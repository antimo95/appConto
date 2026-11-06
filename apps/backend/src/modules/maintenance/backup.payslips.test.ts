import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

/**
 * Backup e verifica con i documenti dei cedolini (manifest v2).
 *
 * I PDF stanno nel database, quindi l'impronta del file li copre già. Il
 * manifest v2 aggiunge però l'elenco dei documenti — identificativo, hash,
 * byte — e la verifica lo confronta con l'audit del file: un backup i cui
 * documenti non sono quelli dichiarati non è un backup.
 *
 * ## Isolamento
 *
 * Radice dati temporanea scelta prima degli import: database, backup, log e
 * temporanei di questo file stanno tutti sotto `os.tmpdir()`.
 */

const dataRoot = mkdtempSync(path.join(tmpdir(), 'appconto-backup-payslips-'));
process.env.DATABASE_FILE = path.join(dataRoot, 'database.sqlite');

const { config } = await import('../../config.js');
const { closeDatabase, db, runMigrations } = await import('../../db/client.js');
const { openSqlite } = await import('../../db/sqlite.js');
const { readDatabaseSchema } = await import('../../db/schema-version.js');
const { sql } = await import('drizzle-orm');
const { BACKUP_FORMAT, LEGACY_BACKUP_FORMAT, parseManifest, sha256OfFile } = await import('./backup.manifest.js');
const { BackupFailedError, backupService } = await import('./backup.service.js');
const { restoreService } = await import('./restore.service.js');
const { payslipsService } = await import('../payslips/index.js');
const { syntheticPayslipPdf } = await import('../payslips/testing/payslip-fixtures.js');

runMigrations();

after(() => {
  closeDatabase();
  try {
    rmSync(dataRoot, { recursive: true, force: true });
  } catch {
    // su Windows il file può restare bloccato: è comunque una cartella temporanea
  }
});

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

interface Confermato {
  id: string;
  pdf: Buffer;
  fileName: string;
}

async function conferma(month: string, fileName: string): Promise<Confermato> {
  const pdf = syntheticPayslipPdf({ month });
  const analysis = await payslipsService.analyze(pdf, fileName);
  const detail = payslipsService.create({ analysisId: analysis.id, ...analysis.draft });

  return { id: detail.id, pdf, fileName };
}

const confermati = [
  await conferma('Gennaio 2026', 'busta-gennaio.pdf'),
  await conferma('Febbraio 2026', 'busta-febbraio.pdf'),
];

// Un cedolino della versione precedente il cui file non è stato ritrovato.
const senzaDocumento = await conferma('Marzo 2026', 'busta-marzo.pdf');
db.run(sql`delete from payslip_documents where payslip_id = ${senzaDocumento.id}`);

const attese = confermati
  .map((cedolino) => ({ payslipId: cedolino.id, sha256: sha256(cedolino.pdf), bytes: cedolino.pdf.length }))
  .sort((a, b) => a.payslipId.localeCompare(b.payslipId));

/** Nessun messaggio deve contenere dati dei cedolini. */
function senzaDatiDeiCedolini(testo: string): void {
  for (const vietato of ['ROSSI', 'MARIO', 'RSSMRA', 'Esempio Lavoro', 'busta-', '169800', '1.698,00']) {
    assert.ok(!testo.includes(vietato), `"${vietato}" non deve comparire in: ${testo}`);
  }
}

const manifestDi = (nome: string): string => path.join(config.backupsDir, nome.replace('.sqlite', '.json'));

function leggiManifest(nome: string): Record<string, unknown> {
  return JSON.parse(readFileSync(manifestDi(nome), 'utf8')) as Record<string, unknown>;
}

function scriviManifest(nome: string, manifest: unknown): void {
  writeFileSync(manifestDi(nome), JSON.stringify(manifest, null, 2), 'utf8');
}

/** Riscrive impronta e dimensione nel manifest perché corrispondano al file modificato. */
function riallineaImpronta(nome: string): void {
  const file = path.join(config.backupsDir, nome);
  const manifest = leggiManifest(nome);
  manifest.databaseSha256 = sha256OfFile(file);
  manifest.databaseBytes = statSync(file).size;
  scriviManifest(nome, manifest);
}

let secondi = 0;

/** Un backup valido, con un istante diverso ad ogni chiamata. */
function backupFresco(): string {
  secondi += 1;

  return backupService.create('manual', new Date(2026, 10, 4, 9, 0, secondi)).name;
}

type Documenti = { entries: { payslipId: string; sha256: string; bytes: number }[]; withoutDocument: number };

function documentiDi(nome: string): Documenti {
  return leggiManifest(nome).payslipDocuments as Documenti;
}

function rifiutato(nome: string): string {
  const check = backupService.verify(nome);
  assert.ok(!check.ok, 'il backup doveva essere rifiutato');
  senzaDatiDeiCedolini(check.problem);

  return check.problem;
}

describe('isolamento del test', () => {
  it('database, backup e temporanei stanno in una cartella temporanea', () => {
    for (const cartella of [config.dataRoot, config.backupsDir, config.tmpDir]) {
      assert.ok(cartella.startsWith(dataRoot));
    }
  });
});

describe('manifest v2', () => {
  it('il formato corrente è il 2, il precedente resta riconosciuto', () => {
    assert.equal(BACKUP_FORMAT, 'appconto-backup/2');
    assert.equal(LEGACY_BACKUP_FORMAT, 'appconto-backup/1');
  });

  it('elenca i documenti dei cedolini confermati, e conta quelli senza', () => {
    const nome = backupFresco();
    const manifest = leggiManifest(nome);

    assert.equal(manifest.format, 'appconto-backup/2');
    assert.deepEqual(manifest.payslipDocuments, { entries: attese, withoutDocument: 1 });

    // L'hash dichiarato è quello del cedolino in archivio.
    for (const entry of attese) {
      const registrato = db.get<{ sha256: string }>(sql`select sha256 from payslips where id = ${entry.payslipId}`);
      assert.equal(entry.sha256, registrato?.sha256);
    }

    const check = backupService.verify(nome);
    assert.ok(check.ok, check.ok ? '' : check.problem);
    assert.deepEqual(check.manifest.payslipDocuments, { entries: attese, withoutDocument: 1 });
  });

  it('il manifest contiene identificativi, hash e byte: nessun dato dei cedolini', () => {
    const testo = readFileSync(manifestDi(backupFresco()), 'utf8');
    senzaDatiDeiCedolini(testo);
  });

  it('parseManifest rifiuta un v2 senza documenti e accetta un v1 senza', () => {
    const manifest = leggiManifest(backupFresco());
    const { payslipDocuments: _documenti, ...senza } = manifest;

    assert.equal(parseManifest(JSON.stringify(manifest)).ok, true);
    assert.equal(parseManifest(JSON.stringify(senza)).ok, false);
    assert.equal(parseManifest(JSON.stringify({ ...senza, format: 'appconto-backup/1' })).ok, true);
    assert.equal(parseManifest(JSON.stringify({ ...manifest, format: 'appconto-backup/3' })).ok, false);
  });
});

describe('verifica: ogni differenza fa rifiutare il backup', () => {
  it('manifest che non è JSON', () => {
    const nome = backupFresco();
    writeFileSync(manifestDi(nome), '{ "format": "appconto-backup/2", ', 'utf8');

    rifiutato(nome);
  });

  it('manifest v2 senza la sezione dei documenti', () => {
    const nome = backupFresco();
    const manifest = leggiManifest(nome);
    delete manifest.payslipDocuments;
    scriviManifest(nome, manifest);

    rifiutato(nome);
  });

  it('hash di un documento alterato nel manifest', () => {
    const nome = backupFresco();
    const manifest = leggiManifest(nome);
    const documenti = manifest.payslipDocuments as Documenti;
    const primo = documenti.entries[0];
    assert.ok(primo !== undefined);
    primo.sha256 = `${primo.sha256.startsWith('0') ? '1' : '0'}${primo.sha256.slice(1)}`;
    scriviManifest(nome, manifest);

    rifiutato(nome);
  });

  it('byte di un documento alterati nel manifest', () => {
    const nome = backupFresco();
    const manifest = leggiManifest(nome);
    const primo = (manifest.payslipDocuments as Documenti).entries[0];
    assert.ok(primo !== undefined);
    primo.bytes += 1;
    scriviManifest(nome, manifest);

    rifiutato(nome);
  });

  it('un documento mancante nel manifest (elenco incompleto)', () => {
    const nome = backupFresco();
    const manifest = leggiManifest(nome);
    (manifest.payslipDocuments as Documenti).entries.pop();
    scriviManifest(nome, manifest);

    rifiutato(nome);
  });

  it('un documento in più nel manifest', () => {
    const nome = backupFresco();
    const manifest = leggiManifest(nome);
    (manifest.payslipDocuments as Documenti).entries.push({
      payslipId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      sha256: 'f'.repeat(64),
      bytes: 1234,
    });
    scriviManifest(nome, manifest);

    rifiutato(nome);
  });

  it('conteggio dei cedolini senza documento diverso', () => {
    const nome = backupFresco();
    const manifest = leggiManifest(nome);
    (manifest.payslipDocuments as Documenti).withoutDocument = 0;
    scriviManifest(nome, manifest);

    rifiutato(nome);
  });

  it('documento alterato dentro lo snapshot, con impronta del file riallineata', () => {
    const nome = backupFresco();
    const file = path.join(config.backupsDir, nome);
    const bersaglio = confermati[0];
    assert.ok(bersaglio !== undefined);

    // Stessa lunghezza, contenuto diverso: l'impronta del file viene poi
    // riscritta nel manifest, quindi solo il controllo dei documenti può
    // accorgersene.
    const alterato = Buffer.from(bersaglio.pdf);
    const posizione = alterato.indexOf('ROSSI MARIO', 0, 'latin1');
    assert.ok(posizione > 0);
    alterato.write('BIANCHI GIO', posizione, 'latin1');

    const sqlite = openSqlite(file);
    try {
      sqlite.prepare('update payslip_documents set content = ? where payslip_id = ?').run(alterato, bersaglio.id);
    } finally {
      sqlite.close();
    }
    riallineaImpronta(nome);

    rifiutato(nome);
  });
});

describe('creazione: un documento incoerente blocca il backup', () => {
  it('se un PDF in archivio non ha l\'hash del suo cedolino, non nasce nessun backup', () => {
    const bersaglio = confermati[1];
    assert.ok(bersaglio !== undefined);
    const prima = readdirSync(config.backupsDir).sort();

    const alterato = Buffer.concat([bersaglio.pdf, Buffer.from('\n% byte in piu\n', 'latin1')]);
    db.run(sql`update payslip_documents set content = ${alterato} where payslip_id = ${bersaglio.id}`);

    try {
      assert.throws(
        () => backupService.create('manual', new Date(2026, 10, 4, 12, 0, 0)),
        (error: unknown) => {
          assert.ok(error instanceof BackupFailedError, `atteso BackupFailedError, ricevuto ${String(error)}`);
          senzaDatiDeiCedolini(error.message);

          return true;
        },
      );

      assert.deepEqual(readdirSync(config.backupsDir).sort(), prima, 'nulla di nuovo in backups/');
      assert.deepEqual(
        readdirSync(config.tmpDir).filter((nome) => nome.endsWith('.partial')),
        [],
        'nessun residuo di lavoro in tmp/',
      );
    } finally {
      db.run(sql`update payslip_documents set content = ${bersaglio.pdf} where payslip_id = ${bersaglio.id}`);
    }

    // Riparato il documento, il backup torna possibile.
    assert.ok(backupService.verify(backupFresco()).ok);
  });
});

describe('compatibilità con i backup anteriori ai documenti (v1)', () => {
  /**
   * Un backup scritto da una versione che non conosceva i cedolini: lo schema
   * si ferma alla migrazione 0009, e il manifest è un v1.
   */
  function backupV1Anteriore(nome: string): void {
    const journal = JSON.parse(
      readFileSync(path.join(config.migrationsFolder, 'meta', '_journal.json'), 'utf8'),
    ) as { entries: { idx: number; tag: string }[] };
    const cartella = path.join(dataRoot, 'migrazioni-0009');
    mkdirSync(path.join(cartella, 'meta'), { recursive: true });
    const voci = journal.entries.filter((voce) => voce.idx <= 9);
    for (const voce of voci) {
      copyFileSync(path.join(config.migrationsFolder, `${voce.tag}.sql`), path.join(cartella, `${voce.tag}.sql`));
    }
    writeFileSync(
      path.join(cartella, 'meta', '_journal.json'),
      JSON.stringify({ version: '7', dialect: 'sqlite', entries: voci }),
      'utf8',
    );

    const file = path.join(config.backupsDir, nome);
    const sqlite = openSqlite(file);
    let schema;
    try {
      migrate(drizzle(sqlite), { migrationsFolder: cartella });
      sqlite.pragma('journal_mode = DELETE');
      schema = readDatabaseSchema(sqlite);
    } finally {
      sqlite.close();
    }

    scriviManifest(nome, {
      format: 'appconto-backup/1',
      kind: 'manual',
      createdAt: new Date(2025, 0, 1, 10, 0, 0).toISOString(),
      appVersion: '0.9.0',
      schemaVersion: schema,
      databaseFile: nome,
      databaseBytes: statSync(file).size,
      databaseSha256: sha256OfFile(file),
      rowCounts: {},
    });
  }

  it('un v1 anteriore alla feature si verifica e si può preparare per il ripristino', () => {
    const nome = 'manual-20250101-100000.sqlite';
    backupV1Anteriore(nome);

    const check = backupService.verify(nome);
    assert.ok(check.ok, check.ok ? '' : check.problem);
    assert.equal(check.manifest.format, 'appconto-backup/1');

    const elencato = backupService.list().find((info) => info.name === nome);
    assert.equal(elencato?.status, 'completo');

    const staged = restoreService.stage(nome, new Date(2026, 10, 4, 13, 0, 0));
    assert.equal(staged.backupName, nome);
    assert.equal(restoreService.cancel(), true);
  });

  it('un v1 il cui database contiene documenti dei cedolini non è autentico: rifiutato', () => {
    const nome = backupFresco();
    const manifest = leggiManifest(nome);
    delete manifest.payslipDocuments;
    manifest.format = 'appconto-backup/1';
    scriviManifest(nome, manifest);

    rifiutato(nome);
  });

  it('un v1 con lo schema corrente ma senza documenti si verifica', () => {
    const nome = backupFresco();
    const file = path.join(config.backupsDir, nome);
    const sqlite = openSqlite(file);
    try {
      sqlite.exec('delete from payslip_documents; delete from payslip_items; delete from payslip_leave_balances; delete from payslips;');
      sqlite.exec('VACUUM');
    } finally {
      sqlite.close();
    }
    const manifest = leggiManifest(nome);
    delete manifest.payslipDocuments;
    manifest.format = 'appconto-backup/1';
    scriviManifest(nome, manifest);
    riallineaImpronta(nome);

    const check = backupService.verify(nome);
    assert.ok(check.ok, check.ok ? '' : check.problem);
  });
});

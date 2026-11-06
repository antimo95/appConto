import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

/**
 * Il ripristino porta con sé i documenti dei cedolini.
 *
 * Il meccanismo è quello di sempre — verifica, backup pre-restore,
 * candidato, scambio all'avvio — e non sa nulla dei cedolini: i PDF sono
 * nel database, quindi tornano con lui. Qui lo si prova fino in fondo, nello
 * stesso processo: la richiesta prepara, poi la connessione si chiude e lo
 * scambio viene applicato come all'avvio, con `applyPendingRestore` sui
 * percorsi della configurazione.
 *
 * ## Isolamento
 *
 * Radice dati temporanea scelta prima degli import.
 */

const dataRoot = mkdtempSync(path.join(tmpdir(), 'appconto-restore-payslips-'));
process.env.DATABASE_FILE = path.join(dataRoot, 'database.sqlite');

const { config } = await import('../../config.js');
const { closeDatabase, runMigrations } = await import('../../db/client.js');
const { openSqlite } = await import('../../db/sqlite.js');
const { backupService } = await import('./backup.service.js');
const { restoreService } = await import('./restore.service.js');
const { applyPendingRestore } = await import('./restore-pending.js');
const { auditPayslipDocuments, payslipsService } = await import('../payslips/index.js');
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

async function conferma(month: string): Promise<{ id: string; pdf: Buffer }> {
  const pdf = syntheticPayslipPdf({ month });
  const analysis = await payslipsService.analyze(pdf, 'cedolino.pdf');
  const detail = payslipsService.create({ analysisId: analysis.id, ...analysis.draft });

  return { id: detail.id, pdf };
}

describe('isolamento del test', () => {
  it('lavora su una radice dati temporanea', () => {
    for (const cartella of [config.dataRoot, config.backupsDir, config.tmpDir]) {
      assert.ok(cartella.startsWith(dataRoot));
    }
  });
});

describe('ripristino completo con i documenti', () => {
  it('torna il cedolino eliminato, con il suo PDF, e sparisce quello aggiunto dopo', async () => {
    const originale = await conferma('Ottobre 2026');
    const backup = backupService.create('manual', new Date(2026, 10, 4, 9, 0, 0)).name;
    assert.ok(backupService.verify(backup).ok);

    // Dopo il backup: l'originale si elimina, un altro si aggiunge.
    payslipsService.remove(originale.id);
    const aggiunto = await conferma('Novembre 2026');

    const staged = restoreService.stage(backup, new Date(2026, 10, 4, 10, 0, 0));
    assert.equal(staged.backupName, backup);
    assert.equal(staged.rowCounts.payslip_documents, 1);

    // Il backup pre-restore contiene l'archivio di adesso, con il suo documento.
    const preRestore = backupService.verify(staged.preRestoreBackup);
    assert.ok(preRestore.ok);
    assert.deepEqual(
      preRestore.manifest.payslipDocuments?.entries.map((entry) => entry.payslipId),
      [aggiunto.id],
    );

    // Il "riavvio": nessuna connessione aperta, poi lo scambio.
    closeDatabase();
    const esito = applyPendingRestore(
      {
        dataRoot: config.dataRoot,
        databaseFile: config.databaseFile,
        tmpDir: config.tmpDir,
        migrationsFolder: config.migrationsFolder,
      },
      new Date(2026, 10, 4, 10, 5, 0),
    );
    assert.equal(esito.kind, 'applicato', JSON.stringify(esito));

    const sqlite = openSqlite(config.databaseFile, { readonly: true, fileMustExist: true });
    try {
      const cedolini = sqlite.prepare('select id, sha256 from payslips order by id').all() as {
        id: string;
        sha256: string;
      }[];
      assert.deepEqual(cedolini, [{ id: originale.id, sha256: sha256(originale.pdf) }]);

      const documento = sqlite
        .prepare('select content from payslip_documents where payslip_id = ?')
        .get(originale.id) as { content: Buffer } | undefined;
      assert.ok(documento !== undefined, 'il documento è tornato con il cedolino');
      assert.ok(Buffer.from(documento.content).equals(originale.pdf));
      assert.equal(sha256(documento.content), cedolini[0]?.sha256);

      assert.deepEqual(auditPayslipDocuments(sqlite), {
        entries: [{ payslipId: originale.id, sha256: sha256(originale.pdf), bytes: originale.pdf.length }],
        withoutDocument: 0,
        mismatched: [],
      });

      const residuo = sqlite.prepare('select count(*) as c from payslips where id = ?').get(aggiunto.id) as {
        c: number;
      };
      assert.equal(residuo.c, 0);
    } finally {
      sqlite.close();
    }

    // Nessun PDF sul disco: né della versione precedente, né di un'analisi.
    const legacy = path.join(config.dataRoot, 'payslips');
    assert.deepEqual(existsSync(legacy) ? readdirSync(legacy) : [], []);
    const analisi = path.join(config.tmpDir, 'payslip-analyses');
    assert.deepEqual(existsSync(analisi) ? readdirSync(analisi) : [], []);
  });
});

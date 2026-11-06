import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

/**
 * L'audit dei documenti dei cedolini.
 *
 * È ciò che backup e ripristino usano per sapere se i PDF dentro un file
 * SQLite sono quelli che i cedolini dichiarano: uno per cedolino, con
 * l'hash registrato. Qui lo si prova su database costruiti apposta, aperti
 * da fuori come li apre la manutenzione — mai sulla connessione
 * dell'applicazione.
 *
 * ## Isolamento
 *
 * `DATABASE_FILE` viene impostato prima degli import: il logger e i percorsi
 * vengono risolti al caricamento dei moduli.
 */

const radice = mkdtempSync(path.join(tmpdir(), 'appconto-audit-'));
process.env.DATABASE_FILE = path.join(radice, 'log-sink', 'database.sqlite');

const { config } = await import('../../config.js');
const { openSqlite } = await import('../../db/sqlite.js');
const { syntheticPayslipPdf } = await import('./testing/payslip-fixtures.js');
const { auditPayslipDocuments } = await import('./payslip-documents.audit.js');
const featureIndex = await import('./index.js');

after(() => {
  try {
    rmSync(radice, { recursive: true, force: true });
  } catch {
    // su Windows il file può restare bloccato: è comunque una cartella temporanea
  }
});

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

let contatore = 0;

/** Un database nuovo, con lo schema corrente dell'applicazione. */
function databaseAggiornato(): string {
  contatore += 1;
  const file = path.join(radice, `archivio-${String(contatore)}.sqlite`);
  const sqlite = openSqlite(file);
  try {
    migrate(drizzle(sqlite), { migrationsFolder: config.migrationsFolder });
  } finally {
    sqlite.close();
  }

  return file;
}

/** Un cedolino scritto a mano, con o senza documento. */
function inserisciCedolino(
  file: string,
  cedolino: { id: string; period: string; pdf: Buffer; conDocumento: boolean },
): void {
  const sqlite = openSqlite(file);
  try {
    sqlite
      .prepare(
        `insert into payslips (id, period, employer, file_name, sha256, imported_at, parser_id,
           total_earnings_cents, total_deductions_cents, net_cents)
         values (?, ?, null, 'cedolino.pdf', ?, '2026-11-04T10:00:00.000Z', 'manual', 1, 0, 1)`,
      )
      .run(cedolino.id, cedolino.period, sha256(cedolino.pdf));
    if (cedolino.conDocumento) {
      sqlite
        .prepare('insert into payslip_documents (payslip_id, content) values (?, ?)')
        .run(cedolino.id, cedolino.pdf);
    }
  } finally {
    sqlite.close();
  }
}

/** L'audit come lo esegue la manutenzione: su una connessione in sola lettura. */
function audit(file: string) {
  const sqlite = openSqlite(file, { readonly: true, fileMustExist: true });
  try {
    return auditPayslipDocuments(sqlite);
  } finally {
    sqlite.close();
  }
}

// Identificativi volutamente fuori ordine rispetto all'inserimento.
const ID_A = '0a000000-0000-4000-8000-00000000000a';
const ID_B = '0b000000-0000-4000-8000-00000000000b';
const ID_C = '0c000000-0000-4000-8000-00000000000c';

const PDF_A = syntheticPayslipPdf({ month: 'Gennaio 2026' });
const PDF_B = syntheticPayslipPdf({ month: 'Febbraio 2026' });
const PDF_C = syntheticPayslipPdf({ month: 'Marzo 2026' });

describe('API pubblica', () => {
  it('l\'audit è esportato dalla feature', () => {
    assert.equal(featureIndex.auditPayslipDocuments, auditPayslipDocuments);
  });
});

describe('database senza le tabelle dei cedolini', () => {
  it('un backup anteriore alla feature non ha documenti da controllare', () => {
    const file = path.join(radice, 'anteriore.sqlite');
    const sqlite = openSqlite(file);
    sqlite.exec('create table transactions (id text primary key)');
    sqlite.close();

    assert.deepEqual(audit(file), { entries: [], withoutDocument: 0, mismatched: [] });
  });
});

describe('database con documenti', () => {
  it('un archivio senza cedolini ha un audit vuoto', () => {
    assert.deepEqual(audit(databaseAggiornato()), { entries: [], withoutDocument: 0, mismatched: [] });
  });

  it('elenca un documento per cedolino, ordinati per identificativo, con hash e byte', () => {
    const file = databaseAggiornato();
    inserisciCedolino(file, { id: ID_C, period: '2026-03', pdf: PDF_C, conDocumento: true });
    inserisciCedolino(file, { id: ID_A, period: '2026-01', pdf: PDF_A, conDocumento: true });
    inserisciCedolino(file, { id: ID_B, period: '2026-02', pdf: PDF_B, conDocumento: true });

    assert.deepEqual(audit(file), {
      entries: [
        { payslipId: ID_A, sha256: sha256(PDF_A), bytes: PDF_A.length },
        { payslipId: ID_B, sha256: sha256(PDF_B), bytes: PDF_B.length },
        { payslipId: ID_C, sha256: sha256(PDF_C), bytes: PDF_C.length },
      ],
      withoutDocument: 0,
      mismatched: [],
    });
  });

  it('conta i cedolini senza documento, senza elencarli fra i documenti', () => {
    const file = databaseAggiornato();
    inserisciCedolino(file, { id: ID_A, period: '2026-01', pdf: PDF_A, conDocumento: true });
    inserisciCedolino(file, { id: ID_B, period: '2026-02', pdf: PDF_B, conDocumento: false });
    inserisciCedolino(file, { id: ID_C, period: '2026-03', pdf: PDF_C, conDocumento: false });

    const esito = audit(file);

    assert.deepEqual(esito.entries, [{ payslipId: ID_A, sha256: sha256(PDF_A), bytes: PDF_A.length }]);
    assert.equal(esito.withoutDocument, 2);
    assert.deepEqual(esito.mismatched, []);
  });

  it('un documento alterato con SQL è segnalato, anche se la lunghezza non cambia', () => {
    const file = databaseAggiornato();
    inserisciCedolino(file, { id: ID_A, period: '2026-01', pdf: PDF_A, conDocumento: true });
    inserisciCedolino(file, { id: ID_B, period: '2026-02', pdf: PDF_B, conDocumento: true });

    // Stessa lunghezza, contenuto diverso: solo l'hash può accorgersene.
    const alterato = Buffer.from(PDF_B);
    const posizione = alterato.indexOf('ROSSI MARIO', 0, 'latin1');
    assert.ok(posizione > 0, 'la fixture contiene il nome sintetico');
    alterato.write('BIANCHI GIO', posizione, 'latin1');
    assert.equal(alterato.length, PDF_B.length);

    const sqlite = openSqlite(file);
    sqlite.prepare('update payslip_documents set content = ? where payslip_id = ?').run(alterato, ID_B);
    sqlite.close();

    const esito = audit(file);

    assert.deepEqual(esito.mismatched, [ID_B]);
    assert.ok(esito.entries.some((entry) => entry.payslipId === ID_A && entry.sha256 === sha256(PDF_A)));
  });

  it('il risultato contiene solo identificativi, hash e byte', () => {
    const file = databaseAggiornato();
    inserisciCedolino(file, { id: ID_A, period: '2026-01', pdf: PDF_A, conDocumento: true });

    const testo = JSON.stringify(audit(file));
    assert.ok(!testo.includes('ROSSI'));
    assert.ok(!testo.includes('cedolino.pdf'));
    assert.ok(!testo.includes('2026-01'));
    for (const entry of audit(file).entries) {
      assert.deepEqual(Object.keys(entry).sort(), ['bytes', 'payslipId', 'sha256']);
    }
  });
});

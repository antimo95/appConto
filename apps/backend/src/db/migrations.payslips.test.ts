import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

/**
 * Le migrazioni dei cedolini, provate su un archivio che ne contiene già.
 *
 * Chi aggiorna l'applicazione ha cedolini salvati con lo schema precedente:
 * la migrazione deve conservarli. Si parte da uno schema fermo a una
 * migrazione, vi si scrive con SQL grezzo come avrebbe fatto la versione di
 * allora, e poi si applica il resto.
 *
 * ## Isolamento
 *
 * `DATABASE_FILE` viene impostato prima degli import: i percorsi vengono
 * risolti al caricamento dei moduli. I database di prova stanno in una
 * cartella temporanea.
 */

const radice = mkdtempSync(path.join(tmpdir(), 'appconto-migrations-payslips-'));
process.env.DATABASE_FILE = path.join(radice, 'log-sink', 'database.sqlite');

const { config } = await import('../config.js');
const { openSqlite } = await import('./sqlite.js');
const { migrateUntil } = await import('../modules/payslips/testing/migrate-until.js');

after(() => {
  try {
    rmSync(radice, { recursive: true, force: true });
  } catch {
    // su Windows il file può restare bloccato: è comunque una cartella temporanea
  }
});

let contatore = 0;

function nuovoFile(): string {
  contatore += 1;

  return path.join(radice, `archivio-${String(contatore)}.sqlite`);
}

/** Applica al file tutte le migrazioni mancanti, come l'avvio dell'applicazione. */
function migraTutto(file: string): void {
  const sqlite = openSqlite(file);
  try {
    migrate(drizzle(sqlite), { migrationsFolder: config.migrationsFolder });
  } finally {
    sqlite.close();
  }
}

/** Un cedolino come lo scriveva la versione con `stored_path` (migrazione 0010). */
function cedolinoV0010(sqlite: ReturnType<typeof openSqlite>, id: string, period: string): void {
  sqlite
    .prepare(
      `insert into payslips (id, period, employer, file_name, sha256, stored_path, imported_at, parser_id,
         total_earnings_cents, total_deductions_cents, net_cents)
       values (?, ?, null, 'cedolino.pdf', ?, 'payslips/vecchio.pdf', '2026-11-04T10:00:00.000Z', 'manual', 1, 0, 1)`,
    )
    .run(id, period, `hash-${id}`);
}

const colonne = (sqlite: ReturnType<typeof openSqlite>, tabella: string): string[] =>
  (sqlite.pragma(`table_info(${tabella})`) as { name: string }[]).map((colonna) => colonna.name);

describe('migrazione 0010 -> 0011 (il PDF passa nel database)', () => {
  it('conserva cedolini e voci, toglie stored_path e crea i documenti vuoti', () => {
    const file = nuovoFile();
    migrateUntil(file, 10);

    const prima = openSqlite(file);
    try {
      assert.ok(colonne(prima, 'payslips').includes('stored_path'));
      cedolinoV0010(prima, 'p-1', '2026-09');
      prima
        .prepare(
          `insert into payslip_items (id, payslip_id, position, code, description, section, amount_cents)
           values ('i-1', 'p-1', 0, 'F01', 'Retribuzione', 'earning', 100)`,
        )
        .run();
    } finally {
      prima.close();
    }

    migraTutto(file);

    const dopo = openSqlite(file);
    try {
      assert.equal((dopo.prepare('select count(*) as n from payslips').get() as { n: number }).n, 1);
      assert.equal(
        (dopo.prepare("select description from payslip_items where id = 'i-1'").get() as { description: string })
          .description,
        'Retribuzione',
      );
      assert.ok(!colonne(dopo, 'payslips').includes('stored_path'));
      assert.deepEqual(
        dopo.prepare("select name from sqlite_master where type = 'table' and name = 'payslip_documents'").all(),
        [{ name: 'payslip_documents' }],
      );
      assert.equal((dopo.prepare('select count(*) as n from payslip_documents').get() as { n: number }).n, 0);
    } finally {
      dopo.close();
    }
  });
});

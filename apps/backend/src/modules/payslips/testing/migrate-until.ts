import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { config } from '../../../config.js';
import { openSqlite } from '../../../db/sqlite.js';

/**
 * Porta un database allo schema di una versione passata dell'applicazione.
 *
 * Copia in una cartella temporanea le migrazioni con `idx <= lastIdx` e le
 * applica al file: serve ai test che devono partire da uno schema anteriore
 * (un backup vecchio, una migrazione da provare) e poi applicare il resto con
 * `migrate` sulla cartella completa.
 *
 * Va importato dopo che il test ha scelto `DATABASE_FILE`, come ogni modulo
 * che legge `config`.
 */
export function migrateUntil(databaseFile: string, lastIdx: number): void {
  const journal = JSON.parse(
    readFileSync(path.join(config.migrationsFolder, 'meta', '_journal.json'), 'utf8'),
  ) as { entries: { idx: number; tag: string }[] };
  const voci = journal.entries.filter((voce) => voce.idx <= lastIdx);

  const cartella = mkdtempSync(path.join(tmpdir(), 'appconto-migrazioni-'));
  const sqlite = openSqlite(databaseFile);
  try {
    mkdirSync(path.join(cartella, 'meta'), { recursive: true });
    for (const voce of voci) {
      copyFileSync(path.join(config.migrationsFolder, `${voce.tag}.sql`), path.join(cartella, `${voce.tag}.sql`));
    }
    writeFileSync(
      path.join(cartella, 'meta', '_journal.json'),
      JSON.stringify({ version: '7', dialect: 'sqlite', entries: voci }),
      'utf8',
    );

    migrate(drizzle(sqlite), { migrationsFolder: cartella });
  } finally {
    sqlite.close();
    rmSync(cartella, { recursive: true, force: true });
  }
}

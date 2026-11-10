import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after } from 'node:test';

/**
 * L'app HTTP completa (`createApp`) su un database temporaneo e una porta
 * assegnata dal sistema, per i test dei contratti HTTP.
 *
 * Imposta `DATABASE_FILE` **prima** di importare app e database: va chiamata
 * con `await` al livello superiore del file di test, prima di qualunque altro
 * import che raggiunga `db/client`. I service si importano dopo, con
 * `await import(...)`. Chiusura e pulizia sono registrate con `after`.
 */

export interface TestResponse {
  readonly status: number;
  readonly text: string;
  /** Il corpo come JSON, o `undefined` se è vuoto. */
  readonly body: unknown;
}

export interface TestApp {
  /** Una richiesta verso l'app; un `json` diventa il corpo con `Content-Type: application/json`. */
  request(pathname: string, init?: RequestInit & { json?: unknown }): Promise<TestResponse>;
}

export async function startTestApp(prefix: string): Promise<TestApp> {
  const dataRoot = mkdtempSync(path.join(tmpdir(), `appconto-${prefix}-`));
  const databaseFile = path.join(dataRoot, 'database.sqlite');
  process.env.DATABASE_FILE = databaseFile;

  const { createApp } = await import('../app.js');
  const { config } = await import('../config.js');
  const { closeDatabase, runMigrations } = await import('../db/client.js');

  // Se `db/client` fosse già stato caricato da un import precedente, il database aperto non sarebbe questo.
  assert.equal(config.databaseFile, databaseFile, 'startTestApp va chiamata prima degli import che aprono il database');

  runMigrations();

  const frontendDir = mkdtempSync(path.join(tmpdir(), `appconto-${prefix}-fe-`));
  const server = createApp(frontendDir).listen(0, config.host);
  await new Promise<void>((resolve) => {
    server.once('listening', resolve);
  });
  const base = `http://${config.host}:${String((server.address() as AddressInfo).port)}`;

  after(() => {
    server.close();
    closeDatabase();
    for (const cartella of [dataRoot, frontendDir]) {
      try {
        rmSync(cartella, { recursive: true, force: true });
      } catch {
        // su Windows il file può restare bloccato: sono cartelle temporanee
      }
    }
  });

  return {
    async request(pathname, { json, ...init } = {}) {
      const response = await fetch(
        `${base}${pathname}`,
        json === undefined
          ? init
          : {
              ...init,
              headers: { 'Content-Type': 'application/json', ...init.headers },
              body: JSON.stringify(json),
            },
      );
      const text = await response.text();

      return { status: response.status, text, body: text.length > 0 ? (JSON.parse(text) as unknown) : undefined };
    },
  };
}

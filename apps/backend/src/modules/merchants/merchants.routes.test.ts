import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

/** L'API dei merchant: forma della risposta e passaggio dei criteri al servizio. */

const dataRoot = mkdtempSync(path.join(tmpdir(), 'appconto-merchantsapi-'));
process.env.DATABASE_FILE = path.join(dataRoot, 'database.sqlite');

const { createApp } = await import('../../app.js');
const { config } = await import('../../config.js');
const { closeDatabase, runMigrations } = await import('../../db/client.js');

runMigrations();

const frontendDir = mkdtempSync(path.join(tmpdir(), 'appconto-merchantsapi-fe-'));
const server = createApp(frontendDir).listen(0, config.host);
await new Promise<void>((resolve) => {
  server.once('listening', resolve);
});
const { port } = server.address() as AddressInfo;

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

const base = `http://${config.host}:${String(port)}`;

async function leggi(percorso: string): Promise<{ status: number; body: unknown }> {
  const risposta = await fetch(`${base}${percorso}`);

  return { status: risposta.status, body: await risposta.json() };
}

interface Pagina {
  items: unknown[];
  counts: unknown;
  pagination: { pageSize: number };
}

describe('API dei merchant', () => {
  it('GET /merchants restituisce items, pagination e counts', async () => {
    const { status, body } = await leggi('/api/merchants');
    const pagina = body as Pagina;
    assert.equal(status, 200);
    assert.ok(Array.isArray(pagina.items));
    assert.ok('counts' in pagina);
    assert.equal(pagina.pagination.pageSize, 25);
  });

  it('GET /merchants passa i criteri al servizio', async () => {
    const { status, body } = await leggi('/api/merchants?sortBy=name&sortDirection=asc&pageSize=50');
    assert.equal(status, 200);
    assert.equal((body as Pagina).pagination.pageSize, 50);
  });

  it('GET /merchants rifiuta un ordinamento non consentito', async () => {
    const { status } = await leggi('/api/merchants?sortBy=foo');
    assert.equal(status, 400);
  });

  it('GET /merchants/summary resta un array', async () => {
    const { body } = await leggi('/api/merchants/summary');
    assert.ok(Array.isArray(body));
  });
});

async function modifica(percorso: string, corpo: unknown): Promise<{ status: number; body: unknown }> {
  const risposta = await fetch(`${base}${percorso}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(corpo),
  });

  return { status: risposta.status, body: await risposta.json() };
}

describe('PATCH dei merchant: errori', () => {
  it('PATCH /merchants/:id con {} → 400', async () => {
    assert.deepEqual(await modifica('/api/merchants/qualsiasi', {}), {
      status: 400,
      body: { error: 'Il corpo della richiesta deve contenere "displayName".' },
    });
  });

  it('PATCH /merchants/:id/category su un merchant inesistente → 404 sul merchant, prima della categoria', async () => {
    assert.deepEqual(await modifica('/api/merchants/m-assente/category', { categoryId: 'c-assente' }), {
      status: 404,
      body: { error: 'Merchant "m-assente" non trovato.' },
    });
  });
});

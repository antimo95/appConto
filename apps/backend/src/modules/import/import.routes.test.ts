import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { startTestApp } from '../../test-support/http-app.js';

/** Contratto HTTP di `/api/import`: risposte e messaggi di oggi. */

const app = await startTestApp('importapi');
const { config } = await import('../../config.js');

const csv = (body: string) => ({ method: 'POST', headers: { 'Content-Type': 'text/csv' }, body });
async function post(url: string, init: Parameters<typeof app.request>[1]) {
  const reply = await app.request(url, init);
  return { status: reply.status, body: reply.body };
}

describe('POST /api/import/csv', () => {
  it('Content-Type JSON → 400', async () => {
    assert.deepEqual(await post('/api/import/csv', { method: 'POST', json: {} }), { status: 400, body: { error: 'Il corpo della richiesta deve contenere il CSV con Content-Type "text/csv".' } });
  });

  for (const [nome, contenuto] of [['vuoto', ''], ['solo spazi', '  \n \t\n']] as const) {
    for (const url of ['/api/import/csv', '/api/import/csv/analysis']) {
      it(`CSV ${nome} su ${url} → 400`, async () => {
        assert.deepEqual(await post(url, csv(contenuto)), { status: 400, body: { error: 'Il file CSV è vuoto.' } });
      });
    }
  }

  it('CSV oltre maxCsvSize → 413', async () => {
    const limite = Number.parseInt(config.maxCsvSize, 10) * 1024 * 1024;
    assert.deepEqual(await post('/api/import/csv', csv('a'.repeat(limite + 1))), { status: 413, body: { error: 'Richiesta non valida: il corpo non è leggibile.' } });
  });
});

describe('POST /api/import/csv/mapped', () => {
  it('{} → 400', async () => {
    assert.deepEqual(await post('/api/import/csv/mapped', { method: 'POST', json: {} }), { status: 400, body: { error: 'Contenuto del CSV mancante' } });
  });

  it('senza corpo → 400', async () => {
    assert.deepEqual(await post('/api/import/csv/mapped', { method: 'POST' }), { status: 400, body: { error: 'Invalid input: expected object, received undefined' } });
  });
});

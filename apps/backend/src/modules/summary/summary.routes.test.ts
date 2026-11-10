import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { startTestApp } from '../../test-support/http-app.js';

/** Contratto HTTP di `/api/summary`: risposte e messaggi di oggi. */

const app = await startTestApp('summaryapi');

async function get(query: string) {
  const reply = await app.request('/api/summary' + query);
  return { status: reply.status, body: reply.body };
}

describe('GET /api/summary', () => {
  it('mese valido → 200', async () => {
    assert.equal((await app.request('/api/summary?month=2026-01')).status, 200);
  });

  it('month mancante', async () => {
    assert.deepEqual(await get(''), { status: 400, body: { error: 'Parametro "month" mancante: atteso il formato YYYY-MM.' } });
  });

  it('month ripetuto', async () => {
    assert.deepEqual(await get('?month=2026-01&month=2026-02'), { status: 400, body: { error: 'Parametro "month" mancante: atteso il formato YYYY-MM.' } });
  });

  it('month malformato (2026-13)', async () => {
    assert.deepEqual(await get('?month=2026-13'), { status: 400, body: { error: 'Il mese deve essere indicato nel formato YYYY-MM.' } });
  });

  it('month malformato (abc)', async () => {
    assert.deepEqual(await get('?month=abc'), { status: 400, body: { error: 'Il mese deve essere indicato nel formato YYYY-MM.' } });
  });
});

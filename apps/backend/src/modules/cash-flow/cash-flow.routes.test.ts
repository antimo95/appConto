import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { startTestApp } from '../../test-support/http-app.js';

/** Contratto HTTP di `/api/cash-flow`: risposte e messaggi di oggi. */

const app = await startTestApp('cashflowapi');

async function get(query: string) {
  const reply = await app.request('/api/cash-flow' + query);
  return { status: reply.status, body: reply.body };
}

describe('GET /api/cash-flow', () => {
  it('mese valido → 200', async () => {
    assert.equal((await app.request('/api/cash-flow?month=2026-01')).status, 200);
  });

  it('month mancante', async () => {
    // senza month: tutto l'archivio
    const reply = await get('');
    assert.equal(reply.status, 200);
    assert.equal((reply.body as { month: unknown }).month, null);
  });

  it('month ripetuto', async () => {
    assert.deepEqual(await get('?month=2026-01&month=2026-02'), { status: 400, body: { error: 'Parametro "month" non valido: atteso il formato YYYY-MM.' } });
  });

  it('month malformato (2026-13)', async () => {
    assert.deepEqual(await get('?month=2026-13'), { status: 400, body: { error: 'Il mese deve essere indicato nel formato YYYY-MM.' } });
  });

  it('month malformato (abc)', async () => {
    assert.deepEqual(await get('?month=abc'), { status: 400, body: { error: 'Il mese deve essere indicato nel formato YYYY-MM.' } });
  });
});

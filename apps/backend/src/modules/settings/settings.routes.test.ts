import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { startTestApp } from '../../test-support/http-app.js';

/** Contratto HTTP di `/api/settings` (T-B): risposte e messaggi di oggi. */

const app = await startTestApp('settingsapi');

const INVALID = {
  error:
    'Impostazioni non valide: "initialBalance" deve essere un numero e "balanceDate" una data YYYY-MM-DD o null.',
};

describe('PATCH /api/settings', () => {
  it('{} → 200 con i valori correnti, invariati', async () => {
    const current = await app.request('/api/settings');

    const reply = await app.request('/api/settings', { method: 'PATCH', json: {} });

    assert.equal(reply.status, 200);
    assert.deepEqual(reply.body, current.body);
  });

  it('un array → 400 con il messaggio fisso', async () => {
    assert.deepEqual(await app.request('/api/settings', { method: 'PATCH', json: [] }), {
      status: 400,
      text: JSON.stringify(INVALID),
      body: INVALID,
    });
  });

  it('senza corpo → 400 con il messaggio fisso', async () => {
    const reply = await app.request('/api/settings', { method: 'PATCH' });

    assert.equal(reply.status, 400);
    assert.deepEqual(reply.body, INVALID);
  });
});

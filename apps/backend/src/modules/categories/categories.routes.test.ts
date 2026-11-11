import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { startTestApp } from '../../test-support/http-app.js';

/** Contratto HTTP di `/api/categories`: risposte e messaggi di oggi. */

const app = await startTestApp('categoriesapi');

const FALLBACK_ID = 'c9bfcd74-e342-4a3f-8b0c-116f89236d51';
const ASSENTE = 'id-che-non-esiste';
const NON_TROVATA = { error: `Categoria "${ASSENTE}" non trovata.` };

async function crea(name: string, color?: string): Promise<{ id: string }> {
  const reply = await app.request('/api/categories', { method: 'POST', json: { name, color } });
  return reply.body as { id: string };
}

describe('POST /api/categories', () => {
  it('crea → 201 con esattamente id, name, color', async () => {
    const reply = await app.request('/api/categories', {
      method: 'POST',
      json: { name: '  Categoria nuova  ', color: '#112233' },
    });

    assert.equal(reply.status, 201);
    const body = reply.body as Record<string, unknown>;
    assert.deepEqual(Object.keys(body).sort(), ['color', 'id', 'name']);
    assert.equal(body['name'], 'Categoria nuova');
    assert.equal(body['color'], '#112233');
  });

  it('un nome già usato → 409', async () => {
    await crea('Duplicata');

    const reply = await app.request('/api/categories', { method: 'POST', json: { name: 'Duplicata' } });

    assert.equal(reply.status, 409);
    assert.deepEqual(reply.body, { error: 'Esiste già una categoria con il nome "Duplicata".' });
  });

  it('senza corpo o con forma errata → 400 con il messaggio fisso', async () => {
    const atteso = { error: 'Il corpo della richiesta deve contenere "name".' };

    for (const init of [{ method: 'POST' }, { method: 'POST', json: {} }, { method: 'POST', json: { name: 5 } }, { method: 'POST', json: { name: '   ' } }]) {
      const reply = await app.request('/api/categories', init);

      assert.equal(reply.status, 400, JSON.stringify(init));
      assert.deepEqual(reply.body, atteso, JSON.stringify(init));
    }
  });
});

describe('PATCH /api/categories/:id', () => {
  it('{} → 400', async () => {
    const { id } = await crea('DaModificare');

    const reply = await app.request(`/api/categories/${id}`, { method: 'PATCH', json: {} });

    assert.equal(reply.status, 400);
    assert.deepEqual(reply.body, { error: 'Il corpo della richiesta deve contenere "name" e/o "color".' });
  });

  it('id inesistente → 404', async () => {
    const reply = await app.request(`/api/categories/${ASSENTE}`, { method: 'PATCH', json: { name: 'X' } });

    assert.equal(reply.status, 404);
    assert.deepEqual(reply.body, NON_TROVATA);
  });
});

describe('GET /api/categories/:id/usage', () => {
  it('id inesistente → 404', async () => {
    const reply = await app.request(`/api/categories/${ASSENTE}/usage`);

    assert.equal(reply.status, 404);
    assert.deepEqual(reply.body, NON_TROVATA);
  });
});

describe('DELETE /api/categories/:id', () => {
  it('elimina → 204 con corpo vuoto', async () => {
    const { id } = await crea('DaEliminare');

    const reply = await app.request(`/api/categories/${id}`, { method: 'DELETE' });

    assert.equal(reply.status, 204);
    assert.equal(reply.text, '');
    assert.equal(reply.body, undefined);
  });

  it('id inesistente → 404', async () => {
    const reply = await app.request(`/api/categories/${ASSENTE}`, { method: 'DELETE' });

    assert.equal(reply.status, 404);
    assert.deepEqual(reply.body, NON_TROVATA);
  });

  it('la categoria «Da classificare» → 409', async () => {
    const reply = await app.request(`/api/categories/${FALLBACK_ID}`, { method: 'DELETE' });

    assert.equal(reply.status, 409);
    assert.deepEqual(reply.body, { error: '«Da classificare» non può essere eliminata.' });
  });
});

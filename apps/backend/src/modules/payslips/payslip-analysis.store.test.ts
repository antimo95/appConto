import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createAnalysisStore, type PendingAnalysis } from './payslip-analysis.store.js';

/** Il deposito non apre il database: il test è puro, senza cartelle temporanee. */

const NOW = Date.parse('2026-11-01T10:00:00Z');

function analisi(id: string, expiresAt: number): PendingAnalysis {
  return {
    id,
    fileName: `${id}.pdf`,
    sha256: id.padEnd(64, '0'),
    bytes: new Uint8Array([1, 2, 3]),
    extraction: {} as PendingAnalysis['extraction'],
    expiresAt,
  };
}

describe('deposito delle analisi', () => {
  it('evictExpired restituisce gli id scaduti e li toglie, lasciando le altre', () => {
    const store = createAnalysisStore();
    store.save(analisi('vecchia', NOW - 1));
    store.save(analisi('viva', NOW + 1_000));

    assert.deepEqual(store.evictExpired(NOW), ['vecchia']);
    assert.equal(store.delete('vecchia'), false, 'è già uscita dalla memoria');
    assert.equal(store.get('viva', NOW)?.id, 'viva');
    assert.deepEqual(store.evictExpired(NOW), []);
  });

  it('un\'analisi che scade proprio adesso è scaduta', () => {
    const store = createAnalysisStore();
    store.save(analisi('limite', NOW));

    assert.equal(store.get('limite', NOW), null);
    assert.deepEqual(store.evictExpired(NOW), ['limite']);
  });

  it('clear svuota il deposito', () => {
    const store = createAnalysisStore();
    store.save(analisi('a', NOW + 1_000));
    store.save(analisi('b', NOW + 1_000));

    store.clear();

    assert.equal(store.get('a', NOW), null);
    assert.equal(store.get('b', NOW), null);
    assert.deepEqual(store.evictExpired(NOW + 10_000), []);
  });

  it('la capacità scarta la più vecchia', () => {
    const store = createAnalysisStore({ maxPending: 2 });
    store.save(analisi('a', NOW + 1_000));
    store.save(analisi('b', NOW + 1_000));
    store.save(analisi('c', NOW + 1_000));

    assert.equal(store.get('a', NOW), null);
    assert.equal(store.get('b', NOW)?.id, 'b');
    assert.equal(store.get('c', NOW)?.id, 'c');
  });
});

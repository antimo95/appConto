import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

/**
 * I1: un movimento cancellato torna se si reimporta lo stesso estratto conto.
 *
 * È una decisione, non un difetto: l'import deduplica solo rispetto ai
 * movimenti presenti, e la cancellazione non lascia traccia. Questo test di
 * caratterizzazione la fissa; la conferma di cancellazione la dichiara
 * all'utente. Se un giorno si volesse il contrario (tombstone), questo test
 * deve cambiare insieme alla decisione.
 *
 * Radice dati temporanea scelta prima degli import.
 */

const dataRoot = mkdtempSync(path.join(tmpdir(), 'appconto-reimport-'));
process.env.DATABASE_FILE = path.join(dataRoot, 'database.sqlite');

const { closeDatabase, runMigrations } = await import('../../db/client.js');
const { importService } = await import('../import/index.js');
const { transactionsService } = await import('./transactions.service.js');

runMigrations();

after(() => {
  closeDatabase();
  try {
    rmSync(dataRoot, { recursive: true, force: true });
  } catch {
    // su Windows il file può restare bloccato: è comunque una cartella temporanea
  }
});

const ESTRATTO = [
  'Data contabile,Descrizione,Importo',
  '01/04/2026,SUPERMERCATO,-42.10',
  '02/04/2026,FARMACIA,-12.00',
  '03/04/2026,STIPENDIO,1500.00',
].join('\r\n');

describe('I1: cancellare e reimportare', () => {
  it('il movimento cancellato torna, con lo stesso fingerprint; gli altri sono duplicati', () => {
    const primo = importService.importCsv(ESTRATTO);
    assert.equal(primo.imported, 3);

    const farmacia = transactionsService.listAll().find((t) => t.description === 'FARMACIA');
    assert.ok(farmacia);
    const impronta = transactionsService.findById(farmacia.id)?.fingerprint;
    assert.ok(impronta);

    transactionsService.remove([farmacia.id], { usagesOf: () => [] });
    assert.equal(transactionsService.listAll().length, 2);

    const secondo = importService.importCsv(ESTRATTO);

    assert.equal(secondo.imported, 1, 'torna solo il movimento cancellato');
    assert.equal(secondo.duplicates, 2, 'gli altri sono riconosciuti come già presenti');
    const tornato = transactionsService.listAll().find((t) => t.description === 'FARMACIA');
    assert.ok(tornato, 'il movimento cancellato è di nuovo in archivio');
    assert.equal(transactionsService.findById(tornato.id)?.fingerprint, impronta);
  });
});

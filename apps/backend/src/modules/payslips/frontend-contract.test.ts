import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

/**
 * Controllo di deriva fra due app che non condividono codice.
 *
 * Il frontend ripete a mano i limiti del backend (importi, quantità, peso del
 * PDF) per avvisare l'utente prima di inviare. Se uno dei due cambia e l'altro
 * no, l'utente vedrebbe un modulo valido rifiutato dal server, o il contrario.
 * Questo test legge il sorgente del frontend come testo e li confronta.
 */

// Il database di prova va scelto prima di caricare il service, che apre la connessione.
const dataRoot = mkdtempSync(path.join(tmpdir(), 'appconto-payslips-contract-'));
process.env.DATABASE_FILE = path.join(dataRoot, 'database.sqlite');

const { closeDatabase } = await import('../../db/client.js');
const { MAX_CENTS, MAX_DECIMAL } = await import('./payslip.model.js');
const { MAX_PDF_BYTES } = await import('./payslips.service.js');

after(() => {
  closeDatabase();
  try {
    rmSync(dataRoot, { recursive: true, force: true });
  } catch {
    // su Windows il file può restare bloccato: è una cartella temporanea
  }
});

const featureDir = path.resolve(
  import.meta.dirname,
  '../../../../frontend/src/app/features/payslips',
);

function sorgente(nome: string): string {
  return readFileSync(path.join(featureDir, nome), 'utf8');
}

/** Il testo a destra di `NOME = `, fino al punto e virgola. */
function dichiarazione(testo: string, nome: string): string {
  const trovata = new RegExp(`${nome} = (.+);`).exec(testo)?.[1];
  assert.ok(trovata !== undefined, `${nome} non trovato nel sorgente del frontend`);

  return trovata;
}

/** Un numero con separatori `_`, oppure un prodotto di numeri (`10 * 1024 * 1024`). */
function valore(espressione: string): number {
  assert.match(espressione, /^[\d_]+(\s*\*\s*[\d_]+)*$/, `espressione inattesa: ${espressione}`);

  return espressione
    .split('*')
    .map((fattore) => Number(fattore.replaceAll('_', '').trim()))
    .reduce((prodotto, fattore) => prodotto * fattore, 1);
}

describe('limiti del frontend allineati al backend', () => {
  const revisione = sorgente('payslip-review.ts');
  const formato = sorgente('payslip-format.ts');

  it('gli importi: euro nel frontend, centesimi nel backend', () => {
    assert.equal(valore(dichiarazione(revisione, 'MAX_EUROS')) * 100, MAX_CENTS);
  });

  it('quantità, ore e saldi', () => {
    assert.equal(valore(dichiarazione(revisione, 'MAX_DECIMAL')), MAX_DECIMAL);
  });

  it('il peso massimo del PDF', () => {
    assert.equal(valore(dichiarazione(formato, 'MAX_PAYSLIP_BYTES')), MAX_PDF_BYTES);
    assert.equal(10 * 1024 * 1024, MAX_PDF_BYTES);
  });
});

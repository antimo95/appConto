import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MAX_CENTS,
  MAX_DECIMAL,
  newPayslipSchema,
  payslipUpdateSchema,
} from './payslip.model.js';

/** Gli schemi di validazione, da soli: il messaggio è ciò che l'utente leggerà. */

function corpoValido(): Record<string, unknown> {
  return {
    analysisId: 'a-1',
    period: '2026-10',
    employer: 'Rossi Srl',
    totalEarningsCents: 200000,
    totalDeductionsCents: 30000,
    netCents: 170000,
    items: [
      {
        code: 'F01',
        description: 'Retribuzione',
        section: 'earning',
        amountCents: 200000,
        quantity: 26,
        unit: 'gg',
      },
    ],
    leaveBalances: [{ type: 'FERIE', accrued: 2, used: 1, remaining: 1, unit: 'gg' }],
  };
}

const voce = (override: Record<string, unknown>): Record<string, unknown> => ({
  ...(corpoValido().items as Record<string, unknown>[])[0],
  ...override,
});

/** Il messaggio del primo errore, o `null` se il corpo è valido. */
function messaggio(schema: typeof newPayslipSchema | typeof payslipUpdateSchema, corpo: unknown): string | null {
  const esito = schema.safeParse(corpo);

  return esito.success ? null : (esito.error.issues[0]?.message ?? '');
}

describe('newPayslipSchema', () => {
  it('accetta un corpo valido e normalizza le stringhe vuote in null', () => {
    const esito = newPayslipSchema.safeParse({
      ...corpoValido(),
      employer: '  ',
      items: [voce({ code: '', unit: '' })],
    });

    assert.ok(esito.success, JSON.stringify(esito.error?.issues));
    assert.equal(esito.data.employer, null);
    assert.equal(esito.data.items[0]?.code, null);
    assert.equal(esito.data.items[0]?.unit, null);
    assert.equal(esito.data.replaceExisting, false);
    assert.equal(esito.data.roundingCents, null);
  });

  const casi: [string, Record<string, unknown>, string][] = [
    ['totale negativo', { totalEarningsCents: -1 }, 'Il totale non può essere negativo.'],
    ['sezione sconosciuta', { items: [voce({ section: 'altro' })] }, 'Sezione della voce non valida.'],
    ['codice con spazi', { items: [voce({ code: 'F 01' })] }, 'Codice voce non valido.'],
    [
      'codice oltre 16 caratteri',
      { items: [voce({ code: 'A'.repeat(17) })] },
      'Testo troppo lungo (massimo 16 caratteri).',
    ],
    ['descrizione vuota', { items: [voce({ description: '' })] }, 'Descrizione della voce mancante.'],
    [
      'descrizione oltre 200 caratteri',
      { items: [voce({ description: 'x'.repeat(201) })] },
      'Descrizione della voce troppo lunga.',
    ],
    [
      '301 voci',
      { items: Array.from({ length: 301 }, () => voce({})) },
      'Troppe voci per un cedolino.',
    ],
    ['ore lavorate oltre il limite', { workedHours: MAX_DECIMAL + 1 }, 'Valore fuori scala.'],
    ['importo oltre il limite', { netCents: MAX_CENTS + 1 }, 'Importo fuori scala.'],
    ['analysisId vuoto', { analysisId: '' }, 'Analisi mancante.'],
    [
      'due saldi dello stesso tipo',
      {
        leaveBalances: [
          { type: 'PAR', accrued: 1, used: 0, remaining: 1, unit: 'ore' },
          { type: 'PAR', accrued: 1, used: 0, remaining: 1, unit: 'ore' },
        ],
      },
      'Ogni saldo (FERIE, PAR) può comparire una sola volta.',
    ],
    [
      'saldo senza unità',
      { leaveBalances: [{ type: 'FERIE', accrued: 1, used: 0, remaining: 1 }] },
      'Unità del saldo mancante.',
    ],
    [
      'saldo con unità vuota',
      { leaveBalances: [{ type: 'FERIE', accrued: 1, used: 0, remaining: 1, unit: ' ' }] },
      'Unità del saldo mancante.',
    ],
  ];

  for (const [nome, modifica, atteso] of casi) {
    it(`rifiuta: ${nome}`, () => {
      assert.equal(messaggio(newPayslipSchema, { ...corpoValido(), ...modifica }), atteso);
    });
  }

  it('i limiti sono inclusi: il valore massimo passa', () => {
    const esito = newPayslipSchema.safeParse({
      ...corpoValido(),
      netCents: MAX_CENTS,
      workedHours: MAX_DECIMAL,
    });

    assert.ok(esito.success);
  });

  it('rifiuta più saldi dei tipi esistenti con un messaggio in italiano', () => {
    const saldo = { type: 'FERIE', accrued: 1, used: 0, remaining: 1, unit: 'gg' };
    const testo = messaggio(newPayslipSchema, { ...corpoValido(), leaveBalances: [saldo, saldo, saldo] });

    assert.ok(testo !== null);
    assert.doesNotMatch(testo, /expected|too big|invalid/i);
  });
});

describe('payslipUpdateSchema', () => {
  it('un oggetto vuoto non è una modifica', () => {
    assert.equal(messaggio(payslipUpdateSchema, {}), 'Nessuna modifica indicata.');
  });

  it('accetta solo i campi indicati', () => {
    const esito = payslipUpdateSchema.safeParse({ netCents: 123 });

    assert.ok(esito.success);
    assert.deepEqual(esito.data, { netCents: 123 });
  });

  it('applica gli stessi limiti della creazione', () => {
    assert.equal(messaggio(payslipUpdateSchema, { netCents: MAX_CENTS + 1 }), 'Importo fuori scala.');
    assert.equal(messaggio(payslipUpdateSchema, { totalDeductionsCents: -5 }), 'Il totale non può essere negativo.');
  });
});

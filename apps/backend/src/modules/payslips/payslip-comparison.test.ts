import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  compareItems,
  compareLeave,
  percentChange,
  summarize,
  type ComparablePayslip,
} from './payslip-comparison.js';
import { itemKey, type PayslipItem } from './payslip.model.js';

const item = (overrides: Partial<PayslipItem>): PayslipItem => ({
  code: null,
  description: 'Voce',
  section: 'earning',
  amountCents: 0,
  quantity: null,
  unit: null,
  ...overrides,
});

const payslip = (period: string, netCents: number, overrides: Partial<ComparablePayslip> = {}): ComparablePayslip => ({
  id: `p-${period}`,
  period,
  netCents,
  totalEarningsCents: netCents + 50000,
  totalDeductionsCents: 50000,
  items: [],
  leaveBalances: [],
  ...overrides,
});

describe('chiave di confronto delle voci', () => {
  it('usa il codice quando c\'è, senza badare alla descrizione', () => {
    assert.equal(
      itemKey({ code: 'z00001', description: 'Retribuzione' }),
      itemKey({ code: 'Z00001', description: 'Retribuzione ordinaria' }),
    );
  });

  it('senza codice usa la descrizione normalizzata', () => {
    assert.equal(
      itemKey({ code: null, description: 'Indennità L.207/24' }),
      itemKey({ code: '', description: "INDENNITA'  L 207 24" }),
    );
    assert.notEqual(
      itemKey({ code: null, description: 'Imp. INAIL' }),
      itemKey({ code: null, description: 'Imp. INPS' }),
    );
  });
});

describe('variazione percentuale', () => {
  it('è relativa al valore assoluto del mese precedente', () => {
    assert.equal(percentChange(110, 100), 10);
    assert.equal(percentChange(90, 100), -10);
    assert.equal(percentChange(-5, -10), 50);
    assert.equal(percentChange(200, 300), -33.33);
  });

  it('da zero non esiste', () => {
    assert.equal(percentChange(100, 0), null);
  });
});

describe('confronto delle voci', () => {
  it('distingue voci variate, invariate, nuove e scomparse', () => {
    const deltas = compareItems(
      [
        item({ code: 'Z00001', description: 'Retribuzione', amountCents: 220000 }),
        item({ code: 'Z00000', description: 'Contributo IVS', section: 'deduction', amountCents: 20000 }),
        item({ code: 'F02703', description: 'Indennità', amountCents: 9639 }),
      ],
      [
        item({ code: 'Z00001', description: 'Retribuzione', amountCents: 200000 }),
        item({ code: 'Z00000', description: 'Contributo IVS', section: 'deduction', amountCents: 20000 }),
        item({ code: 'Z50000', description: 'Una tantum', amountCents: 5000 }),
      ],
    );

    assert.deepEqual(
      deltas.map((delta) => [delta.code, delta.status, delta.currentCents, delta.previousCents, delta.deltaCents, delta.deltaPercent]),
      [
        ['Z00001', 'changed', 220000, 200000, 20000, 10],
        ['Z00000', 'unchanged', 20000, 20000, 0, 0],
        ['F02703', 'added', 9639, null, 9639, null],
        ['Z50000', 'removed', null, 5000, -5000, -100],
      ],
    );
  });

  it('somma le righe ripetute della stessa voce', () => {
    const [delta] = compareItems(
      [
        item({ code: 'Z00001', amountCents: 100000 }),
        item({ code: 'Z00001', amountCents: 25000 }),
      ],
      [item({ code: 'Z00001', amountCents: 125000 })],
    );

    assert.equal(delta?.status, 'unchanged');
    assert.equal(delta?.currentCents, 125000);
  });

  it('riconosce per descrizione le voci senza codice', () => {
    const [delta] = compareItems(
      [item({ description: 'Retribuzione utile T.F.R.', amountCents: 230000 })],
      [item({ description: 'RETRIBUZIONE UTILE TFR', amountCents: 220000 })],
    );

    assert.equal(delta?.status, 'changed');
    assert.equal(delta?.deltaCents, 10000);
  });
});

describe('confronto di ferie e P.A.R.', () => {
  it('confronta i residui come fotografie, non somma i movimenti', () => {
    const deltas = compareLeave(
      [
        { type: 'FERIE', accrued: 13.33333, used: 8, remaining: 45.5, unit: 'ORE' },
        { type: 'PAR', accrued: 6, used: 0, remaining: 8.1, unit: 'ORE' },
      ],
      [
        { type: 'FERIE', accrued: 13.33333, used: 0, remaining: 40.16667, unit: 'ORE' },
        { type: 'PAR', accrued: 6, used: 4, remaining: 2.1, unit: 'ORE' },
      ],
    );

    assert.deepEqual(deltas, [
      { type: 'FERIE', unit: 'ORE', currentRemaining: 45.5, previousRemaining: 40.16667, deltaRemaining: 5.33333 },
      { type: 'PAR', unit: 'ORE', currentRemaining: 8.1, previousRemaining: 2.1, deltaRemaining: 6 },
    ]);
  });

  it('un saldo presente in un solo mese non ha variazione', () => {
    const [delta] = compareLeave([], [{ type: 'PAR', accrued: 1, used: 0, remaining: 1, unit: 'ORE' }]);

    assert.equal(delta?.currentRemaining, null);
    assert.equal(delta?.deltaRemaining, null);
  });
});

describe('andamento e confronti mensili', () => {
  const archive = [
    payslip('2026-09', 180000),
    payslip('2026-07', 170000, { leaveBalances: [{ type: 'FERIE', accrued: 1, used: 0, remaining: 10, unit: 'ORE' }] }),
    payslip('2026-10', 171000),
    payslip('2026-08', 175000),
  ];

  it('ordina cronologicamente e confronta ogni mese con il cedolino precedente', () => {
    const summary = summarize(archive, null, null);

    assert.deepEqual(
      summary.trend.map((point) => point.period),
      ['2026-07', '2026-08', '2026-09', '2026-10'],
    );
    assert.deepEqual(summary.trend[0]?.leaveRemaining, { FERIE: 10, PAR: null });
    assert.deepEqual(
      summary.comparisons.map((comparison) => [comparison.period, comparison.previousPeriod, comparison.net.deltaCents]),
      [
        ['2026-08', '2026-07', 5000],
        ['2026-09', '2026-08', 5000],
        ['2026-10', '2026-09', -9000],
      ],
    );
    assert.equal(summary.comparisons[2]?.net.deltaPercent, -5);
  });

  it('il primo mese dell\'intervallo si confronta con il cedolino che lo precede, anche fuori intervallo', () => {
    const summary = summarize(archive, '2026-09', '2026-09');

    assert.deepEqual(summary.trend.map((point) => point.period), ['2026-09']);
    assert.equal(summary.comparisons.length, 1);
    assert.equal(summary.comparisons[0]?.previousPeriod, '2026-08');
  });

  it('un mese mancante allontana il precedente, senza inventare il mese vuoto', () => {
    const summary = summarize([payslip('2026-05', 100000), payslip('2026-08', 110000)], null, null);

    assert.equal(summary.comparisons[0]?.previousPeriod, '2026-05');
  });

  it('il primo cedolino in assoluto non ha confronto', () => {
    assert.deepEqual(summarize([payslip('2026-01', 100000)], null, null).comparisons, []);
  });

  it('aggiunge il riepilogo di ferie e permessi senza alterare andamento e confronti', () => {
    const summary = summarize(archive, null, null);

    assert.deepEqual(Object.keys(summary).sort(), ['comparisons', 'from', 'leave', 'to', 'trend']);
    assert.equal(summary.trend.length, 4);
    assert.equal(summary.comparisons.length, 3);
    assert.equal(summary.leave.semantics, 'progressivo-annuo');
    assert.equal(summary.leave.coverage.payslipCount, 4);
    assert.equal(summary.leave.coverage.from, '2026-07');
    assert.equal(summary.leave.coverage.to, '2026-10');
    assert.deepEqual(summary.leave.types.map((type) => type.type), ['FERIE']);
  });

  it('il riepilogo segue l\'intervallo richiesto', () => {
    const summary = summarize(archive, '2026-09', '2026-09');

    assert.equal(summary.leave.coverage.from, '2026-09');
    assert.equal(summary.leave.coverage.to, '2026-09');
  });
});

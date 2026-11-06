import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ComparablePayslip } from './payslip-comparison.js';
import type { LeaveBalance } from './payslip.model.js';
import type { LeaveCheck, LeaveTypeOverview } from './payslips.view-model.js';
import { verifyLeave } from './payslip-leave-verification.js';

/**
 * La verifica di coerenza di ferie e P.A.R., funzione pura.
 *
 * Maturato e goduto sono progressivi dall'inizio dell'anno; il residuo AP è
 * costante nell'anno e si ricava: ap = residuo − maturato + goduto.
 */

const balance = (accrued: number, used: number, remaining: number, unit = 'ORE'): LeaveBalance[] => [
  { type: 'FERIE', accrued, used, remaining, unit },
];

const payslip = (period: string, leaveBalances: LeaveBalance[]): ComparablePayslip => ({
  id: `p-${period}`,
  period,
  netCents: 150000,
  totalEarningsCents: 200000,
  totalDeductionsCents: 50000,
  items: [],
  leaveBalances,
});

/** Mescola in modo deterministico: l'ordine in ingresso non deve contare. */
const shuffled = <T>(values: readonly T[]): T[] => [...values.slice(1), values[0] as T].reverse();

function ferie(overview: ReturnType<typeof verifyLeave>): LeaveTypeOverview {
  const found = overview.types.find((type) => type.type === 'FERIE');
  assert.ok(found !== undefined, 'tipo FERIE assente');
  return found;
}

function checkOf(type: LeaveTypeOverview, period: string): LeaveCheck {
  const found = type.checks.find((check) => check.period === period);
  assert.ok(found !== undefined, `check assente per ${period}`);
  return found;
}

// Residuo AP = 10: gennaio 2+0, febbraio 4+1 usati, marzo 6+1.
const coherentYear = [
  payslip('2026-01', balance(2, 0, 12)),
  payslip('2026-02', balance(4, 1, 13)),
  payslip('2026-03', balance(6, 1, 15)),
];

describe('verifica ferie: ordine e collegamenti', () => {
  it('con cedolini in ordine sparso, cronologia e check sono crescenti e collegati al mese giusto', () => {
    const overview = verifyLeave(shuffled([...coherentYear, payslip('2026-04', balance(8, 1, 17))]), null, null);
    const type = ferie(overview);

    assert.deepEqual(type.history.map((o) => o.period), ['2026-01', '2026-02', '2026-03', '2026-04']);
    assert.deepEqual(type.checks.map((c) => c.period), ['2026-01', '2026-02', '2026-03', '2026-04']);
    for (const check of type.checks) {
      assert.equal(check.payslipId, `p-${check.period}`);
    }
    assert.deepEqual(type.checks.map((c) => c.previousPeriod), [null, '2026-01', '2026-02', '2026-03']);
    assert.deepEqual(type.checks.map((c) => c.previousPayslipId), [null, 'p-2026-01', 'p-2026-02', 'p-2026-03']);
    assert.deepEqual(type.history[1], {
      period: '2026-02',
      payslipId: 'p-2026-02',
      accrued: 4,
      used: 1,
      remaining: 13,
      unit: 'ORE',
    });
  });

  it('la semantica dichiarata è progressiva annua', () => {
    assert.equal(verifyLeave(coherentYear, null, null).semantics, 'progressivo-annuo');
  });

  it('i tipi compaiono solo se almeno un cedolino li ha', () => {
    const soloFerie = verifyLeave(coherentYear, null, null);
    assert.deepEqual(soloFerie.types.map((t) => t.type), ['FERIE']);

    const conPar = verifyLeave(
      [
        payslip('2026-01', [...balance(2, 0, 12), { type: 'PAR', accrued: 1, used: 0, remaining: 1, unit: 'ORE' }]),
        payslip('2026-02', balance(4, 1, 13)),
      ],
      null,
      null,
    );
    assert.deepEqual(conPar.types.map((t) => t.type), ['FERIE', 'PAR']);

    assert.deepEqual(verifyLeave([payslip('2026-01', [])], null, null).types, []);
  });
});

describe('verifica ferie: stesso anno', () => {
  it('una sequenza progressiva coerente: tutto coerente tranne il primo cedolino', () => {
    const overview = verifyLeave(shuffled(coherentYear), null, null);
    const type = ferie(overview);

    assert.deepEqual(
      type.checks.map((c) => [c.rule, c.status]),
      [
        ['primo-cedolino', 'non_verificabile'],
        ['stesso-anno', 'coerente'],
        ['stesso-anno', 'coerente'],
      ],
    );
    assert.equal(type.status, 'coerente');
    assert.deepEqual(overview.anomalies, []);
    const feb = checkOf(type, '2026-02');
    assert.equal(feb.expectedRemaining, 13);
    assert.equal(feb.observedRemaining, 13);
    assert.equal(feb.difference, 0);
  });

  it('un residuo che non torna fra mesi consecutivi è un\'anomalia, con i numeri esatti', () => {
    // Atteso a marzo: 13 + (6 − 4) − (1 − 1) = 15; stampato 14,25.
    const overview = verifyLeave(
      [coherentYear[0]!, coherentYear[1]!, payslip('2026-03', balance(6, 1, 14.25))],
      null,
      null,
    );
    const type = ferie(overview);
    const check = checkOf(type, '2026-03');

    assert.equal(check.status, 'anomalia');
    assert.equal(check.rule, 'stesso-anno');
    assert.equal(check.expectedRemaining, 15);
    assert.equal(check.observedRemaining, 14.25);
    assert.equal(check.difference, -0.75);
    assert.ok(check.reason.trim().length > 0);
    assert.equal(type.status, 'anomalia');
    assert.deepEqual(overview.anomalies, [check]);
  });

  it('il mese successivo a un\'anomalia si confronta con il valore stampato, non con quello atteso', () => {
    const overview = verifyLeave(
      [
        coherentYear[0]!,
        payslip('2026-02', balance(4, 1, 12)), // anomalia: atteso 13
        payslip('2026-03', balance(6, 1, 14)), // 12 + 2 − 0 = 14: coerente col precedente
      ],
      null,
      null,
    );
    const type = ferie(overview);

    assert.equal(checkOf(type, '2026-02').status, 'anomalia');
    assert.equal(checkOf(type, '2026-03').status, 'coerente');
    assert.deepEqual(overview.anomalies.map((c) => c.period), ['2026-02']);
  });

  it('le anomalie sono in ordine crescente e tutte elencate', () => {
    const overview = verifyLeave(
      shuffled([
        payslip('2026-01', balance(2, 0, 12)),
        payslip('2026-02', balance(4, 1, 20)),
        payslip('2026-03', balance(6, 1, 30)),
      ]),
      null,
      null,
    );

    assert.deepEqual(overview.anomalies.map((c) => c.period), ['2026-02', '2026-03']);
    assert.ok(overview.anomalies.every((c) => c.status === 'anomalia'));
  });

  it('un mese mancante con valori coerenti resta coerente e il buco è nella copertura', () => {
    // Gennaio → marzo: 12 + (6 − 2) − (1 − 0) = 15.
    const overview = verifyLeave(shuffled([coherentYear[0]!, coherentYear[2]!]), null, null);
    const type = ferie(overview);
    const check = checkOf(type, '2026-03');

    assert.equal(check.status, 'coerente');
    assert.equal(check.rule, 'stesso-anno');
    assert.equal(check.previousPeriod, '2026-01');
    assert.deepEqual(overview.coverage.missingPeriods, ['2026-02']);
    assert.equal(overview.coverage.payslipCount, 2);
    assert.equal(overview.coverage.from, '2026-01');
    assert.equal(overview.coverage.to, '2026-03');
    assert.equal(type.status, 'coerente');
  });

  it('un mese mancante con valori incoerenti non è un\'anomalia: non è verificabile', () => {
    const overview = verifyLeave([coherentYear[0]!, payslip('2026-03', balance(6, 1, 99))], null, null);
    const type = ferie(overview);
    const check = checkOf(type, '2026-03');

    assert.equal(check.status, 'non_verificabile');
    assert.equal(check.rule, 'stesso-anno');
    assert.ok(check.reason.trim().length > 0);
    assert.deepEqual(overview.anomalies, []);
    assert.equal(type.status, 'non_verificabile');
    assert.deepEqual(overview.coverage.missingPeriods, ['2026-02']);
  });

  it('un solo cedolino: aggregato non verificabile', () => {
    const overview = verifyLeave([coherentYear[1]!], null, null);
    const type = ferie(overview);

    assert.equal(type.checks.length, 1);
    assert.equal(type.checks[0]?.rule, 'primo-cedolino');
    assert.equal(type.checks[0]?.status, 'non_verificabile');
    assert.equal(type.checks[0]?.expectedRemaining, null);
    assert.equal(type.checks[0]?.difference, null);
    assert.equal(type.status, 'non_verificabile');
    assert.deepEqual(overview.coverage.missingPeriods, []);
  });

  it('i progressivi che diminuiscono nell\'anno (dati mensili) non sono verificabili, mai anomalia', () => {
    const overview = verifyLeave(
      [
        payslip('2026-01', balance(10, 2, 18)),
        payslip('2026-02', balance(8, 1, 17)),
        payslip('2026-03', balance(10, 3, 5)),
      ],
      null,
      null,
    );
    const type = ferie(overview);

    assert.equal(checkOf(type, '2026-02').status, 'non_verificabile');
    assert.equal(checkOf(type, '2026-02').rule, 'stesso-anno');
    assert.match(checkOf(type, '2026-02').reason, /diminuisc/i);
    assert.ok(type.checks.every((c) => c.status !== 'anomalia'));
    assert.deepEqual(overview.anomalies, []);
    assert.equal(type.status, 'non_verificabile');
  });

  it('anche il goduto che diminuisce rende il mese non verificabile', () => {
    const overview = verifyLeave(
      [payslip('2026-01', balance(2, 5, 7)), payslip('2026-02', balance(4, 3, 11))],
      null,
      null,
    );
    assert.equal(checkOf(ferie(overview), '2026-02').status, 'non_verificabile');
  });

  it('i saldi negativi sono valori validi', () => {
    const overview = verifyLeave(
      // Riporto dell'anno precedente costante (0): −3 + (4 − 2) − (9 − 5) = −5.
      [payslip('2026-01', balance(2, 5, -3)), payslip('2026-02', balance(4, 9, -5))],
      null,
      null,
    );
    const check = checkOf(ferie(overview), '2026-02');

    assert.equal(check.status, 'coerente');
    assert.equal(check.expectedRemaining, -5);
    assert.equal(check.observedRemaining, -5);
  });
});

describe('verifica ferie: tolleranza', () => {
  const con = (remaining: number) =>
    checkOf(
      ferie(verifyLeave([payslip('2026-01', balance(2, 0, 12)), payslip('2026-02', balance(4, 1, remaining))], null, null)),
      '2026-02',
    );

  it('0,00005 di scarto è arrotondamento: coerente', () => {
    assert.equal(con(13.00005).status, 'coerente');
    assert.equal(con(12.99995).status, 'coerente');
  });

  it('0,001 di scarto è un\'anomalia', () => {
    const check = con(13.001);
    assert.equal(check.status, 'anomalia');
    assert.ok(Math.abs((check.difference ?? 0) - 0.001) < 1e-9);
  });
});

describe('verifica ferie: cambio anno', () => {
  it('dicembre → gennaio coerente: il riporto è il residuo di dicembre', () => {
    // atteso = 20 + 1,5 − 0,5 = 21
    const overview = verifyLeave(
      shuffled([payslip('2025-12', balance(24, 4, 20)), payslip('2026-01', balance(1.5, 0.5, 21))]),
      null,
      null,
    );
    const check = checkOf(ferie(overview), '2026-01');

    assert.equal(check.rule, 'cambio-anno');
    assert.equal(check.status, 'coerente');
    assert.equal(check.expectedRemaining, 21);
    assert.equal(check.previousPeriod, '2025-12');
    assert.equal(check.previousPayslipId, 'p-2025-12');
  });

  it('dicembre → gennaio che non torna è un\'anomalia', () => {
    const overview = verifyLeave(
      [payslip('2025-12', balance(24, 4, 20)), payslip('2026-01', balance(1.5, 0.5, 25))],
      null,
      null,
    );
    const check = checkOf(ferie(overview), '2026-01');

    assert.equal(check.rule, 'cambio-anno');
    assert.equal(check.status, 'anomalia');
    assert.equal(check.expectedRemaining, 21);
    assert.equal(check.observedRemaining, 25);
    assert.equal(check.difference, 4);
    assert.deepEqual(overview.anomalies, [check]);
    assert.equal(ferie(overview).status, 'anomalia');
  });

  it('novembre → gennaio non è verificabile: manca dicembre', () => {
    const overview = verifyLeave(
      [payslip('2025-11', balance(22, 4, 18)), payslip('2026-01', balance(1.5, 0.5, 99))],
      null,
      null,
    );
    const check = checkOf(ferie(overview), '2026-01');

    assert.equal(check.rule, 'cambio-anno');
    assert.equal(check.status, 'non_verificabile');
    assert.deepEqual(overview.anomalies, []);
    assert.deepEqual(overview.coverage.missingPeriods, ['2025-12']);
  });
});

describe('verifica ferie: unità e saldi assenti', () => {
  it('unità diverse: non verificabile, e il tipo non ha un\'unità unica', () => {
    const overview = verifyLeave(
      [payslip('2026-01', balance(2, 0, 12, 'ORE')), payslip('2026-02', balance(4, 1, 13, 'GIORNI'))],
      null,
      null,
    );
    const type = ferie(overview);
    const check = checkOf(type, '2026-02');

    assert.equal(check.status, 'non_verificabile');
    assert.equal(check.rule, 'nessuna');
    assert.equal(type.unit, null);
  });

  it('unità uguali: l\'unità è quella dei cedolini', () => {
    assert.equal(ferie(verifyLeave(coherentYear, null, null)).unit, 'ORE');
  });

  it('la stessa unità scritta con maiuscole diverse (letta dal PDF o inserita a mano) è la stessa unità', () => {
    const overview = verifyLeave(
      [payslip('2026-01', balance(2, 0, 12, 'ORE')), payslip('2026-02', balance(4, 1, 13, 'ore'))],
      null,
      null,
    );
    const type = ferie(overview);

    assert.equal(checkOf(type, '2026-02').status, 'coerente');
    assert.notEqual(type.unit, null);
  });

  it('un cedolino senza il saldo: nessuna regola; e il successivo non si può confrontare con lui', () => {
    const overview = verifyLeave(
      [payslip('2026-01', balance(2, 0, 12)), payslip('2026-02', []), payslip('2026-03', balance(6, 1, 15))],
      null,
      null,
    );
    const type = ferie(overview);

    const feb = checkOf(type, '2026-02');
    assert.equal(feb.status, 'non_verificabile');
    assert.equal(feb.rule, 'nessuna');
    assert.match(feb.reason, /saldo non presente/i);
    assert.equal(feb.observedRemaining, null);

    const mar = checkOf(type, '2026-03');
    assert.equal(mar.status, 'non_verificabile');
    assert.equal(mar.rule, 'nessuna');
    assert.equal(mar.previousPeriod, '2026-02');
    assert.deepEqual(type.history.map((o) => o.period), ['2026-01', '2026-03']);
  });
});

describe('verifica ferie: riepilogo', () => {
  it('yearTotals riporta l\'ultimo progressivo di ogni anno, mai una somma', () => {
    const overview = verifyLeave(
      shuffled([
        payslip('2025-11', balance(22, 4, 18)),
        payslip('2025-12', balance(24, 4, 20)),
        payslip('2026-01', balance(1.5, 0.5, 21)),
        payslip('2026-02', balance(3, 0.5, 22.5)),
      ]),
      null,
      null,
    );

    assert.deepEqual(ferie(overview).yearTotals, [
      { year: '2025', period: '2025-12', payslipId: 'p-2025-12', accrued: 24, used: 4 },
      { year: '2026', period: '2026-02', payslipId: 'p-2026-02', accrued: 3, used: 0.5 },
    ]);
  });

  it('yearTotals ignora i cedolini senza il saldo', () => {
    const overview = verifyLeave([payslip('2026-01', balance(2, 0, 12)), payslip('2026-02', [])], null, null);
    assert.equal(ferie(overview).yearTotals[0]?.period, '2026-01');
  });

  it('latest è l\'ultima osservazione', () => {
    const type = ferie(verifyLeave(shuffled(coherentYear), null, null));
    assert.equal(type.latest?.period, '2026-03');
    assert.equal(type.latest?.remaining, 15);
    assert.equal(type.latest?.payslipId, 'p-2026-03');
  });

  it('le limitazioni ci sono e dichiarano la tolleranza', () => {
    const { limitations } = verifyLeave(coherentYear, null, null);

    assert.ok(limitations.length > 0);
    assert.ok(limitations.every((text) => text.trim().length > 0));
    assert.ok(limitations.some((text) => /tolleranza/i.test(text)));
    assert.ok(limitations.some((text) => /progressiv/i.test(text)));
    assert.ok(limitations.some((text) => /Residuo AP|residuo dell'anno precedente|ricavat/i.test(text)));
  });

  it('con mesi mancanti le limitazioni lo dicono', () => {
    const { limitations } = verifyLeave([coherentYear[0]!, coherentYear[2]!], null, null);
    assert.ok(limitations.some((text) => /mancant/i.test(text)));
  });

  it('un archivio vuoto: copertura vuota, nessun tipo', () => {
    const overview = verifyLeave([], null, null);

    assert.deepEqual(overview.coverage, { from: null, to: null, payslipCount: 0, missingPeriods: [] });
    assert.deepEqual(overview.types, []);
    assert.deepEqual(overview.anomalies, []);
  });
});

describe('verifica ferie: intervallo', () => {
  const archive = [
    payslip('2026-01', balance(2, 0, 12)),
    payslip('2026-02', balance(4, 1, 13)),
    payslip('2026-03', balance(6, 1, 15)),
    payslip('2026-04', balance(8, 1, 17)),
    payslip('2026-05', balance(10, 1, 19)),
  ];

  it('i check riguardano solo i cedolini dell\'intervallo, ma il primo si confronta con quello prima di from', () => {
    const overview = verifyLeave(shuffled(archive), '2026-03', '2026-04');
    const type = ferie(overview);

    assert.deepEqual(type.checks.map((c) => c.period), ['2026-03', '2026-04']);
    assert.equal(checkOf(type, '2026-03').previousPeriod, '2026-02');
    assert.equal(checkOf(type, '2026-03').rule, 'stesso-anno');
    assert.equal(checkOf(type, '2026-03').status, 'coerente');
    assert.deepEqual(type.history.map((o) => o.period), ['2026-03', '2026-04']);
    assert.equal(overview.coverage.from, '2026-03');
    assert.equal(overview.coverage.to, '2026-04');
    assert.equal(overview.coverage.payslipCount, 2);
  });

  it('un cedolino oltre to non conta', () => {
    const type = ferie(verifyLeave(archive, null, '2026-02'));
    assert.deepEqual(type.checks.map((c) => c.period), ['2026-01', '2026-02']);
    assert.equal(type.latest?.period, '2026-02');
  });

  it('un\'anomalia prima di from non compare nell\'intervallo', () => {
    const overview = verifyLeave(
      [payslip('2026-01', balance(2, 0, 12)), payslip('2026-02', balance(4, 1, 50)), payslip('2026-03', balance(6, 1, 52))],
      '2026-03',
      null,
    );
    assert.deepEqual(overview.anomalies.map((c) => c.period), []);
    assert.equal(ferie(overview).status, 'coerente');
  });
});

describe('verifica ferie: nessun dato personale nei motivi', () => {
  it('i motivi non contengono identificativi né nomi di file o datori', () => {
    const personali = [
      { ...payslip('2025-12', balance(24, 4, 20)), id: 'id-segreto-1', fileName: 'Rossi Mario.pdf', employer: 'Esempio Lavoro' },
      { ...payslip('2026-01', balance(1.5, 0.5, 25)), id: 'id-segreto-2', fileName: 'gennaio.pdf', employer: 'Esempio Lavoro' },
    ];
    const overview = verifyLeave(personali, null, null);
    const reasons = overview.types.flatMap((type) => type.checks.map((c) => c.reason)).concat(overview.limitations);

    assert.ok(reasons.length > 0);
    for (const reason of reasons) {
      assert.doesNotMatch(reason, /id-segreto|Rossi|Mario|\.pdf|Esempio Lavoro/i);
    }
  });
});

import type { ComparablePayslip } from './payslip-comparison.js';
import { LEAVE_TYPES, type LeaveBalance, type LeaveType } from './payslip.model.js';
import type {
  LeaveCheck,
  LeaveCheckRule,
  LeaveCheckStatus,
  LeaveObservation,
  LeaveOverview,
  LeaveTypeOverview,
} from './payslips.view-model.js';

/**
 * Verifica di coerenza di ferie e P.A.R. fra cedolini consecutivi.
 *
 * Nel formato supportato `Maturato` e `Goduto` sono progressivi dall'inizio
 * dell'anno e il residuo dell'anno precedente è costante: da un mese al
 * successivo il residuo deve muoversi di quanto sono cresciuti maturato e
 * goduto. Funzione pura: nulla viene salvato, quindi una correzione o una
 * sostituzione si riflette alla richiesta successiva.
 */

/**
 * Il formato stampa cinque decimali: l'errore di arrotondamento di quattro
 * valori resta sotto 0,00002, quindi uno scarto oltre questa soglia è reale.
 */
const TOLERANCE = 0.0001;

const round = (value: number): number => Math.round(value * 100_000) / 100_000;

const monthIndex = (period: string): number => Number(period.slice(0, 4)) * 12 + Number(period.slice(5, 7)) - 1;

const formatPeriod = (index: number): string =>
  `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;

/** I mesi senza cedolino fra due periodi, estremi esclusi. */
function monthsBetween(earlier: string, later: string): string[] {
  const months: string[] = [];
  for (let index = monthIndex(earlier) + 1; index < monthIndex(later); index += 1) {
    months.push(formatPeriod(index));
  }
  return months;
}

/**
 * L'unità come chiave di confronto: il parser legge `ORE`, chi inserisce a
 * mano scrive `ore`. È la stessa unità, e non deve bloccare la verifica.
 */
const unitKey = (unit: string): string => unit.trim().toUpperCase();

const balanceOf = (payslip: ComparablePayslip, type: LeaveType): LeaveBalance | undefined =>
  payslip.leaveBalances.find((balance) => balance.type === type);

/** Maturato o goduto sono calati, fino a `payslip` compreso, fra due cedolini con saldo dello stesso anno. */
function decreasesInYear(type: LeaveType, all: readonly ComparablePayslip[], payslip: ComparablePayslip): boolean {
  const year = payslip.period.slice(0, 4);
  const balances = all
    .filter((candidate) => candidate.period.slice(0, 4) === year && candidate.period <= payslip.period)
    .map((candidate) => balanceOf(candidate, type))
    .filter((balance): balance is LeaveBalance => balance !== undefined);

  return balances.some((balance, index) => {
    const earlier = balances[index - 1];
    return earlier !== undefined && (balance.accrued < earlier.accrued - TOLERANCE || balance.used < earlier.used - TOLERANCE);
  });
}

function checkType(
  type: LeaveType,
  inRange: readonly ComparablePayslip[],
  all: readonly ComparablePayslip[],
): LeaveCheck[] {
  const checks: LeaveCheck[] = [];

  for (const payslip of inRange) {
    // Il precedente si cerca fra tutti i cedolini, anche prima di `from`.
    const index = all.indexOf(payslip);
    const previous = index > 0 ? all[index - 1] : undefined;
    const current = balanceOf(payslip, type);
    const before = previous === undefined ? undefined : balanceOf(previous, type);

    const result = (
      rule: LeaveCheckRule,
      status: LeaveCheckStatus,
      reason: string,
      expected: number | null = null,
    ): LeaveCheck => ({
      type,
      period: payslip.period,
      payslipId: payslip.id,
      previousPeriod: previous?.period ?? null,
      previousPayslipId: previous?.id ?? null,
      rule,
      status,
      expectedRemaining: expected,
      observedRemaining: current?.remaining ?? null,
      difference: expected === null || current === undefined ? null : round(current.remaining - expected),
      reason,
    });

    if (current === undefined) {
      checks.push(result('nessuna', 'non_verificabile', 'Saldo non presente nel cedolino.'));
      continue;
    }
    if (previous === undefined) {
      checks.push(
        result('primo-cedolino', 'non_verificabile', 'Primo cedolino in archivio: manca un mese precedente con cui confrontarlo.'),
      );
      continue;
    }
    if (before === undefined) {
      checks.push(
        result('nessuna', 'non_verificabile', 'Il cedolino precedente non riporta il saldo: nessun confronto possibile.'),
      );
      continue;
    }
    if (unitKey(before.unit) !== unitKey(current.unit)) {
      checks.push(result('nessuna', 'non_verificabile', 'Le unità di misura differiscono dal cedolino precedente.'));
      continue;
    }

    const missing = monthsBetween(previous.period, payslip.period);

    if (previous.period.slice(0, 4) === payslip.period.slice(0, 4)) {
      // Se nell'anno i valori sono già diminuiti, i dati non sono progressivi:
      // anche i mesi successivi non si verificano, altrimenti nascerebbero
      // anomalie false da una semantica che non vale per quel cedolino.
      if (decreasesInYear(type, all, payslip)) {
        checks.push(
          result(
            'stesso-anno',
            'non_verificabile',
            'I progressivi diminuiscono: valori non compatibili con la semantica progressiva.',
          ),
        );
        continue;
      }
      const expected = round(before.remaining + (current.accrued - before.accrued) - (current.used - before.used));
      if (Math.abs(current.remaining - expected) <= TOLERANCE) {
        checks.push(
          result(
            'stesso-anno',
            'coerente',
            missing.length > 0
              ? 'Il residuo torna con il cedolino precedente, anche se fra i due mancano dei mesi.'
              : 'Il residuo torna con il cedolino precedente.',
            expected,
          ),
        );
      } else if (missing.length > 0) {
        checks.push(
          result(
            'stesso-anno',
            'non_verificabile',
            'Il residuo non torna, ma fra i due cedolini mancano dei mesi: la differenza può nascere nel mese mancante.',
            expected,
          ),
        );
      } else {
        checks.push(
          result('stesso-anno', 'anomalia', 'Il residuo non coincide con quello atteso dal cedolino precedente.', expected),
        );
      }
      continue;
    }

    const decemberToJanuary = missing.length === 0 && previous.period.endsWith('-12') && payslip.period.endsWith('-01');
    if (!decemberToJanuary) {
      checks.push(
        result('cambio-anno', 'non_verificabile', "Mancano mesi a cavallo dell'anno: il riporto non è verificabile."),
      );
      continue;
    }
    // Il riporto di gennaio deve essere il residuo di dicembre.
    const expected = round(before.remaining + current.accrued - current.used);
    checks.push(
      Math.abs(current.remaining - expected) <= TOLERANCE
        ? result('cambio-anno', 'coerente', 'Il residuo di gennaio riporta quello di dicembre.', expected)
        : result('cambio-anno', 'anomalia', 'Il residuo di gennaio non riporta quello di dicembre.', expected),
    );
  }

  return checks;
}

function aggregate(checks: readonly LeaveCheck[]): LeaveCheckStatus {
  if (checks.some((check) => check.status === 'anomalia')) {
    return 'anomalia';
  }
  const meaningful = checks.filter((check) => check.rule !== 'primo-cedolino');
  if (meaningful.length === 0 || meaningful.some((check) => check.status === 'non_verificabile')) {
    return 'non_verificabile';
  }
  return 'coerente';
}

export function verifyLeave(
  payslips: readonly ComparablePayslip[],
  from: string | null,
  to: string | null,
): LeaveOverview {
  const all = [...payslips]
    .filter((payslip) => to === null || payslip.period <= to)
    .sort((a, b) => a.period.localeCompare(b.period));
  const inRange = all.filter((payslip) => from === null || payslip.period >= from);

  const missingPeriods: string[] = [];
  for (let i = 1; i < inRange.length; i += 1) {
    missingPeriods.push(
      ...monthsBetween((inRange[i - 1] as ComparablePayslip).period, (inRange[i] as ComparablePayslip).period),
    );
  }

  const types: LeaveTypeOverview[] = [];
  for (const type of LEAVE_TYPES) {
    const history: LeaveObservation[] = [];
    for (const payslip of inRange) {
      const balance = balanceOf(payslip, type);
      if (balance !== undefined) {
        history.push({
          period: payslip.period,
          payslipId: payslip.id,
          accrued: balance.accrued,
          used: balance.used,
          remaining: balance.remaining,
          unit: balance.unit,
        });
      }
    }
    if (history.length === 0) {
      continue;
    }

    const units = new Set(history.map((observation) => unitKey(observation.unit)));
    // L'ultimo di ogni anno sovrascrive i precedenti: il progressivo, non una somma.
    const byYear = new Map<string, LeaveObservation>();
    for (const observation of history) {
      byYear.set(observation.period.slice(0, 4), observation);
    }
    const checks = checkType(type, inRange, all);

    types.push({
      type,
      unit: units.size === 1 ? (history[0] as LeaveObservation).unit : null,
      latest: history[history.length - 1] ?? null,
      yearTotals: [...byYear].map(([year, o]) => ({
        year,
        period: o.period,
        payslipId: o.payslipId,
        accrued: o.accrued,
        used: o.used,
      })),
      history,
      status: aggregate(checks),
      checks,
    });
  }

  const limitations = [
    "Maturato e goduto sono progressivi dall'inizio dell'anno, come dichiara il formato del cedolino: i residui non si sommano mai.",
    "Il residuo dell'anno precedente non è letto dal cedolino: è ricavato come residuo meno maturato più goduto.",
    "La tolleranza è di 0,0001: il cedolino stampa cinque decimali e l'arrotondamento dei valori letti può produrre differenze minime, che non sono anomalie.",
  ];
  if (missingPeriods.length > 0) {
    limitations.push(
      "Nell'intervallo ci sono mesi mancanti: dove manca un cedolino una differenza non è attribuibile con certezza e il mese resta non verificabile.",
    );
  }

  return {
    semantics: 'progressivo-annuo',
    coverage: {
      from: inRange[0]?.period ?? null,
      to: inRange[inRange.length - 1]?.period ?? null,
      payslipCount: inRange.length,
      missingPeriods,
    },
    types,
    anomalies: types
      .flatMap((type) => type.checks.filter((check) => check.status === 'anomalia'))
      .sort((a, b) => a.period.localeCompare(b.period)),
    limitations,
  };
}

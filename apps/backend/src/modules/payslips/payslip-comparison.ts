import {
  LEAVE_TYPES,
  itemKey,
  type LeaveBalance,
  type LeaveType,
  type Payslip,
  type PayslipItem,
} from './payslip.model.js';
import type {
  AmountDelta,
  ItemDelta,
  LeaveDelta,
  PayslipComparison,
  PayslipSummariesViewModel,
  PayslipTrendPoint,
} from './payslips.view-model.js';
import { verifyLeave } from './payslip-leave-verification.js';

/**
 * Confronti fra cedolini: tutto calcolato, niente persistito.
 *
 * Un delta salvato diventerebbe falso alla prima correzione del mese da cui
 * dipende; ricalcolarlo costa una manciata di righe per mese.
 */

export type ComparablePayslip = Pick<
  Payslip,
  'id' | 'period' | 'netCents' | 'totalEarningsCents' | 'totalDeductionsCents' | 'items' | 'leaveBalances'
>;

/**
 * La variazione percentuale, con due decimali.
 *
 * Rispetto al valore assoluto del precedente: passare da −10 a −5 è salire,
 * e il segno deve dirlo. Da zero non esiste una percentuale.
 */
export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) {
    return null;
  }

  return Math.round(((current - previous) / Math.abs(previous)) * 10_000) / 100;
}

export function amountDelta(currentCents: number, previousCents: number): AmountDelta {
  return {
    currentCents,
    previousCents,
    deltaCents: currentCents - previousCents,
    deltaPercent: percentChange(currentCents, previousCents),
  };
}

interface GroupedItem {
  key: string;
  code: string | null;
  description: string;
  section: PayslipItem['section'];
  cents: number;
}

/**
 * Le voci riunite per chiave, nell'ordine in cui compaiono.
 *
 * Una stessa voce può comparire su più righe nello stesso mese (due tariffe
 * orarie, per esempio): ai fini del confronto conta la somma. La sezione fa
 * parte della chiave: lo stesso codice fra competenze e trattenute sono due voci.
 */
function groupItems(items: readonly PayslipItem[]): Map<string, GroupedItem> {
  const groups = new Map<string, GroupedItem>();

  for (const item of items) {
    const key = `${item.section}:${itemKey(item)}`;
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, {
        key,
        code: item.code,
        description: item.description,
        section: item.section,
        cents: item.amountCents,
      });
    } else {
      group.cents += item.amountCents;
    }
  }

  return groups;
}

/**
 * Ogni voce dei due mesi, con il suo stato.
 *
 * Prima le voci del mese corrente nel loro ordine, poi quelle scomparse
 * nell'ordine del mese precedente: è l'ordine in cui le si ritrova sul foglio.
 */
export function compareItems(current: readonly PayslipItem[], previous: readonly PayslipItem[]): ItemDelta[] {
  const now = groupItems(current);
  const before = groupItems(previous);
  const deltas: ItemDelta[] = [];

  for (const item of now.values()) {
    const old = before.get(item.key);
    const previousCents = old?.cents ?? null;
    const deltaCents = item.cents - (previousCents ?? 0);

    deltas.push({
      key: item.key,
      code: item.code,
      description: item.description,
      section: item.section,
      status: previousCents === null ? 'added' : deltaCents === 0 ? 'unchanged' : 'changed',
      currentCents: item.cents,
      previousCents,
      deltaCents,
      deltaPercent: previousCents === null ? null : percentChange(item.cents, previousCents),
    });
  }

  for (const old of before.values()) {
    if (now.has(old.key)) {
      continue;
    }

    deltas.push({
      key: old.key,
      code: old.code,
      description: old.description,
      section: old.section,
      status: 'removed',
      currentCents: null,
      previousCents: old.cents,
      deltaCents: -old.cents,
      deltaPercent: percentChange(0, old.cents),
    });
  }

  return deltas;
}

/** Le ore hanno cinque decimali: oltre è rumore della virgola mobile. */
function roundQuantity(value: number): number {
  return Math.round(value * 100_000) / 100_000;
}

function balanceOf(balances: readonly LeaveBalance[], type: LeaveType): LeaveBalance | undefined {
  return balances.find((balance) => balance.type === type);
}

/**
 * Come si sono mossi i residui.
 *
 * Il confronto è fra due fotografie: il delta è la differenza dei residui,
 * non la somma di ciò che è stato goduto.
 */
export function compareLeave(current: readonly LeaveBalance[], previous: readonly LeaveBalance[]): LeaveDelta[] {
  return LEAVE_TYPES.flatMap((type) => {
    const now = balanceOf(current, type);
    const before = balanceOf(previous, type);
    if (now === undefined && before === undefined) {
      return [];
    }

    const currentRemaining = now?.remaining ?? null;
    const previousRemaining = before?.remaining ?? null;

    return [
      {
        type,
        unit: now?.unit ?? before?.unit ?? 'ORE',
        currentRemaining,
        previousRemaining,
        deltaRemaining:
          currentRemaining === null || previousRemaining === null
            ? null
            : roundQuantity(currentRemaining - previousRemaining),
      },
    ];
  });
}

export function comparePayslips(current: ComparablePayslip, previous: ComparablePayslip): PayslipComparison {
  return {
    period: current.period,
    payslipId: current.id,
    previousPeriod: previous.period,
    previousPayslipId: previous.id,
    net: amountDelta(current.netCents, previous.netCents),
    totalEarnings: amountDelta(current.totalEarningsCents, previous.totalEarningsCents),
    totalDeductions: amountDelta(current.totalDeductionsCents, previous.totalDeductionsCents),
    leave: compareLeave(current.leaveBalances, previous.leaveBalances),
    items: compareItems(current.items, previous.items),
  };
}

function trendPoint(payslip: ComparablePayslip): PayslipTrendPoint {
  return {
    payslipId: payslip.id,
    period: payslip.period,
    netCents: payslip.netCents,
    totalEarningsCents: payslip.totalEarningsCents,
    totalDeductionsCents: payslip.totalDeductionsCents,
    leaveRemaining: {
      FERIE: balanceOf(payslip.leaveBalances, 'FERIE')?.remaining ?? null,
      PAR: balanceOf(payslip.leaveBalances, 'PAR')?.remaining ?? null,
    },
  };
}

/**
 * Andamento e confronti di un intervallo di mesi.
 *
 * `payslips` deve contenere anche i cedolini precedenti a `from`: il primo
 * mese dell'intervallo si confronta con il cedolino che lo precede, anche se
 * quello sta fuori dall'intervallo. L'ordine in ingresso non conta.
 */
export function summarize(
  payslips: readonly ComparablePayslip[],
  from: string | null,
  to: string | null,
): PayslipSummariesViewModel {
  const sorted = [...payslips]
    .filter((payslip) => to === null || payslip.period <= to)
    .sort((a, b) => a.period.localeCompare(b.period));

  const trend: PayslipTrendPoint[] = [];
  const comparisons: PayslipComparison[] = [];

  sorted.forEach((payslip, index) => {
    if (from !== null && payslip.period < from) {
      return;
    }

    trend.push(trendPoint(payslip));
    const previous = sorted[index - 1];
    if (previous !== undefined) {
      comparisons.push(comparePayslips(payslip, previous));
    }
  });

  return { from, to, trend, comparisons, leave: verifyLeave(payslips, from, to) };
}

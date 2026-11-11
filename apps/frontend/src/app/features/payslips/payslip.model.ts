/*
 * Il contratto del backend dei cedolini. Tutti gli importi viaggiano in
 * CENTESIMI interi: si convertono in euro solo per mostrarli (v. payslip-format.ts).
 *
 * Il file non si chiama `*.model.ts` di proposito: il gate del design system
 * tratta quei nomi come «dominio» e ne vieta la modifica rispetto a master.
 */

export type PayslipSection = 'earning' | 'deduction' | 'employer_contribution' | 'informational';
export type LeaveType = 'FERIE' | 'PAR';
/** Un mese può avere più cedolini, uno per tipo; confronti e verifica ferie riguardano solo gli ordinari. */
export type PayslipKind = 'ordinary' | 'thirteenth' | 'fourteenth' | 'adjustment';

export interface PayslipItem {
  code: string | null;
  description: string;
  section: PayslipSection;
  amountCents: number;
  quantity: number | null;
  unit: string | null;
}

/** Ore o giorni, non denaro: può essere negativo. */
export interface LeaveBalance {
  type: LeaveType;
  accrued: number;
  used: number;
  remaining: number;
  unit: string;
}

export interface PayslipData {
  /** `YYYY-MM`. */
  period: string;
  kind: PayslipKind;
  employer: string | null;
  totalEarningsCents: number;
  totalDeductionsCents: number;
  netCents: number;
  roundingCents: number | null;
  taxableInpsCents: number | null;
  taxableIrpefCents: number | null;
  workedHours: number | null;
  items: PayslipItem[];
  leaveBalances: LeaveBalance[];
}

export type ExtractionStatus = 'complete' | 'incomplete' | 'unrecognized';
export type ExtractionConfidence = 'high' | 'medium' | 'low';

export interface ExtractionWarning {
  code: string;
  field: string | null;
  message: string;
}

/** Ciò che l'estrazione ha trovato: ogni scalare può mancare. */
export interface PayslipDraft {
  period: string | null;
  /** Il parser non lo riconosce: nella bozza d'analisi manca, un cedolino salvato lo ha. */
  kind?: PayslipKind;
  employer: string | null;
  totalEarningsCents: number | null;
  totalDeductionsCents: number | null;
  netCents: number | null;
  roundingCents: number | null;
  taxableInpsCents: number | null;
  taxableIrpefCents: number | null;
  workedHours: number | null;
  items: PayslipItem[];
  leaveBalances: LeaveBalance[];
}

export interface PeriodConflict {
  payslipId: string;
  period: string;
  kind: PayslipKind;
}

export interface PayslipAnalysis {
  id: string;
  fileName: string;
  parserId: string | null;
  status: ExtractionStatus;
  confidence: ExtractionConfidence;
  warnings: ExtractionWarning[];
  draft: PayslipDraft;
  conflict: PeriodConflict | null;
  expiresAt: string;
}

export interface PayslipSummary {
  id: string;
  period: string;
  kind: PayslipKind;
  employer: string | null;
  fileName: string;
  importedAt: string;
  parserId: string;
  totalEarningsCents: number;
  totalDeductionsCents: number;
  netCents: number;
}

export interface PayslipList {
  items: PayslipSummary[];
}

export interface PayslipDetail extends PayslipSummary {
  roundingCents: number | null;
  taxableInpsCents: number | null;
  taxableIrpefCents: number | null;
  workedHours: number | null;
  items: PayslipItem[];
  leaveBalances: LeaveBalance[];
  hasDocument: boolean;
}

export interface AmountDelta {
  currentCents: number;
  previousCents: number;
  deltaCents: number;
  deltaPercent: number | null;
}

export type ItemChangeStatus = 'changed' | 'unchanged' | 'added' | 'removed';

export interface ItemDelta {
  key: string;
  code: string | null;
  description: string;
  section: PayslipSection;
  status: ItemChangeStatus;
  currentCents: number | null;
  previousCents: number | null;
  deltaCents: number;
  deltaPercent: number | null;
}

export interface LeaveDelta {
  type: LeaveType;
  unit: string;
  currentRemaining: number | null;
  previousRemaining: number | null;
  deltaRemaining: number | null;
}

export interface PayslipComparison {
  period: string;
  payslipId: string;
  previousPeriod: string;
  previousPayslipId: string;
  net: AmountDelta;
  totalEarnings: AmountDelta;
  totalDeductions: AmountDelta;
  leave: LeaveDelta[];
  items: ItemDelta[];
}

export interface PayslipTrendPoint {
  payslipId: string;
  period: string;
  netCents: number;
  totalEarningsCents: number;
  totalDeductionsCents: number;
  leaveRemaining: Record<LeaveType, number | null>;
}

export interface PayslipSummaries {
  from: string | null;
  to: string | null;
  trend: PayslipTrendPoint[];
  comparisons: PayslipComparison[];
  /** Verifica di coerenza di ferie e P.A.R.; assente solo in risposte di versioni precedenti. */
  leave?: LeaveOverview;
}

export type LeaveCheckStatus = 'coerente' | 'anomalia' | 'non_verificabile';
export type LeaveCheckRule = 'primo-cedolino' | 'stesso-anno' | 'cambio-anno' | 'nessuna';

export interface LeaveObservation {
  period: string;
  payslipId: string;
  accrued: number;
  used: number;
  remaining: number;
  unit: string;
}

export interface LeaveCheck {
  type: LeaveType;
  period: string;
  payslipId: string;
  previousPeriod: string | null;
  previousPayslipId: string | null;
  rule: LeaveCheckRule;
  status: LeaveCheckStatus;
  expectedRemaining: number | null;
  observedRemaining: number | null;
  difference: number | null;
  reason: string;
}

export interface LeaveTypeOverview {
  type: LeaveType;
  unit: string | null;
  latest: LeaveObservation | null;
  yearTotals: { year: string; period: string; payslipId: string; accrued: number; used: number }[];
  history: LeaveObservation[];
  status: LeaveCheckStatus;
  checks: LeaveCheck[];
}

export interface LeaveOverview {
  semantics: 'progressivo-annuo';
  coverage: {
    from: string | null;
    to: string | null;
    payslipCount: number;
    missingPeriods: string[];
  };
  types: LeaveTypeOverview[];
  anomalies: LeaveCheck[];
  limitations: string[];
}

/** Il corpo di `POST /payslips`. */
export type NewPayslip = PayslipData & { analysisId: string; replaceExisting: boolean };

/** Ciò che la revisione consegna alla pagina. */
export interface ReviewResult {
  data: PayslipData;
  replaceExisting: boolean;
}

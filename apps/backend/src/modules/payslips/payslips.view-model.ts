import type {
  ExtractionConfidence,
  ExtractionStatus,
  ExtractionWarning,
  PayslipDraft,
} from './parsing/payslip-parser.js';
import type { LeaveBalance, LeaveType, PayslipItem, PayslipKind, PayslipSection } from './payslip.model.js';

export type { ExtractionConfidence, ExtractionStatus, ExtractionWarning, PayslipDraft };

/**
 * Rappresentazione dei cedolini esposta dalle API.
 *
 * Gli importi viaggiano in centesimi interi, come sono in archivio: un
 * cedolino si confronta al centesimo, e passare per i decimali in virgola
 * mobile solo per tornare indietro nel frontend sarebbe un'occasione di errore
 * senza vantaggi. La conversione in euro è affare di chi mostra il numero.
 */

/** Il cedolino già presente per lo stesso mese. */
export interface PeriodConflict {
  payslipId: string;
  period: string;
  kind: PayslipKind;
}

/** Risposta di `POST /payslip-analyses`. */
export interface PayslipAnalysisViewModel {
  id: string;
  fileName: string;
  /** Il parser che ha riconosciuto il documento, `null` se nessuno. */
  parserId: string | null;
  status: ExtractionStatus;
  confidence: ExtractionConfidence;
  warnings: ExtractionWarning[];
  draft: PayslipDraft;
  /** Se il mese estratto è già in archivio: la conferma dovrà dire se sostituirlo. */
  conflict: PeriodConflict | null;
  /** Fino a quando l'analisi può essere confermata. */
  expiresAt: string;
}

/** Il cedolino come lo mostra l'elenco. */
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

/** Risposta di `GET /payslips`. */
export interface PayslipListViewModel {
  items: PayslipSummary[];
}

/** Risposta di `GET /payslips/:id`, `POST /payslips` e `PATCH /payslips/:id`. */
export interface PayslipDetailViewModel extends PayslipSummary {
  roundingCents: number | null;
  taxableInpsCents: number | null;
  taxableIrpefCents: number | null;
  workedHours: number | null;
  items: PayslipItem[];
  leaveBalances: LeaveBalance[];
  /** Il PDF originale è in archivio (manca solo per un cedolino della versione precedente il cui file non è stato ritrovato). */
  hasDocument: boolean;
}

/** La variazione di un importo rispetto al mese precedente. */
export interface AmountDelta {
  currentCents: number;
  previousCents: number;
  deltaCents: number;
  /** `null` quando il mese precedente valeva zero: la percentuale non esiste. */
  deltaPercent: number | null;
}

export type ItemChangeStatus = 'changed' | 'unchanged' | 'added' | 'removed';

/** Come è cambiata una voce fra i due mesi. */
export interface ItemDelta {
  /** Codice, o descrizione normalizzata: ciò che ha permesso di riconoscerla. */
  key: string;
  code: string | null;
  description: string;
  section: PayslipSection;
  status: ItemChangeStatus;
  /** `null` se la voce non c'è nel mese corrente (`removed`). */
  currentCents: number | null;
  /** `null` se la voce non c'era nel mese precedente (`added`). */
  previousCents: number | null;
  deltaCents: number;
  deltaPercent: number | null;
}

/** Come è cambiato un saldo di ferie o permessi. */
export interface LeaveDelta {
  type: LeaveType;
  unit: string;
  currentRemaining: number | null;
  previousRemaining: number | null;
  /** `null` se manca uno dei due saldi. */
  deltaRemaining: number | null;
}

/** Il mese confrontato con il cedolino precedente in archivio. */
export interface PayslipComparison {
  period: string;
  payslipId: string;
  /** Il cedolino precedente: di solito il mese prima, ma un mese mancante lo allontana. */
  previousPeriod: string;
  previousPayslipId: string;
  net: AmountDelta;
  totalEarnings: AmountDelta;
  totalDeductions: AmountDelta;
  leave: LeaveDelta[];
  /** Tutte le voci dei due mesi, comprese quelle invariate: filtrare è della vista. */
  items: ItemDelta[];
}

/** Un punto dell'andamento mensile. */
export interface PayslipTrendPoint {
  payslipId: string;
  period: string;
  netCents: number;
  totalEarningsCents: number;
  totalDeductionsCents: number;
  /** Il residuo a fine mese, `null` se il cedolino non lo riporta. */
  leaveRemaining: Record<LeaveType, number | null>;
}

/** Risposta di `GET /payslip-summaries`. */
export interface PayslipSummariesViewModel {
  from: string | null;
  to: string | null;
  /** In ordine cronologico crescente. */
  trend: PayslipTrendPoint[];
  /** Un confronto per ogni mese dell'intervallo che ha un cedolino precedente. */
  comparisons: PayslipComparison[];
  /** Verifica di coerenza di ferie e P.A.R.: calcolata a ogni richiesta, mai salvata. */
  leave: LeaveOverview;
}

export type LeaveCheckStatus = 'coerente' | 'anomalia' | 'non_verificabile';
export type LeaveCheckRule = 'primo-cedolino' | 'stesso-anno' | 'cambio-anno' | 'nessuna';

/** Un saldo di ferie o permessi come è stampato sul cedolino. */
export interface LeaveObservation {
  period: string;
  payslipId: string;
  accrued: number;
  used: number;
  remaining: number;
  unit: string;
}

/** L'esito della verifica di un mese rispetto al cedolino che lo precede. */
export interface LeaveCheck {
  type: LeaveType;
  period: string;
  payslipId: string;
  previousPeriod: string | null;
  previousPayslipId: string | null;
  rule: LeaveCheckRule;
  status: LeaveCheckStatus;
  /** Calcolato: `null` quando la regola non lo permette. */
  expectedRemaining: number | null;
  /** Osservato: `null` se il cedolino non ha il saldo. */
  observedRemaining: number | null;
  /** Osservato meno atteso. */
  difference: number | null;
  /** In italiano, senza dati personali. */
  reason: string;
}

export interface LeaveTypeOverview {
  type: LeaveType;
  /** `null` se nel periodo le unità differiscono. */
  unit: string | null;
  latest: LeaveObservation | null;
  /** Il progressivo dell'ultimo cedolino con saldo di ciascun anno: mai una somma. */
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

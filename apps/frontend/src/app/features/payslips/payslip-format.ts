import { parseAmount } from '../../core/amount';
import { typographicMinus } from '../../core/format';
import {
  ExtractionConfidence,
  ExtractionStatus,
  ItemChangeStatus,
  LeaveType,
  PayslipSection
} from './payslip.model';

/** Il limite del backend sul PDF; il client lo controlla prima di caricare. */
export const MAX_PAYSLIP_BYTES = 10 * 1024 * 1024;

const quantityFormatter = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 2 });
const shortMonthFormatter = new Intl.DateTimeFormat('it-IT', { month: 'short', year: '2-digit' });
const dateTimeFormatter = new Intl.DateTimeFormat('it-IT', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit'
});

export const SECTIONS: readonly PayslipSection[] = [
  'earning',
  'deduction',
  'employer_contribution',
  'informational'
];

export const SECTION_LABELS: Record<PayslipSection, string> = {
  earning: 'Competenza',
  deduction: 'Trattenuta',
  employer_contribution: 'Contributo azienda',
  informational: 'Informativa'
};

export const LEAVE_TYPES: readonly LeaveType[] = ['FERIE', 'PAR'];

export const LEAVE_LABELS: Record<LeaveType, string> = { FERIE: 'Ferie', PAR: 'P.A.R.' };

export const ITEM_STATUS_LABELS: Record<ItemChangeStatus, string> = {
  unchanged: 'Invariata',
  changed: 'Variata',
  added: 'Nuova',
  removed: 'Scomparsa'
};

export const EXTRACTION_STATUS_MESSAGES: Record<ExtractionStatus, string> = {
  complete: 'Estrazione completa: verifica i valori prima di confermare.',
  incomplete: 'Estrazione incompleta: completa i campi mancanti.',
  unrecognized:
    'Documento non riconosciuto o senza testo selezionabile: inserisci i dati a mano.'
};

export const CONFIDENCE_LABELS: Record<ExtractionConfidence, string> = {
  high: 'Affidabilità alta',
  medium: 'Affidabilità media',
  low: 'Affidabilità bassa'
};

/** Dal backend arrivano centesimi interi; l'interfaccia ragiona in euro. */
export function centsToEuros(cents: number): number {
  return cents / 100;
}

/** `Math.round` assorbe il rumore binario: 1,1 × 100 non è 110 esatti. */
export function eurosToCents(euros: number): number {
  return Math.round(euros * 100);
}

/**
 * Da testo digitato a centesimi: `null` se vuoto o illeggibile.
 * Accetta `1.234,56` come `1234.56`.
 */
export function parseCents(text: string): number | null {
  const euros = parseAmount(text);

  return euros === null ? null : eurosToCents(euros);
}

/** Per precompilare un campo: `123456` diventa `1234,56`, senza separatore di migliaia. */
export function centsToInput(cents: number | null): string {
  return cents === null ? '' : centsToEuros(cents).toFixed(2).replace('.', ',');
}

/** Ore, giorni, quantità: decimali con la virgola, senza zeri inutili. */
export function numberToInput(value: number | null): string {
  return value === null ? '' : String(value).replace('.', ',');
}

export function formatQuantity(value: number): string {
  return typographicMinus(quantityFormatter.format(value));
}

/** `−40 ore`, `10 giorni`. */
export function formatLeaveValue(value: number | null, unit: string): string {
  // Il cedolino stampa `ORE`: in una frase si legge «ore».
  return value === null ? '—' : `${formatQuantity(value)} ${unit.toLowerCase()}`;
}

/** Da `YYYY-MM` a `ago 26`: sta sull'asse del grafico. */
export function formatShortMonth(period: string): string {
  return shortMonthFormatter.format(new Date(`${period}-01T00:00:00`));
}

export function formatImportedAt(iso: string): string {
  return dateTimeFormatter.format(new Date(iso));
}

import type { LeaveBalance, PayslipItem } from '../payslip.model.js';
import type { PdfTextDocument } from './pdf-text.js';

/**
 * Il contratto dei parser e la valutazione di ciò che producono.
 *
 * Un parser conosce un formato e niente altro: riceve il testo posizionato,
 * restituisce una bozza. Non scrive in archivio, non conosce HTTP, non decide
 * se la bozza basta — quel giudizio è qui, uguale per ogni formato, così un
 * secondo parser non può essere più indulgente del primo.
 */

/** Esito complessivo dell'estrazione. */
export type ExtractionStatus =
  /** Tutti i campi obbligatori sono stati letti. */
  | 'complete'
  /** Il formato è stato riconosciuto ma qualche campo manca: va completato a mano. */
  | 'incomplete'
  /** Nessun parser ha riconosciuto il documento, o il PDF non contiene testo. */
  | 'unrecognized';

/** Quanto fidarsi dei valori letti. */
export type ExtractionConfidence = 'high' | 'medium' | 'low';

/** Un problema riscontrato durante l'estrazione: mai il contenuto del documento. */
export interface ExtractionWarning {
  code: string;
  /** Il campo interessato, se il problema riguarda un campo preciso. */
  field: string | null;
  message: string;
}

/**
 * La bozza estratta: gli stessi campi del cedolino, ma ognuno può mancare.
 *
 * `null` significa «non letto», mai «zero»: un importo che il parser non ha
 * trovato non viene inventato.
 */
export interface PayslipDraft {
  period: string | null;
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

export interface ParsedPayslip {
  draft: PayslipDraft;
  warnings: ExtractionWarning[];
}

/**
 * Un formato di cedolino.
 *
 * `id` finisce in archivio accanto al cedolino: porta la versione, così un
 * cedolino letto da una versione difettosa del parser resta riconoscibile.
 */
export interface PayslipParser {
  readonly id: string;
  /** Se il documento ha la forma che questo parser sa leggere. */
  canParse(document: PdfTextDocument): boolean;
  parse(document: PdfTextDocument): ParsedPayslip;
}

export interface PayslipExtraction extends ParsedPayslip {
  parserId: string | null;
  status: ExtractionStatus;
  confidence: ExtractionConfidence;
}

export function emptyDraft(): PayslipDraft {
  return {
    period: null,
    employer: null,
    totalEarningsCents: null,
    totalDeductionsCents: null,
    netCents: null,
    roundingCents: null,
    taxableInpsCents: null,
    taxableIrpefCents: null,
    workedHours: null,
    items: [],
    leaveBalances: [],
  };
}

/** I campi senza i quali un cedolino non si può confermare. */
const REQUIRED_FIELDS = [
  { field: 'period', label: 'Il mese di competenza' },
  { field: 'totalEarningsCents', label: 'Il totale competenze' },
  { field: 'totalDeductionsCents', label: 'Il totale trattenute' },
  { field: 'netCents', label: 'Il netto del mese' },
] as const satisfies readonly { field: keyof PayslipDraft; label: string }[];

/** Sotto questa soglia di caratteri il PDF è un'immagine, non un documento digitale. */
const MIN_TEXT_LENGTH = 20;

function textLength(document: PdfTextDocument): number {
  return document.pages.reduce(
    (total, page) => total + page.items.reduce((sum, item) => sum + item.text.length, 0),
    0,
  );
}

function sumCents(items: readonly PayslipItem[], section: PayslipItem['section']): number {
  return items.filter((item) => item.section === section).reduce((sum, item) => sum + item.amountCents, 0);
}

/**
 * I controlli incrociati che valgono per ogni cedolino italiano.
 *
 * Le voci in colonna devono sommare ai totali, e il netto deve essere la loro
 * differenza più l'arrotondamento. Se i conti non tornano qualcosa è stato
 * letto male: non si corregge niente, lo si dice.
 */
export function consistencyWarnings(draft: PayslipDraft): ExtractionWarning[] {
  const warnings: ExtractionWarning[] = [];
  const { totalEarningsCents: earnings, totalDeductionsCents: deductions, netCents: net } = draft;

  if (earnings !== null && draft.items.some((item) => item.section === 'earning')) {
    if (sumCents(draft.items, 'earning') !== earnings) {
      warnings.push({
        code: 'earnings-mismatch',
        field: 'totalEarningsCents',
        message: 'La somma delle competenze lette non corrisponde al totale competenze: verifica le voci.',
      });
    }
  }

  if (deductions !== null && draft.items.some((item) => item.section === 'deduction')) {
    if (sumCents(draft.items, 'deduction') !== deductions) {
      warnings.push({
        code: 'deductions-mismatch',
        field: 'totalDeductionsCents',
        message: 'La somma delle trattenute lette non corrisponde al totale trattenute: verifica le voci.',
      });
    }
  }

  if (earnings !== null && deductions !== null && net !== null) {
    if (earnings - deductions + (draft.roundingCents ?? 0) !== net) {
      warnings.push({
        code: 'net-mismatch',
        field: 'netCents',
        message:
          'Competenze meno trattenute, più l\'arrotondamento, non danno il netto letto: verifica i totali.',
      });
    }
  }

  return warnings;
}

function assess(parserId: string, parsed: ParsedPayslip): PayslipExtraction {
  const missing = REQUIRED_FIELDS.filter(({ field }) => parsed.draft[field] === null);
  const warnings = [
    ...missing.map(({ field, label }) => ({
      code: 'missing-field',
      field,
      message: `${label} non è stato letto: inseriscilo a mano.`,
    })),
    ...parsed.warnings,
    ...consistencyWarnings(parsed.draft),
  ];

  const status: ExtractionStatus = missing.length === 0 ? 'complete' : 'incomplete';
  const confidence: ExtractionConfidence =
    status === 'incomplete' ? 'low' : warnings.length === 0 ? 'high' : 'medium';

  return { parserId, status, confidence, warnings, draft: parsed.draft };
}

function unrecognized(warning: ExtractionWarning): PayslipExtraction {
  return {
    parserId: null,
    status: 'unrecognized',
    confidence: 'low',
    warnings: [warning],
    draft: emptyDraft(),
  };
}

/**
 * Legge il documento con il primo parser che lo riconosce.
 *
 * Nessun parser, o un parser che fallisce, non è un errore della richiesta:
 * il file è un PDF valido, solo che i dati andranno inseriti a mano. Il
 * dettaglio del guasto non viene riportato né registrato — potrebbe contenere
 * frammenti del documento.
 */
export function extractPayslip(
  document: PdfTextDocument,
  parsers: readonly PayslipParser[],
): PayslipExtraction {
  if (textLength(document) < MIN_TEXT_LENGTH) {
    return unrecognized({
      code: 'no-text',
      field: null,
      message:
        'Il PDF non contiene testo selezionabile (probabilmente è una scansione): inserisci i dati a mano.',
    });
  }

  const parser = parsers.find((candidate) => candidate.canParse(document));
  if (parser === undefined) {
    return unrecognized({
      code: 'unknown-format',
      field: null,
      message: 'Il formato del cedolino non è riconosciuto: inserisci i dati a mano.',
    });
  }

  try {
    return assess(parser.id, parser.parse(document));
  } catch {
    return unrecognized({
      code: 'parser-failure',
      field: null,
      message: 'La lettura del cedolino non è riuscita: inserisci i dati a mano.',
    });
  }
}

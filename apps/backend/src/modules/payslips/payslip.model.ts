import { z } from 'zod';
import { foldSearchText } from '../../shared/text.js';

/**
 * Modello di dominio dei cedolini.
 *
 * Non dipende da Express, da SQLite né dal formato del PDF. Il cedolino è una
 * fotografia del mese: ciò che c'è scritto, non ciò che se ne deduce. Per
 * questo qui non esistono delta, trend o totali progressivi — si calcolano
 * quando servono (`payslip-comparison.ts`), così non possono divergere dalle
 * righe da cui nascono.
 *
 * Gli importi sono interi in centesimi. Quantità, ore e saldi di ferie e
 * permessi non sono denaro: restano numeri decimali, come li stampa il
 * cedolino.
 */

/** Dove compare una voce del cedolino. */
export const PAYSLIP_SECTIONS = [
  /** Colonna delle competenze: soldi che entrano in busta. */
  'earning',
  /** Colonna delle trattenute: soldi che escono dalla busta. */
  'deduction',
  /** Importi figurativi a carico dell'azienda (TFR ai fondi, contributi c/ditta). */
  'employer_contribution',
  /** Imponibili, aliquote, detrazioni: informazioni che non muovono la busta. */
  'informational',
] as const;
export type PayslipSection = (typeof PAYSLIP_SECTIONS)[number];

/** I saldi che il cedolino riporta mese per mese. */
export const LEAVE_TYPES = ['FERIE', 'PAR'] as const;
export type LeaveType = (typeof LEAVE_TYPES)[number];

/** Una riga del cedolino. */
export interface PayslipItem {
  /** Codice della voce, quando il cedolino lo stampa. */
  code: string | null;
  description: string;
  section: PayslipSection;
  /** Importo in centesimi. Per le voci informative è il valore della riga. */
  amountCents: number;
  quantity: number | null;
  unit: string | null;
}

/**
 * Saldo di ferie o permessi alla fine del mese.
 *
 * È una fotografia, non un movimento: il residuo di settembre non si somma a
 * quello di agosto, lo sostituisce.
 */
export interface LeaveBalance {
  type: LeaveType;
  accrued: number;
  used: number;
  remaining: number;
  unit: string;
}

/** I dati del cedolino che l'utente conferma o corregge. */
export interface PayslipData {
  /** Mese di competenza, `YYYY-MM`. */
  period: string;
  employer: string | null;
  totalEarningsCents: number;
  totalDeductionsCents: number;
  netCents: number;
  /** Arrotondamento del mese, quando il cedolino lo riporta. */
  roundingCents: number | null;
  taxableInpsCents: number | null;
  taxableIrpefCents: number | null;
  workedHours: number | null;
  items: PayslipItem[];
  leaveBalances: LeaveBalance[];
}

/** Il cedolino persistito. */
export interface Payslip extends PayslipData {
  id: string;
  fileName: string;
  /** SHA-256 del PDF: lo stesso file non entra due volte. */
  sha256: string;
  importedAt: string;
  /** Il parser che ha prodotto la bozza, o `manual` se non ne è servito nessuno. */
  parserId: string;
}

/** Il periodo `YYYY-MM`, con un mese che esiste. */
export const PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isPeriod(value: string): boolean {
  return PERIOD_PATTERN.test(value);
}

/**
 * La chiave con cui una voce si riconosce da un mese all'altro.
 *
 * Il codice, quando c'è, è l'identità della voce: la descrizione può cambiare
 * di una virgola senza che la voce cambi. Senza codice resta la descrizione,
 * normalizzata quanto basta perché «Indennità L.207/24» e «INDENNITA' L. 207/24»
 * siano la stessa cosa.
 */
export function itemKey(item: Pick<PayslipItem, 'code' | 'description'>): string {
  const code = item.code?.trim().toUpperCase() ?? '';
  if (code.length > 0) {
    return `code:${code}`;
  }

  // Senza separatori: «T.F.R.» e «TFR», «L.207/24» e «L 207 24» coincidono.
  return `desc:${normalizeDescription(item.description).replaceAll(' ', '')}`;
}

/** Minuscolo, senza accenti, senza punteggiatura, con spazi singoli. */
export function normalizeDescription(description: string): string {
  return foldSearchText(description).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/** Un importo in centesimi entro limiti che un cedolino non può superare. */
const MAX_CENTS = 100_000_000_00;

const centsSchema = z
  .number({ error: 'Importo non valido: deve essere un numero intero di centesimi.' })
  .int({ error: 'Importo non valido: deve essere un numero intero di centesimi.' })
  .min(-MAX_CENTS, { error: 'Importo fuori scala.' })
  .max(MAX_CENTS, { error: 'Importo fuori scala.' });

const nonNegativeCents = centsSchema.min(0, { error: 'Il totale non può essere negativo.' });

const decimalSchema = z
  .number({ error: 'Valore numerico non valido.' })
  .finite({ error: 'Valore numerico non valido.' })
  .min(-1_000_000, { error: 'Valore fuori scala.' })
  .max(1_000_000, { error: 'Valore fuori scala.' });

/** Una stringa vuota non è un valore: è l'assenza del dato. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, { error: `Testo troppo lungo (massimo ${String(max)} caratteri).` })
    .nullish()
    .transform((value) => (value === undefined || value === null || value === '' ? null : value));

export const periodSchema = z
  .string({ error: 'Periodo mancante.' })
  .trim()
  .regex(PERIOD_PATTERN, { error: 'Periodo non valido: usa il formato AAAA-MM.' });

/** Il corpo della richiesta è l'unico punto in cui zod non ha un campo a cui riferirsi. */
const BODY_ERROR = 'Corpo della richiesta mancante o non valido.';

export const payslipItemSchema = z.object({
  code: optionalText(16).refine((code) => code === null || /^[\p{L}\p{N}._/-]+$/u.test(code), {
    error: 'Codice voce non valido.',
  }),
  description: z
    .string({ error: 'Descrizione della voce mancante.' })
    .trim()
    .min(1, { error: 'Descrizione della voce mancante.' })
    .max(200, { error: 'Descrizione della voce troppo lunga.' }),
  section: z.enum(PAYSLIP_SECTIONS, { error: 'Sezione della voce non valida.' }),
  amountCents: centsSchema,
  quantity: decimalSchema.nullish().transform((value) => value ?? null),
  unit: optionalText(12),
}, { error: 'Voce non valida.' });

export const leaveBalanceSchema = z.object({
  type: z.enum(LEAVE_TYPES, { error: 'Tipo di saldo non valido: FERIE oppure PAR.' }),
  accrued: decimalSchema,
  used: decimalSchema,
  remaining: decimalSchema,
  unit: z
    .string({ error: 'Unità del saldo mancante.' })
    .trim()
    .min(1, { error: 'Unità del saldo mancante.' })
    .max(12, { error: 'Unità del saldo troppo lunga.' }),
}, { error: 'Saldo non valido.' });

const leaveBalancesSchema = z
  .array(leaveBalanceSchema, { error: 'I saldi devono essere un elenco.' })
  .max(LEAVE_TYPES.length)
  .refine((balances) => new Set(balances.map((balance) => balance.type)).size === balances.length, {
    error: 'Ogni saldo (FERIE, PAR) può comparire una sola volta.',
  });

const payslipDataShape = {
  period: periodSchema,
  employer: optionalText(200),
  totalEarningsCents: nonNegativeCents,
  totalDeductionsCents: nonNegativeCents,
  netCents: centsSchema,
  roundingCents: centsSchema.nullish().transform((value) => value ?? null),
  taxableInpsCents: centsSchema.nullish().transform((value) => value ?? null),
  taxableIrpefCents: centsSchema.nullish().transform((value) => value ?? null),
  workedHours: decimalSchema.nullish().transform((value) => value ?? null),
  items: z.array(payslipItemSchema, { error: 'Le voci devono essere un elenco.' }).max(300, { error: 'Troppe voci per un cedolino.' }),
  leaveBalances: leaveBalancesSchema,
};

/** Ciò che arriva con la conferma di un'analisi. */
export const newPayslipSchema = z.object({
  analysisId: z.string({ error: 'Analisi mancante.' }).trim().min(1, { error: 'Analisi mancante.' }),
  /** Sostituire il cedolino già presente per lo stesso mese: va chiesto, mai dedotto. */
  replaceExisting: z
    .boolean({ error: 'La sostituzione del cedolino esistente deve essere vero o falso.' })
    .optional()
    .default(false),
  ...payslipDataShape,
}, { error: BODY_ERROR });

/** Correzione di un cedolino già confermato: si indica solo ciò che cambia. */
export const payslipUpdateSchema = z
  .object(payslipDataShape, { error: BODY_ERROR })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, { error: 'Nessuna modifica indicata.' });

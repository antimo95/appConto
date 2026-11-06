import type { LeaveBalance, LeaveType, PayslipItem, PayslipSection } from '../payslip.model.js';
import { normalizeDescription } from '../payslip.model.js';
import { isItalianNumber, parseItalianCents, parseItalianDecimal } from './italian-numbers.js';
import type { PdfTextDocument, PdfTextItem, PdfTextPage } from './pdf-text.js';
import {
  emptyDraft,
  type ExtractionWarning,
  type ParsedPayslip,
  type PayslipDraft,
  type PayslipParser,
} from './payslip-parser.js';
import {
  center,
  compactKey,
  findLabel,
  findLabels,
  groupRows,
  isLabel,
  nearest,
  tokenize,
  type Row,
  type Token,
} from './text-layout.js';

/**
 * Il cedolino digitale nel modello di Libro Unico più diffuso in Italia: un
 * modulo con le voci del mese in quattro colonne — importo base, riferimento,
 * trattenute, competenze — e in fondo i totali, il netto e i saldi di ferie e
 * permessi.
 *
 * Il parser legge la geometria, non il testo di corsa: un numero è una
 * competenza perché sta sotto l'intestazione COMPETENZE, non perché lo dice la
 * riga. Gli importi fra parentesi sono figurativi — a carico dell'azienda, non
 * della busta — e non entrano nei totali.
 */

const LABELS = {
  base: ['IMPORTO', 'BASE'],
  reference: ['RIFERIMENTO'],
  deductions: ['TRATTENUTE'],
  earnings: ['COMPETENZE'],
  totalEarnings: ['TOTALE', 'COMPETENZE'],
  totalDeductions: ['TOTALE', 'TRATTENUTE'],
  rounding: ['ARROTONDAMENTO'],
  net: ['NETTO', 'DEL', 'MESE'],
  period: ['PERIODO', 'DI', 'RETRIBUZIONE'],
  employer: ['RAGIONE', 'SOCIALE'],
  ordinaryHours: ['ORE', 'ORDINARIE'],
  accrued: ['MATURATO'],
  used: ['GODUTO'],
  remaining: ['RESIDUO'],
  remainingPreviousYear: ['RESIDUO', 'AP'],
} as const;

/** Le sezioni che chiudono l'elenco delle voci, dall'alto verso il basso. */
const ITEMS_END_LABELS = [['CONGUAGLIO'], ['PROGRESSIVI'], ['RATEI'], ['TOTALE', 'COMPETENZE']] as const;

/**
 * Tutte le etichette del modulo. Un elemento che è per intero una di loro non
 * si cerca al suo interno: «Residuo AP» non contiene l'etichetta «Residuo».
 */
const KNOWN_LABELS = { vocabulary: [...Object.values(LABELS), ...ITEMS_END_LABELS] };

/** Due intestazioni più vicine di così in verticale sono sulla stessa riga. */
const SAME_ROW = 3;

/** Un codice voce: lettere e cifre, almeno una cifra. `Z00001`, `F02000`, `ZP9960`. */
const ITEM_CODE = /^(?=[A-Z0-9]*\d)[A-Z0-9]{4,8}$/;

/** Le unità che il modulo stampa accanto al riferimento. */
const UNITS = new Set(['ORE', 'GG', 'GIORNI', '%', 'H']);

const MONTHS = [
  'gennaio',
  'febbraio',
  'marzo',
  'aprile',
  'maggio',
  'giugno',
  'luglio',
  'agosto',
  'settembre',
  'ottobre',
  'novembre',
  'dicembre',
] as const;

const MONTH_YEAR = new RegExp(`\\b(${MONTHS.join('|')})\\s+(\\d{4})\\b`, 'gi');

type ColumnName = 'base' | 'reference' | 'deductions' | 'earnings';

interface Column {
  name: ColumnName;
  center: number;
}

/** La griglia delle voci su una pagina. */
interface ItemsLayout {
  page: PdfTextPage;
  columns: Column[];
  /** Le parole a sinistra di qui sono codice e descrizione. */
  descriptionLimit: number;
  top: number;
  bottom: number;
}

/** Una riga delle voci, prima di decidere che cosa diventa. */
interface ItemRow {
  code: string | null;
  description: string;
  figurative: boolean;
  values: Partial<Record<ColumnName, string>>;
  unit: string | null;
}

function numberText(token: Token): string | null {
  const text = token.text.replace(/[()]/g, '');

  return isItalianNumber(text) ? text : null;
}

function isNumberToken(token: Token): boolean {
  return numberText(token) !== null;
}

function sameRow(a: PdfTextItem, b: PdfTextItem): boolean {
  return Math.abs(a.y - b.y) <= SAME_ROW;
}

/** La riga delle intestazioni delle voci, se la pagina ce l'ha. */
function itemsLayout(page: PdfTextPage): ItemsLayout | null {
  for (const deductions of findLabels(page, LABELS.deductions, KNOWN_LABELS)) {
    const onRow = (words: readonly string[]) =>
      findLabels(page, words, KNOWN_LABELS).find((label) => sameRow(label, deductions));

    const earnings = onRow(LABELS.earnings);
    const base = onRow(LABELS.base);
    const reference = onRow(LABELS.reference);
    if (earnings === undefined || base === undefined || reference === undefined) {
      continue;
    }

    const ends = ITEMS_END_LABELS.flatMap((words) => findLabels(page, words, KNOWN_LABELS))
      .map((label) => label.y)
      .filter((y) => y < deductions.y);

    return {
      page,
      columns: [
        { name: 'base', center: center(base) },
        { name: 'reference', center: center(reference) },
        { name: 'deductions', center: center(deductions) },
        { name: 'earnings', center: center(earnings) },
      ],
      descriptionLimit: base.x - 2,
      top: deductions.y - SAME_ROW,
      bottom: ends.length === 0 ? Number.NEGATIVE_INFINITY : Math.max(...ends),
    };
  }

  return null;
}

function readItemRow(row: Row, layout: ItemsLayout): ItemRow | null {
  // Gli asterischi segnano le voci che concorrono agli imponibili: non sono testo.
  const tokens = row.tokens.filter((token) => token.text !== '*');
  const words = tokens.filter((token) => token.x < layout.descriptionLimit && !isNumberToken(token));

  const first = words[0];
  const code = first !== undefined && ITEM_CODE.test(first.text) ? first.text : null;
  const description = (code === null ? words : words.slice(1)).map((token) => token.text).join(' ');

  const values: Partial<Record<ColumnName, string>> = {};
  for (const token of tokens) {
    const text = numberText(token);
    if (text === null || token.x < layout.descriptionLimit) {
      continue;
    }

    const column = nearest(layout.columns, (candidate) => Math.abs(candidate.center - center(token)));
    if (column !== null) {
      values[column.name] ??= text;
    }
  }

  if (Object.keys(values).length === 0) {
    return null;
  }

  const unit = tokens.find(
    (token) => token.x >= layout.descriptionLimit && UNITS.has(token.text.toUpperCase()),
  );

  return {
    code,
    description,
    // Solo le parentesi attorno agli importi: «Indennità (L.207/24)» non è figurativa.
    figurative: tokens.some((token) => token.x >= layout.descriptionLimit && token.text.includes('(')),
    values,
    unit: unit === undefined ? null : unit.text.toUpperCase(),
  };
}

interface ItemsReading {
  items: PayslipItem[];
  /** L'importo base di ogni riga, per ritrovare gli imponibili. */
  bases: { description: string; cents: number }[];
  warnings: ExtractionWarning[];
}

/** Che cosa diventa una riga: la colonna in cui sta l'importo decide la sezione. */
function toItems(row: ItemRow): { items: PayslipItem[]; unreadable: boolean } {
  const quantity = row.values.reference === undefined ? null : parseItalianDecimal(row.values.reference);
  const make = (section: PayslipSection, text: string): PayslipItem | null => {
    const amountCents = parseItalianCents(text);

    return amountCents === null
      ? null
      : { code: row.code, description: row.description, section, amountCents, quantity, unit: row.unit };
  };

  const money: [ColumnName, PayslipSection][] = [
    ['earnings', row.figurative ? 'employer_contribution' : 'earning'],
    ['deductions', row.figurative ? 'employer_contribution' : 'deduction'],
  ];

  const candidates = money.flatMap(([column, section]) => {
    const text = row.values[column];
    return text === undefined ? [] : [make(section, text)];
  });

  // Senza competenze né trattenute la riga è un'informazione: vale l'importo base.
  if (candidates.length === 0 && row.values.base !== undefined) {
    candidates.push(make('informational', row.values.base));
  }

  const items = candidates.filter((item): item is PayslipItem => item !== null);

  return { items, unreadable: candidates.length === 0 || items.length < candidates.length };
}

function readItems(layouts: readonly ItemsLayout[]): ItemsReading {
  const reading: ItemsReading = { items: [], bases: [], warnings: [] };
  let unreadable = 0;

  for (const layout of layouts) {
    const rows = groupRows(tokenize(layout.page.items)).filter(
      (row) => row.y < layout.top && row.y > layout.bottom,
    );

    for (const row of rows) {
      const itemRow = readItemRow(row, layout);
      if (itemRow === null) {
        continue;
      }
      if (itemRow.description.length === 0) {
        unreadable++;
        continue;
      }

      const base = itemRow.values.base === undefined ? null : parseItalianCents(itemRow.values.base);
      if (base !== null) {
        reading.bases.push({ description: itemRow.description, cents: base });
      }

      const converted = toItems(itemRow);
      reading.items.push(...converted.items);
      if (converted.unreadable) {
        unreadable++;
      }
    }
  }

  if (unreadable > 0) {
    reading.warnings.push({
      code: 'unreadable-rows',
      field: 'items',
      message: `${String(unreadable)} ${unreadable === 1 ? 'riga delle voci non è stata letta' : 'righe delle voci non sono state lette'}: confrontale con il PDF e aggiungile a mano se servono.`,
    });
  }

  return reading;
}

/** L'importo base della prima riga la cui descrizione contiene una delle frasi. */
function baseOf(bases: ItemsReading['bases'], phrases: readonly string[]): number | null {
  for (const phrase of phrases) {
    const found = bases.find((base) => normalizeDescription(base.description).includes(phrase));
    if (found !== undefined) {
      return found.cents;
    }
  }

  return null;
}

/** Le etichette del riquadro dei totali: ognuna si contende gli importi vicini. */
const TOTAL_LABELS = [LABELS.totalEarnings, LABELS.totalDeductions, LABELS.rounding, LABELS.net] as const;

/** Quanto sta sopra il numero l'etichetta; negativo se sta sotto. */
function drop(label: PdfTextItem, token: Token): number {
  return label.y - token.y;
}

/** Se il numero può accompagnare l'etichetta: a destra, sulla stessa riga o poco sotto. */
function accompanies(label: PdfTextItem, token: Token): boolean {
  const below = drop(label, token);
  return token.x >= label.x && below >= -SAME_ROW && below <= 16;
}

/**
 * L'importo che accompagna un'etichetta dei totali.
 *
 * Sta a destra dell'etichetta, sulla stessa riga o poco sotto: il netto, per
 * esempio, è stampato sotto la propria etichetta. Un numero appartiene però
 * all'etichetta più vicina fra tutte quelle dei totali: se il totale
 * competenze manca, il numero del totale trattenute che gli sta sotto resta
 * delle trattenute — prenderlo significherebbe inventare un valore.
 */
function amountNear(document: PdfTextDocument, words: readonly string[]): string | null {
  const found = findLabel(document.pages, words, KNOWN_LABELS);
  if (found === null) {
    return null;
  }

  const { page, label } = found;
  const rivals = TOTAL_LABELS.flatMap((rival) => findLabels(page, rival, KNOWN_LABELS));
  const candidates = tokenize(page.items).filter((token) => {
    if (!isNumberToken(token) || !accompanies(label, token)) {
      return false;
    }

    const owner = nearest(
      rivals.filter((rival) => accompanies(rival, token)),
      (rival) => Math.abs(drop(rival, token)),
    );
    return owner === label;
  });

  const best = nearest(candidates, (token) => Math.abs(drop(label, token)));

  return best === null ? null : numberText(best);
}

function readCents(
  document: PdfTextDocument,
  words: readonly string[],
  field: keyof PayslipDraft,
  warnings: ExtractionWarning[],
): number | null {
  const text = amountNear(document, words);
  if (text === null) {
    return null;
  }

  const cents = parseItalianCents(text);
  if (cents === null) {
    warnings.push({
      code: 'unreadable-amount',
      field,
      message: 'Un importo dei totali non è leggibile: inseriscilo a mano.',
    });
  }

  return cents;
}

function periodFrom(text: string): string[] {
  return [...text.matchAll(MONTH_YEAR)].map((match) => {
    const month = MONTHS.indexOf((match[1] ?? '').toLowerCase() as (typeof MONTHS)[number]) + 1;
    return `${match[2] ?? ''}-${String(month).padStart(2, '0')}`;
  });
}

/**
 * Il mese di competenza.
 *
 * Prima sotto l'etichetta PERIODO DI RETRIBUZIONE; se manca, dal mese scritto
 * nel documento — ma solo se è uno solo. Due mesi diversi non sono un dato da
 * scegliere, sono un'ambiguità da segnalare.
 */
function readPeriod(document: PdfTextDocument, warnings: ExtractionWarning[]): string | null {
  const found = findLabel(document.pages, LABELS.period, KNOWN_LABELS);
  if (found !== null) {
    const { page, label } = found;
    const below = page.items
      .filter(
        (item) =>
          item.y < label.y - 1 &&
          item.y >= label.y - 20 &&
          item.x >= label.x - 40 &&
          item.x <= label.x + label.width + 40,
      )
      .map((item) => item.text)
      .join(' ');

    const period = periodFrom(below)[0];
    if (period !== undefined) {
      return period;
    }
  }

  const all = new Set(
    document.pages.flatMap((page) => periodFrom(page.items.map((item) => item.text).join(' '))),
  );

  if (all.size === 1) {
    warnings.push({
      code: 'period-inferred',
      field: 'period',
      message: 'Il mese di competenza è stato dedotto dal testo del documento: verificalo.',
    });
    return [...all][0] ?? null;
  }

  if (all.size > 1) {
    warnings.push({
      code: 'period-ambiguous',
      field: 'period',
      message: 'Il documento cita più mesi: indica a mano il mese di competenza.',
    });
  }

  return null;
}

/** Il testo stampato subito sotto un'etichetta, allineato a sinistra con essa. */
function textBelow(document: PdfTextDocument, words: readonly string[]): string | null {
  const found = findLabel(document.pages, words, KNOWN_LABELS);
  if (found === null) {
    return null;
  }

  const { page, label } = found;
  const value = page.items.find(
    (item) =>
      item.y < label.y - 2 &&
      item.y >= label.y - 14 &&
      Math.abs(item.x - label.x) <= 15 &&
      !isItalianNumber(item.text),
  );

  return value === undefined ? null : value.text.trim();
}

/** Le ore ordinarie lavorate, stampate sotto la propria intestazione. */
function readWorkedHours(document: PdfTextDocument): number | null {
  for (const page of document.pages) {
    for (const label of findLabels(page, LABELS.ordinaryHours, KNOWN_LABELS)) {
      const value = tokenize(page.items).find(
        (token) =>
          token.y < label.y - 2 &&
          token.y >= label.y - 15 &&
          Math.abs(center(token) - center(label)) <= 20 &&
          isNumberToken(token),
      );
      const hours = value === undefined ? null : parseItalianDecimal(value.text);
      if (hours !== null) {
        return hours;
      }
    }
  }

  return null;
}

function leaveType(text: string): LeaveType | null {
  const key = compactKey(text);
  if (key === 'FERIE') {
    return 'FERIE';
  }

  return /^(PERM|PERMESSI)?PAR$/.test(key) ? 'PAR' : null;
}

type LeaveColumn = 'accrued' | 'used' | 'remaining' | 'remainingPreviousYear';

/**
 * I saldi di ferie e P.A.R.
 *
 * Sono fotografie di fine mese: si leggono come sono, senza ricalcolarle. Il
 * conto `maturato − goduto (+ residuo anno precedente) = residuo` serve solo a
 * dire se la lettura è plausibile.
 */
function readLeave(document: PdfTextDocument, warnings: ExtractionWarning[]): LeaveBalance[] {
  const balances: LeaveBalance[] = [];

  for (const page of document.pages) {
    for (const accrued of findLabels(page, LABELS.accrued, KNOWN_LABELS)) {
      const header = (words: readonly string[]) =>
        findLabels(page, words, KNOWN_LABELS).find((label) => sameRow(label, accrued));
      const columns = (
        [
          ['accrued', accrued],
          ['used', header(LABELS.used)],
          ['remaining', header(LABELS.remaining)],
          ['remainingPreviousYear', header(LABELS.remainingPreviousYear)],
        ] as const
      ).flatMap(([name, label]) => (label === undefined ? [] : [{ name, center: center(label) }]));

      const tokens = tokenize(page.items);
      const labels = page.items.filter(
        (item) => item.y < accrued.y && item.y >= accrued.y - 40 && item.x < accrued.x,
      );

      for (const label of labels) {
        const type = leaveType(label.text);
        if (type === null || balances.some((balance) => balance.type === type)) {
          continue;
        }

        const values: Partial<Record<LeaveColumn, number>> = {};
        let unit: string | null = null;
        for (const token of tokens) {
          if (Math.abs(token.y - label.y) > SAME_ROW || token.x <= label.x + label.width) {
            continue;
          }

          if (UNITS.has(token.text.toUpperCase())) {
            unit ??= token.text.toUpperCase();
            continue;
          }

          const value = parseItalianDecimal(token.text);
          const column = nearest(columns, (candidate) => Math.abs(candidate.center - center(token)));
          if (value !== null && column !== null && Math.abs(column.center - center(token)) <= 40) {
            values[column.name] ??= value;
          }
        }

        const name = type === 'FERIE' ? 'ferie' : 'P.A.R.';
        if (values.accrued === undefined || values.used === undefined || values.remaining === undefined) {
          warnings.push({
            code: 'leave-incomplete',
            field: 'leaveBalances',
            message: `Il saldo ${name} non è stato letto per intero: completalo a mano.`,
          });
          continue;
        }

        if (unit === null) {
          warnings.push({
            code: 'leave-unit-missing',
            field: 'leaveBalances',
            message: `L'unità del saldo ${name} non è indicata: sono state assunte le ore, verificala.`,
          });
        }

        const expected = values.accrued - values.used + (values.remainingPreviousYear ?? 0);
        if (Math.abs(expected - values.remaining) > 0.005) {
          warnings.push({
            code: 'leave-mismatch',
            field: 'leaveBalances',
            message: `Il residuo ${name} non corrisponde a maturato meno goduto: verificalo.`,
          });
        }

        balances.push({
          type,
          accrued: values.accrued,
          used: values.used,
          remaining: values.remaining,
          unit: unit ?? 'ORE',
        });
      }
    }
  }

  return balances.sort((a, b) => a.type.localeCompare(b.type));
}

function layouts(document: PdfTextDocument): ItemsLayout[] {
  return document.pages.flatMap((page) => {
    const layout = itemsLayout(page);
    return layout === null ? [] : [layout];
  });
}

export const zucchettiLulParser: PayslipParser = {
  id: 'zucchetti-lul/1',

  canParse(document) {
    return (
      layouts(document).length > 0 &&
      document.pages.some((page) => page.items.some((item) => isLabel(item.text, LABELS.net)))
    );
  },

  parse(document): ParsedPayslip {
    const warnings: ExtractionWarning[] = [];
    const reading = readItems(layouts(document));

    const draft: PayslipDraft = {
      ...emptyDraft(),
      period: readPeriod(document, warnings),
      employer: textBelow(document, LABELS.employer),
      totalEarningsCents: readCents(document, LABELS.totalEarnings, 'totalEarningsCents', warnings),
      totalDeductionsCents: readCents(document, LABELS.totalDeductions, 'totalDeductionsCents', warnings),
      netCents: readCents(document, LABELS.net, 'netCents', warnings),
      roundingCents: readCents(document, LABELS.rounding, 'roundingCents', warnings),
      taxableInpsCents: baseOf(reading.bases, ['contributo ivs', 'imponibile inps', 'imponibile previdenziale']),
      taxableIrpefCents: baseOf(reading.bases, ['imponibile irpef']),
      workedHours: readWorkedHours(document),
      items: reading.items,
      leaveBalances: readLeave(document, warnings),
    };

    return { draft, warnings: [...reading.warnings, ...warnings] };
  },
};

import {
  Component,
  ElementRef,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  signal
} from '@angular/core';
import { formatMonth } from '../../core/format';
import { Badge } from '@shared/ui/feedback/badge/badge';
import {
  CONFIDENCE_LABELS,
  EXTRACTION_STATUS_MESSAGES,
  KINDS,
  KIND_LABELS,
  LEAVE_LABELS,
  LEAVE_TYPES,
  SECTIONS,
  SECTION_LABELS,
  centsToInput,
  numberToInput,
  parseCents,
  parseNumberInput
} from './payslip-format';
import {
  LeaveType,
  PayslipAnalysis,
  PayslipData,
  PayslipDraft,
  PayslipKind,
  PayslipSection,
  ReviewResult
} from './payslip.model';

type ScalarKey =
  | 'period'
  | 'employer'
  | 'totalEarnings'
  | 'totalDeductions'
  | 'net'
  | 'rounding'
  | 'taxableInps'
  | 'taxableIrpef'
  | 'workedHours';

interface ScalarField {
  readonly key: ScalarKey;
  readonly label: string;
  readonly kind: 'month' | 'text' | 'amount' | 'number';
  readonly required: boolean;
}

/** Il periodo, i tre totali e il netto non si possono lasciare vuoti: il resto è facoltativo. */
const SCALAR_FIELDS: readonly ScalarField[] = [
  { key: 'period', label: 'Mese di competenza', kind: 'month', required: true },
  { key: 'employer', label: 'Datore di lavoro', kind: 'text', required: false },
  { key: 'totalEarnings', label: 'Totale competenze (€)', kind: 'amount', required: true },
  { key: 'totalDeductions', label: 'Totale trattenute (€)', kind: 'amount', required: true },
  { key: 'net', label: 'Netto in busta (€)', kind: 'amount', required: true },
  { key: 'rounding', label: 'Arrotondamento (€)', kind: 'amount', required: false },
  { key: 'taxableInps', label: 'Imponibile INPS (€)', kind: 'amount', required: false },
  { key: 'taxableIrpef', label: 'Imponibile IRPEF (€)', kind: 'amount', required: false },
  { key: 'workedHours', label: 'Ore lavorate', kind: 'number', required: false }
];

interface ItemRow {
  readonly id: number;
  code: string;
  description: string;
  section: PayslipSection;
  amount: string;
  quantity: string;
  unit: string;
}

interface LeaveRow {
  readonly id: number;
  type: LeaveType;
  accrued: string;
  used: string;
  remaining: string;
  unit: string;
}

type ScalarValues = Record<ScalarKey, string>;

const REQUIRED = 'Valore obbligatorio.';
const INVALID = 'Valore non valido.';
const TOO_MANY_DECIMALS = 'Al massimo due decimali.';
const periodTaken = (kind: PayslipKind): string =>
  `Esiste già un cedolino ${KIND_LABELS[kind].toLowerCase()} per questo mese.`;
const LEAVE_REPEATED = 'Saldo già presente.';
const NEGATIVE = 'Il totale non può essere negativo.';
const OUT_OF_SCALE = 'Valore fuori scala.';
const INVALID_CODE = 'Codice voce non valido.';

/** Gli stessi limiti del backend: euro per gli importi, unità per i valori decimali. */
const MAX_EUROS = 100_000_000;
const MAX_DECIMAL = 1_000_000;

const tooLong = (max: number): string => `Testo troppo lungo (massimo ${max} caratteri).`;

/**
 * Vuoto è lecito se il campo è facoltativo; un testo che non è un numero mai.
 * Oltre `max` in valore assoluto il backend rifiuta; `nonNegative` vale per i totali.
 */
function checkNumber(
  text: string,
  required: boolean,
  max: number = MAX_DECIMAL,
  nonNegative = false,
  cents = false
): string | null {
  if (text.trim() === '') {
    return required ? REQUIRED : null;
  }

  const value = parseNumberInput(text);
  if (value === null) {
    return INVALID;
  }
  if (cents && parseCents(text) === null) {
    return TOO_MANY_DECIMALS;
  }

  return Math.abs(value) > max ? OUT_OF_SCALE : nonNegative && value < 0 ? NEGATIVE : null;
}

/** Il backend misura il testo già ripulito dagli spazi ai bordi. */
function checkLength(text: string, max: number): string | null {
  return text.trim().length > max ? tooLong(max) : null;
}

/**
 * Revisione e correzione di un cedolino.
 *
 * Serve due momenti: dopo l'analisi di un PDF (con stato dell'estrazione,
 * avvisi e un eventuale conflitto di mese) e nella modifica di un cedolino già
 * salvato (senza `analysis`). I campi restano testo finché l'utente scrive:
 * si convertono in centesimi solo alla conferma, così `1.234,56` non viene
 * riscritto mentre lo si digita.
 */
@Component({
  selector: 'app-payslip-review',
  imports: [Badge],
  templateUrl: './payslip-review.html',
  styleUrl: './payslip-review.scss',
  // Il contenitore è la destinazione del fuoco alla creazione: senza, chi usa la tastiera o
  // uno screen reader resta sul pulsante che ha appena fatto sparire il resto della pagina.
  host: {
    role: 'group',
    tabindex: '-1',
    '[attr.aria-label]': "analysis() ? 'Verifica del cedolino' : 'Modifica del cedolino'"
  }
})
export class PayslipReview {
  /** I valori di partenza: una bozza d'analisi o un cedolino salvato. */
  readonly draft = input.required<PayslipDraft>();
  /** Assente nella modifica di un cedolino già salvato. */
  readonly analysis = input<PayslipAnalysis | null>(null);
  /** Un salvataggio in corso: niente doppio invio. */
  readonly busy = input(false);
  /** L'esito negativo di conferma o salvataggio: sta sopra i pulsanti, dove l'utente guarda. */
  readonly error = input<string | null>(null);
  /**
   * I cedolini già in archivio, per mese e tipo. Il conflitto segue mese e tipo
   * scelti nei campi, non solo quelli letti dal PDF: l'utente può correggerli.
   */
  readonly taken = input<readonly { period: string; kind: PayslipKind }[]>([]);

  readonly confirmed = output<ReviewResult>();
  readonly cancelled = output<void>();

  protected readonly scalarFields = SCALAR_FIELDS;
  protected readonly sections = SECTIONS;
  protected readonly sectionLabels = SECTION_LABELS;
  protected readonly leaveTypes = LEAVE_TYPES;
  protected readonly leaveLabels = LEAVE_LABELS;
  protected readonly kinds = KINDS;
  protected readonly kindLabels = KIND_LABELS;
  protected readonly statusMessages = EXTRACTION_STATUS_MESSAGES;
  protected readonly confidenceLabels = CONFIDENCE_LABELS;
  protected readonly formatMonth = formatMonth;
  protected readonly monthPattern = String.raw`\d{4}-(0[1-9]|1[0-2])`;

  protected readonly kind = signal<PayslipKind>('ordinary');
  protected readonly values = signal<ScalarValues>(this.emptyValues());
  protected readonly items = signal<ItemRow[]>([]);
  protected readonly leaves = signal<LeaveRow[]>([]);
  protected readonly replaceExisting = signal(false);

  private nextId = 0;
  /** Vero da quando l'utente ha toccato qualcosa: la pagina lo chiede prima di scartare il modulo. */
  private dirty = false;

  /**
   * Se mese e tipo scelti sono già occupati da un altro cedolino. In modifica
   * la coppia di partenza è del cedolino stesso, quindi non conta.
   */
  private readonly slotTaken = computed(() => {
    const { period } = this.values();
    const kind = this.kind();
    const draft = this.draft();
    const isOwn =
      this.analysis() === null && period === draft.period && kind === (draft.kind ?? 'ordinary');
    const conflict = this.analysis()?.conflict;

    return (
      !isOwn &&
      (this.taken().some((item) => item.period === period && item.kind === kind) ||
        (conflict?.period === period && conflict.kind === kind))
    );
  });

  /** Il mese da sostituire, se la conferma di un'analisi ne sostituirebbe uno. */
  protected readonly conflict = computed<string | null>(() =>
    this.analysis() !== null && this.slotTaken() ? this.values().period : null
  );

  /** Il tipo in minuscolo, per la frase «Esiste già un cedolino <tipo> per <mese>». */
  protected readonly conflictKind = computed(() => KIND_LABELS[this.kind()].toLowerCase());

  protected readonly scalarErrors = computed<Record<ScalarKey, string | null>>(() => {
    const values = this.values();
    const errors = {} as Record<ScalarKey, string | null>;

    for (const field of SCALAR_FIELDS) {
      const text = values[field.key];

      if (field.kind === 'month') {
        // In modifica non c'è sostituzione: un mese occupato è un errore.
        errors[field.key] = !/^\d{4}-(0[1-9]|1[0-2])$/.test(text)
          ? text.trim() === ''
            ? REQUIRED
            : INVALID
          : this.analysis() === null && this.slotTaken()
            ? periodTaken(this.kind())
            : null;
      } else if (field.kind === 'text') {
        errors[field.key] = checkLength(text, 200);
      } else {
        errors[field.key] = checkNumber(
          text,
          field.required,
          field.kind === 'amount' ? MAX_EUROS : MAX_DECIMAL,
          field.key === 'totalEarnings' || field.key === 'totalDeductions',
          field.kind === 'amount'
        );
      }
    }

    return errors;
  });

  protected readonly itemErrors = computed(() =>
    this.items().map((row) => ({
      code:
        row.code.trim().length > 16 || !/^[\p{L}\p{N}._/-]*$/u.test(row.code.trim())
          ? INVALID_CODE
          : null,
      description: row.description.trim() === '' ? REQUIRED : checkLength(row.description, 200),
      amount: checkNumber(row.amount, true, MAX_EUROS, false, true),
      quantity: checkNumber(row.quantity, false),
      unit: checkLength(row.unit, 12)
    }))
  );

  protected readonly leaveErrors = computed(() => {
    const rows = this.leaves();

    // Il backend accetta un saldo per tipo: il secondo dello stesso tipo è l'errore.
    return rows.map((row, index) => ({
      type: rows.findIndex((other) => other.type === row.type) < index ? LEAVE_REPEATED : null,
      accrued: checkNumber(row.accrued, true),
      used: checkNumber(row.used, true),
      remaining: checkNumber(row.remaining, true),
      unit: checkLength(row.unit, 12)
    }));
  });

  /** FERIE e P.A.R. ci sono già entrambi: non c'è un altro saldo da aggiungere. */
  protected readonly leavesFull = computed(() => this.leaves().length >= LEAVE_TYPES.length);

  /** Quanti valori bloccano la conferma. */
  protected readonly problemCount = computed(
    () =>
      Object.values(this.scalarErrors()).filter((error) => error !== null).length +
      this.itemErrors().flatMap((row) => Object.values(row)).filter((error) => error !== null)
        .length +
      this.leaveErrors().flatMap((row) => Object.values(row)).filter((error) => error !== null)
        .length
  );

  protected readonly canConfirm = computed(
    () =>
      !this.busy() &&
      this.problemCount() === 0 &&
      (this.conflict() === null || this.replaceExisting())
  );

  constructor() {
    const host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    afterNextRender(() => host.focus());
    // Una nuova bozza (un altro PDF, un altro cedolino da modificare) riparte da zero.
    effect(() => this.load(this.draft()));
  }

  private emptyValues(): ScalarValues {
    return Object.fromEntries(SCALAR_FIELDS.map((field) => [field.key, ''])) as ScalarValues;
  }

  private load(draft: PayslipDraft): void {
    this.kind.set(draft.kind ?? 'ordinary');
    this.values.set({
      period: draft.period ?? '',
      employer: draft.employer ?? '',
      totalEarnings: centsToInput(draft.totalEarningsCents),
      totalDeductions: centsToInput(draft.totalDeductionsCents),
      net: centsToInput(draft.netCents),
      rounding: centsToInput(draft.roundingCents),
      taxableInps: centsToInput(draft.taxableInpsCents),
      taxableIrpef: centsToInput(draft.taxableIrpefCents),
      workedHours: numberToInput(draft.workedHours)
    });
    this.items.set(
      draft.items.map((item) => ({
        id: this.nextId++,
        code: item.code ?? '',
        description: item.description,
        section: item.section,
        amount: centsToInput(item.amountCents),
        quantity: numberToInput(item.quantity),
        unit: item.unit ?? ''
      }))
    );
    this.leaves.set(
      draft.leaveBalances.map((leave) => ({
        id: this.nextId++,
        type: leave.type,
        accrued: numberToInput(leave.accrued),
        used: numberToInput(leave.used),
        remaining: numberToInput(leave.remaining),
        unit: leave.unit
      }))
    );
    this.replaceExisting.set(false);
    this.dirty = false;
  }

  /** Ci sono modifiche dell'utente non ancora consegnate con «Conferma» o «Salva». */
  isDirty(): boolean {
    return this.dirty;
  }

  protected inputValue(event: Event): string {
    return (event.target as HTMLInputElement | HTMLSelectElement).value;
  }

  protected setScalar(key: ScalarKey, event: Event): void {
    const value = this.inputValue(event);
    this.dirty = true;

    // La sostituzione confermata vale per un mese preciso: cambiato il mese, va richiesta di nuovo.
    if (key === 'period' && value !== this.values().period) {
      this.replaceExisting.set(false);
    }
    this.values.update((current) => ({ ...current, [key]: value }));
  }

  protected setKind(event: Event): void {
    this.dirty = true;
    // Come per il mese: la sostituzione confermata riguardava un altro cedolino.
    this.replaceExisting.set(false);
    this.kind.set(this.inputValue(event) as PayslipKind);
  }

  protected setItem(id: number, field: keyof Omit<ItemRow, 'id'>, event: Event): void {
    const value = this.inputValue(event);
    this.dirty = true;

    this.items.update((rows) =>
      rows.map((row) => (row.id === id ? { ...row, [field]: value } : row))
    );
  }

  protected setLeave(id: number, field: keyof Omit<LeaveRow, 'id'>, event: Event): void {
    const value = this.inputValue(event);
    this.dirty = true;

    this.leaves.update((rows) =>
      rows.map((row) => (row.id === id ? { ...row, [field]: value } : row))
    );
  }

  protected addItem(): void {
    this.dirty = true;
    this.items.update((rows) => [
      ...rows,
      {
        id: this.nextId++,
        code: '',
        description: '',
        section: 'earning',
        amount: '',
        quantity: '',
        unit: ''
      }
    ]);
  }

  protected removeItem(id: number): void {
    this.dirty = true;
    this.items.update((rows) => rows.filter((row) => row.id !== id));
  }

  protected addLeave(): void {
    this.dirty = true;
    this.leaves.update((rows) => {
      // Il primo tipo che manca: due saldi dello stesso tipo il backend non li accetta.
      const type = LEAVE_TYPES.find((candidate) => rows.every((row) => row.type !== candidate));

      return type === undefined
        ? rows
        : [...rows, { id: this.nextId++, type, accrued: '', used: '', remaining: '', unit: 'ore' }];
    });
  }

  protected removeLeave(id: number): void {
    this.dirty = true;
    this.leaves.update((rows) => rows.filter((row) => row.id !== id));
  }

  protected setReplace(event: Event): void {
    this.dirty = true;
    this.replaceExisting.set((event.target as HTMLInputElement).checked);
  }

  protected confirm(): void {
    if (!this.canConfirm()) {
      return;
    }

    // Senza conflitto non c'è nulla da sostituire, anche se la casella era stata spuntata.
    this.confirmed.emit({
      data: this.toData(),
      replaceExisting: this.conflict() !== null && this.replaceExisting()
    });
  }

  /** Solo a form valido: i `!` qui sono garantiti da `problemCount() === 0`. */
  private toData(): PayslipData {
    const v = this.values();

    return {
      period: v.period,
      kind: this.kind(),
      employer: v.employer.trim() === '' ? null : v.employer.trim(),
      totalEarningsCents: parseCents(v.totalEarnings)!,
      totalDeductionsCents: parseCents(v.totalDeductions)!,
      netCents: parseCents(v.net)!,
      roundingCents: parseCents(v.rounding),
      taxableInpsCents: parseCents(v.taxableInps),
      taxableIrpefCents: parseCents(v.taxableIrpef),
      workedHours: parseNumberInput(v.workedHours),
      items: this.items().map((row) => ({
        code: row.code.trim() === '' ? null : row.code.trim(),
        description: row.description.trim(),
        section: row.section,
        amountCents: parseCents(row.amount)!,
        quantity: parseNumberInput(row.quantity),
        unit: row.unit.trim() === '' ? null : row.unit.trim()
      })),
      leaveBalances: this.leaves().map((row) => ({
        type: row.type,
        accrued: parseNumberInput(row.accrued)!,
        used: parseNumberInput(row.used)!,
        remaining: parseNumberInput(row.remaining)!,
        unit: row.unit.trim() === '' ? 'ore' : row.unit.trim()
      }))
    };
  }
}

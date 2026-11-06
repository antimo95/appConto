import { Component, computed, effect, input, output, signal } from '@angular/core';
import { formatMonth } from '../../core/format';
import { Badge } from '@shared/ui/feedback/badge/badge';
import {
  CONFIDENCE_LABELS,
  EXTRACTION_STATUS_MESSAGES,
  LEAVE_LABELS,
  LEAVE_TYPES,
  SECTIONS,
  SECTION_LABELS,
  centsToInput,
  numberToInput,
  parseCents
} from './payslip-format';
import {
  LeaveType,
  PayslipAnalysis,
  PayslipData,
  PayslipDraft,
  PayslipSection,
  ReviewResult
} from './payslip.model';
import { parseAmount } from '../../core/amount';

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
const PERIOD_TAKEN = 'Esiste già un cedolino per questo mese.';
const LEAVE_REPEATED = 'Saldo già presente.';

/** Vuoto è lecito se il campo è facoltativo; un testo che non è un numero mai. */
function checkNumber(text: string, required: boolean): string | null {
  if (text.trim() === '') {
    return required ? REQUIRED : null;
  }

  return parseAmount(text) === null ? INVALID : null;
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
  styleUrl: './payslip-review.scss'
})
export class PayslipReview {
  /** I valori di partenza: una bozza d'analisi o un cedolino salvato. */
  readonly draft = input.required<PayslipDraft>();
  /** Assente nella modifica di un cedolino già salvato. */
  readonly analysis = input<PayslipAnalysis | null>(null);
  /** Un salvataggio in corso: niente doppio invio. */
  readonly busy = input(false);
  /**
   * I mesi che hanno già un cedolino in archivio. Il conflitto segue il mese
   * scritto nel campo, non solo quello letto dal PDF: l'utente può correggerlo.
   */
  readonly takenPeriods = input<readonly string[]>([]);

  readonly confirmed = output<ReviewResult>();
  readonly cancelled = output<void>();

  protected readonly scalarFields = SCALAR_FIELDS;
  protected readonly sections = SECTIONS;
  protected readonly sectionLabels = SECTION_LABELS;
  protected readonly leaveTypes = LEAVE_TYPES;
  protected readonly leaveLabels = LEAVE_LABELS;
  protected readonly statusMessages = EXTRACTION_STATUS_MESSAGES;
  protected readonly confidenceLabels = CONFIDENCE_LABELS;
  protected readonly formatMonth = formatMonth;

  protected readonly values = signal<ScalarValues>(this.emptyValues());
  protected readonly items = signal<ItemRow[]>([]);
  protected readonly leaves = signal<LeaveRow[]>([]);
  protected readonly replaceExisting = signal(false);

  private nextId = 0;

  /**
   * Se il mese scritto nel campo è già occupato da un altro cedolino. In
   * modifica il mese di partenza è del cedolino stesso, quindi non conta.
   */
  private readonly periodTaken = computed(() => {
    const period = this.values().period;
    const own = this.analysis() === null ? this.draft().period : null;

    return (
      period !== own &&
      (this.takenPeriods().includes(period) || this.analysis()?.conflict?.period === period)
    );
  });

  /** Il mese da sostituire, se la conferma di un'analisi ne sostituirebbe uno. */
  protected readonly conflict = computed<string | null>(() =>
    this.analysis() !== null && this.periodTaken() ? this.values().period : null
  );

  protected readonly scalarErrors = computed<Record<ScalarKey, string | null>>(() => {
    const values = this.values();
    const errors = {} as Record<ScalarKey, string | null>;

    for (const field of SCALAR_FIELDS) {
      const text = values[field.key];

      if (field.kind === 'month') {
        // In modifica non c'è sostituzione: un mese occupato è un errore.
        errors[field.key] = !/^\d{4}-(0[1-9]|1[0-2])$/.test(text)
          ? REQUIRED
          : this.analysis() === null && this.periodTaken()
            ? PERIOD_TAKEN
            : null;
      } else if (field.kind === 'text') {
        errors[field.key] = null;
      } else {
        errors[field.key] = checkNumber(text, field.required);
      }
    }

    return errors;
  });

  protected readonly itemErrors = computed(() =>
    this.items().map((row) => ({
      description: row.description.trim() === '' ? REQUIRED : null,
      amount: checkNumber(row.amount, true),
      quantity: checkNumber(row.quantity, false)
    }))
  );

  protected readonly leaveErrors = computed(() => {
    const rows = this.leaves();

    // Il backend accetta un saldo per tipo: il secondo dello stesso tipo è l'errore.
    return rows.map((row, index) => ({
      type: rows.findIndex((other) => other.type === row.type) < index ? LEAVE_REPEATED : null,
      accrued: checkNumber(row.accrued, true),
      used: checkNumber(row.used, true),
      remaining: checkNumber(row.remaining, true)
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
    // Una nuova bozza (un altro PDF, un altro cedolino da modificare) riparte da zero.
    effect(() => this.load(this.draft()));
  }

  private emptyValues(): ScalarValues {
    return Object.fromEntries(SCALAR_FIELDS.map((field) => [field.key, ''])) as ScalarValues;
  }

  private load(draft: PayslipDraft): void {
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
  }

  protected inputValue(event: Event): string {
    return (event.target as HTMLInputElement | HTMLSelectElement).value;
  }

  protected setScalar(key: ScalarKey, event: Event): void {
    const value = this.inputValue(event);

    // La sostituzione confermata vale per un mese preciso: cambiato il mese, va richiesta di nuovo.
    if (key === 'period' && value !== this.values().period) {
      this.replaceExisting.set(false);
    }
    this.values.update((current) => ({ ...current, [key]: value }));
  }

  protected setItem(id: number, field: keyof Omit<ItemRow, 'id'>, event: Event): void {
    const value = this.inputValue(event);

    this.items.update((rows) =>
      rows.map((row) => (row.id === id ? { ...row, [field]: value } : row))
    );
  }

  protected setLeave(id: number, field: keyof Omit<LeaveRow, 'id'>, event: Event): void {
    const value = this.inputValue(event);

    this.leaves.update((rows) =>
      rows.map((row) => (row.id === id ? { ...row, [field]: value } : row))
    );
  }

  protected addItem(): void {
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
    this.items.update((rows) => rows.filter((row) => row.id !== id));
  }

  protected addLeave(): void {
    this.leaves.update((rows) => {
      // Il primo tipo che manca: due saldi dello stesso tipo il backend non li accetta.
      const type = LEAVE_TYPES.find((candidate) => rows.every((row) => row.type !== candidate));

      return type === undefined
        ? rows
        : [...rows, { id: this.nextId++, type, accrued: '', used: '', remaining: '', unit: 'ore' }];
    });
  }

  protected removeLeave(id: number): void {
    this.leaves.update((rows) => rows.filter((row) => row.id !== id));
  }

  protected setReplace(event: Event): void {
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
    const optionalCents = (text: string): number | null => parseCents(text);
    const optionalNumber = (text: string): number | null => parseAmount(text);

    return {
      period: v.period,
      employer: v.employer.trim() === '' ? null : v.employer.trim(),
      totalEarningsCents: parseCents(v.totalEarnings)!,
      totalDeductionsCents: parseCents(v.totalDeductions)!,
      netCents: parseCents(v.net)!,
      roundingCents: optionalCents(v.rounding),
      taxableInpsCents: optionalCents(v.taxableInps),
      taxableIrpefCents: optionalCents(v.taxableIrpef),
      workedHours: optionalNumber(v.workedHours),
      items: this.items().map((row) => ({
        code: row.code.trim() === '' ? null : row.code.trim(),
        description: row.description.trim(),
        section: row.section,
        amountCents: parseCents(row.amount)!,
        quantity: optionalNumber(row.quantity),
        unit: row.unit.trim() === '' ? null : row.unit.trim()
      })),
      leaveBalances: this.leaves().map((row) => ({
        type: row.type,
        accrued: parseAmount(row.accrued)!,
        used: parseAmount(row.used)!,
        remaining: parseAmount(row.remaining)!,
        unit: row.unit.trim() === '' ? 'ore' : row.unit.trim()
      }))
    };
  }
}

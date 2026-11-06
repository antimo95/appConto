import { httpResource } from '@angular/common/http';
import { Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { formatMonth } from '../../core/format';
import { toErrorMessage } from '../../core/http-error';
import { PageLayout } from '@shared/layout/page-layout/page-layout';
import { Panel } from '@shared/layout/panel/panel';
import { SectionHeader } from '@shared/layout/section-header/section-header';
import { StatCardGrid, StatCardItem } from '@shared/layout/stat-card-grid/stat-card-grid';
import { Amount } from '@shared/ui/data/amount/amount';
import { EmptyState } from '@shared/ui/feedback/empty-state/empty-state';
import { ErrorRetry } from '@shared/ui/feedback/error-retry/error-retry';
import { PayslipComparisonView } from './payslip-comparison';
import { PayslipDetailView } from './payslip-detail';
import { PayslipLeaveOverview } from './payslip-leave-overview';
import { LEAVE_LABELS, MAX_PAYSLIP_BYTES, centsToEuros, formatLeaveValue } from './payslip-format';
import { PayslipReview } from './payslip-review';
import { PayslipTrend } from './payslip-trend';
import {
  LeaveType,
  PayslipAnalysis,
  PayslipComparison,
  PayslipDetail,
  PayslipList,
  PayslipSummaries,
  PayslipSummary,
  ReviewResult
} from './payslip.model';
import {
  PayslipsApi,
  payslipRequest,
  payslipSummariesRequest,
  payslipsRequest
} from './payslips.api';

type Phase = 'idle' | 'analyzing' | 'reviewing' | 'saving';

/**
 * Workspace dei cedolini.
 *
 * Una sola rotta: il mese scelto sta nell'URL (`?period=YYYY-MM`) e il
 * dettaglio compare nella stessa pagina. Il flusso di caricamento ha quattro
 * momenti — niente, analisi, revisione, salvataggio — e il PDF non diventa un
 * cedolino finché l'utente non conferma i valori.
 */
@Component({
  selector: 'app-payslips-page',
  imports: [
    Amount,
    EmptyState,
    ErrorRetry,
    PageLayout,
    Panel,
    PayslipComparisonView,
    PayslipDetailView,
    PayslipLeaveOverview,
    PayslipReview,
    PayslipTrend,
    SectionHeader,
    StatCardGrid
  ],
  templateUrl: './payslips-page.html',
  styleUrl: './payslips-page.scss'
})
export class PayslipsPage {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly api = inject(PayslipsApi);

  private readonly fileInput = viewChild<ElementRef<HTMLInputElement>>('fileInput');

  private readonly params = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap
  });

  protected readonly list = httpResource<PayslipList>(() => payslipsRequest());
  protected readonly summaries = httpResource<PayslipSummaries>(() => payslipSummariesRequest());

  protected readonly items = computed<PayslipSummary[]>(() =>
    this.list.hasValue() ? this.list.value().items : []
  );

  /** I mesi già in archivio: la revisione li usa per riconoscere un conflitto sul mese digitato. */
  protected readonly takenPeriods = computed(() => this.items().map((item) => item.period));

  /** Il mese dell'URL, o il più recente se manca o non esiste più. */
  protected readonly selected = computed<PayslipSummary | null>(() => {
    const items = this.items();
    const requested = this.params().get('period');

    return items.find((item) => item.period === requested) ?? items[0] ?? null;
  });

  protected readonly detail = httpResource<PayslipDetail>(() => {
    const selected = this.selected();

    return selected === null ? undefined : payslipRequest(selected.id);
  });

  protected readonly detailData = computed<PayslipDetail | null>(() => {
    const detail = this.detail.hasValue() ? this.detail.value() : null;

    return detail !== null && detail.id === this.selected()?.id ? detail : null;
  });

  protected readonly comparison = computed<PayslipComparison | null>(() => {
    const selected = this.selected();
    const summaries = this.summaries.hasValue() ? this.summaries.value() : null;

    return summaries?.comparisons.find((item) => item.payslipId === selected?.id) ?? null;
  });

  protected readonly phase = signal<Phase>('idle');
  protected readonly analysis = signal<PayslipAnalysis | null>(null);
  protected readonly editing = signal(false);
  protected readonly actionError = signal<string | null>(null);

  protected readonly formatMonth = formatMonth;
  protected readonly euros = centsToEuros;

  protected readonly listError = computed(() => {
    const error = this.list.error();

    return error === undefined ? null : toErrorMessage(error);
  });
  protected readonly summariesError = computed(() => {
    const error = this.summaries.error();

    return error === undefined ? null : toErrorMessage(error);
  });
  protected readonly detailError = computed(() => {
    const error = this.detail.error();

    return error === undefined ? null : toErrorMessage(error);
  });

  /** Il testo del riquadro `aria-live`: chi non vede lo schermo sente a che punto si è. */
  protected readonly statusText = computed(() => {
    switch (this.phase()) {
      case 'analyzing':
        return 'Analisi del cedolino in corso…';
      case 'saving':
        return 'Salvataggio in corso…';
      default:
        return '';
    }
  });

  protected readonly showNewReview = computed(
    () => this.analysis() !== null && (this.phase() === 'reviewing' || this.phase() === 'saving')
  );

  protected readonly kpis = computed<StatCardItem[]>(() => {
    const selected = this.selected();
    if (selected === null) {
      return [];
    }

    const comparison = this.comparison();
    const net = comparison?.net;

    return [
      {
        kind: 'amount',
        label: 'Netto',
        value: centsToEuros(selected.netCents),
        tone: 'neutral',
        delta:
          comparison && net && net.deltaPercent !== null
            ? {
                percent: net.deltaPercent,
                caption: `rispetto a ${formatMonth(comparison.previousPeriod)}`,
                tone: net.deltaCents > 0 ? 'positive' : net.deltaCents < 0 ? 'negative' : 'neutral'
              }
            : undefined
      },
      {
        kind: 'amount',
        label: 'Competenze',
        value: centsToEuros(selected.totalEarningsCents),
        tone: 'neutral'
      },
      {
        kind: 'amount',
        label: 'Trattenute',
        value: centsToEuros(selected.totalDeductionsCents),
        tone: 'neutral'
      },
      { kind: 'text', label: 'Ferie residue', value: this.leaveText('FERIE') },
      { kind: 'text', label: `${LEAVE_LABELS.PAR} residui`, value: this.leaveText('PAR') }
    ];
  });

  /** Il residuo del mese scelto: dal dettaglio se c'è, altrimenti dalla serie storica. */
  private leaveText(type: LeaveType): string {
    const selected = this.selected();
    const detail = this.detailData();
    const summaries = this.summaries.hasValue() ? this.summaries.value() : null;

    const balance = detail?.leaveBalances.find((leave) => leave.type === type);
    if (balance) {
      return formatLeaveValue(balance.remaining, balance.unit);
    }

    const remaining =
      summaries?.trend.find((point) => point.payslipId === selected?.id)?.leaveRemaining[type] ??
      null;
    const unit = this.comparison()?.leave.find((leave) => leave.type === type)?.unit ?? 'ore';

    return formatLeaveValue(remaining, unit);
  }

  protected openFilePicker(): void {
    this.fileInput()?.nativeElement.click();
  }

  protected onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    // Senza azzerarlo, riscegliere lo stesso file non scatenerebbe `change`.
    input.value = '';

    if (file === null) {
      return;
    }

    const rejection = this.validateFile(file);
    if (rejection !== null) {
      this.actionError.set(rejection);
      return;
    }

    this.actionError.set(null);
    this.phase.set('analyzing');
    this.api.analyze(file).subscribe({
      next: (analysis) => {
        this.analysis.set(analysis);
        this.phase.set('reviewing');
      },
      error: (error: unknown) => {
        this.actionError.set(toErrorMessage(error));
        this.phase.set('idle');
      }
    });
  }

  /** Il controllo del client risparmia un caricamento destinato a fallire. */
  private validateFile(file: File): string | null {
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');

    if (!isPdf) {
      return 'Il file scelto non è un PDF.';
    }

    return file.size > MAX_PAYSLIP_BYTES ? 'Il file supera il limite di 10 MB.' : null;
  }

  protected confirmNew(result: ReviewResult): void {
    const analysis = this.analysis();
    if (analysis === null) {
      return;
    }

    this.actionError.set(null);
    this.phase.set('saving');
    this.api
      .create({ analysisId: analysis.id, replaceExisting: result.replaceExisting, ...result.data })
      .subscribe({
        next: (saved) => {
          this.analysis.set(null);
          this.phase.set('idle');
          this.afterChange(saved.period, saved.id);
        },
        // La revisione resta aperta: i valori corretti a mano non vanno persi.
        error: (error: unknown) => {
          this.actionError.set(toErrorMessage(error));
          this.phase.set('reviewing');
        }
      });
  }

  protected cancelNew(): void {
    const analysis = this.analysis();

    if (analysis !== null) {
      // Il PDF temporaneo scade comunque: se lo scarto fallisce non c'è nulla da dire.
      this.api.discardAnalysis(analysis.id).subscribe({ error: () => undefined });
    }
    this.analysis.set(null);
    this.actionError.set(null);
    this.phase.set('idle');
  }

  protected startEdit(): void {
    this.actionError.set(null);
    this.editing.set(true);
  }

  protected cancelEdit(): void {
    this.actionError.set(null);
    this.editing.set(false);
  }

  protected confirmEdit(result: ReviewResult): void {
    const detail = this.detailData();
    if (detail === null) {
      return;
    }

    this.actionError.set(null);
    this.phase.set('saving');
    this.api.update(detail.id, result.data).subscribe({
      next: (saved) => {
        this.editing.set(false);
        this.phase.set('idle');
        this.afterChange(saved.period, saved.id);
      },
      error: (error: unknown) => {
        this.actionError.set(toErrorMessage(error));
        this.phase.set('idle');
      }
    });
  }

  protected deleteSelected(): void {
    const detail = this.detailData();
    if (detail === null) {
      return;
    }

    if (!window.confirm(`Eliminare il cedolino di ${formatMonth(detail.period)}?`)) {
      return;
    }

    this.actionError.set(null);
    this.api.remove(detail.id).subscribe({
      next: () => {
        this.list.reload();
        this.summaries.reload();
        // Senza `period` la selezione torna al mese più recente rimasto.
        void this.router.navigate([], { relativeTo: this.route, queryParams: { period: null } });
      },
      error: (error: unknown) => this.actionError.set(toErrorMessage(error))
    });
  }

  protected select(period: string): void {
    void this.router.navigate([], { relativeTo: this.route, queryParams: { period } });
  }

  protected reloadAll(): void {
    this.list.reload();
    this.summaries.reload();
  }

  /** Dopo un salvataggio tutto ciò che deriva dal cedolino si rilegge, e si sceglie il suo mese. */
  private afterChange(period: string, savedId: string): void {
    this.list.reload();
    this.summaries.reload();
    // Lo stesso id non cambia la richiesta del dettaglio: va riletto a mano.
    if (this.selected()?.id === savedId) {
      this.detail.reload();
    }
    this.select(period);
  }
}

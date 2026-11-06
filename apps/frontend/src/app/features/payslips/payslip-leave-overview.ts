import { Component, computed, input, output } from '@angular/core';
import { formatMonth } from '../../core/format';
import { Badge } from '@shared/ui/feedback/badge/badge';
import { LEAVE_LABELS, formatLeaveValue, formatQuantity } from './payslip-format';
import { LeaveCheckStatus, LeaveOverview, LeaveTypeOverview } from './payslip.model';

const STATUS_LABELS: Record<LeaveCheckStatus, string> = {
  coerente: 'Coerente',
  anomalia: 'Anomalia',
  non_verificabile: 'Non verificabile'
};

const STATUS_TONES: Record<LeaveCheckStatus, 'positive' | 'negative' | 'neutral'> = {
  coerente: 'positive',
  anomalia: 'negative',
  non_verificabile: 'neutral'
};

/**
 * Riepilogo di ferie e P.A.R. su tutto l'archivio.
 *
 * Mostra ciò che il backend ha già verificato: qui non si ricalcola nulla.
 * Maturato e goduto sono progressivi annui, perciò si riporta l'ultimo valore
 * dell'anno e non si sommano mai i mesi.
 */
@Component({
  selector: 'app-payslip-leave-overview',
  imports: [Badge],
  templateUrl: './payslip-leave-overview.html',
  styleUrl: './payslip-leave-overview.scss'
})
export class PayslipLeaveOverview {
  readonly overview = input.required<LeaveOverview>();
  /** Il mese (`YYYY-MM`) che l'utente vuole aprire. */
  readonly selectPeriod = output<string>();

  protected readonly formatMonth = formatMonth;
  protected readonly labels = LEAVE_LABELS;
  protected readonly statusLabels = STATUS_LABELS;
  protected readonly statusTones = STATUS_TONES;

  protected readonly missingText = computed(() =>
    this.overview()
      .coverage.missingPeriods.map((period) => formatMonth(period))
      .join(', ')
  );

  protected unitOf(type: LeaveTypeOverview): string {
    return (type.unit ?? type.latest?.unit ?? 'ore').toLowerCase();
  }

  protected latestText(type: LeaveTypeOverview): string {
    return type.latest === null ? '—' : formatLeaveValue(type.latest.remaining, type.latest.unit);
  }

  /** Una differenza con il segno esplicito: `+4`, `−4`. */
  protected signed(value: number | null): string {
    if (value === null) {
      return '—';
    }

    return value > 0 ? `+${formatQuantity(value)}` : formatQuantity(value);
  }

  protected quantity(value: number | null): string {
    return value === null ? '—' : formatQuantity(value);
  }
}

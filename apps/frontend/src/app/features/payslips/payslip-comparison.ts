import { Component, computed, input } from '@angular/core';
import { formatAmount, formatMonth, signedPercent, typographicMinus } from '../../core/format';
import { Amount } from '@shared/ui/data/amount/amount';
import { Badge } from '@shared/ui/feedback/badge/badge';
import { ITEM_STATUS_LABELS, SECTION_LABELS, centsToEuros } from './payslip-format';
import { AmountDelta, ItemDelta, PayslipComparison } from './payslip.model';

interface DeltaRow {
  readonly label: string;
  readonly delta: AmountDelta;
  /** Per le trattenute salire è la brutta notizia: il colore lo dichiara chi conosce il dominio. */
  readonly tone: 'positive' | 'negative' | 'neutral';
}

/** Un importo con il segno sempre esplicito: `+12,00 €`, `−3,50 €`. */
export function signedEuros(cents: number): string {
  const text = typographicMinus(formatAmount(centsToEuros(cents)));

  return cents > 0 ? `+${text}` : text;
}

/** Il confronto con il cedolino del mese precedente. */
@Component({
  selector: 'app-payslip-comparison',
  imports: [Amount, Badge],
  templateUrl: './payslip-comparison.html',
  styleUrl: './payslip-comparison.scss'
})
export class PayslipComparisonView {
  /** `null` se il mese scelto non ha un cedolino precedente. */
  readonly comparison = input.required<PayslipComparison | null>();

  protected readonly formatMonth = formatMonth;
  protected readonly signedEuros = signedEuros;
  protected readonly signedPercent = signedPercent;
  protected readonly sectionLabels = SECTION_LABELS;
  protected readonly statusLabels = ITEM_STATUS_LABELS;

  protected readonly rows = computed<DeltaRow[]>(() => {
    const comparison = this.comparison();
    if (comparison === null) {
      return [];
    }

    const tone = (cents: number, goodWhenUp: boolean): DeltaRow['tone'] =>
      cents === 0 ? 'neutral' : cents > 0 === goodWhenUp ? 'positive' : 'negative';

    return [
      { label: 'Netto', delta: comparison.net, tone: tone(comparison.net.deltaCents, true) },
      {
        label: 'Competenze',
        delta: comparison.totalEarnings,
        tone: tone(comparison.totalEarnings.deltaCents, true)
      },
      {
        label: 'Trattenute',
        delta: comparison.totalDeductions,
        tone: tone(comparison.totalDeductions.deltaCents, false)
      }
    ];
  });

  /** Le voci identiche sono rumore: restano solo quelle che si sono mosse. */
  protected readonly changedItems = computed<ItemDelta[]>(() =>
    (this.comparison()?.items ?? []).filter((item) => item.status !== 'unchanged')
  );

  protected itemTone(status: ItemDelta['status']): 'positive' | 'negative' | 'neutral' {
    return status === 'added' ? 'positive' : status === 'removed' ? 'negative' : 'neutral';
  }

  protected euros(cents: number): number {
    return centsToEuros(cents);
  }
}

import { Component, computed, input, linkedSignal, output } from '@angular/core';
import { ChartTooltip } from '@shared/ui/chart/core/chart-tooltip';
import { LineChart } from '@shared/ui/chart/line/line-chart';
import type { LineSeries } from '@shared/ui/chart/line/line-chart.model';
import { Amount } from '@shared/ui/data/amount/amount';
import { formatMonth } from '../../core/format';
import { centsToEuros, formatShortMonth } from './payslip-format';
import { PayslipTrendPoint } from './payslip.model';

/** Con un solo mese non c'è un andamento da disegnare. */
const MIN_POINTS = 2;

/** Un mese dell'asse: `payslip` è `null` se per quel mese non c'è un cedolino. */
interface MonthPoint {
  readonly period: string;
  readonly payslip: PayslipTrendPoint | null;
}

const monthIndex = (period: string): number =>
  Number(period.slice(0, 4)) * 12 + Number(period.slice(5, 7)) - 1;

const periodOf = (index: number): string =>
  `${String(Math.floor(index / 12))}-${String((index % 12) + 1).padStart(2, '0')}`;

/**
 * Il netto mese per mese.
 *
 * Una sola linea su una scala adattata ai valori: su una scala da zero, con
 * competenze e trattenute accanto, cento euro di differenza erano una riga
 * piatta. Competenze e trattenute si leggono nel riquadro del mese. L'asse ha
 * tutti i mesi fra il primo e l'ultimo: un mese senza cedolino è un buco nella
 * linea, non un mese che sparisce.
 */
@Component({
  selector: 'app-payslip-trend',
  imports: [Amount, ChartTooltip, LineChart],
  templateUrl: './payslip-trend.html',
  styleUrl: './payslip-trend.scss'
})
export class PayslipTrend {
  /** In ordine di periodo, dal più vecchio, come lo manda il backend. */
  readonly trend = input.required<readonly PayslipTrendPoint[]>();
  /** Il mese scelto nella pagina: nel grafico ha il marcatore vuoto. */
  readonly selectedPeriod = input<string | null>(null);
  /** Il mese (`YYYY-MM`) da aprire dal riquadro. */
  readonly selectPeriod = output<string>();

  protected readonly minPoints = MIN_POINTS;
  protected readonly formatMonth = formatMonth;

  protected readonly points = computed<MonthPoint[]>(() => {
    const trend = this.trend();
    const first = trend[0];
    const last = trend.at(-1);
    if (first === undefined || last === undefined) {
      return [];
    }

    const byPeriod = new Map(trend.map((point) => [point.period, point]));
    const points: MonthPoint[] = [];
    for (let index = monthIndex(first.period); index <= monthIndex(last.period); index += 1) {
      const period = periodOf(index);
      points.push({ period, payslip: byPeriod.get(period) ?? null });
    }

    return points;
  });

  protected readonly series: readonly LineSeries<MonthPoint>[] = [
    {
      key: 'net',
      label: 'Netto',
      color: 'chart-1',
      value: (point) => (point.payslip === null ? null : centsToEuros(point.payslip.netCents))
    }
  ];

  protected readonly xLabel = (point: MonthPoint): string => formatShortMonth(point.period);

  protected readonly marker = (point: MonthPoint) =>
    point.period === this.selectedPeriod() ? ('hollow' as const) : ('auto' as const);

  /**
   * Il punto aperto nel grafico; chiuso, il riquadro non c'è. È un indice nei
   * mesi dell'asse: se l'archivio cambia si richiude, invece di indicare un altro mese.
   */
  protected readonly opened = linkedSignal<readonly PayslipTrendPoint[], number | null>({
    source: this.trend,
    computation: () => null
  });

  protected readonly openedPoint = computed(() => {
    const index = this.opened();
    return index === null ? null : (this.points()[index] ?? null);
  });

  protected readonly tooltipPosition = computed(() => {
    const lastIndex = this.points().length - 1;
    const ratio = lastIndex <= 0 ? 0.5 : (this.opened() ?? 0) / lastIndex;

    return { left: ratio * 100, side: ratio > 0.55 ? ('left' as const) : ('right' as const) };
  });

  protected readonly euros = centsToEuros;

  protected open(point: MonthPoint): void {
    this.opened.set(null);
    this.selectPeriod.emit(point.period);
  }
}

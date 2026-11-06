import { Component, input } from '@angular/core';
import { LineChart } from '@shared/ui/chart/line/line-chart';
import {
  chartColorVar,
  type LineSeries
} from '@shared/ui/chart/line/line-chart.model';
import { centsToEuros, formatShortMonth } from './payslip-format';
import { PayslipTrendPoint } from './payslip.model';

/** Con un solo mese non c'è un andamento da disegnare. */
const MIN_POINTS = 2;

/** Netto, competenze e trattenute mese per mese. Non ha selezione: la scelta del mese sta nell'elenco. */
@Component({
  selector: 'app-payslip-trend',
  imports: [LineChart],
  templateUrl: './payslip-trend.html',
  styleUrl: './payslip-trend.scss'
})
export class PayslipTrend {
  readonly trend = input.required<readonly PayslipTrendPoint[]>();

  protected readonly minPoints = MIN_POINTS;
  protected readonly chartColor = chartColorVar;

  /** Il grafico vuole euro: i centesimi si convertono qui, una volta. */
  protected readonly series: readonly LineSeries<PayslipTrendPoint>[] = [
    { key: 'net', label: 'Netto', color: 'chart-1', value: (p) => centsToEuros(p.netCents) },
    {
      key: 'earnings',
      label: 'Competenze',
      color: 'chart-2',
      value: (p) => centsToEuros(p.totalEarningsCents)
    },
    {
      key: 'deductions',
      label: 'Trattenute',
      color: 'chart-3',
      value: (p) => centsToEuros(p.totalDeductionsCents)
    }
  ];

  protected readonly xLabel = (point: PayslipTrendPoint): string => formatShortMonth(point.period);
}

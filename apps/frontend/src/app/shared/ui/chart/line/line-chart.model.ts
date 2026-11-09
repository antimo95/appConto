import type { ChartSeriesColor } from '@shared/ui/chart/core/chart.model';

// I colori-serie stanno in `chart.model`: qui restano riesportati per chi li importava dalla linea.
export { CHART_SERIES_COLORS, chartColorVar } from '@shared/ui/chart/core/chart.model';
export type { ChartSeriesColor } from '@shared/ui/chart/core/chart.model';

export interface LineSeries<T, K extends string = string> {
  readonly key: K;
  readonly label: string;
  readonly color: ChartSeriesColor;
  /** `null` = nessun dato per quel punto: la linea si interrompe e il punto non ha marcatore. */
  readonly value: (point: T) => number | null;
}

/**
 * `auto` = regola di densità comune; `hollow` = sempre visibile, vuoto.
 * Estensione: un eventuale `hidden` si aggiunge qui e nel builder dei punti.
 */
export type LinePointMarker = 'auto' | 'hollow';

/**
 * L'asse Y tiene insieme formato e politica di scala. Estensione: un asse
 * `percent` si aggiunge qui, con il proprio formato e la propria scala.
 * `amount` parte sempre da zero e compatta le migliaia (`1,7k €`); `amount-fit`
 * segue i dati senza zero e scrive euro interi, per fasce strette lontane da zero.
 */
export type LineChartValueAxis = 'amount' | 'amount-fit';

import { describe, expect, it } from 'vitest';
import { formatAmount } from '../../../../core/format';
import { lineChartData, lineChartOptions, lineChartValueRange } from './line-chart-config';
import { LINE_CHART_GEOMETRY, type LineChartTheme } from './line-chart-theme';
import type { LinePointMarker, LineSeries } from './line-chart.model';
import { fittedScale, niceScale } from '@shared/ui/chart/core/value-scale';

interface Point {
  label: string;
  a: number;
  b: number;
  c?: number | null;
  partial?: boolean;
}

const THEME: LineChartTheme = {
  axisText: 'muted',
  grid: 'border',
  hollowFill: 'surface',
  guideSelected: 'primary',
  guideHover: 'hover',
  zeroLine: 'strong',
  labelFont: { family: 'Inter', size: 11, weight: 400 },
  valueFont: { family: 'Mono', size: 12, weight: 600 },
  series: {
    'chart-1': 'c1',
    'chart-2': 'c2',
    'chart-3': 'c3',
    'chart-4': 'c4',
    'chart-5': 'c5',
    'chart-6': 'c6',
    'chart-7': 'c7',
    'chart-neutral': 'cn',
  },
};

const SERIES: readonly LineSeries<Point>[] = [
  { key: 'a', label: 'Entrate', color: 'chart-1', value: (p) => p.a },
  { key: 'b', label: 'Uscite', color: 'chart-5', value: (p) => p.b },
];

const marker = (p: Point): LinePointMarker => (p.partial ? 'hollow' : 'auto');
const xLabel = (p: Point): string => p.label;

function points(count: number, partialAt: readonly number[] = []): Point[] {
  return Array.from({ length: count }, (_, i) => ({
    label: `p${i}`,
    a: i * 10,
    b: i * 5,
    partial: partialAt.includes(i),
  }));
}

describe('lineChartData', () => {
  it('stila ogni serie con il colore del tema e la geometria condivisa', () => {
    const { datasets } = lineChartData(points(3), SERIES, marker, xLabel, THEME);

    expect(datasets.map((d) => d.label)).toEqual(['Entrate', 'Uscite']);
    expect(datasets[0]?.borderColor).toBe('c1');
    expect(datasets[1]?.borderColor).toBe('c5');
    expect(datasets[0]?.pointBorderColor).toBe('c1');
    expect(datasets[0]?.data).toEqual([0, 10, 20]);
    expect(datasets[1]?.data).toEqual([0, 5, 10]);
    expect(datasets[0]?.borderWidth).toBe(LINE_CHART_GEOMETRY.lineWidth);
    expect(datasets[0]?.borderCapStyle).toBe('round');
    expect(datasets[0]?.borderJoinStyle).toBe('round');
    expect(datasets[0]?.tension).toBe(0);
    expect(datasets[0]?.fill).toBe(false);
    expect(datasets[0]?.pointHoverRadius).toBe(LINE_CHART_GEOMETRY.pointHoverRadius);
    expect(datasets[0]?.pointBorderWidth).toBe(LINE_CHART_GEOMETRY.pointBorderWidth);
  });

  it('con pochi punti mostra tutti i marcatori', () => {
    const { datasets } = lineChartData(points(24), SERIES, marker, xLabel, THEME);

    expect(datasets[0]?.pointRadius).toEqual(Array<number>(24).fill(3));
  });

  it('oltre la soglia restano solo primo, ultimo e gli hollow', () => {
    const { datasets } = lineChartData(points(30, [10]), SERIES, marker, xLabel, THEME);
    const radius = datasets[0]?.pointRadius;

    expect(Array.isArray(radius)).toBe(true);
    const visible = Array.isArray(radius)
      ? radius.flatMap((r, i) => (r === 3 ? [i] : []))
      : [];
    expect(visible).toEqual([0, 10, 29]);
  });

  it('i punti hollow usano il fondo del tema, gli altri il colore serie', () => {
    const { datasets } = lineChartData(points(3, [1]), SERIES, marker, xLabel, THEME);

    expect(datasets[0]?.pointBackgroundColor).toEqual(['c1', 'surface', 'c1']);
  });

  it('le etichette vengono da xLabel', () => {
    expect(lineChartData(points(3), SERIES, marker, xLabel, THEME).labels).toEqual(['p0', 'p1', 'p2']);
  });

  it('senza serie restano le etichette e nessun dataset', () => {
    const data = lineChartData(points(2), [], marker, xLabel, THEME);

    expect(data.datasets).toEqual([]);
    expect(data.labels).toEqual(['p0', 'p1']);
  });
});

describe('lineChartData: punti senza dato', () => {
  const GAPPY: readonly LineSeries<Point>[] = [
    { key: 'c', label: 'Netto', color: 'chart-1', value: (p) => p.c ?? null },
  ];
  const rows: Point[] = [
    { label: 'g', a: 0, b: 0, c: 1638 },
    { label: 'f', a: 0, b: 0, c: null },
    { label: 'm', a: 0, b: 0, c: 1818 },
  ];

  it('un null passa tale e quale al dataset e non viene disegnato come zero', () => {
    const { datasets } = lineChartData(rows, GAPPY, marker, xLabel, THEME);

    expect(datasets[0]?.data).toEqual([1638, null, 1818]);
    expect(datasets[0]?.spanGaps).toBeFalsy();
  });

  it('il punto senza dato non ha marcatore', () => {
    const { datasets } = lineChartData(rows, GAPPY, marker, xLabel, THEME);

    expect(datasets[0]?.pointRadius).toEqual([3, 0, 3]);
  });

  it('oltre la soglia dei marcatori, un punto isolato fra due buchi resta visibile', () => {
    // Senza vicini non c'è segmento: senza marcatore il dato sparirebbe dal grafico.
    const many: Point[] = Array.from({ length: 30 }, (_, i) => ({
      label: String(i),
      a: 0,
      b: 0,
      c: i === 14 ? 1700 : i === 13 || i === 15 ? null : 1600
    }));
    const radius = lineChartData(many, GAPPY, marker, xLabel, THEME).datasets[0]?.pointRadius as number[];

    expect(radius[14]).toBe(3);
    expect(radius[5]).toBe(0);
  });
});

describe('lineChartValueRange', () => {
  it('applica la scala dell’asse ai valori', () => {
    expect(lineChartValueRange('amount', [120, 480])).toEqual(niceScale([120, 480]));
  });

  it('l’asse amount-fit usa la scala che non forza lo zero', () => {
    expect(lineChartValueRange('amount-fit', [1638, 1818])).toEqual(fittedScale([1638, 1818]));
  });
});

describe('lineChartOptions', () => {
  const guides = { selected: 1, hover: null };
  const build = (theme: LineChartTheme = THEME, values: readonly number[] = [10, 40]) =>
    lineChartOptions(theme, 'amount', lineChartValueRange('amount', values), guides);
  it('la scala Y viene da niceScale e include lo zero', () => {
    const y = build(THEME, [120, 480]).scales?.['y'];
    const { min, max } = niceScale([120, 480]);

    expect(y).toMatchObject({ min, max });
    expect(min).toBeLessThanOrEqual(0);
  });

  it('compatta le etichette dell’asse Y senza cambiare il formatter degli importi', () => {
    const ticks = build().scales?.['y']?.ticks;
    const callback = ticks?.callback;

    expect(callback?.call({} as never, 999, 0, [])).toBe(formatAmount(999));
    expect(callback?.call({} as never, 1234.5, 0, [])).toBe('1,2k €');
    expect(callback?.call({} as never, 1_234_567, 0, [])).toBe('1,2M €');
    expect(callback?.call({} as never, 1_234_567_890, 0, [])).toBe('1,2B €');
    expect(callback?.call({} as never, -1234.5, 0, [])).toBe('-1,2k €');
  });

  it('amount-fit scrive gli euro interi con il separatore delle migliaia, senza la k', () => {
    const range = lineChartValueRange('amount-fit', [1638, 1818]);
    const y = lineChartOptions(THEME, 'amount-fit', range, guides).scales?.['y'];
    const callback = y?.ticks?.callback;
    const nbsp = ' ';

    expect(y).toMatchObject({ min: range.min, max: range.max });
    expect(callback?.call({} as never, 1650, 0, [])).toBe(`1.650${nbsp}€`);
    expect(callback?.call({} as never, 1700, 0, [])).toBe(`1.700${nbsp}€`);
    expect(callback?.call({} as never, 0, 0, [])).toBe(`0${nbsp}€`);
    expect(callback?.call({} as never, -200, 0, [])).toBe(`-200${nbsp}€`);
  });

  it('l’asse Y non scende molto sotto i dati: niente -5000 per un minimo di -69', () => {
    const y = build(THEME, [-69, 9830]).scales?.['y'];

    expect(y?.min).toBeGreaterThanOrEqual(-600);
    expect(y?.max).toBeGreaterThanOrEqual(9830);
  });

  it('con valori non negativi (flussi) l’asse Y parte da zero', () => {
    expect(build(THEME, [0, 120, 480]).scales?.['y']?.min).toBe(0);
  });

  it('con zeroLine acceso lo zero resta visibile', () => {
    const range = lineChartValueRange('amount', [-69, 9830]);
    const y = lineChartOptions(THEME, 'amount', range, guides, true).scales?.['y'];

    expect(y?.min).toBeLessThanOrEqual(0);
    expect(y?.max).toBeGreaterThanOrEqual(0);
  });

  it('le linee guida Y sono quelle tonde calcolate dalla scala', () => {
    const y = build(THEME, [-69, 9830]).scales?.['y'];
    const scale = { ticks: [] as { value: number }[] };
    (y as { afterBuildTicks?: (s: typeof scale) => void }).afterBuildTicks?.(scale);

    expect(scale.ticks.map((t) => t.value)).toEqual([0, 2500, 5000, 7500, 10000]);
  });

  it('asse X con il font etichetta, asse Y con il font valori', () => {
    const scales = build().scales;

    expect(scales?.['x']?.ticks?.font).toEqual({ family: 'Inter', size: 11, weight: 400 });
    expect(scales?.['y']?.ticks?.font).toEqual({ family: 'Mono', size: 12, weight: 600 });
    expect(scales?.['x']?.ticks?.color).toBe('muted');
    expect(scales?.['y']?.grid).toMatchObject({ color: 'border', drawTicks: false });
  });

  it('omette famiglia vuota e dimensione/peso indefiniti', () => {
    const theme: LineChartTheme = {
      ...THEME,
      labelFont: { family: '', size: undefined, weight: undefined },
      valueFont: { family: 'Mono', size: undefined, weight: 500 },
    };
    const scales = build(theme).scales;

    expect(scales?.['x']?.ticks?.font).toEqual({});
    expect(scales?.['y']?.ticks?.font).toEqual({ family: 'Mono', weight: 500 });
  });

  it('passa stato e stili delle guide al plugin', () => {
    expect(build().plugins?.lineGuides).toEqual({
      selected: 1,
      hover: null,
      styles: {
        selected: { color: 'primary', width: 2, dash: [] },
        hover: { color: 'hover', width: 1, dash: [3, 3] },
      },
    });
  });

  it('la linea dello zero è facoltativa: assente di partenza, col token forte se chiesta', () => {
    expect(build().plugins?.lineGuides).not.toHaveProperty('zero');

    const options = lineChartOptions(THEME, 'amount', lineChartValueRange('amount', [10, 40]), guides, true);

    expect(options.plugins?.lineGuides?.zero).toEqual({
      color: 'strong',
      ...LINE_CHART_GEOMETRY.zeroLine,
    });
  });

  it('opzioni generali: senza animazioni, legenda e tooltip nativi', () => {
    const options = build();

    expect(options.responsive).toBe(true);
    expect(options.maintainAspectRatio).toBe(false);
    expect(options.animation).toBe(false);
    expect(options.interaction).toEqual({ mode: 'index', intersect: false });
    expect(options.plugins?.legend).toEqual({ display: false });
    expect(options.plugins?.tooltip).toEqual({ enabled: false });
    expect(options.layout?.padding).toEqual(LINE_CHART_GEOMETRY.layoutPadding);
  });
});

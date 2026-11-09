import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { CHART_CONSTRUCTOR, LineChart } from '@shared/ui/chart/line/line-chart';
import { PayslipTrend } from './payslip-trend';
import { PayslipTrendPoint } from './payslip.model';

class MockChart {
  data: unknown;
  options: unknown;
  constructor(_canvas: unknown, config: { data: unknown; options: unknown }) {
    this.data = config.data;
    this.options = config.options;
  }
  update(): void {}
  destroy(): void {}
  setActiveElements(): void {}
}

const point = (period: string, netCents: number): PayslipTrendPoint => ({
  payslipId: `p-${period}`,
  period,
  netCents,
  totalEarningsCents: netCents + 50000,
  totalDeductionsCents: 50000,
  leaveRemaining: { FERIE: null, PAR: null }
});

describe('PayslipTrend', () => {
  const render = async (trend: PayslipTrendPoint[]): Promise<HTMLElement> => {
    const fixture = TestBed.createComponent(PayslipTrend);
    fixture.componentRef.setInput('trend', trend);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [PayslipTrend],
      providers: [{ provide: CHART_CONSTRUCTOR, useValue: MockChart }]
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as CanvasRenderingContext2D);
  });

  afterEach(() => vi.restoreAllMocks());

  it('con meno di due mesi mostra la nota al posto del grafico', async () => {
    for (const trend of [[], [point('2026-09', 200000)]]) {
      const host = await render(trend);

      expect(host.querySelector('app-line-chart')).toBeNull();
      expect(host.textContent).toContain('Servono almeno due cedolini');
    }
  });

  it('disegna il solo netto, su una scala adattata ai valori', async () => {
    const { chart } = await renderChart([point('2026-08', 192000), point('2026-09', 200000)]);

    expect(chart.series().map((series) => series.label)).toEqual(['Netto']);
    expect(chart.valueAxis()).toBe('amount-fit');
  });

  it('un mese senza cedolino resta un buco nella linea, non sparisce', async () => {
    const { chart } = await renderChart([point('2026-08', 192000), point('2026-10', 200000)]);
    const net = chart.series()[0];

    expect(chart.points().map((p) => chart.xLabel()(p))).toHaveLength(3);
    expect(chart.points().map((p) => net.value(p))).toEqual([1920, null, 2000]);
  });

  it('il mese scelto mostra netto, competenze e trattenute, e si apre dal riquadro', async () => {
    const { fixture, chart } = await renderChart([
      point('2026-08', 192000),
      point('2026-09', 200000)
    ]);
    const opened: string[] = [];
    fixture.componentInstance.selectPeriod.subscribe((period) => opened.push(period));

    chart.selectedIndex.set(1);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;
    const tooltip = host.querySelector('app-chart-tooltip');

    expect(tooltip?.textContent).toContain('Netto');
    expect(tooltip?.textContent).toContain('Competenze');
    expect(tooltip?.textContent).toContain('Trattenute');
    tooltip!.querySelector<HTMLButtonElement>('button.open')!.click();
    expect(opened).toEqual(['2026-09']);
  });

  it('se l\'archivio cambia il riquadro aperto si richiude, invece di indicare un altro mese', async () => {
    const { fixture, chart } = await renderChart([
      point('2026-08', 192000),
      point('2026-09', 200000)
    ]);
    chart.selectedIndex.set(1);
    await fixture.whenStable();

    fixture.componentRef.setInput('trend', [point('2026-09', 200000), point('2026-10', 205000)]);
    await fixture.whenStable();

    expect((fixture.nativeElement as HTMLElement).querySelector('app-chart-tooltip')).toBeNull();
  });

  it('il mese selezionato nella pagina è evidenziato nel grafico, senza aprire il riquadro', async () => {
    const { fixture, chart } = await renderChart(
      [point('2026-08', 192000), point('2026-09', 200000)],
      '2026-08'
    );

    // Un marcatore, non una selezione: cliccare quel punto apre il riquadro invece di deselezionarlo.
    expect(chart.points().map((p) => chart.marker()(p))).toEqual(['hollow', 'auto']);
    expect(chart.selectedIndex()).toBeNull();
    expect((fixture.nativeElement as HTMLElement).querySelector('app-chart-tooltip')).toBeNull();
  });

  const renderChart = async (trend: PayslipTrendPoint[], selected: string | null = null) => {
    const fixture = TestBed.createComponent(PayslipTrend);
    fixture.componentRef.setInput('trend', trend);
    fixture.componentRef.setInput('selectedPeriod', selected);
    await fixture.whenStable();
    const chart = fixture.debugElement.query(By.directive(LineChart))
      .componentInstance as LineChart<unknown>;

    return { fixture, chart };
  };
});

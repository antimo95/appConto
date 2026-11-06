import { TestBed } from '@angular/core/testing';
import { CHART_CONSTRUCTOR } from '@shared/ui/chart/line/line-chart';
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
      expect(host.querySelector('ul.legend')).toBeNull();
    }
  });

  it('con due mesi disegna il grafico e la legenda delle tre serie', async () => {
    const host = await render([point('2026-08', 192000), point('2026-09', 200000)]);

    expect(host.querySelector('app-line-chart')).not.toBeNull();
    expect(
      [...host.querySelectorAll('ul.legend li')].map((item) => item.textContent?.trim())
    ).toEqual(['Netto', 'Competenze', 'Trattenute']);
  });
});

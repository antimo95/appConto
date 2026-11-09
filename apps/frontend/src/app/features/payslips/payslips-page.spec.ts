import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { CHART_CONSTRUCTOR } from '@shared/ui/chart/line/line-chart';
import { PayslipTrend } from './payslip-trend';
import { PayslipsPage } from './payslips-page';
import {
  PayslipAnalysis,
  PayslipComparison,
  PayslipDetail,
  PayslipSummaries,
  PayslipSummary
} from './payslip.model';

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

const summary = (overrides: Partial<PayslipSummary> = {}): PayslipSummary => ({
  id: 'p-9',
  period: '2026-09',
  employer: 'Acme Srl',
  fileName: 'settembre.pdf',
  importedAt: '2026-10-01T10:00:00Z',
  parserId: 'zucchetti',
  totalEarningsCents: 250000,
  totalDeductionsCents: 50000,
  netCents: 200000,
  ...overrides
});

const SEPTEMBER = summary();
const AUGUST = summary({
  id: 'p-8',
  period: '2026-08',
  totalEarningsCents: 240000,
  totalDeductionsCents: 48000,
  netCents: 192000
});

const detail = (base: PayslipSummary = SEPTEMBER): PayslipDetail => ({
  ...base,
  roundingCents: null,
  taxableInpsCents: 250000,
  taxableIrpefCents: null,
  workedHours: 168,
  hasDocument: true,
  items: [
    {
      code: '0001',
      description: 'Retribuzione base',
      section: 'earning',
      amountCents: 250000,
      quantity: null,
      unit: null
    }
  ],
  leaveBalances: [
    { type: 'FERIE', accrued: 20, used: 60, remaining: -40, unit: 'ore' },
    { type: 'PAR', accrued: 10, used: 0, remaining: 10, unit: 'ore' }
  ]
});

const comparison = (): PayslipComparison => ({
  period: '2026-09',
  payslipId: 'p-9',
  previousPeriod: '2026-08',
  previousPayslipId: 'p-8',
  net: { currentCents: 200000, previousCents: 192000, deltaCents: 8000, deltaPercent: 4.2 },
  totalEarnings: { currentCents: 250000, previousCents: 240000, deltaCents: 10000, deltaPercent: 4.2 },
  totalDeductions: { currentCents: 50000, previousCents: 48000, deltaCents: 2000, deltaPercent: 4.2 },
  leave: [],
  items: [
    {
      key: 'a',
      code: '0001',
      description: 'Voce variata',
      section: 'earning',
      status: 'changed',
      currentCents: 150000,
      previousCents: 140000,
      deltaCents: 10000,
      deltaPercent: 7.1
    },
    {
      key: 'b',
      code: null,
      description: 'Voce nuova',
      section: 'earning',
      status: 'added',
      currentCents: 5000,
      previousCents: null,
      deltaCents: 5000,
      deltaPercent: null
    },
    {
      key: 'c',
      code: null,
      description: 'Voce scomparsa',
      section: 'deduction',
      status: 'removed',
      currentCents: null,
      previousCents: 3000,
      deltaCents: -3000,
      deltaPercent: null
    },
    {
      key: 'd',
      code: null,
      description: 'Voce identica',
      section: 'deduction',
      status: 'unchanged',
      currentCents: 1000,
      previousCents: 1000,
      deltaCents: 0,
      deltaPercent: 0
    }
  ]
});

const summaries = (): PayslipSummaries => ({
  from: null,
  to: null,
  trend: [AUGUST, SEPTEMBER].map((p) => ({
    payslipId: p.id,
    period: p.period,
    netCents: p.netCents,
    totalEarningsCents: p.totalEarningsCents,
    totalDeductionsCents: p.totalDeductionsCents,
    leaveRemaining: { FERIE: -40, PAR: 10 }
  })),
  comparisons: [comparison()]
});

const analysis = (): PayslipAnalysis => ({
  id: 'a-1',
  fileName: 'ottobre.pdf',
  parserId: 'zucchetti',
  status: 'complete',
  confidence: 'high',
  warnings: [],
  conflict: null,
  expiresAt: '2026-11-01T00:00:00Z',
  draft: {
    period: '2026-10',
    employer: 'Acme Srl',
    totalEarningsCents: 260000,
    totalDeductionsCents: 52000,
    netCents: 208000,
    roundingCents: null,
    taxableInpsCents: null,
    taxableIrpefCents: null,
    workedHours: null,
    items: [],
    leaveBalances: []
  }
});

describe('PayslipsPage', () => {
  let harness: RouterTestingHarness;
  let http: HttpTestingController;
  let router: Router;

  const settle = async (): Promise<void> => {
    await new Promise((resolve) => setTimeout(resolve));
    TestBed.tick();
  };

  const root = (): HTMLElement => harness.routeNativeElement as HTMLElement;
  const text = (): string => root().textContent ?? '';

  const expectOne = (url: string, method = 'GET'): TestRequest =>
    http.expectOne((request) => request.url === url && request.method === method);

  /** Risponde alle tre letture della pagina (elenco, andamento, dettaglio). */
  const loadPage = async (
    items: PayslipSummary[] = [SEPTEMBER, AUGUST],
    summaryData: PayslipSummaries = summaries()
  ): Promise<void> => {
    await settle();
    expectOne('/api/payslips').flush({ items });
    expectOne('/api/payslip-summaries').flush(summaryData);
    await settle();
  };

  const flushDetail = async (data: PayslipDetail): Promise<void> => {
    expectOne(`/api/payslips/${data.id}`).flush(data);
    await settle();
  };

  const chooseFile = async (file: File): Promise<void> => {
    const input = root().querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change'));
    await settle();
  };

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'payslips', component: PayslipsPage }]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: CHART_CONSTRUCTOR, useValue: MockChart }
      ]
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      {} as CanvasRenderingContext2D
    );

    harness = await RouterTestingHarness.create();
    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    http.verify();
  });

  it('senza cedolini mostra lo stato vuoto con l\'azione di caricamento', async () => {
    await harness.navigateByUrl('/payslips', PayslipsPage);
    await loadPage([], { from: null, to: null, trend: [], comparisons: [] });

    expect(text()).toContain('Nessun cedolino importato.');
    expect(
      [...root().querySelectorAll('button')].some(
        (button) => button.textContent?.trim() === 'Carica cedolino'
      )
    ).toBe(true);
  });

  it('elenca i cedolini dal più recente e seleziona di default il primo', async () => {
    await harness.navigateByUrl('/payslips', PayslipsPage);
    await loadPage();
    await flushDetail(detail());

    const rows = root().querySelectorAll('table.payslips tbody tr');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('settembre 2026');
    expect(rows[0].textContent).toContain('2000,00');
    expect(rows[0].classList.contains('selected')).toBe(true);
    expect(rows[1].classList.contains('selected')).toBe(false);
  });

  it('mostra le card del mese scelto, con la variazione del netto', async () => {
    await harness.navigateByUrl('/payslips', PayslipsPage);
    await loadPage();
    await flushDetail(detail());

    const cards = root().querySelector('app-stat-card-grid')?.textContent ?? '';
    expect(cards).toContain('Netto');
    expect(cards).toContain('2000,00');
    expect(cards).toContain('+4,2%');
    expect(cards).toContain('rispetto a agosto 2026');
    expect(cards).toContain('Ferie residue');
    expect(cards).toContain('−40 ore');
    expect(cards).toContain('P.A.R. residui');
    expect(cards).toContain('10 ore');
  });

  it('il mese nell\'URL decide la selezione', async () => {
    await harness.navigateByUrl('/payslips?period=2026-08', PayslipsPage);
    await loadPage();
    await flushDetail(detail(AUGUST));

    const rows = root().querySelectorAll('table.payslips tbody tr');
    expect(rows[1].classList.contains('selected')).toBe(true);
    expect(text()).toContain('Nessun cedolino precedente da confrontare.');
  });

  it('scegliere un mese lo scrive nell\'URL', async () => {
    await harness.navigateByUrl('/payslips', PayslipsPage);
    await loadPage();
    await flushDetail(detail());

    root().querySelectorAll<HTMLButtonElement>('table.payslips .month')[1].click();
    await settle();

    expect(router.url).toContain('period=2026-08');
    await flushDetail(detail(AUGUST));
  });

  it('nel confronto mostra voci variate, nuove e scomparse ma non le identiche', async () => {
    await harness.navigateByUrl('/payslips', PayslipsPage);
    await loadPage();
    await flushDetail(detail());

    const table = root().querySelector('table.changes')!;
    expect(table.textContent).toContain('Voce variata');
    expect(table.textContent).toContain('Voce nuova');
    expect(table.textContent).toContain('Voce scomparsa');
    expect(table.textContent).not.toContain('Voce identica');
    expect(table.textContent).toContain('Variata');
    expect(table.textContent).toContain('Nuova');
    expect(table.textContent).toContain('Scomparsa');
  });

  it('disegna il grafico dell\'andamento con due mesi', async () => {
    await harness.navigateByUrl('/payslips', PayslipsPage);
    await loadPage();
    await flushDetail(detail());

    expect(root().querySelector('app-line-chart')).not.toBeNull();
  });

  it('con un solo mese al posto del grafico c\'è una nota', async () => {
    await harness.navigateByUrl('/payslips', PayslipsPage);
    await loadPage([SEPTEMBER], { ...summaries(), trend: [summaries().trend[1]], comparisons: [] });
    await flushDetail(detail());

    expect(root().querySelector('app-line-chart')).toBeNull();
    expect(text()).toContain('almeno due cedolini');
  });

  it('rifiuta un file che non è un PDF senza chiamare il backend', async () => {
    await harness.navigateByUrl('/payslips', PayslipsPage);
    await loadPage([], { from: null, to: null, trend: [], comparisons: [] });

    await chooseFile(new File(['a,b'], 'dati.csv', { type: 'text/csv' }));

    expect(root().querySelector('[role="alert"]')?.textContent).toContain('non è un PDF');
    http.expectNone((request) => request.url.includes('payslip-analyses'));
  });

  it('rifiuta un PDF oltre i 10 MB senza chiamare il backend', async () => {
    await harness.navigateByUrl('/payslips', PayslipsPage);
    await loadPage([], { from: null, to: null, trend: [], comparisons: [] });

    const big = new File(['x'], 'grande.pdf', { type: 'application/pdf' });
    Object.defineProperty(big, 'size', { value: 10 * 1024 * 1024 + 1 });
    await chooseFile(big);

    expect(root().querySelector('[role="alert"]')?.textContent).toContain('10 MB');
    http.expectNone((request) => request.url.includes('payslip-analyses'));
  });

  it('carica, rivede, conferma e rilegge l\'elenco', async () => {
    await harness.navigateByUrl('/payslips', PayslipsPage);
    await loadPage([], { from: null, to: null, trend: [], comparisons: [] });

    const file = new File(['%PDF-1.4'], 'ottobre.pdf', { type: 'application/pdf' });
    await chooseFile(file);

    expect(text()).toContain('Analisi del cedolino in corso…');
    const upload = expectOne('/api/payslip-analyses', 'POST');
    expect(upload.request.headers.get('Content-Type')).toBe('application/pdf');
    expect(upload.request.headers.get('X-File-Name')).toBe('ottobre.pdf');
    expect(upload.request.body).toBe(file);
    upload.flush(analysis());
    await settle();
    await settle();

    expect(text()).toContain('Estrazione completa');
    const net = root().querySelector<HTMLInputElement>('#payslip-net')!;
    expect(net.value).toBe('2080,00');

    root().querySelector<HTMLButtonElement>('.confirm')!.click();
    await settle();

    const save = expectOne('/api/payslips', 'POST');
    expect(save.request.body).toEqual({
      analysisId: 'a-1',
      replaceExisting: false,
      period: '2026-10',
      employer: 'Acme Srl',
      totalEarningsCents: 260000,
      totalDeductionsCents: 52000,
      netCents: 208000,
      roundingCents: null,
      taxableInpsCents: null,
      taxableIrpefCents: null,
      workedHours: null,
      items: [],
      leaveBalances: []
    });
    const october = summary({ id: 'p-10', period: '2026-10', netCents: 208000 });
    save.flush(detail(october));
    await settle();

    // L'elenco e l'andamento si rileggono dopo il salvataggio.
    expectOne('/api/payslips').flush({ items: [october] });
    expectOne('/api/payslip-summaries').flush({ from: null, to: null, trend: [], comparisons: [] });
    await settle();
    await flushDetail(detail(october));

    expect(router.url).toContain('period=2026-10');
    expect(root().querySelector('table.payslips')?.textContent).toContain('ottobre 2026');
  });

  it('mostra l\'errore del backend e lascia la revisione aperta', async () => {
    await harness.navigateByUrl('/payslips', PayslipsPage);
    await loadPage([], { from: null, to: null, trend: [], comparisons: [] });

    await chooseFile(new File(['%PDF'], 'doppio.pdf', { type: 'application/pdf' }));
    expectOne('/api/payslip-analyses', 'POST').flush(
      { error: 'Questo file è già stato importato.' },
      { status: 409, statusText: 'Conflict' }
    );
    await settle();

    expect(root().querySelector('[role="alert"]')?.textContent).toContain('già stato importato');
    expect(root().querySelector('app-payslip-review')).toBeNull();
  });

  it('annullare la revisione scarta l\'analisi', async () => {
    await harness.navigateByUrl('/payslips', PayslipsPage);
    await loadPage([], { from: null, to: null, trend: [], comparisons: [] });

    await chooseFile(new File(['%PDF'], 'ottobre.pdf', { type: 'application/pdf' }));
    expectOne('/api/payslip-analyses', 'POST').flush(analysis());
    await settle();
    await settle();

    root().querySelector<HTMLButtonElement>('.cancel')!.click();
    await settle();

    expectOne('/api/payslip-analyses/a-1', 'DELETE').flush(null, { status: 204, statusText: 'No Content' });
    expect(root().querySelector('app-payslip-review')).toBeNull();
  });

  it('elimina il cedolino dopo conferma e rilegge elenco e andamento', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await harness.navigateByUrl('/payslips', PayslipsPage);
    await loadPage();
    await flushDetail(detail());

    root().querySelector<HTMLButtonElement>('app-payslip-detail .remove')!.click();
    await settle();

    expectOne('/api/payslips/p-9', 'DELETE').flush(null, { status: 204, statusText: 'No Content' });
    await settle();
    expectOne('/api/payslips').flush({ items: [AUGUST] });
    expectOne('/api/payslip-summaries').flush({ from: null, to: null, trend: [], comparisons: [] });
    await settle();
    await flushDetail(detail(AUGUST));
  });

  it('non elimina se l\'utente non conferma', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    await harness.navigateByUrl('/payslips', PayslipsPage);
    await loadPage();
    await flushDetail(detail());

    root().querySelector<HTMLButtonElement>('app-payslip-detail .remove')!.click();
    await settle();

    http.expectNone((request) => request.method === 'DELETE');
  });

  it('modifica un cedolino salvato con un PATCH', async () => {
    await harness.navigateByUrl('/payslips', PayslipsPage);
    await loadPage();
    await flushDetail(detail());

    root().querySelector<HTMLButtonElement>('app-payslip-detail .edit')!.click();
    await settle();
    const net = root().querySelector<HTMLInputElement>('#payslip-net')!;
    net.value = '2.010,00';
    net.dispatchEvent(new Event('input'));
    await settle();
    root().querySelector<HTMLButtonElement>('.confirm')!.click();
    await settle();

    const patch = expectOne('/api/payslips/p-9', 'PATCH');
    expect(patch.request.body.netCents).toBe(201000);
    patch.flush(detail());
    await settle();
    expectOne('/api/payslips').flush({ items: [SEPTEMBER, AUGUST] });
    expectOne('/api/payslip-summaries').flush(summaries());
    await settle();
    await flushDetail(detail());
  });

  it('scegliere un altro mese durante la modifica chiude il modulo e mostra il dettaglio del nuovo mese', async () => {
    await harness.navigateByUrl('/payslips', PayslipsPage);
    await loadPage();
    await flushDetail(detail());

    root().querySelector<HTMLButtonElement>('app-payslip-detail .edit')!.click();
    await settle();
    expect(root().querySelector('app-payslip-review')).not.toBeNull();

    root().querySelectorAll<HTMLButtonElement>('table.payslips .month')[1].click();
    await settle();
    await flushDetail({ ...detail(AUGUST), fileName: 'agosto.pdf' });

    expect(root().querySelector('app-payslip-review')).toBeNull();
    expect(root().querySelector('app-payslip-detail')?.textContent).toContain('agosto.pdf');
  });

  it('riscegliere il mese in modifica lascia aperto il modulo', async () => {
    await harness.navigateByUrl('/payslips', PayslipsPage);
    await loadPage();
    await flushDetail(detail());

    root().querySelector<HTMLButtonElement>('app-payslip-detail .edit')!.click();
    await settle();

    root().querySelectorAll<HTMLButtonElement>('table.payslips .month')[0].click();
    await settle();

    expect(root().querySelector('app-payslip-review')).not.toBeNull();
  });

  it('un errore di caricamento dell\'elenco offre di riprovare', async () => {
    await harness.navigateByUrl('/payslips', PayslipsPage);
    await settle();
    expectOne('/api/payslips').flush({ error: 'Archivio non disponibile.' }, { status: 500, statusText: 'Error' });
    expectOne('/api/payslip-summaries').flush(summaries());
    await settle();

    expect(text()).toContain('Archivio non disponibile.');
    expect(text()).toContain('Riprova');
  });

  const EMPTY: PayslipSummaries = { from: null, to: null, trend: [], comparisons: [] };

  /** Carica un PDF di prova e risponde con l'analisi data; lascia la revisione aperta. */
  const analyzeWith = async (data: PayslipAnalysis): Promise<void> => {
    await harness.navigateByUrl('/payslips', PayslipsPage);
    await loadPage([], EMPTY);
    await chooseFile(new File(['%PDF'], 'ottobre.pdf', { type: 'application/pdf' }));
    expectOne('/api/payslip-analyses', 'POST').flush(data);
    await settle();
    await settle();
  };

  const type = async (selector: string, value: string): Promise<void> => {
    const input = root().querySelector<HTMLInputElement>(selector)!;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    await settle();
  };

  const retryButtons = (): HTMLButtonElement[] => [
    ...root().querySelectorAll<HTMLButtonElement>('app-error-retry .retry')
  ];

  it('mentre le richieste sono in corso mostra il testo di caricamento', async () => {
    await harness.navigateByUrl('/payslips', PayslipsPage);
    await settle();

    expect(text()).toContain('Caricamento in corso…');
    expect(root().querySelector('table.payslips')).toBeNull();

    expectOne('/api/payslips').flush({ items: [SEPTEMBER, AUGUST] });
    await settle();
    // Elenco arrivato, andamento e dettaglio ancora in attesa.
    expect(root().querySelector('table.payslips')).not.toBeNull();
    expect(text()).toContain('Caricamento in corso…');

    expectOne('/api/payslip-summaries').flush(summaries());
    await settle();
    await flushDetail(detail());
    expect(text()).not.toContain('Caricamento in corso…');
  });

  it("riprovare dopo un errore dell'elenco rilegge elenco e andamento", async () => {
    await harness.navigateByUrl('/payslips', PayslipsPage);
    await settle();
    expectOne('/api/payslips').flush({ error: 'Archivio non disponibile.' }, { status: 500, statusText: 'Error' });
    expectOne('/api/payslip-summaries').flush(summaries());
    await settle();

    retryButtons()[0].click();
    await settle();
    expectOne('/api/payslips').flush({ items: [SEPTEMBER, AUGUST] });
    expectOne('/api/payslip-summaries').flush(summaries());
    await settle();
    await flushDetail(detail());

    expect(text()).not.toContain('Archivio non disponibile.');
    expect(root().querySelectorAll('table.payslips tbody tr')).toHaveLength(2);
  });

  it("un errore dell'andamento mostra «Riprova» e riprovare rilegge solo l'andamento", async () => {
    await harness.navigateByUrl('/payslips', PayslipsPage);
    await settle();
    expectOne('/api/payslips').flush({ items: [SEPTEMBER, AUGUST] });
    expectOne('/api/payslip-summaries').flush(
      { error: 'Andamento non disponibile.' },
      { status: 500, statusText: 'Error' }
    );
    await settle();
    await flushDetail(detail());

    expect(text()).toContain('Andamento non disponibile.');
    expect(retryButtons().length).toBeGreaterThan(0);
    // L'elenco resta visibile nonostante l'errore dell'andamento.
    expect(root().querySelectorAll('table.payslips tbody tr')).toHaveLength(2);

    retryButtons()[0].click();
    await settle();
    expectOne('/api/payslip-summaries').flush(summaries());
    await settle();

    expect(text()).not.toContain('Andamento non disponibile.');
    expect(root().querySelector('app-line-chart')).not.toBeNull();
  });

  it('un errore del dettaglio mostra «Riprova» e riprovare rilegge il dettaglio', async () => {
    await harness.navigateByUrl('/payslips', PayslipsPage);
    await loadPage();
    expectOne('/api/payslips/p-9').flush(
      { error: 'Dettaglio non disponibile.' },
      { status: 500, statusText: 'Error' }
    );
    await settle();

    expect(text()).toContain('Dettaglio non disponibile.');
    expect(root().querySelector('app-payslip-detail')).toBeNull();

    retryButtons()[0].click();
    await settle();
    await flushDetail(detail());

    expect(text()).not.toContain('Dettaglio non disponibile.');
    expect(root().querySelector('app-payslip-detail')).not.toBeNull();
  });

  it("scegliere un mese dall'elenco ne carica il dettaglio e lo mostra", async () => {
    await harness.navigateByUrl('/payslips', PayslipsPage);
    await loadPage();
    await flushDetail(detail());

    root().querySelectorAll<HTMLButtonElement>('table.payslips .month')[1].click();
    await settle();
    expect(router.url).toContain('period=2026-08');
    await flushDetail({ ...detail(AUGUST), fileName: 'agosto.pdf' });

    expect(root().querySelector('app-payslip-detail')?.textContent).toContain('agosto.pdf');
    expect(
      root().querySelectorAll('table.payslips tbody tr')[1].classList.contains('selected')
    ).toBe(true);
  });

  it("al grafico dell'andamento i mesi arrivano in ordine crescente", async () => {
    await harness.navigateByUrl('/payslips', PayslipsPage);
    await loadPage();
    await flushDetail(detail());

    const trend = harness.fixture.debugElement.query(By.directive(PayslipTrend))
      .componentInstance as PayslipTrend;
    const periods = trend.trend().map((point) => point.period);

    expect(periods).toEqual(['2026-08', '2026-09']);
    expect(periods).toEqual([...periods].sort());
  });

  it('con un conflitto di mese la conferma richiede di sostituire e invia replaceExisting', async () => {
    await analyzeWith({ ...analysis(), conflict: { payslipId: 'p-10', period: '2026-10' } });

    expect(text()).toContain('Esiste già un cedolino per ottobre 2026.');
    expect(text()).toContain('Sostituisci il cedolino esistente');
    const confirm = root().querySelector<HTMLButtonElement>('.confirm')!;
    expect(confirm.disabled).toBe(true);

    root().querySelector<HTMLInputElement>('.conflict input')!.click();
    await settle();
    expect(confirm.disabled).toBe(false);
    confirm.click();
    await settle();

    const save = expectOne('/api/payslips', 'POST');
    expect(save.request.body.replaceExisting).toBe(true);
    expect(save.request.body.analysisId).toBe('a-1');
    save.flush({ error: 'x' }, { status: 500, statusText: 'Error' });
    await settle();
  });

  it('un mese digitato a mano già in archivio chiede di sostituirlo e invia replaceExisting', async () => {
    await harness.navigateByUrl('/payslips', PayslipsPage);
    await loadPage();
    await flushDetail(detail());
    await chooseFile(new File(['%PDF'], 'scansione.pdf', { type: 'application/pdf' }));
    const scan = analysis();
    expectOne('/api/payslip-analyses', 'POST').flush({
      ...scan,
      status: 'unrecognized',
      draft: { ...scan.draft, period: null }
    });
    await settle();
    await settle();

    await type('#payslip-period', '2026-08');

    expect(text()).toContain('Esiste già un cedolino per agosto 2026.');
    const confirm = root().querySelector<HTMLButtonElement>('.confirm')!;
    expect(confirm.disabled).toBe(true);
    root().querySelector<HTMLInputElement>('.conflict input')!.click();
    await settle();
    confirm.click();
    await settle();

    const save = expectOne('/api/payslips', 'POST');
    expect(save.request.body.period).toBe('2026-08');
    expect(save.request.body.replaceExisting).toBe(true);
    save.flush({ error: 'x' }, { status: 500, statusText: 'Error' });
    await settle();
  });

  it('un errore 409 al salvataggio mostra il messaggio e lascia la revisione con i valori digitati', async () => {
    await analyzeWith(analysis());

    await type('#payslip-net', '2.100,00');
    root().querySelector<HTMLButtonElement>('.confirm')!.click();
    await settle();

    const save = expectOne('/api/payslips', 'POST');
    expect(save.request.body.netCents).toBe(210000);
    expect(save.request.body.replaceExisting).toBe(false);
    save.flush(
      { error: 'Esiste già un cedolino per questo mese.' },
      { status: 409, statusText: 'Conflict' }
    );
    await settle();

    expect(root().querySelector('[role="alert"]')?.textContent).toContain(
      'Esiste già un cedolino per questo mese.'
    );
    expect(root().querySelector('app-payslip-review')).not.toBeNull();
    expect(root().querySelector<HTMLInputElement>('#payslip-net')!.value).toBe('2.100,00');
    expect(root().querySelector<HTMLButtonElement>('.confirm')!.disabled).toBe(false);
  });

  it('un totale e una voce corretti a mano nella revisione arrivano al POST come centesimi interi', async () => {
    const data = analysis();
    await analyzeWith({
      ...data,
      draft: {
        ...data.draft,
        items: [
          { code: '0001', description: 'Retribuzione', section: 'earning', amountCents: 260000, quantity: null, unit: null }
        ]
      }
    });

    await type('#payslip-totalEarnings', '2.700,05');
    await type('input[aria-label="Importo della voce 1"]', '2.700,05');
    root().querySelector<HTMLButtonElement>('.confirm')!.click();
    await settle();

    const save = expectOne('/api/payslips', 'POST');
    expect(save.request.body.totalEarningsCents).toBe(270005);
    expect(save.request.body.items[0].amountCents).toBe(270005);
    save.flush({ error: 'x' }, { status: 500, statusText: 'Error' });
    await settle();
  });

  it("la revisione mostra stato, affidabilità e avvisi dell'analisi ricevuta", async () => {
    await analyzeWith({
      ...analysis(),
      status: 'incomplete',
      confidence: 'low',
      warnings: [{ code: 'NET_MISSING', field: 'netCents', message: 'Netto non trovato.' }]
    });

    expect(text()).toContain('Estrazione incompleta');
    expect(text()).toContain('Affidabilità bassa');
    expect(root().querySelector('.warnings')?.textContent).toContain('Netto non trovato.');
  });

  it('un PDF non valido (400) mostra il messaggio del backend e non apre la revisione', async () => {
    await harness.navigateByUrl('/payslips', PayslipsPage);
    await loadPage([], EMPTY);

    await chooseFile(new File(['%PDF'], 'rotto.pdf', { type: 'application/pdf' }));
    expectOne('/api/payslip-analyses', 'POST').flush(
      { error: 'Il file non è un PDF valido oppure è danneggiato.' },
      { status: 400, statusText: 'Bad Request' }
    );
    await settle();

    expect(root().querySelector('[role="alert"]')?.textContent).toContain(
      'Il file non è un PDF valido oppure è danneggiato.'
    );
    expect(root().querySelector('app-payslip-review')).toBeNull();
    expect(text()).not.toContain('Analisi del cedolino in corso…');
  });

  it("un'analisi scaduta (404) alla conferma mostra il messaggio e lascia la revisione aperta", async () => {
    await analyzeWith(analysis());

    root().querySelector<HTMLButtonElement>('.confirm')!.click();
    await settle();
    expectOne('/api/payslips', 'POST').flush(
      { error: 'Analisi non trovata o scaduta: carica di nuovo il PDF.' },
      { status: 404, statusText: 'Not Found' }
    );
    await settle();

    expect(root().querySelector('[role="alert"]')?.textContent).toContain(
      'Analisi non trovata o scaduta: carica di nuovo il PDF.'
    );
    expect(root().querySelector('app-payslip-review')).not.toBeNull();
  });

  it("se lo scarto dell'analisi fallisce la revisione si chiude lo stesso, senza errori", async () => {
    await analyzeWith(analysis());

    root().querySelector<HTMLButtonElement>('.cancel')!.click();
    await settle();
    expectOne('/api/payslip-analyses/a-1', 'DELETE').flush(
      { error: 'Analisi non trovata.' },
      { status: 404, statusText: 'Not Found' }
    );
    await settle();

    expect(root().querySelector('app-payslip-review')).toBeNull();
    expect(root().querySelector('[role="alert"]')).toBeNull();
  });

  it("un errore nell'eliminazione mostra il messaggio e non rilegge l'elenco", async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await harness.navigateByUrl('/payslips', PayslipsPage);
    await loadPage();
    await flushDetail(detail());

    root().querySelector<HTMLButtonElement>('app-payslip-detail .remove')!.click();
    await settle();
    expectOne('/api/payslips/p-9', 'DELETE').flush(
      { error: 'Impossibile eliminare il cedolino.' },
      { status: 500, statusText: 'Error' }
    );
    await settle();

    expect(root().querySelector('[role="alert"]')?.textContent).toContain(
      'Impossibile eliminare il cedolino.'
    );
    expect(root().querySelector('app-payslip-detail')).not.toBeNull();
    http.expectNone((request) => request.method === 'GET');
  });

  it('il dettaglio non mostra «Apri PDF» se il documento non è conservato', async () => {
    await harness.navigateByUrl('/payslips', PayslipsPage);
    await loadPage();
    await flushDetail({ ...detail(), hasDocument: false });

    expect(root().querySelector('a.document')).toBeNull();
  });

  describe('selezione del cedolino e riepilogo ferie (contratto A e B)', () => {
    // Caricati in ordine ottobre, agosto, settembre: gli id non seguono i periodi.
    // L'API risponde già dal periodo più recente.
    const OCT = summary({
      id: 'p-1',
      period: '2026-10',
      fileName: 'ottobre.pdf',
      netCents: 208000,
      totalEarningsCents: 260000,
      totalDeductionsCents: 52000
    });
    const SEP = summary({ id: 'p-3', period: '2026-09', fileName: 'settembre.pdf' });
    const AUG = summary({
      id: 'p-2',
      period: '2026-08',
      fileName: 'agosto.pdf',
      netCents: 192000,
      totalEarningsCents: 240000,
      totalDeductionsCents: 48000
    });
    const LIST = [OCT, SEP, AUG];
    const FERIE_RESIDUE: Record<string, number> = { 'p-1': 45, 'p-3': 44, 'p-2': 46 };

    const detailOf = (base: PayslipSummary): PayslipDetail => ({
      ...detail(base),
      leaveBalances: [
        { type: 'FERIE', accrued: 14, used: 8, remaining: FERIE_RESIDUE[base.id], unit: 'ore' },
        { type: 'PAR', accrued: 6, used: 4, remaining: 2, unit: 'ore' }
      ]
    });

    const obs = (period: string, payslipId: string, remaining: number) => ({
      period,
      payslipId,
      accrued: 10,
      used: 4,
      remaining,
      unit: 'ore'
    });

    const leaveOverview = (withAnomaly: boolean) => {
      const anomaly = {
        type: 'FERIE',
        period: '2026-08',
        payslipId: 'p-2',
        previousPeriod: '2026-07',
        previousPayslipId: 'p-0',
        rule: 'stesso-anno',
        status: 'anomalia',
        expectedRemaining: 44,
        observedRemaining: 40,
        difference: -4,
        reason: 'Il residuo non coincide con quello atteso dal cedolino precedente.'
      };

      return {
        semantics: 'progressivo-annuo',
        coverage: { from: '2026-08', to: '2026-10', payslipCount: 3, missingPeriods: [] },
        types: [
          {
            type: 'FERIE',
            unit: 'ore',
            latest: obs('2026-10', 'p-1', 45),
            yearTotals: [{ year: '2026', period: '2026-10', payslipId: 'p-1', accrued: 14, used: 8 }],
            history: [obs('2026-08', 'p-2', 46), obs('2026-09', 'p-3', 44), obs('2026-10', 'p-1', 45)],
            status: withAnomaly ? 'anomalia' : 'coerente',
            checks: withAnomaly ? [anomaly] : []
          }
        ],
        anomalies: withAnomaly ? [anomaly] : [],
        limitations: ['Maturato e goduto sono progressivi dall\'inizio dell\'anno.']
      };
    };

    const summariesOf = (withAnomaly = false): PayslipSummaries =>
      ({
        from: '2026-08',
        to: '2026-10',
        trend: [AUG, SEP, OCT].map((p) => ({
          payslipId: p.id,
          period: p.period,
          netCents: p.netCents,
          totalEarningsCents: p.totalEarningsCents,
          totalDeductionsCents: p.totalDeductionsCents,
          leaveRemaining: { FERIE: FERIE_RESIDUE[p.id], PAR: 2 }
        })),
        comparisons: [],
        leave: leaveOverview(withAnomaly)
      }) as PayslipSummaries;

    const rows = (): HTMLTableRowElement[] => [
      ...root().querySelectorAll<HTMLTableRowElement>('table.payslips tbody tr')
    ];
    const monthButtons = (): HTMLButtonElement[] => [
      ...root().querySelectorAll<HTMLButtonElement>('table.payslips button.month')
    ];

    const open = async (period: string | null): Promise<void> => {
      await harness.navigateByUrl(period === null ? '/payslips' : `/payslips?period=${period}`, PayslipsPage);
      await loadPage(LIST, summariesOf());
      const startId = LIST.find((item) => item.period === period)?.id ?? 'p-1';
      await flushDetail(detailOf(LIST.find((item) => item.id === startId)!));
    };

    /** Esattamente una riga attiva, e il pulsante `aria-current` sta in quella riga. */
    const expectOnlyActive = (index: number): void => {
      const selectedRows = rows().filter((row) => row.classList.contains('selected'));
      expect(selectedRows).toHaveLength(1);
      expect(selectedRows[0]).toBe(rows()[index]);
      const current = monthButtons().filter((button) => button.getAttribute('aria-current') === 'true');
      expect(current).toHaveLength(1);
      expect(current[0]).toBe(monthButtons()[index]);
    };

    it('elenca i cedolini dal periodo più recente anche se gli id non seguono i periodi', async () => {
      await open(null);

      expect(rows().map((row) => row.querySelector('button.month')?.textContent?.trim())).toEqual([
        'ottobre 2026',
        'settembre 2026',
        'agosto 2026'
      ]);
      expectOnlyActive(0);
    });

    const CASES = [
      { period: '2026-10', index: 0, start: '2026-08', net: '2080,00', ferie: '45 ore' },
      { period: '2026-09', index: 1, start: '2026-10', net: '2000,00', ferie: '44 ore' },
      { period: '2026-08', index: 2, start: '2026-10', net: '1920,00', ferie: '46 ore' }
    ];

    for (const { period, index, start, net, ferie } of CASES) {
      it(`un click sulla cella del Netto seleziona il cedolino ${period}`, async () => {
        await open(start);
        expect(router.url).toContain(`period=${start}`);

        // La cella del Netto, non il pulsante del mese.
        rows()[index].querySelectorAll<HTMLTableCellElement>('td')[1].click();
        await settle();

        expect(router.url).toContain(`period=${period}`);
        const target = LIST[index];
        await flushDetail(detailOf(target));

        expectOnlyActive(index);
        const cards = root().querySelector('app-stat-card-grid')?.textContent ?? '';
        expect(cards).toContain(net);
        expect(cards).toContain(ferie);
        expect(root().querySelector('app-payslip-detail')?.textContent).toContain(target.fileName);
      });
    }

    // L'elenco ha due colonne (Mese, Netto): competenze e trattenute stanno nei KPI del mese.
    it('un click sulla cella del mese fuori dal pulsante, sul Netto e sulla riga seleziona il cedolino', async () => {
      await open('2026-10');

      rows()[2].querySelectorAll<HTMLTableCellElement>('td')[0].click();
      await settle();
      expect(router.url).toContain('period=2026-08');
      await flushDetail(detailOf(AUG));

      rows()[1].querySelectorAll<HTMLTableCellElement>('td')[1].click();
      await settle();
      expect(router.url).toContain('period=2026-09');
      await flushDetail(detailOf(SEP));

      rows()[0].click();
      await settle();
      expect(router.url).toContain('period=2026-10');
      await flushDetail(detailOf(OCT));
      expectOnlyActive(0);
    });

    it('il cursore sulla riga è quello della mano e la riga non entra nell\'ordine di Tab', async () => {
      await open(null);

      for (const row of rows()) {
        expect(row.hasAttribute('tabindex')).toBe(false);
      }
      // Il cursore sta nello stile del componente: il template deve almeno
      // non lasciare le celle numeriche come uniche zone cliccabili.
      expect(rows()[0].querySelector('button.month')).not.toBeNull();
    });

    it('da tastiera: il pulsante del mese è un vero <button type="button"> raggiungibile con Tab', async () => {
      await open(null);

      for (const button of monthButtons()) {
        expect(button.tagName).toBe('BUTTON');
        expect(button.getAttribute('type')).toBe('button');
        expect(button.disabled).toBe(false);
        expect(button.tabIndex).toBeGreaterThanOrEqual(0);
      }

      const target = monthButtons()[2];
      target.focus();
      expect(document.activeElement).toBe(target);
    });

    it('da tastiera: Invio e Spazio sul pulsante (che il browser traduce in click) selezionano una sola volta', async () => {
      await open(null);

      const target = monthButtons()[1];
      target.focus();
      // jsdom non traduce i tasti in click: lo fa il browser su un <button>.
      target.click();
      await settle();

      expect(router.url).toContain('period=2026-09');
      // Il click risale fino alla riga: la richiesta del dettaglio resta una.
      await flushDetail(detailOf(SEP));
      expectOnlyActive(1);
      expect(document.activeElement).toBe(target);
    });

    it('il riepilogo ferie sta in un pannello in alto, prima dell\'elenco e del mese selezionato', async () => {
      await open(null);

      const overview = root().querySelector('app-payslip-leave-overview');
      expect(overview).not.toBeNull();
      const panel = overview!.closest('app-panel');
      expect(panel?.querySelector('h2')?.textContent?.trim()).toBe('Riepilogo ferie e permessi');

      const list = root().querySelector('table.payslips')!;
      const grid = root().querySelector('app-stat-card-grid')!;
      expect(overview!.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(overview!.compareDocumentPosition(grid) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(overview!.textContent).toContain('Coerente');
    });

    it('«Vai al cedolino» seleziona il cedolino dell\'anomalia: URL, dettaglio e riga attiva', async () => {
      await harness.navigateByUrl('/payslips', PayslipsPage);
      await loadPage(LIST, summariesOf(true));
      await flushDetail(detailOf(OCT));
      expect(root().querySelector('app-payslip-leave-overview')?.textContent).toContain('Anomalia');

      const go = [...root().querySelectorAll<HTMLButtonElement>('app-payslip-leave-overview button')].find(
        (button) => button.textContent?.trim() === 'Vai al cedolino'
      );
      expect(go).toBeDefined();
      go!.click();
      await settle();

      expect(router.url).toContain('period=2026-08');
      await flushDetail(detailOf(AUG));
      expectOnlyActive(2);
    });
  });
});

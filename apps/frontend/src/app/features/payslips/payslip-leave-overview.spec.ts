import { TestBed } from '@angular/core/testing';
import { PayslipLeaveOverview } from './payslip-leave-overview';

/*
 * Contratto: docs/superpowers/specs/2026-11-04-cedolini-selezione-e-riepilogo-ferie.md
 * (sezione B e «Moduli»). I tipi sono dichiarati qui in piccolo: il file del
 * modello non li ha ancora, e il test non deve dipendere da come verranno
 * esportati. Solo dati sintetici.
 */

type Status = 'coerente' | 'anomalia' | 'non_verificabile';

interface Observation {
  period: string;
  payslipId: string;
  accrued: number;
  used: number;
  remaining: number;
  unit: string;
}

interface Check {
  type: 'FERIE' | 'PAR';
  period: string;
  payslipId: string;
  previousPeriod: string | null;
  previousPayslipId: string | null;
  rule: 'primo-cedolino' | 'stesso-anno' | 'cambio-anno' | 'nessuna';
  status: Status;
  expectedRemaining: number | null;
  observedRemaining: number | null;
  difference: number | null;
  reason: string;
}

interface TypeOverview {
  type: 'FERIE' | 'PAR';
  unit: string | null;
  latest: Observation | null;
  yearTotals: { year: string; period: string; payslipId: string; accrued: number; used: number }[];
  history: Observation[];
  status: Status;
  checks: Check[];
}

interface Overview {
  semantics: 'progressivo-annuo';
  coverage: { from: string | null; to: string | null; payslipCount: number; missingPeriods: string[] };
  types: TypeOverview[];
  anomalies: Check[];
  limitations: string[];
}

const IDS: Record<string, string> = { '2026-08': 'p-2', '2026-09': 'p-3', '2026-10': 'p-1' };

const obs = (period: string, accrued: number, used: number, remaining: number): Observation => ({
  period,
  payslipId: IDS[period],
  accrued,
  used,
  remaining,
  unit: 'ore'
});

const check = (overrides: Partial<Check> & Pick<Check, 'type' | 'period'>): Check => ({
  payslipId: IDS[overrides.period],
  previousPeriod: null,
  previousPayslipId: null,
  rule: 'stesso-anno',
  status: 'coerente',
  expectedRemaining: null,
  observedRemaining: null,
  difference: null,
  reason: '',
  ...overrides
});

/** Ago → set → ott 2026, tutto coerente. Ferie: 46, 44, 46 ore; P.A.R.: 2, 2, 2 ore. */
const coherent = (): Overview => {
  const ferie: TypeOverview = {
    type: 'FERIE',
    unit: 'ore',
    latest: obs('2026-10', 14, 8, 46),
    yearTotals: [{ year: '2026', period: '2026-10', payslipId: 'p-1', accrued: 14, used: 8 }],
    history: [obs('2026-08', 10, 4, 46), obs('2026-09', 12, 8, 44), obs('2026-10', 14, 8, 46)],
    status: 'coerente',
    checks: [
      check({
        type: 'FERIE',
        period: '2026-08',
        rule: 'primo-cedolino',
        status: 'non_verificabile',
        reason: 'Primo cedolino in archivio: manca il termine di confronto.'
      }),
      check({
        type: 'FERIE',
        period: '2026-09',
        previousPeriod: '2026-08',
        previousPayslipId: 'p-2',
        expectedRemaining: 44,
        observedRemaining: 44,
        difference: 0,
        reason: 'Il residuo coincide con quello atteso.'
      }),
      check({
        type: 'FERIE',
        period: '2026-10',
        previousPeriod: '2026-09',
        previousPayslipId: 'p-3',
        expectedRemaining: 46,
        observedRemaining: 46,
        difference: 0,
        reason: 'Il residuo coincide con quello atteso.'
      })
    ]
  };
  const par: TypeOverview = {
    type: 'PAR',
    unit: 'ore',
    latest: obs('2026-10', 6, 4, 2),
    yearTotals: [{ year: '2026', period: '2026-10', payslipId: 'p-1', accrued: 6, used: 4 }],
    history: [obs('2026-08', 4, 2, 2), obs('2026-09', 5, 3, 2), obs('2026-10', 6, 4, 2)],
    status: 'coerente',
    checks: [
      check({ type: 'PAR', period: '2026-08', rule: 'primo-cedolino', status: 'non_verificabile' }),
      check({
        type: 'PAR',
        period: '2026-09',
        previousPeriod: '2026-08',
        previousPayslipId: 'p-2',
        expectedRemaining: 2,
        observedRemaining: 2,
        difference: 0
      }),
      check({
        type: 'PAR',
        period: '2026-10',
        previousPeriod: '2026-09',
        previousPayslipId: 'p-3',
        expectedRemaining: 2,
        observedRemaining: 2,
        difference: 0
      })
    ]
  };

  return {
    semantics: 'progressivo-annuo',
    coverage: { from: '2026-08', to: '2026-10', payslipCount: 3, missingPeriods: [] },
    types: [ferie, par],
    anomalies: [],
    limitations: [
      'Maturato e goduto sono progressivi dall\'inizio dell\'anno, come dichiara il formato del cedolino.',
      'Il residuo dell\'anno precedente è ricavato dai valori stampati, non letto dal cedolino.',
      'La tolleranza di 0,0001 assorbe l\'arrotondamento dei cinque decimali stampati.'
    ]
  };
};

const ANOMALY_REASON = 'Il residuo non coincide con quello atteso dal cedolino precedente.';

/** Come `coherent`, ma a settembre le ferie hanno un residuo di 40 invece di 44. */
const withAnomaly = (): Overview => {
  const data = coherent();
  const ferie = data.types[0];
  const broken = check({
    type: 'FERIE',
    period: '2026-09',
    previousPeriod: '2026-08',
    previousPayslipId: 'p-2',
    status: 'anomalia',
    expectedRemaining: 44,
    observedRemaining: 40,
    difference: -4,
    reason: ANOMALY_REASON
  });
  ferie.checks[1] = broken;
  ferie.history[1] = obs('2026-09', 12, 8, 40);
  ferie.status = 'anomalia';
  data.anomalies = [broken];

  return data;
};

describe('PayslipLeaveOverview', () => {
  const render = async (overview: Overview): Promise<HTMLElement> => {
    const fixture = TestBed.createComponent(PayslipLeaveOverview);
    fixture.componentRef.setInput('overview', overview);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  };

  const text = (host: HTMLElement): string => (host.textContent ?? '').replace(/\s+/g, ' ');
  const buttons = (host: HTMLElement): HTMLButtonElement[] => [...host.querySelectorAll('button')];
  const findButton = (host: HTMLElement, label: string): HTMLButtonElement | undefined =>
    buttons(host).find((button) => button.textContent?.trim() === label);

  beforeEach(() => TestBed.configureTestingModule({ imports: [PayslipLeaveOverview] }));

  it('mostra il periodo coperto, il numero di cedolini e nessun mese mancante', async () => {
    const host = await render(coherent());
    const content = text(host);

    expect(content).toContain('agosto 2026');
    expect(content).toContain('ottobre 2026');
    expect(content).toMatch(/\b3\b/);
    expect(content).toMatch(/cedolin/i);
  });

  it('con un solo cedolino scrive «1 cedolino», al singolare', async () => {
    const data = coherent();
    data.coverage = { from: '2026-10', to: '2026-10', payslipCount: 1, missingPeriods: [] };
    const content = text(await render(data));

    expect(content).toContain('1 cedolino nel periodo');
    expect(content).not.toContain('1 cedolini');
  });

  it('elenca i mesi mancanti fra il primo e l\'ultimo cedolino', async () => {
    const data = coherent();
    data.coverage = { from: '2026-07', to: '2026-10', payslipCount: 3, missingPeriods: ['2026-08'] };
    const host = await render(data);
    const content = text(host);

    expect(content).toMatch(/mancant/i);
    expect(content).toContain('agosto 2026');
    expect(content).toContain('luglio 2026');
  });

  it('mostra l\'ultimo residuo di ferie e di P.A.R. con l\'unità', async () => {
    const host = await render(coherent());
    const content = text(host);

    expect(content).toContain('Ferie');
    expect(content).toContain('P.A.R.');
    expect(content).toMatch(/\b46 ore/);
    expect(content).toMatch(/\b2 ore/);
  });

  it('mostra maturato e goduto nell\'anno dall\'ultimo progressivo, senza sommare i mesi', async () => {
    const host = await render(coherent());
    const content = text(host);

    expect(content).toContain('2026');
    // Ferie: maturato 14, goduto 8 — non 10+12+14 né 4+8+8.
    expect(content).toMatch(/\b14\b/);
    expect(content).toMatch(/\b8\b/);
    expect(content).not.toMatch(/\b36\b/);
    expect(content).not.toMatch(/\b20\b/);
    // P.A.R.: maturato 6, goduto 4 — non 15 né 9.
    expect(content).not.toMatch(/\b15\b/);
    expect(content).not.toMatch(/\b9\b/);
  });

  it('la cronologia dei residui è una tabella con un mese per riga, in ordine crescente', async () => {
    const host = await render(coherent());
    const tables = [...host.querySelectorAll('table')];
    const history = tables.find((table) => /agosto 2026/.test(table.textContent ?? ''));

    expect(history).toBeDefined();
    const body = [...history!.querySelectorAll('tbody tr')].map((row) => row.textContent ?? '');
    const months = body.map((row) => /(agosto|settembre|ottobre) 2026/.exec(row)?.[1]);
    expect(months.filter(Boolean)).toEqual(['agosto', 'settembre', 'ottobre']);
  });

  it('mostra lo stato «Coerente» e non «Anomalia» quando i controlli tornano', async () => {
    const host = await render(coherent());
    const content = text(host);

    expect(content).toContain('Coerente');
    expect(content).not.toContain('Anomalia');
    expect(findButton(host, 'Vai al cedolino')).toBeUndefined();
  });

  it('la cronologia ha una colonna «Verifica»: il motivo se il mese non è verificabile, «Coerente» se torna', async () => {
    const host = await render(coherent());
    const history = [...host.querySelectorAll('table')].find(
      (table) => table.getAttribute('aria-label') === 'Cronologia Ferie'
    )!;
    const headers = [...history.querySelectorAll('th')].map((th) => th.textContent?.trim());
    const verification = (row: number): string =>
      history.querySelectorAll('tbody tr')[row].querySelector('.verification')?.textContent?.trim() ?? '';

    expect(headers).toContain('Verifica');
    expect(verification(0)).toBe('Primo cedolino in archivio: manca il termine di confronto.');
    expect(verification(1)).toBe('Coerente');
    expect(verification(2)).toBe('Coerente');
  });

  it('nella cronologia un mese con anomalia è segnato «Anomalia»', async () => {
    const host = await render(withAnomaly());
    const history = [...host.querySelectorAll('table')].find(
      (table) => table.getAttribute('aria-label') === 'Cronologia Ferie'
    )!;

    expect(history.querySelectorAll('tbody tr')[1].querySelector('.verification')?.textContent?.trim()).toBe(
      'Anomalia'
    );
  });

  it('mostra lo stato «Non verificabile»', async () => {
    const data = coherent();
    data.types[1].status = 'non_verificabile';
    const host = await render(data);
    const content = text(host);

    expect(content).toContain('Non verificabile');
    expect(content).toContain('Coerente');
    expect(content).not.toContain('Anomalia');
  });

  it('mostra lo stato «Anomalia» e la riga dell\'anomalia con mese, atteso, rilevato, differenza e motivo', async () => {
    const host = await render(withAnomaly());
    const content = text(host);

    expect(content).toContain('Anomalia');
    const button = findButton(host, 'Vai al cedolino');
    expect(button).toBeDefined();
    const row = button!.closest('tr, li, article, [class*="anomal"]');
    expect(row).not.toBeNull();
    const rowText = (row!.textContent ?? '').replace(/\s+/g, ' ');

    expect(rowText).toContain('settembre 2026');
    expect(rowText).toMatch(/\b44\b/); // atteso
    expect(rowText).toMatch(/\b40\b/); // rilevato
    expect(rowText).toMatch(/[−-]\s?4\b/); // differenza
    expect(rowText).toContain(ANOMALY_REASON);
  });

  it('un\'anomalia per ogni controllo fallito: due anomalie, due pulsanti «Vai al cedolino»', async () => {
    const data = withAnomaly();
    const second = check({
      type: 'FERIE',
      period: '2026-10',
      previousPeriod: '2026-09',
      previousPayslipId: 'p-3',
      status: 'anomalia',
      expectedRemaining: 42,
      observedRemaining: 46,
      difference: 4,
      reason: ANOMALY_REASON
    });
    data.types[0].checks[2] = second;
    data.anomalies = [data.anomalies[0], second];
    const host = await render(data);

    expect(buttons(host).filter((button) => button.textContent?.trim() === 'Vai al cedolino')).toHaveLength(2);
  });

  it('«Vai al cedolino» emette il periodo dell\'anomalia', async () => {
    const fixture = TestBed.createComponent(PayslipLeaveOverview);
    fixture.componentRef.setInput('overview', withAnomaly());
    const emitted: string[] = [];
    fixture.componentInstance.selectPeriod.subscribe((period: string) => emitted.push(period));
    await fixture.whenStable();

    findButton(fixture.nativeElement as HTMLElement, 'Vai al cedolino')!.click();

    expect(emitted).toEqual(['2026-09']);
  });

  it('un periodo della cronologia emette selectPeriod', async () => {
    const fixture = TestBed.createComponent(PayslipLeaveOverview);
    fixture.componentRef.setInput('overview', coherent());
    const emitted: string[] = [];
    fixture.componentInstance.selectPeriod.subscribe((period: string) => emitted.push(period));
    await fixture.whenStable();

    const host = fixture.nativeElement as HTMLElement;
    const history = [...host.querySelectorAll('table')].find((table) =>
      /agosto 2026/.test(table.textContent ?? '')
    )!;
    const month = [...history.querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === 'agosto 2026'
    );
    expect(month).toBeDefined();
    month!.click();

    expect(emitted).toEqual(['2026-08']);
  });

  it('mostra i limiti dichiarati della verifica', async () => {
    const data = coherent();
    const host = await render(data);
    const content = text(host);

    for (const limit of data.limitations) {
      expect(content).toContain(limit);
    }
  });

  it('senza cedolini non mostra tipi, anomalie né pulsanti e non va in errore', async () => {
    const host = await render({
      semantics: 'progressivo-annuo',
      coverage: { from: null, to: null, payslipCount: 0, missingPeriods: [] },
      types: [],
      anomalies: [],
      limitations: []
    });

    expect(buttons(host)).toHaveLength(0);
    expect(text(host)).not.toContain('Anomalia');
  });
});

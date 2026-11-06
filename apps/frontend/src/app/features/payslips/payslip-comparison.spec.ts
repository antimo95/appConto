import { TestBed } from '@angular/core/testing';
import { PayslipComparisonView } from './payslip-comparison';
import { ItemDelta, PayslipComparison } from './payslip.model';

const delta = (overrides: Partial<ItemDelta>): ItemDelta => ({
  key: 'k',
  code: null,
  description: 'Voce',
  section: 'earning',
  status: 'changed',
  currentCents: 0,
  previousCents: 0,
  deltaCents: 0,
  deltaPercent: null,
  ...overrides
});

const comparison = (items: ItemDelta[]): PayslipComparison => ({
  period: '2026-09',
  payslipId: 'p-9',
  previousPeriod: '2026-08',
  previousPayslipId: 'p-8',
  net: { currentCents: 200000, previousCents: 192000, deltaCents: 8000, deltaPercent: 4.2 },
  totalEarnings: { currentCents: 250000, previousCents: 240000, deltaCents: 10000, deltaPercent: 4.2 },
  totalDeductions: { currentCents: 50000, previousCents: 48000, deltaCents: 2000, deltaPercent: 4.2 },
  leave: [],
  items
});

describe('PayslipComparisonView', () => {
  const render = async (data: PayslipComparison | null): Promise<HTMLElement> => {
    const fixture = TestBed.createComponent(PayslipComparisonView);
    fixture.componentRef.setInput('comparison', data);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  };

  beforeEach(() => TestBed.configureTestingModule({ imports: [PayslipComparisonView] }));

  it('senza cedolino precedente mostra il messaggio e nessuna tabella', async () => {
    const host = await render(null);

    expect(host.textContent).toContain('Nessun cedolino precedente da confrontare.');
    expect(host.querySelector('ul.deltas')).toBeNull();
    expect(host.querySelector('table.changes')).toBeNull();
  });

  it('mostra le variazioni di netto, competenze e trattenute con segno e percentuale', async () => {
    const host = await render(comparison([]));
    const rows = [...host.querySelectorAll('ul.deltas li')];

    expect(host.querySelector('.intro')?.textContent).toContain('settembre 2026 rispetto a agosto 2026');
    expect(rows.map((row) => row.querySelector('.label')?.textContent?.trim())).toEqual([
      'Netto',
      'Competenze',
      'Trattenute'
    ]);
    expect(rows[0].textContent).toContain('+80,00');
    expect(rows[0].textContent).toContain('+4,2%');
    // Più netto è un miglioramento, più trattenute un peggioramento.
    expect(rows[0].querySelector('.value')?.classList.contains('positive')).toBe(true);
    expect(rows[2].querySelector('.value')?.classList.contains('negative')).toBe(true);
  });

  it('mostra voci variate, nuove e scomparse e nasconde le identiche', async () => {
    const host = await render(
      comparison([
        delta({ key: 'a', description: 'Voce variata', status: 'changed', currentCents: 150000, previousCents: 140000, deltaCents: 10000, deltaPercent: 7.1 }),
        delta({ key: 'b', description: 'Voce nuova', status: 'added', currentCents: 5000, previousCents: null, deltaCents: 5000 }),
        delta({ key: 'c', description: 'Voce scomparsa', section: 'deduction', status: 'removed', currentCents: null, previousCents: 3000, deltaCents: -3000 }),
        delta({ key: 'd', description: 'Voce identica', status: 'unchanged', currentCents: 1000, previousCents: 1000 })
      ])
    );
    const rows = [...host.querySelectorAll('table.changes tbody tr')].map((row) => row.textContent ?? '');

    expect(rows).toHaveLength(3);
    expect(rows[0]).toContain('Variata');
    expect(rows[0]).toContain('+100,00');
    expect(rows[0]).toContain('+7,1%');
    expect(rows[1]).toContain('Nuova');
    expect(rows[1]).toContain('—');
    expect(rows[2]).toContain('Scomparsa');
    expect(rows[2]).toContain('Trattenuta');
    expect(host.textContent).not.toContain('Voce identica');
  });

  it('se tutte le voci sono identiche lo dice al posto della tabella', async () => {
    const host = await render(comparison([delta({ status: 'unchanged' })]));

    expect(host.querySelector('table.changes')).toBeNull();
    expect(host.textContent).toContain('Nessuna voce variata rispetto a agosto 2026.');
  });
});

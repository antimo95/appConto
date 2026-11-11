import { TestBed } from '@angular/core/testing';
import { PayslipDetailView } from './payslip-detail';
import { PayslipDetail } from './payslip.model';

const detail = (overrides: Partial<PayslipDetail> = {}): PayslipDetail => ({
  id: 'p-9',
  period: '2026-09',
  employer: 'Acme Srl',
  fileName: 'settembre.pdf',
  importedAt: '2026-10-01T10:00:00Z',
  parserId: 'zucchetti',
  totalEarningsCents: 250000,
  totalDeductionsCents: 50000,
  netCents: 200000,
  roundingCents: null,
  taxableInpsCents: 250000,
  taxableIrpefCents: null,
  workedHours: 168,
  hasDocument: true,
  items: [
    { code: '0001', description: 'Retribuzione base', section: 'earning', amountCents: 250000, quantity: 26, unit: 'giorni' },
    { code: null, description: 'Contributi INPS', section: 'deduction', amountCents: 23000, quantity: null, unit: null },
    { code: '0900', description: 'INPS azienda', section: 'employer_contribution', amountCents: 70000, quantity: null, unit: null },
    { code: null, description: 'Ratei TFR', section: 'informational', amountCents: 18000, quantity: null, unit: null }
  ],
  leaveBalances: [
    { type: 'FERIE', accrued: 20, used: 60, remaining: -40, unit: 'ore' },
    { type: 'PAR', accrued: 10, used: 0, remaining: 10, unit: 'ore' }
  ],
  ...overrides
});

/** Il valore di una riga dei metadati, con il testo esatto della cella. */
const metaValue = (host: HTMLElement, label: string): string =>
  [...host.querySelectorAll('dl.meta div')]
    .find((row) => row.querySelector('dt')?.textContent?.trim() === label)!
    .querySelector('dd')!
    .textContent!.replace(/\s+/g, ' ')
    .trim();

describe('PayslipDetailView', () => {
  const render = async (data: PayslipDetail): Promise<HTMLElement> => {
    const fixture = TestBed.createComponent(PayslipDetailView);
    fixture.componentRef.setInput('detail', data);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  };

  beforeEach(() => TestBed.configureTestingModule({ imports: [PayslipDetailView] }));

  it('mostra i metadati del cedolino', async () => {
    const host = await render(detail());

    expect(metaValue(host, 'Mese')).toBe('settembre 2026');
    expect(metaValue(host, 'Datore di lavoro')).toBe('Acme Srl');
    expect(metaValue(host, 'File')).toBe('settembre.pdf');
    expect(metaValue(host, 'Lettore')).toBe('zucchetti');
    expect(metaValue(host, 'Ore lavorate')).toBe('168');
    // Ogni importo nella sua cella: «500,00» da solo si troverebbe anche dentro «2500,00».
    expect(metaValue(host, 'Totale competenze')).toContain('2500,00');
    expect(metaValue(host, 'Totale trattenute')).toContain('500,00');
    expect(metaValue(host, 'Totale trattenute')).not.toContain('2500,00');
    expect(metaValue(host, 'Netto')).toContain('2000,00');
  });

  it('con busy Modifica ed Elimina sono disabilitati', async () => {
    const fixture = TestBed.createComponent(PayslipDetailView);
    fixture.componentRef.setInput('detail', detail());
    fixture.componentRef.setInput('busy', true);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector<HTMLButtonElement>('.edit')!.disabled).toBe(true);
    expect(host.querySelector<HTMLButtonElement>('.remove')!.disabled).toBe(true);
  });

  it('i valori assenti compaiono come trattino', async () => {
    const host = await render(detail({ employer: null, workedHours: null }));

    expect(metaValue(host, 'Datore di lavoro')).toBe('—');
    expect(metaValue(host, 'Ore lavorate')).toBe('—');
    expect(metaValue(host, 'Arrotondamento')).toBe('—');
    expect(metaValue(host, 'Imponibile IRPEF')).toBe('—');
  });

  it("elenca tutte le voci con l'etichetta della sezione", async () => {
    const host = await render(detail());
    const rows = [...host.querySelectorAll('table.items tbody tr')].map((row) => row.textContent ?? '');

    expect(rows).toHaveLength(4);
    expect(rows[0]).toContain('Retribuzione base');
    expect(rows[0]).toContain('Competenza');
    expect(rows[0]).toContain('26 giorni');
    expect(rows[1]).toContain('Trattenuta');
    expect(rows[2]).toContain('Contributo azienda');
    expect(rows[3]).toContain('Informativa');
  });

  it('senza voci né saldi mostra i messaggi vuoti', async () => {
    const host = await render(detail({ items: [], leaveBalances: [] }));

    expect(host.querySelector('table.items')).toBeNull();
    expect(host.textContent).toContain('Nessuna voce.');
    expect(host.querySelector('table.leaves')).toBeNull();
    expect(host.textContent).toContain('Nessun saldo di ferie o P.A.R.');
  });

  it('la tabella di ferie e P.A.R. mostra maturato, goduto e residuo', async () => {
    const host = await render(detail());
    const rows = [...host.querySelectorAll('table.leaves tbody tr')].map((row) => row.textContent ?? '');

    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain('Ferie');
    expect(rows[0]).toContain('20');
    expect(rows[0]).toContain('60');
    expect(rows[0]).toContain('−40');
    expect(rows[1]).toContain('P.A.R.');
  });

  it("il link «Apri PDF» c'è solo se il documento è conservato", async () => {
    const withDocument = await render(detail({ hasDocument: true }));
    const link = withDocument.querySelector<HTMLAnchorElement>('a.document')!;
    expect(link.textContent?.trim()).toBe('Apri PDF');
    expect(link.getAttribute('href')).toBe('/api/payslips/p-9/document');

    const without = await render(detail({ hasDocument: false }));
    expect(without.querySelector('a.document')).toBeNull();
    expect(without.textContent).not.toContain('Apri PDF');
  });

  it('i pulsanti Modifica ed Elimina emettono gli eventi', async () => {
    const fixture = TestBed.createComponent(PayslipDetailView);
    fixture.componentRef.setInput('detail', detail());
    let edits = 0;
    let removes = 0;
    fixture.componentInstance.edit.subscribe(() => edits++);
    fixture.componentInstance.remove.subscribe(() => removes++);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;

    host.querySelector<HTMLButtonElement>('.edit')!.click();
    host.querySelector<HTMLButtonElement>('.remove')!.click();

    expect([edits, removes]).toEqual([1, 1]);
  });
});

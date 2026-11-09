import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PayslipReview } from './payslip-review';
import { PayslipAnalysis, PayslipDraft, ReviewResult } from './payslip.model';

const draft = (overrides: Partial<PayslipDraft> = {}): PayslipDraft => ({
  period: '2026-09',
  employer: 'Acme Srl',
  totalEarningsCents: 250000,
  totalDeductionsCents: 50000,
  netCents: 200000,
  roundingCents: null,
  taxableInpsCents: 250000,
  taxableIrpefCents: null,
  workedHours: 168,
  items: [
    {
      code: '0001',
      description: 'Retribuzione',
      section: 'earning',
      amountCents: 250000,
      quantity: 26,
      unit: 'giorni'
    }
  ],
  leaveBalances: [{ type: 'FERIE', accrued: 20, used: 60, remaining: -40, unit: 'ore' }],
  ...overrides
});

const analysis = (overrides: Partial<PayslipAnalysis> = {}): PayslipAnalysis => ({
  id: 'a-1',
  fileName: 'settembre.pdf',
  parserId: 'zucchetti',
  status: 'complete',
  confidence: 'high',
  warnings: [],
  draft: draft(),
  conflict: null,
  expiresAt: '2026-10-01T00:00:00Z',
  ...overrides
});

describe('PayslipReview', () => {
  let fixture: ComponentFixture<PayslipReview>;
  let emitted: ReviewResult[];
  let cancelled: number;

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const field = (id: string): HTMLInputElement =>
    host().querySelector<HTMLInputElement>(`#payslip-${id}`)!;
  const confirmButton = (): HTMLButtonElement => host().querySelector('.confirm')!;

  const render = async (
    data: PayslipDraft = draft(),
    info: PayslipAnalysis | null = analysis(),
    takenPeriods: readonly string[] = []
  ): Promise<void> => {
    fixture = TestBed.createComponent(PayslipReview);
    fixture.componentRef.setInput('draft', data);
    fixture.componentRef.setInput('analysis', info);
    fixture.componentRef.setInput('takenPeriods', takenPeriods);
    emitted = [];
    cancelled = 0;
    fixture.componentInstance.confirmed.subscribe((result) => emitted.push(result));
    fixture.componentInstance.cancelled.subscribe(() => cancelled++);
    await fixture.whenStable();
  };

  const type = async (element: HTMLInputElement, value: string): Promise<void> => {
    element.value = value;
    element.dispatchEvent(new Event('input'));
    await fixture.whenStable();
  };

  beforeEach(() => TestBed.configureTestingModule({ imports: [PayslipReview] }));

  it('precompila i campi dalla bozza, con gli importi in euro', async () => {
    await render();

    expect(field('period').value).toBe('2026-09');
    expect(field('employer').value).toBe('Acme Srl');
    expect(field('totalEarnings').value).toBe('2500,00');
    expect(field('net').value).toBe('2000,00');
    expect(field('workedHours').value).toBe('168');
    expect(host().querySelectorAll('table.items tbody tr').length).toBe(1);
    expect(host().textContent).toContain('Estrazione completa');
    expect(confirmButton().disabled).toBe(false);
  });

  it('mostra il messaggio dello stato e gli avvisi', async () => {
    await render(
      draft({ netCents: null }),
      analysis({
        status: 'incomplete',
        confidence: 'low',
        warnings: [{ code: 'NET_MISSING', field: 'netCents', message: 'Netto non trovato.' }]
      })
    );

    expect(host().textContent).toContain('Estrazione incompleta: completa i campi mancanti.');
    expect(host().textContent).toContain('Affidabilità bassa');
    expect(host().querySelector('.warnings')?.textContent).toContain('Netto non trovato.');
  });

  it('un valore obbligatorio mancante è segnalato e blocca la conferma', async () => {
    await render(draft({ netCents: null }), analysis({ status: 'incomplete' }));

    expect(field('net').getAttribute('aria-invalid')).toBe('true');
    expect(host().querySelector('#payslip-error-net')?.textContent).toContain('obbligatorio');
    expect(confirmButton().disabled).toBe(true);

    await type(field('net'), '2.000,00');

    expect(field('net').getAttribute('aria-invalid')).toBeNull();
    expect(confirmButton().disabled).toBe(false);
  });

  it('una voce senza descrizione blocca la conferma', async () => {
    await render();

    const description = host().querySelector<HTMLInputElement>(
      'input[aria-label="Descrizione della voce 1"]'
    )!;
    await type(description, '  ');

    expect(confirmButton().disabled).toBe(true);
  });

  it('una quantità non numerica in una voce mostra il messaggio e blocca la conferma', async () => {
    await render();

    const quantity = host().querySelector<HTMLInputElement>(
      'input[aria-label="Quantità della voce 1"]'
    )!;
    await type(quantity, 'abc');

    expect(quantity.getAttribute('aria-invalid')).toBe('true');
    expect(host().querySelector('table.items tbody tr .field-error')?.textContent).toBeTruthy();
    expect(confirmButton().disabled).toBe(true);
  });

  it('con un conflitto la conferma richiede di sostituire il cedolino esistente', async () => {
    await render(draft(), analysis({ conflict: { payslipId: 'p-9', period: '2026-09' } }));

    expect(host().textContent).toContain('Esiste già un cedolino per settembre 2026.');
    expect(confirmButton().disabled).toBe(true);

    host().querySelector<HTMLInputElement>('.conflict input')!.click();
    await fixture.whenStable();

    expect(confirmButton().disabled).toBe(false);
    confirmButton().click();

    expect(emitted[0].replaceExisting).toBe(true);
  });

  it('il conflitto segue il mese digitato, non solo quello letto dal PDF', async () => {
    await render(draft(), analysis(), ['2026-08']);

    expect(host().querySelector('.conflict')).toBeNull();
    await type(field('period'), '2026-08');

    expect(host().textContent).toContain('Esiste già un cedolino per agosto 2026.');
    expect(confirmButton().disabled).toBe(true);

    host().querySelector<HTMLInputElement>('.conflict input')!.click();
    await fixture.whenStable();
    confirmButton().click();

    expect(emitted[0].data.period).toBe('2026-08');
    expect(emitted[0].replaceExisting).toBe(true);
  });

  it('corretto il mese verso uno libero, il conflitto sparisce e non si sostituisce nulla', async () => {
    await render(draft(), analysis({ conflict: { payslipId: 'p-9', period: '2026-09' } }), [
      '2026-09'
    ]);

    host().querySelector<HTMLInputElement>('.conflict input')!.click();
    await fixture.whenStable();
    await type(field('period'), '2026-07');

    expect(host().querySelector('.conflict')).toBeNull();
    expect(confirmButton().disabled).toBe(false);
    confirmButton().click();

    expect(emitted[0].replaceExisting).toBe(false);
  });

  it('cambiando mese la sostituzione va confermata di nuovo', async () => {
    await render(draft(), analysis({ conflict: { payslipId: 'p-9', period: '2026-09' } }), [
      '2026-08',
      '2026-09'
    ]);

    host().querySelector<HTMLInputElement>('.conflict input')!.click();
    await fixture.whenStable();
    await type(field('period'), '2026-08');

    expect(host().querySelector<HTMLInputElement>('.conflict input')!.checked).toBe(false);
    expect(confirmButton().disabled).toBe(true);
  });

  it('in modifica, un mese già occupato da un altro cedolino blocca la conferma', async () => {
    await render(draft(), null, ['2026-08', '2026-09']);

    // Il mese del cedolino che si modifica è suo: nessun errore.
    expect(field('period').getAttribute('aria-invalid')).toBeNull();
    expect(confirmButton().disabled).toBe(false);

    await type(field('period'), '2026-08');

    expect(host().querySelector('#payslip-error-period')?.textContent).toContain(
      'Esiste già un cedolino'
    );
    expect(confirmButton().disabled).toBe(true);
  });

  it('un nuovo saldo prende il tipo ancora libero, e un tipo ripetuto blocca la conferma', async () => {
    await render();

    host().querySelector<HTMLButtonElement>('.add-leave')!.click();
    await fixture.whenStable();

    const types = host().querySelectorAll<HTMLSelectElement>('table.leaves select');
    expect(types[1].value).toBe('PAR');
    // Con FERIE e P.A.R. entrambi presenti non c'è un terzo saldo da aggiungere.
    expect(host().querySelector<HTMLButtonElement>('.add-leave')!.disabled).toBe(true);

    types[1].value = 'FERIE';
    types[1].dispatchEvent(new Event('change'));
    await fixture.whenStable();

    expect(host().textContent).toContain('Saldo già presente');
    expect(confirmButton().disabled).toBe(true);
  });

  it('emette centesimi interi e i valori corretti dall\'utente', async () => {
    await render();

    await type(field('totalEarnings'), '1.234,56');
    await type(field('totalDeductions'), '234.56');
    await type(field('net'), '1000');
    await type(field('rounding'), '0,1');
    await type(field('employer'), '');
    confirmButton().click();

    expect(emitted).toHaveLength(1);
    const { data, replaceExisting } = emitted[0];
    expect(replaceExisting).toBe(false);
    expect(data.totalEarningsCents).toBe(123456);
    expect(data.totalDeductionsCents).toBe(23456);
    expect(data.netCents).toBe(100000);
    expect(data.roundingCents).toBe(10);
    expect(data.employer).toBeNull();
    expect(data.taxableIrpefCents).toBeNull();
    expect(data.workedHours).toBe(168);
    expect(data.items[0]).toEqual({
      code: '0001',
      description: 'Retribuzione',
      section: 'earning',
      amountCents: 250000,
      quantity: 26,
      unit: 'giorni'
    });
    expect(data.leaveBalances[0]).toEqual({
      type: 'FERIE',
      accrued: 20,
      used: 60,
      remaining: -40,
      unit: 'ore'
    });
    expect(Object.values(data).filter((value) => typeof value === 'number')).toSatisfy(
      (numbers: number[]) => numbers.every((value) => Number.isFinite(value))
    );
  });

  it('aggiunge e rimuove una riga di voce', async () => {
    await render();

    host().querySelector<HTMLButtonElement>('.add-item')!.click();
    await fixture.whenStable();
    expect(host().querySelectorAll('table.items tbody tr').length).toBe(2);
    // La riga nuova è vuota: descrizione e importo mancano.
    expect(confirmButton().disabled).toBe(true);

    host().querySelector<HTMLButtonElement>('.remove-item[aria-label="Rimuovi la voce 2"]')!.click();
    await fixture.whenStable();
    expect(host().querySelectorAll('table.items tbody tr').length).toBe(1);
    expect(confirmButton().disabled).toBe(false);
  });

  it('aggiunge e rimuove un saldo di ferie o P.A.R.', async () => {
    await render();

    host().querySelector<HTMLButtonElement>('.add-leave')!.click();
    await fixture.whenStable();
    expect(host().querySelectorAll('table.leaves tbody tr').length).toBe(2);

    host().querySelector<HTMLButtonElement>('.remove-leave')!.click();
    await fixture.whenStable();
    host().querySelector<HTMLButtonElement>('.remove-leave')!.click();
    await fixture.whenStable();
    expect(host().textContent).toContain('Nessun saldo.');
    confirmButton().click();
    expect(emitted[0].data.leaveBalances).toEqual([]);
  });

  it('in modifica (senza analisi) non mostra stato né conflitto', async () => {
    await render(draft(), null);

    expect(host().querySelector('.status')).toBeNull();
    expect(host().querySelector('.conflict')).toBeNull();
    expect(confirmButton().textContent).toContain('Salva modifiche');
  });

  it('mostra il messaggio e l\'affidabilità per ogni stato di estrazione', async () => {
    await render(draft(), analysis({ status: 'complete', confidence: 'high' }));
    expect(host().querySelector('.status-message')?.textContent).toContain(
      'Estrazione completa: verifica i valori prima di confermare.'
    );
    expect(host().querySelector('.status-message')?.classList.contains('problem')).toBe(false);
    expect(host().textContent).toContain('Affidabilità alta');

    await render(draft(), analysis({ status: 'incomplete', confidence: 'medium' }));
    expect(host().querySelector('.status-message')?.textContent).toContain('Estrazione incompleta');
    expect(host().querySelector('.status-message')?.classList.contains('problem')).toBe(true);
    expect(host().textContent).toContain('Affidabilità media');

    await render(draft(), analysis({ status: 'unrecognized', confidence: 'low' }));
    expect(host().querySelector('.status-message')?.textContent).toContain(
      'Documento non riconosciuto o senza testo selezionabile: inserisci i dati a mano.'
    );
    expect(host().textContent).toContain('Affidabilità bassa');
  });

  it('elenca tutti gli avvisi dell\'estrazione e nessuna lista se non ce ne sono', async () => {
    await render(
      draft(),
      analysis({
        warnings: [
          { code: 'A', field: 'netCents', message: 'Primo avviso.' },
          { code: 'B', field: null, message: 'Secondo avviso.' }
        ]
      })
    );
    const warnings = [...host().querySelectorAll('.warnings li')].map((li) => li.textContent?.trim());
    expect(warnings).toEqual(['Primo avviso.', 'Secondo avviso.']);

    await render(draft(), analysis({ warnings: [] }));
    expect(host().querySelector('.warnings')).toBeNull();
  });

  it('un totale e una voce corretti a mano arrivano come centesimi interi', async () => {
    await render();

    await type(field('totalEarnings'), '2.700,05');
    await type(
      host().querySelector<HTMLInputElement>('input[aria-label="Descrizione della voce 1"]')!,
      'Retribuzione corretta'
    );
    await type(
      host().querySelector<HTMLInputElement>('input[aria-label="Importo della voce 1"]')!,
      '1.234,56'
    );
    confirmButton().click();

    const { data } = emitted[0];
    expect(data.totalEarningsCents).toBe(270005);
    expect(data.items[0].description).toBe('Retribuzione corretta');
    expect(data.items[0].amountCents).toBe(123456);
    expect(Number.isInteger(data.items[0].amountCents)).toBe(true);
  });

  it('un mese scritto a metà mostra «non valido», non «obbligatorio»', async () => {
    // Il campo month di jsdom svuota da sé i valori malformati: il testo storto arriva dalla bozza.
    await render(draft({ period: '2026-13' }));

    expect(host().querySelector('#payslip-error-period')?.textContent).toContain(
      'Valore non valido.'
    );
    expect(confirmButton().disabled).toBe(true);

    // «Obbligatorio» resta per il campo davvero vuoto.
    await render(draft({ period: null }));
    expect(host().querySelector('#payslip-error-period')?.textContent).toContain(
      'Valore obbligatorio.'
    );
  });

  it('un totale competenze negativo mostra l\'errore e blocca la conferma', async () => {
    await render();

    await type(field('totalEarnings'), '-100');

    expect(host().querySelector('#payslip-error-totalEarnings')?.textContent).toContain(
      'Il totale non può essere negativo.'
    );
    expect(confirmButton().disabled).toBe(true);

    await type(field('totalDeductions'), '-1');
    expect(host().querySelector('#payslip-error-totalDeductions')?.textContent).toContain(
      'Il totale non può essere negativo.'
    );
  });

  it('un importo o un valore decimale fuori scala blocca la conferma', async () => {
    await render();

    await type(field('net'), '100.000.001');
    expect(host().querySelector('#payslip-error-net')?.textContent).toContain('Valore fuori scala.');
    expect(confirmButton().disabled).toBe(true);

    await type(field('net'), '2.000,00');
    expect(confirmButton().disabled).toBe(false);

    await type(field('workedHours'), '1000001');
    expect(host().querySelector('#payslip-error-workedHours')?.textContent).toContain(
      'Valore fuori scala.'
    );
    expect(confirmButton().disabled).toBe(true);

    await type(field('workedHours'), '168');
    const quantity = host().querySelector<HTMLInputElement>(
      'input[aria-label="Quantità della voce 1"]'
    )!;
    await type(quantity, '-1000001');
    expect(host().querySelector('table.items tbody tr .field-error')?.textContent).toContain(
      'Valore fuori scala.'
    );
    expect(confirmButton().disabled).toBe(true);

    await type(quantity, '26');
    const accrued = host().querySelector<HTMLInputElement>(
      'input[aria-label="Maturato del saldo 1"]'
    )!;
    await type(accrued, '1000001');
    expect(host().querySelector('table.leaves tbody tr .field-error')?.textContent).toContain(
      'Valore fuori scala.'
    );
    expect(confirmButton().disabled).toBe(true);
  });

  it('un codice voce con spazi o troppo lungo mostra «Codice voce non valido.»', async () => {
    await render();
    const code = host().querySelector<HTMLInputElement>('input[aria-label="Codice della voce 1"]')!;

    await type(code, 'A B');
    expect(host().querySelector('table.items tbody tr .field-error')?.textContent).toContain(
      'Codice voce non valido.'
    );
    expect(confirmButton().disabled).toBe(true);

    await type(code, 'A'.repeat(17));
    expect(confirmButton().disabled).toBe(true);

    // Il codice è facoltativo, e questi caratteri sono ammessi.
    await type(code, 'AB.12/3_x-y');
    expect(confirmButton().disabled).toBe(false);
    await type(code, '');
    expect(confirmButton().disabled).toBe(false);
  });

  it('i testi troppo lunghi bloccano la conferma e mostrano il messaggio', async () => {
    await render();
    const itemUnit = host().querySelector<HTMLInputElement>('input[aria-label="Unità della voce 1"]')!;
    const leaveUnit = host().querySelector<HTMLInputElement>(
      'input[aria-label="Unità del saldo 1"]'
    )!;
    const description = host().querySelector<HTMLInputElement>(
      'input[aria-label="Descrizione della voce 1"]'
    )!;

    await type(itemUnit, 'x'.repeat(13));
    expect(host().querySelector('table.items tbody tr .field-error')?.textContent).toContain(
      'Testo troppo lungo (massimo 12 caratteri).'
    );
    expect(confirmButton().disabled).toBe(true);
    await type(itemUnit, 'x'.repeat(12));
    expect(confirmButton().disabled).toBe(false);

    await type(leaveUnit, 'x'.repeat(13));
    expect(host().querySelector('table.leaves tbody tr .field-error')?.textContent).toContain(
      'Testo troppo lungo (massimo 12 caratteri).'
    );
    expect(confirmButton().disabled).toBe(true);
    await type(leaveUnit, 'ore');

    await type(description, 'd'.repeat(201));
    expect(host().querySelector('table.items tbody tr .field-error')?.textContent).toContain(
      'Testo troppo lungo (massimo 200 caratteri).'
    );
    expect(confirmButton().disabled).toBe(true);
    await type(description, 'd'.repeat(200));
    expect(confirmButton().disabled).toBe(false);

    await type(field('employer'), 'e'.repeat(201));
    expect(host().querySelector('#payslip-error-employer')?.textContent).toContain(
      'Testo troppo lungo (massimo 200 caratteri).'
    );
    expect(confirmButton().disabled).toBe(true);
  });

  it('annulla sempre, anche con il form non valido', async () => {
    await render(draft({ netCents: null }));

    host().querySelector<HTMLButtonElement>('.cancel')!.click();

    expect(cancelled).toBe(1);
  });
});

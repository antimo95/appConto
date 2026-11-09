import { expect, test } from '@playwright/test';
import {
  LUGLIO,
  SERIE_COERENTE,
  SETTEMBRE_DOPO_LUGLIO,
  deleteAllPayslips,
  importPayslip,
  kpi,
  leavePanel,
  listPayslips,
  monthPanel,
  openPayslips,
  patchLeaveRemaining,
  payslipRows,
  pdfConFerie,
  uploadForReview,
} from './support/cedolini.js';

/**
 * Cedolini: selezione della riga e riepilogo complessivo di ferie e permessi.
 * Contratto: docs/superpowers/specs/2026-11-04-cedolini-selezione-e-riepilogo-ferie.md
 *
 * Tutti i PDF nascono dal costruttore sintetico (`syntheticPayslipPdf`): nessun
 * dato personale. I mesi sono caricati volutamente fuori ordine cronologico.
 */

test.beforeEach(async ({ request }) => {
  await deleteAllPayslips(request);
});

/** Importa ottobre, agosto, settembre (in questo ordine) e restituisce gli id per periodo. */
async function importaFuoriOrdine(request: Parameters<typeof importPayslip>[0]): Promise<Record<string, string>> {
  const ids: Record<string, string> = {};
  for (const options of [SERIE_COERENTE.ottobre, SERIE_COERENTE.agosto, SERIE_COERENTE.settembre]) {
    const saved = await importPayslip(request, pdfConFerie(options));
    ids[saved.period] = saved.id;
  }
  return ids;
}

test.describe('Cedolini: selezione e riepilogo ferie', () => {
  test("a-b. tre cedolini caricati dall'interfaccia fuori ordine: ogni riga si seleziona da una cella qualunque", async ({
    page,
    request,
  }) => {
    await openPayslips(page);
    for (const options of [SERIE_COERENTE.ottobre, SERIE_COERENTE.agosto, SERIE_COERENTE.settembre]) {
      const review = await uploadForReview(page, pdfConFerie(options));
      await review.getByRole('button', { name: 'Conferma e salva' }).click();
      await expect(review).toBeHidden();
    }

    // Ordine di caricamento ≠ ordine dei periodi: la lista segue il periodo.
    await expect(payslipRows(page)).toHaveCount(3);
    await expect(payslipRows(page).getByRole('button')).toHaveText(['ottobre 2026', 'settembre 2026', 'agosto 2026']);
    const salvati = await listPayslips(request);
    expect(salvati.map((item) => item.period)).toEqual(['2026-10', '2026-09', '2026-08']);

    const casi = [
      { riga: 2, periodo: '2026-08', mese: 'agosto 2026', ferie: '46 ore', par: '2 ore' },
      { riga: 1, periodo: '2026-09', mese: 'settembre 2026', ferie: '44 ore', par: '3 ore' },
      { riga: 0, periodo: '2026-10', mese: 'ottobre 2026', ferie: '45 ore', par: '4 ore' },
      { riga: 1, periodo: '2026-09', mese: 'settembre 2026', ferie: '44 ore', par: '3 ore' },
    ];
    for (const caso of casi) {
      // Click sulla cella del Netto, non sul pulsante del mese.
      await payslipRows(page).nth(caso.riga).getByRole('cell').nth(1).click();

      await expect(page).toHaveURL(new RegExp(`period=${caso.periodo}$`));
      await expect(monthPanel(page, caso.mese)).toBeVisible();
      await expect(kpi(page, caso.mese, 'Ferie residue')).toContainText(caso.ferie);
      await expect(kpi(page, caso.mese, 'P.A.R. residui')).toContainText(caso.par);
      // Un solo cedolino attivo, ed è quello cliccato.
      await expect(page.locator('table.payslips tbody tr.selected')).toHaveCount(1);
      await expect(payslipRows(page).nth(caso.riga)).toHaveClass(/selected/);
      await expect(page.locator('table.payslips button.month[aria-current="true"]')).toHaveCount(1);
      await expect(payslipRows(page).nth(caso.riga).getByRole('button')).toHaveAttribute('aria-current', 'true');
    }

    // Indietro e avanti: vale l'URL.
    await page.goBack();
    await expect(page).toHaveURL(/period=2026-10$/);
    await expect(payslipRows(page).nth(0)).toHaveClass(/selected/);
    await expect(kpi(page, 'ottobre 2026', 'Ferie residue')).toContainText('45 ore');
    await page.goForward();
    await expect(page).toHaveURL(/period=2026-09$/);
    await expect(payslipRows(page).nth(1)).toHaveClass(/selected/);
  });

  test('b. dalla tastiera il pulsante del mese seleziona con Invio e con Spazio', async ({ page, request }) => {
    await importaFuoriOrdine(request);
    await openPayslips(page);

    const agosto = payslipRows(page).getByRole('button', { name: 'agosto 2026' });
    await agosto.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/period=2026-08$/);
    await expect(agosto).toHaveAttribute('aria-current', 'true');

    const settembre = payslipRows(page).getByRole('button', { name: 'settembre 2026' });
    await settembre.focus();
    await page.keyboard.press('Space');
    await expect(page).toHaveURL(/period=2026-09$/);
    await expect(settembre).toHaveAttribute('aria-current', 'true');
    await expect(agosto).not.toHaveAttribute('aria-current', 'true');
  });

  test('c. il riepilogo complessivo mostra periodo, cedolini, ultimi residui e stato «Coerente»', async ({
    page,
    request,
  }) => {
    await importaFuoriOrdine(request);
    await openPayslips(page);

    const riepilogo = leavePanel(page);
    await expect(riepilogo).toBeVisible();
    await expect(riepilogo).toContainText('agosto 2026');
    await expect(riepilogo).toContainText('ottobre 2026');
    await expect(riepilogo).toContainText(/\b3\b/);
    await expect(riepilogo).toContainText('Ferie');
    await expect(riepilogo).toContainText('P.A.R.');
    // Ultimo residuo: ottobre.
    await expect(riepilogo).toContainText('45 ore');
    await expect(riepilogo).toContainText('4 ore');
    // Maturato e goduto dell'anno: l'ultimo progressivo, non una somma.
    await expect(riepilogo).toContainText('2026');
    await expect(riepilogo).toContainText(/\b13\b/);
    await expect(riepilogo.getByText('Coerente').first()).toBeVisible();
    await expect(riepilogo.getByText('Anomalia', { exact: true })).toHaveCount(0);
    await expect(riepilogo.getByRole('button', { name: 'Vai al cedolino' })).toHaveCount(0);

    // Il pannello sta in alto, prima dell'elenco e del mese selezionato.
    const titoli = (
      await page.locator('section').evaluateAll((sezioni) =>
        sezioni.map((s) => s.querySelector('h2')?.textContent?.trim() ?? ''),
      )
    ).filter(Boolean);
    expect(titoli.indexOf('Riepilogo ferie e permessi')).toBeGreaterThanOrEqual(0);
    expect(titoli.indexOf('Riepilogo ferie e permessi')).toBeLessThan(titoli.indexOf('Cedolini importati'));
    expect(titoli.indexOf('Cedolini importati')).toBeLessThan(titoli.indexOf('ottobre 2026'));

    // Il riepilogo arriva da `leave` e non è salvato.
    const sintesi = await (await request.get('/api/payslip-summaries')).json();
    expect(sintesi.leave.coverage).toMatchObject({
      from: '2026-08',
      to: '2026-10',
      payslipCount: 3,
      missingPeriods: [],
    });
  });

  test('d. una correzione che rompe la continuità mostra «Anomalia» e «Vai al cedolino» porta a quel mese', async ({
    page,
    request,
  }) => {
    const ids = await importaFuoriOrdine(request);
    // Settembre: residuo ferie 40 invece di 44 (atteso 44, rilevato 40, differenza −4).
    await patchLeaveRemaining(request, ids['2026-09']!, 'FERIE', 40);
    await openPayslips(page);

    const riepilogo = leavePanel(page);
    await expect(riepilogo.getByText('Anomalia').first()).toBeVisible();

    const riga = riepilogo
      .locator('xpath=.//*[self::tr or self::li or self::article][.//button[normalize-space()="Vai al cedolino"]]')
      .filter({ hasText: 'settembre 2026' });
    await expect(riga).toHaveCount(1);
    await expect(riga).toContainText(/\b44\b/);
    await expect(riga).toContainText(/\b40\b/);
    await expect(riga).toContainText(/[−-]\s?4\b/);

    // Si parte da ottobre (default): il pulsante porta a settembre.
    await expect(page).not.toHaveURL(/period=2026-09/);
    await riga.getByRole('button', { name: 'Vai al cedolino' }).click();
    await expect(page).toHaveURL(/period=2026-09$/);
    await expect(monthPanel(page, 'settembre 2026')).toBeVisible();
    await expect(kpi(page, 'settembre 2026', 'Ferie residue')).toContainText('40 ore');
    await expect(payslipRows(page).nth(1)).toHaveClass(/selected/);
  });

  test("e. un mese mancante è elencato e, con valori coerenti, non produce un'anomalia", async ({
    page,
    request,
  }) => {
    await importPayslip(request, pdfConFerie(LUGLIO));
    await importPayslip(request, pdfConFerie(SETTEMBRE_DOPO_LUGLIO));
    await openPayslips(page);
    await expect(payslipRows(page)).toHaveCount(2);

    const riepilogo = leavePanel(page);
    await expect(riepilogo).toContainText(/mancant/i);
    await expect(riepilogo).toContainText('agosto 2026');
    await expect(riepilogo.getByText('Anomalia', { exact: true })).toHaveCount(0);
    await expect(riepilogo.getByRole('button', { name: 'Vai al cedolino' })).toHaveCount(0);

    const sintesi = await (await request.get('/api/payslip-summaries')).json();
    expect(sintesi.leave.coverage.missingPeriods).toEqual(['2026-08']);
    expect(sintesi.leave.anomalies).toEqual([]);
  });

  test('f. nessun dato personale: tutti i cedolini vengono dal costruttore sintetico', async ({ request }) => {
    const ids = await importaFuoriOrdine(request);

    for (const id of Object.values(ids)) {
      const dettaglio = (await (await request.get(`/api/payslips/${id}`)).json()) as {
        employer: string | null;
        fileName: string;
      };
      expect(dettaglio.employer).toBe('Esempio Lavoro S.r.l.');
      expect(dettaglio.fileName).toMatch(/^cedolino-(agosto|settembre|ottobre)-2026\.pdf$/);
    }
  });
});

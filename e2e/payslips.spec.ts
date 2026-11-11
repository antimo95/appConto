import { expect, test } from '@playwright/test';
import {
  deleteAllPayslips,
  fileDiTesto,
  fileInput,
  importPayslip,
  kpi,
  listPayslips,
  monthPanel,
  openPayslips,
  payslipRows,
  pdfCorrotto,
  pdfOttobre,
  pdfOttobreRistampa,
  pdfSettembre,
  pdfSettembreVariante,
  reviewPanel,
  uploadForReview,
} from './support/cedolini.js';

/**
 * Cedolini, end-to-end: interfaccia Angular compilata + backend reale su una
 * cartella dati temporanea. Ogni test parte da un archivio senza cedolini e
 * usa mesi fissi; i PDF sono sintetici.
 *
 * Gli importi seguono `Intl` it-IT, che non raggruppa le migliaia sotto le
 * cinque cifre: 1.698,00 € si legge «1698,00 €».
 */

test.beforeEach(async ({ request }) => {
  await deleteAllPayslips(request);
});

test.describe('Cedolini', () => {
  test('1. si apre dal menu laterale', async ({ page }) => {
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: 'Navigazione principale' });
    await nav.getByRole('link', { name: 'Cedolini' }).click();

    await expect(page).toHaveURL(/\/payslips$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Cedolini' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Archivio' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Cedolini' })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByText('Nessun cedolino importato.')).toBeVisible();
  });

  test('2-3-5-6. carica dal pulsante, mostra la bozza, conferma e mostra il riepilogo', async ({ page }) => {
    await openPayslips(page);

    // 2. Il pulsante apre la scelta del file; il file passa dal campo nascosto.
    await expect(fileInput(page)).toBeHidden();
    await expect(fileInput(page)).toHaveAttribute('accept', 'application/pdf,.pdf');
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Carica cedolino' }).first().click();
    const analysis = page.waitForResponse(
      (r) => r.url().endsWith('/api/payslip-analyses') && r.request().method() === 'POST',
    );
    await (await chooser).setFiles(pdfOttobre());
    expect((await analysis).status()).toBe(201);

    // 3. La bozza estratta.
    const review = reviewPanel(page);
    await expect(review).toBeVisible();
    await expect(review.getByText('Estrazione completa: verifica i valori prima di confermare.')).toBeVisible();
    await expect(review.getByText('Affidabilità alta')).toBeVisible();
    await expect(review.getByText('cedolino-ottobre-2026.pdf')).toBeVisible();
    await expect(review.getByLabel('Mese di competenza')).toHaveValue('2026-10');
    await expect(review.getByLabel('Totale competenze (€)')).toHaveValue('2180,00');
    await expect(review.getByLabel('Totale trattenute (€)')).toHaveValue('482,35');
    await expect(review.getByLabel('Netto in busta (€)')).toHaveValue('1698,00');
    await expect(review.getByLabel('Descrizione della voce 1', { exact: true })).toHaveValue('Retribuzione');
    await expect(review.getByLabel('Residuo del saldo 1', { exact: true })).toHaveValue('45,5');
    await expect(review.getByLabel('Residuo del saldo 2', { exact: true })).toHaveValue('2');
    // Durante la revisione non si carica un altro PDF.
    await expect(page.getByRole('button', { name: 'Carica cedolino' })).toBeDisabled();

    // 5. Conferma: il cedolino entra nella lista.
    await review.getByRole('button', { name: 'Conferma e salva' }).click();
    await expect(review).toBeHidden();
    await expect(page).toHaveURL(/\/payslips\?period=2026-10$/);
    await expect(payslipRows(page)).toHaveCount(1);
    const row = payslipRows(page).first();
    await expect(row.getByRole('button', { name: 'ottobre 2026' })).toHaveAttribute('aria-current', 'true');
    // L'elenco mostra mese e netto; competenze e trattenute sono nei KPI qui sotto.
    await expect(row.getByRole('cell')).toHaveText(['ottobre 2026', '1698,00 €']);

    // 6. Il riepilogo del mese con i valori del cedolino sintetico.
    const mese = 'ottobre 2026';
    await expect(kpi(page, mese, 'Netto')).toContainText('1698,00 €');
    await expect(kpi(page, mese, 'Competenze')).toContainText('2180,00 €');
    await expect(kpi(page, mese, 'Trattenute')).toContainText('482,35 €');
    await expect(kpi(page, mese, 'Ferie residue')).toContainText('45,5 ore');
    await expect(kpi(page, mese, 'P.A.R. residui')).toContainText('2 ore');
    // Un solo mese: nessun confronto possibile.
    await expect(page.getByText('Nessun cedolino precedente da confrontare.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Modifica' })).toBeVisible();
  });

  test('3-bis. il datore di lavoro viene estratto dal PDF', async ({ page }) => {
    // pdfjs-dist fonde le etichette vicine «CodicesAzienda» e «RagionesSociale»
    // in un solo elemento: il lettore deve trovare «Ragione sociale» anche
    // dentro quell'elemento, e leggere il valore sotto la sua posizione.
    await openPayslips(page);
    const review = await uploadForReview(page, pdfOttobre());
    await expect(review.getByLabel('Datore di lavoro')).toHaveValue('Esempio Lavoro S.r.l.', { timeout: 2_000 });
  });

  test('4. un valore corretto a mano prima della conferma viene salvato', async ({ page, request }) => {
    await openPayslips(page);
    const review = await uploadForReview(page, pdfOttobre());

    const netto = review.getByLabel('Netto in busta (€)');
    await netto.fill('');
    await expect(review.getByText('Valore obbligatorio.')).toBeVisible();
    await expect(review.getByRole('button', { name: 'Conferma e salva' })).toBeDisabled();
    await netto.fill('1.700,50');
    await expect(review.getByRole('alert')).toHaveCount(0);

    await review.getByRole('button', { name: 'Conferma e salva' }).click();
    await expect(review).toBeHidden();

    await expect(payslipRows(page).first().getByRole('cell').nth(1)).toHaveText('1700,50 €');
    await expect(kpi(page, 'ottobre 2026', 'Netto')).toContainText('1700,50 €');
    // Gli altri valori restano quelli estratti.
    await expect(kpi(page, 'ottobre 2026', 'Competenze')).toContainText('2180,00 €');

    const [salvato] = await listPayslips(request);
    const detail = await (await request.get(`/api/payslips/${salvato!.id}`)).json();
    expect(detail).toMatchObject({ period: '2026-10', netCents: 170050, totalEarningsCents: 218000 });
  });

  test('7. confronto fra settembre e ottobre', async ({ page }) => {
    await openPayslips(page);

    for (const file of [pdfSettembre(), pdfOttobre()]) {
      const review = await uploadForReview(page, file);
      await review.getByRole('button', { name: 'Conferma e salva' }).click();
      await expect(review).toBeHidden();
    }

    // L'ultimo confermato è selezionato; la lista è dal più recente.
    await expect(page).toHaveURL(/period=2026-10$/);
    await expect(payslipRows(page)).toHaveCount(2);
    await expect(payslipRows(page).getByRole('button')).toHaveText(['ottobre 2026', 'settembre 2026']);

    const mese = 'ottobre 2026';
    await expect(kpi(page, mese, 'Netto')).toContainText('1698,00 €');
    await expect(kpi(page, mese, 'Netto')).toContainText('+6,3%');
    await expect(kpi(page, mese, 'Netto')).toContainText('rispetto a settembre 2026');

    const confronto = monthPanel(page, 'Confronto con il mese precedente');
    await expect(confronto.getByText('ottobre 2026 rispetto a settembre 2026')).toBeVisible();
    const deltas = confronto.getByRole('listitem');
    await expect(deltas).toHaveText([
      'Netto +100,00 € (+6,3%)',
      'Competenze +100,00 € (+4,8%)',
      'Trattenute 0,00 € (0%)',
    ]);

    const voci = confronto.getByRole('row');
    const voce = (nome: string) => voci.filter({ has: page.getByRole('cell', { name: nome, exact: true }) });
    await expect(voce('Retribuzione Variata')).toContainText('2020,00 €');
    await expect(voce('Retribuzione Variata')).toContainText('2100,00 €');
    await expect(voce('Retribuzione Variata')).toContainText('+80,00 €');
    await expect(voce('Indennità L.207/24 Nuova')).toContainText('80,00 €');
    await expect(voce('Premio produzione Scomparsa')).toContainText('60,00 €');
    // Solo le voci che si sono mosse.
    await expect(voci).toHaveCount(1 + 3);

    // Settembre non ha un mese precedente.
    await payslipRows(page).getByRole('button', { name: 'settembre 2026' }).click();
    await expect(page).toHaveURL(/period=2026-09$/);
    await expect(kpi(page, 'settembre 2026', 'Netto')).toContainText('1598,00 €');
    await expect(kpi(page, 'settembre 2026', 'Competenze')).toContainText('2080,00 €');
    await expect(page.getByText('Nessun cedolino precedente da confrontare.')).toBeVisible();
  });

  test('8. un secondo cedolino per lo stesso mese chiede la sostituzione', async ({ page, request }) => {
    const originale = await importPayslip(request, pdfOttobre());
    await openPayslips(page);
    await expect(payslipRows(page)).toHaveCount(1);

    const review = await uploadForReview(page, pdfOttobreRistampa());
    await expect(review.getByText('Esiste già un cedolino ordinario per ottobre 2026.')).toBeVisible();
    const conferma = review.getByRole('button', { name: 'Conferma e salva' });
    const sostituisci = review.getByRole('checkbox', { name: 'Sostituisci il cedolino esistente' });
    await expect(sostituisci).not.toBeChecked();
    await expect(conferma).toBeDisabled();

    await sostituisci.check();
    await expect(conferma).toBeEnabled();
    await sostituisci.uncheck();
    await expect(conferma).toBeDisabled();
    await sostituisci.check();

    await review.getByLabel('Netto in busta (€)').fill('1699,00');
    await conferma.click();
    await expect(review).toBeHidden();

    await expect(payslipRows(page)).toHaveCount(1);
    await expect(kpi(page, 'ottobre 2026', 'Netto')).toContainText('1699,00 €');
    await expect(page.getByText('cedolino-ottobre-2026-ristampa.pdf')).toBeVisible();

    const dopo = await listPayslips(request);
    expect(dopo).toHaveLength(1);
    expect(dopo[0]!.id).not.toBe(originale.id);
    expect((await request.get(`/api/payslips/${originale.id}`)).status()).toBe(404);
  });

  test('9. annullare l\'analisi chiude la revisione e non tocca la lista', async ({ page, request }) => {
    await importPayslip(request, pdfSettembre());
    await openPayslips(page);
    await expect(payslipRows(page)).toHaveCount(1);

    const analysisResponse = page.waitForResponse(
      (r) => r.url().endsWith('/api/payslip-analyses') && r.request().method() === 'POST',
    );
    const review = await uploadForReview(page, pdfOttobre());
    const { id, draft } = await (await analysisResponse).json();

    const scarto = page.waitForResponse(
      (r) => r.url().endsWith(`/api/payslip-analyses/${id}`) && r.request().method() === 'DELETE',
    );
    await review.getByRole('button', { name: 'Annulla' }).click();
    expect((await scarto).status()).toBe(204);

    await expect(review).toBeHidden();
    await expect(page.getByRole('button', { name: 'Carica cedolino' })).toBeEnabled();
    await expect(payslipRows(page)).toHaveCount(1);
    await expect(payslipRows(page).getByRole('button')).toHaveText(['settembre 2026']);

    // L'analisi annullata non si può più confermare.
    const tardiva = await request.post('/api/payslips', { data: { analysisId: id, ...draft } });
    expect(tardiva.status()).toBe(404);
    expect((await tardiva.json()).error).toBe('Analisi non trovata o scaduta: carica di nuovo il PDF.');

    expect((await listPayslips(request)).map((item) => item.period)).toEqual(['2026-09']);
  });

  test('10. eliminazione con conferma del browser', async ({ page, request }) => {
    await importPayslip(request, pdfSettembre());
    await importPayslip(request, pdfOttobre());
    await openPayslips(page);
    await expect(payslipRows(page)).toHaveCount(2);
    const dettaglio = monthPanel(page, 'Dettaglio');

    // Rifiutare la conferma non elimina nulla.
    page.once('dialog', (dialog) => dialog.dismiss());
    await dettaglio.getByRole('button', { name: 'Elimina' }).click();
    await expect(payslipRows(page)).toHaveCount(2);

    const messaggi: string[] = [];
    page.on('dialog', (dialog) => {
      messaggi.push(dialog.message());
      void dialog.accept();
    });

    await dettaglio.getByRole('button', { name: 'Elimina' }).click();
    await expect(payslipRows(page)).toHaveCount(1);
    await expect(payslipRows(page).getByRole('button')).toHaveText(['settembre 2026']);
    // La selezione torna al mese più recente rimasto.
    await expect(kpi(page, 'settembre 2026', 'Netto')).toContainText('1598,00 €');

    await dettaglio.getByRole('button', { name: 'Elimina' }).click();
    await expect(page.getByText('Nessun cedolino importato.')).toBeVisible();
    await expect(payslipRows(page)).toHaveCount(0);

    expect(messaggi).toEqual([
      'Eliminare il cedolino di ottobre 2026?',
      'Eliminare il cedolino di settembre 2026?',
    ]);
    expect(await listPayslips(request)).toEqual([]);
  });

  test.describe('11. messaggi di errore', () => {
    test('un file che non è un PDF viene rifiutato senza caricarlo', async ({ page }) => {
      await openPayslips(page);
      const richieste: string[] = [];
      page.on('request', (r) => {
        if (r.url().includes('/api/payslip-analyses')) richieste.push(r.url());
      });

      await fileInput(page).setInputFiles(fileDiTesto());

      await expect(page.getByRole('alert')).toHaveText('Il file scelto non è un PDF.');
      await expect(reviewPanel(page)).toBeHidden();
      expect(richieste).toEqual([]);
    });

    test('un PDF danneggiato mostra il messaggio del backend', async ({ page }) => {
      await openPayslips(page);
      const risposta = page.waitForResponse(
        (r) => r.url().endsWith('/api/payslip-analyses') && r.request().method() === 'POST',
      );

      await fileInput(page).setInputFiles(pdfCorrotto());

      expect((await risposta).status()).toBe(400);
      await expect(page.getByRole('alert')).toHaveText('Il file non è un PDF valido oppure è danneggiato.');
      await expect(reviewPanel(page)).toBeHidden();
      await expect(page.getByRole('button', { name: 'Carica cedolino' }).first()).toBeEnabled();
      await expect(page.getByText('Nessun cedolino importato.')).toBeVisible();
    });

    test("un'analisi scaduta non si può più confermare", async ({ page, request }) => {
      await openPayslips(page);
      const analysisResponse = page.waitForResponse(
        (r) => r.url().endsWith('/api/payslip-analyses') && r.request().method() === 'POST',
      );
      const review = await uploadForReview(page, pdfOttobre());
      const { id } = await (await analysisResponse).json();

      // L'analisi sparisce fra la revisione e la conferma.
      expect((await request.delete(`/api/payslip-analyses/${id}`)).status()).toBe(204);

      await review.getByLabel('Netto in busta (€)').fill('1700,00');
      await review.getByRole('button', { name: 'Conferma e salva' }).click();

      // Un 404 non è un errore di salvataggio: la revisione mostra l'avviso dell'analisi scaduta.
      await expect(page.getByRole('alert')).toHaveCount(1);
      await expect(page.getByRole('alert')).toContainText(
        "L'analisi è scaduta: il PDF non è più sul server. I valori che hai scritto sono conservati.",
      );
      await expect(page.getByRole('alert').getByRole('button', { name: 'Ricarica il PDF' })).toBeEnabled();
      // La revisione resta aperta con i valori corretti a mano.
      await expect(review).toBeVisible();
      await expect(review.getByLabel('Netto in busta (€)')).toHaveValue('1700,00');
      expect(await listPayslips(request)).toEqual([]);
    });
  });

  test.describe('12. tipi, modifica, PDF, file grande e modifiche non salvate', () => {
    test("una tredicesima dello stesso mese convive con l'ordinario e non cambia il confronto", async ({
      page,
      request,
    }) => {
      await importPayslip(request, pdfSettembre());
      await importPayslip(request, pdfOttobre());
      await openPayslips(page);
      await expect(payslipRows(page)).toHaveCount(2);

      const review = await uploadForReview(page, pdfSettembreVariante());
      const conflitto = review.getByText('Esiste già un cedolino ordinario per settembre 2026.');
      await expect(conflitto).toBeVisible();
      await review.getByLabel('Tipo di cedolino').selectOption({ label: 'Tredicesima' });
      await expect(conflitto).toBeHidden();
      await review.getByRole('button', { name: 'Conferma e salva' }).click();
      await expect(review).toBeHidden();

      await expect(page).toHaveURL(/period=2026-09&kind=thirteenth$/);
      await expect(payslipRows(page)).toHaveCount(3);
      await expect(payslipRows(page).getByRole('button', { name: 'settembre 2026' })).toHaveCount(2);
      await expect(payslipRows(page).filter({ hasText: 'Tredicesima' })).toHaveCount(1);
      await expect(payslipRows(page).filter({ hasText: 'Tredicesima' })).toContainText('1600,00 €');
      await expect(page.getByText('Il confronto riguarda solo i cedolini ordinari.')).toBeVisible();

      // Il confronto di ottobre resta quello con il settembre ordinario.
      await payslipRows(page).getByRole('button', { name: 'ottobre 2026' }).click();
      await expect(page).toHaveURL(/\/payslips\?period=2026-10$/);
      await expect(kpi(page, 'ottobre 2026', 'Netto')).toContainText('+6,3%');
      await expect(kpi(page, 'ottobre 2026', 'Netto')).toContainText('rispetto a settembre 2026');
      const confronto = monthPanel(page, 'Confronto con il mese precedente');
      await expect(confronto.getByRole('listitem')).toHaveText([
        'Netto +100,00 € (+6,3%)',
        'Competenze +100,00 € (+4,8%)',
        'Trattenute 0,00 € (0%)',
      ]);
    });

    test("un valore modificato dall'interfaccia resta dopo il ricaricamento", async ({ page, request }) => {
      await importPayslip(request, pdfOttobre());
      await openPayslips(page);

      const dettaglio = monthPanel(page, 'Dettaglio');
      await dettaglio.getByRole('button', { name: 'Modifica' }).click();
      await dettaglio.getByLabel('Netto in busta (€)').fill('1705,25');
      await dettaglio.getByRole('button', { name: 'Salva modifiche' }).click();

      await expect(dettaglio.getByRole('button', { name: 'Modifica' })).toBeVisible();
      await expect(kpi(page, 'ottobre 2026', 'Netto')).toContainText('1705,25 €');

      await page.reload();
      await expect(page.getByText('Caricamento in corso…')).toHaveCount(0);
      await expect(kpi(page, 'ottobre 2026', 'Netto')).toContainText('1705,25 €');
      await expect(payslipRows(page).first().getByRole('cell').nth(1)).toHaveText('1705,25 €');
      const [salvato] = await listPayslips(request);
      expect(await (await request.get(`/api/payslips/${salvato!.id}`)).json()).toMatchObject({ netCents: 170525 });
    });

    test('il PDF originale si apre dal dettaglio', async ({ page, request }) => {
      const { id } = await importPayslip(request, pdfOttobre());
      await openPayslips(page);

      const href = await monthPanel(page, 'Dettaglio').getByRole('link', { name: 'Apri PDF' }).getAttribute('href');
      expect(href).toBe(`/api/payslips/${id}/document`);

      const risposta = await page.request.get(href!);
      expect(risposta.status()).toBe(200);
      expect(risposta.headers()['content-type']).toContain('application/pdf');
      expect(risposta.headers()['content-disposition']).toContain('cedolino-2026-10.pdf');
      expect((await risposta.body()).subarray(0, 4).toString('latin1')).toBe('%PDF');
    });

    test("un file oltre 10 MB viene rifiutato senza chiedere l'analisi", async ({ page }) => {
      await openPayslips(page);
      const richieste: string[] = [];
      page.on('request', (r) => {
        if (r.url().includes('/api/payslip-analyses')) richieste.push(r.url());
      });

      await fileInput(page).setInputFiles({
        name: 'enorme.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.alloc(10 * 1024 * 1024 + 1),
      });

      await expect(page.getByRole('alert')).toHaveText('Il file supera il limite di 10 MB.');
      await expect(reviewPanel(page)).toBeHidden();
      expect(richieste).toEqual([]);
    });

    test('cambiare mese con una modifica non salvata chiede conferma e, rifiutando, lascia il modulo aperto', async ({
      page,
      request,
    }) => {
      await importPayslip(request, pdfSettembre());
      await importPayslip(request, pdfOttobre());
      await openPayslips(page);

      const dettaglio = monthPanel(page, 'Dettaglio');
      await dettaglio.getByRole('button', { name: 'Modifica' }).click();
      const netto = dettaglio.getByLabel('Netto in busta (€)');
      await netto.fill('1111,00');

      const messaggi: string[] = [];
      page.once('dialog', (dialog) => {
        messaggi.push(dialog.message());
        void dialog.dismiss();
      });
      await payslipRows(page).getByRole('button', { name: 'settembre 2026' }).click();

      await expect.poll(() => messaggi).toEqual(['Hai modifiche non salvate. Scartarle?']);
      await expect(monthPanel(page, 'ottobre 2026')).toBeVisible();
      await expect(netto).toHaveValue('1111,00');
      await expect(dettaglio.getByRole('button', { name: 'Salva modifiche' })).toBeVisible();
    });
  });
});

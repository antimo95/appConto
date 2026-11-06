import { expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import {
  syntheticPayslipPdf,
  type FixtureLine,
} from '../../apps/backend/src/modules/payslips/testing/payslip-fixtures.js';

/**
 * PDF sintetici e scorciatoie per i test e2e dei cedolini.
 *
 * Nessun cedolino vero: i PDF nascono a ogni test dal costruttore usato dai
 * test del backend (`payslip-fixtures.ts`), con nomi e importi di fantasia.
 */

export interface PdfFile {
  readonly name: string;
  readonly mimeType: string;
  readonly buffer: Buffer;
}

const pdf = (name: string, buffer: Buffer): PdfFile => ({
  name,
  mimeType: 'application/pdf',
  buffer,
});

/**
 * Ottobre 2026, il cedolino di riferimento: netto 1.698,00 €, competenze
 * 2.180,00 €, trattenute 482,35 €, ferie residue 45,5 ore, P.A.R. residui 2 ore.
 */
export function pdfOttobre(): PdfFile {
  return pdf('cedolino-ottobre-2026.pdf', syntheticPayslipPdf({ month: 'Ottobre 2026' }));
}

/**
 * Settembre 2026: la retribuzione è 2.020,00 € invece di 2.100,00, manca
 * l'indennità L.207/24 (80,00 €) e c'è un premio di produzione (60,00 €) che
 * a ottobre non ci sarà. I conti tornano: competenze 2.080,00 €, trattenute
 * invariate (482,35 €), netto 1.598,00 €.
 *
 * Rispetto a settembre, quindi, ottobre ha: netto +100,00 €, competenze
 * +100,00 €, trattenute 0; Retribuzione «Variata», Indennità «Nuova»,
 * Premio produzione «Scomparsa».
 */
export function pdfSettembre(): PdfFile {
  const edit = (lines: FixtureLine[]): FixtureLine[] => [
    ...lines
      // Via la riga dell'indennità (descrizione e importo).
      .filter(([y]) => y !== 442.0 && y !== 441.9)
      .map((line): FixtureLine => {
        const [y, x] = line;
        if (y === 545.9 && x === 537.4) return [y, x, '2.020,00'];
        if (y === 136.4 && x === 546.8) return [y, x, '2.080,00'];
        if (y === 93.5 && x === 510.2) return [y, x, '1.598,00 €'];
        return line;
      }),
    [421.2, 38.7, 'Z50000 Premio produzione'],
    [421.1, 541.0, '60,00'],
  ];

  return pdf('cedolino-settembre-2026.pdf', syntheticPayslipPdf({ month: 'Settembre 2026', edit }));
}

/**
 * Un secondo PDF di ottobre 2026: stessi valori, ma un file diverso (un hash
 * diverso), come una ristampa con una nota in più.
 */
export function pdfOttobreRistampa(): PdfFile {
  return pdf(
    'cedolino-ottobre-2026-ristampa.pdf',
    syntheticPayslipPdf({
      month: 'Ottobre 2026',
      edit: (lines) => [...lines, [60, 30, 'Ristampa']],
    }),
  );
}

/** Intestazione PDF valida, corpo illeggibile: deve fallire dentro `pdfjs-dist`. */
export function pdfCorrotto(): PdfFile {
  return pdf(
    'cedolino-corrotto.pdf',
    Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 9 0 R\nquesto non è un PDF\n%%EOF\n', 'latin1'),
  );
}

/** Un file che non è un PDF né per tipo né per estensione. */
export function fileDiTesto(): PdfFile {
  return { name: 'note.txt', mimeType: 'text/plain', buffer: Buffer.from('non sono un cedolino\n') };
}

// --- API pubblica: preparazione e pulizia dello stato ----------------------

interface PayslipSummary {
  readonly id: string;
  readonly period: string;
}

export async function listPayslips(request: APIRequestContext): Promise<PayslipSummary[]> {
  const response = await request.get('/api/payslips');
  expect(response.ok()).toBe(true);

  return ((await response.json()) as { items: PayslipSummary[] }).items;
}

/** Ogni test parte da un archivio senza cedolini. */
export async function deleteAllPayslips(request: APIRequestContext): Promise<void> {
  for (const item of await listPayslips(request)) {
    const response = await request.delete(`/api/payslips/${item.id}`);
    expect(response.status(), `eliminazione del cedolino ${item.period}`).toBe(204);
  }
  expect(await listPayslips(request)).toEqual([]);
}

/** Importa un cedolino senza passare dall'interfaccia: analisi, poi conferma della bozza. */
export async function importPayslip(request: APIRequestContext, file: PdfFile): Promise<PayslipSummary> {
  const analysis = await request.post('/api/payslip-analyses', {
    data: file.buffer,
    headers: { 'Content-Type': 'application/pdf', 'X-File-Name': encodeURIComponent(file.name) },
  });
  expect(analysis.status(), await analysis.text()).toBe(201);
  const { id, draft } = (await analysis.json()) as { id: string; draft: Record<string, unknown> };

  const created = await request.post('/api/payslips', { data: { analysisId: id, ...draft } });
  expect(created.status(), await created.text()).toBe(201);

  return (await created.json()) as PayslipSummary;
}

// --- Interfaccia ----------------------------------------------------------

export async function openPayslips(page: Page): Promise<void> {
  await page.goto('/payslips');
  await expect(page.getByRole('heading', { level: 1, name: 'Cedolini' })).toBeVisible();
  // La pagina è pronta quando la lista (anche vuota) è arrivata.
  await expect(page.getByText('Caricamento in corso…')).toHaveCount(0);
}

/** Il campo file nascosto dietro «Carica cedolino». */
export function fileInput(page: Page): Locator {
  return page.getByLabel('Scegli il PDF del cedolino');
}

/** Il pannello di revisione che compare dopo l'analisi. */
export function reviewPanel(page: Page): Locator {
  return page
    .locator('section')
    .filter({ has: page.getByRole('heading', { level: 2, name: 'Verifica del cedolino' }) });
}

/** Carica un PDF e attende la revisione. */
export async function uploadForReview(page: Page, file: PdfFile): Promise<Locator> {
  const analysis = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/payslip-analyses') && response.request().method() === 'POST',
  );
  await fileInput(page).setInputFiles(file);
  expect((await analysis).status()).toBe(201);

  const review = reviewPanel(page);
  await expect(review).toBeVisible();
  return review;
}

/** Il pannello con l'intestazione del mese selezionato, per esempio «ottobre 2026». */
export function monthPanel(page: Page, month: string): Locator {
  return page.locator('section').filter({ has: page.getByRole('heading', { level: 2, name: month, exact: true }) });
}

/** Un riquadro KPI del mese selezionato, individuato dalla sua etichetta. */
export function kpi(page: Page, month: string, label: string): Locator {
  return monthPanel(page, month)
    .locator('.card')
    .filter({ has: page.getByText(label, { exact: true }) });
}

/** La tabella «Cedolini importati». */
export function payslipTable(page: Page): Locator {
  return page.getByRole('table').filter({ has: page.getByRole('columnheader', { name: 'Mese', exact: true }) });
}

/** Le righe dati della tabella dei cedolini importati. */
export function payslipRows(page: Page): Locator {
  return payslipTable(page).locator('tbody').getByRole('row');
}

// --- Ferie e P.A.R.: progressivi coerenti ------------------------------------

/** Maturato e goduto (progressivi dall'inizio dell'anno) e residuo di un saldo. */
export interface LeaveFigures {
  readonly accrued: number;
  readonly used: number;
  readonly remaining: number;
  /** Solo per le ferie: il residuo dell'anno precedente. */
  readonly previousYear?: number;
}

export interface LeavePdfOptions {
  /** Per esempio `Agosto 2026`. */
  readonly month: string;
  readonly ferie: LeaveFigures;
  readonly par: LeaveFigures;
}

const FERIE_Y = 121.3;
const PAR_Y = 110.9;

/** Il formato del cedolino: cinque decimali, virgola decimale. */
const fiveDecimals = (value: number): string => value.toFixed(5).replace('.', ',');

/**
 * Un PDF sintetico con i saldi di ferie e P.A.R. dati. Ogni riga deve
 * rispettare `residuo = residuo AP + maturato − goduto`, altrimenti il lettore
 * segnala un avviso: la coerenza è responsabilità di chi chiama.
 */
export function pdfConFerie({ month, ferie, par }: LeavePdfOptions): PdfFile {
  const edit = (lines: FixtureLine[]): FixtureLine[] =>
    lines.map((line): FixtureLine => {
      const [y, x] = line;
      if (y === FERIE_Y) {
        if (x === 122.3) return [y, x, fiveDecimals(ferie.accrued)];
        if (x === 188.0) return [y, x, fiveDecimals(ferie.used)];
        if (x === 252.0) return [y, x, fiveDecimals(ferie.remaining)];
        if (x === 316.6) return [y, x, fiveDecimals(ferie.previousYear ?? 0)];
      }
      if (y === PAR_Y) {
        if (x === 122.3) return [y, x, fiveDecimals(par.accrued)];
        if (x === 188.0) return [y, x, fiveDecimals(par.used)];
        if (x === 252.0) return [y, x, fiveDecimals(par.remaining)];
      }
      return line;
    });

  const slug = month.toLowerCase().replace(' ', '-');
  return pdf(`cedolino-${slug}.pdf`, syntheticPayslipPdf({ month, edit }));
}

/**
 * Serie coerente: residuo AP delle ferie costante a 40 ore.
 *
 * - agosto:    ferie 10 / 4 → 46;  P.A.R. 4 / 2 → 2
 * - settembre: ferie 12 / 8 → 44;  P.A.R. 6 / 3 → 3
 * - ottobre:   ferie 13 / 8 → 45;  P.A.R. 8 / 4 → 4
 *
 * Ogni passo rispetta `atteso = precedente + Δmaturato − Δgoduto`.
 */
export const SERIE_COERENTE = {
  agosto: {
    month: 'Agosto 2026',
    ferie: { accrued: 10, used: 4, remaining: 46, previousYear: 40 },
    par: { accrued: 4, used: 2, remaining: 2 },
  },
  settembre: {
    month: 'Settembre 2026',
    ferie: { accrued: 12, used: 8, remaining: 44, previousYear: 40 },
    par: { accrued: 6, used: 3, remaining: 3 },
  },
  ottobre: {
    month: 'Ottobre 2026',
    ferie: { accrued: 13, used: 8, remaining: 45, previousYear: 40 },
    par: { accrued: 8, used: 4, remaining: 4 },
  },
} as const satisfies Record<string, LeavePdfOptions>;

/** Luglio, per il test del mese mancante: ferie 8 / 2 → 46, P.A.R. 3 / 1 → 2. */
export const LUGLIO: LeavePdfOptions = {
  month: 'Luglio 2026',
  ferie: { accrued: 8, used: 2, remaining: 46, previousYear: 40 },
  par: { accrued: 3, used: 1, remaining: 2 },
};

/** Settembre dopo un luglio senza agosto: ferie 12 / 4 → 48 (46 + 4 − 2), P.A.R. 5 / 3 → 2. */
export const SETTEMBRE_DOPO_LUGLIO: LeavePdfOptions = {
  month: 'Settembre 2026',
  ferie: { accrued: 12, used: 4, remaining: 48, previousYear: 40 },
  par: { accrued: 5, used: 3, remaining: 2 },
};

/** Cambia il residuo di un saldo di un cedolino già salvato (correzione manuale via API). */
export async function patchLeaveRemaining(
  request: APIRequestContext,
  id: string,
  type: 'FERIE' | 'PAR',
  remaining: number,
): Promise<void> {
  const current = await request.get(`/api/payslips/${id}`);
  expect(current.ok()).toBe(true);
  const { leaveBalances } = (await current.json()) as {
    leaveBalances: { type: string; remaining: number }[];
  };
  const patched = await request.patch(`/api/payslips/${id}`, {
    data: { leaveBalances: leaveBalances.map((b) => (b.type === type ? { ...b, remaining } : b)) },
  });
  expect(patched.status(), await patched.text()).toBe(200);
}

/** Il pannello «Riepilogo ferie e permessi». */
export function leavePanel(page: Page): Locator {
  return page
    .locator('section')
    .filter({ has: page.getByRole('heading', { level: 2, name: 'Riepilogo ferie e permessi' }) });
}

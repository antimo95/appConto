import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DomainError } from '../../../shared/errors.js';
import { buildPdf, syntheticPayslipPdf } from '../testing/payslip-fixtures.js';
import { extractPayslip } from './payslip-parser.js';
import { PAYSLIP_PARSERS } from './parsers.js';
import { MAX_PDF_PAGES, extractPdfText, hasPdfSignature } from './pdf-text.js';

async function rejectsAsValidation(bytes: Uint8Array, message: RegExp): Promise<void> {
  await assert.rejects(extractPdfText(bytes), (error: unknown) => {
    assert.ok(error instanceof DomainError);
    assert.equal(error.code, 'VALIDATION');
    assert.match(error.message, message);
    return true;
  });
}

describe('estrazione del testo da un PDF', () => {
  it('restituisce il testo con le coordinate, pagina per pagina', async () => {
    const document = await extractPdfText(buildPdf([[[700, 100, 'Ciao (mondo)']], [[500, 50, 'Indennità']]]));

    assert.equal(document.pages.length, 2);
    const [first] = document.pages[0]?.items ?? [];
    assert.equal(first?.text, 'Ciao (mondo)');
    assert.ok(Math.abs((first?.x ?? 0) - 100) < 0.01);
    assert.ok(Math.abs((first?.y ?? 0) - 700) < 0.01);
    assert.ok((first?.width ?? 0) > 0);
    assert.equal(document.pages[1]?.items[0]?.text, 'Indennità');
  });

  it('un cedolino sintetico attraversa estrazione e parser senza perdere nulla', async () => {
    const document = await extractPdfText(syntheticPayslipPdf());
    const result = extractPayslip(document, PAYSLIP_PARSERS);

    assert.equal(result.status, 'complete');
    assert.deepEqual(result.warnings, []);
    assert.equal(result.draft.period, '2026-10');
    assert.equal(result.draft.netCents, 169800);
    assert.equal(result.draft.items.length, 12);
    assert.equal(result.draft.leaveBalances.length, 2);
  });

  it('il datore di lavoro sopravvive alla fusione delle etichette fatta da pdfjs', async () => {
    // Nel PDF vero "CodicesAzienda" e "RagionesSociale" sono vicini sulla
    // stessa riga, e pdfjs-dist li restituisce come un solo elemento.
    const result = extractPayslip(await extractPdfText(syntheticPayslipPdf()), PAYSLIP_PARSERS);

    assert.equal(result.draft.employer, 'Esempio Lavoro S.r.l.');
  });

  it('un PDF senza testo produce pagine vuote, non un errore', async () => {
    const document = await extractPdfText(buildPdf([[]]));

    assert.equal(document.pages.length, 1);
    assert.deepEqual(document.pages[0]?.items, []);
  });

  it('rifiuta un file vuoto', async () => {
    await rejectsAsValidation(new Uint8Array(), /vuoto/);
  });

  it('rifiuta un file che non è un PDF', async () => {
    await rejectsAsValidation(Buffer.from('Data,Importo\n01/01/2026,10.00'), /non è un PDF/);
    assert.equal(hasPdfSignature(Buffer.from('PK\u0003\u0004')), false);
  });

  it('rifiuta un PDF danneggiato senza ripeterne il contenuto', async () => {
    await rejectsAsValidation(
      Buffer.from('%PDF-1.4\nquesto non è un documento\n%%EOF'),
      /^Il file non è un PDF valido oppure è danneggiato\.$/,
    );
  });

  it('rifiuta un PDF troncato a metà', async () => {
    const pdf = syntheticPayslipPdf();
    await rejectsAsValidation(pdf.subarray(0, Math.floor(pdf.length / 3)), /danneggiato/);
  });

  it(`rifiuta un documento con più di ${String(MAX_PDF_PAGES)} pagine`, async () => {
    const pages = Array.from({ length: MAX_PDF_PAGES + 1 }, () => [[700, 100, 'pagina'] as const]);
    await rejectsAsValidation(buildPdf(pages), /pagine/);
  });
});

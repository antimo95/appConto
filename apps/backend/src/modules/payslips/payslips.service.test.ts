import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

/**
 * Le regole dei cedolini, su un archivio vero.
 *
 * Il PDF di un cedolino confermato vive nel database, nella stessa
 * transazione delle sue righe; quello di un'analisi non confermata vive solo
 * in memoria. Il disco dell'utente, quindi, non vede mai un PDF: i test lo
 * verificano percorrendo l'intera cartella dei dati, non una cartella attesa.
 *
 * Il database e la cartella dei dati sono temporanei.
 */

// Il database di prova va scelto prima di caricare i moduli che aprono la connessione.
const dataRoot = mkdtempSync(path.join(tmpdir(), 'appconto-payslips-'));
process.env.DATABASE_FILE = path.join(dataRoot, 'database.sqlite');

// Il tipo si importa staticamente: viene cancellato in compilazione e non
// carica nulla, quindi non anticipa la lettura dei percorsi.
import type { PayslipsRepository } from './payslips.repository.js';
import type { PendingAnalysis } from './payslip-analysis.store.js';

const { config } = await import('../../config.js');
const { closeDatabase, db, runMigrations } = await import('../../db/client.js');
const { sql } = await import('drizzle-orm');
const { DomainError } = await import('../../shared/errors.js');
const { transactionsService } = await import('../transactions/index.js');
const { loansService, DEFAULT_LOAN_QUERY } = await import('../loans/index.js');
const { buildPdf, syntheticPayslipPdf } = await import('./testing/payslip-fixtures.js');
const { ANALYSIS_TTL_MS, createPayslipsService, payslipsService } = await import('./payslips.service.js');
const { MAX_PENDING_ANALYSES, createAnalysisStore } = await import('./payslip-analysis.store.js');
const { payslipsRepository } = await import('./payslips.repository.js');
const { PAYSLIP_PARSERS } = await import('./parsing/parsers.js');
const { extractPdfText } = await import('./parsing/pdf-text.js');

runMigrations();

after(() => {
  closeDatabase();
  try {
    rmSync(dataRoot, { recursive: true, force: true });
  } catch {
    // su Windows il file può restare bloccato: è comunque una cartella temporanea
  }
});

type Service = ReturnType<typeof createPayslipsService>;
type Analysis = Awaited<ReturnType<typeof payslipsService.analyze>>;

/**
 * Tutti i file sotto la radice dati, tranne quelli che l'applicazione ci
 * mette per conto proprio: il database con i suoi file di contorno e i log.
 * Qualunque altra cosa è un file che non dovrebbe esistere.
 */
function fileEstranei(): string[] {
  const trovati: string[] = [];
  const visita = (cartella: string): void => {
    for (const nome of readdirSync(cartella)) {
      const percorso = path.join(cartella, nome);
      if (statSync(percorso).isDirectory()) {
        visita(percorso);
      } else {
        trovati.push(path.relative(dataRoot, percorso));
      }
    }
  };
  visita(dataRoot);

  return trovati.filter(
    (relativo) =>
      !/^database\.sqlite(-wal|-shm|-journal)?$/.test(relativo) &&
      !relativo.startsWith(`logs${path.sep}`),
  );
}

/** Conferma la bozza così com'è, con le modifiche indicate. */
function confirm(analysis: Analysis, overrides: Record<string, unknown> = {}, service: Service = payslipsService) {
  return service.create({ analysisId: analysis.id, ...analysis.draft, ...overrides });
}

function expectError(code: 'VALIDATION' | 'NOT_FOUND' | 'CONFLICT', fn: () => unknown, message?: RegExp): void {
  assert.throws(fn, (error: unknown) => {
    assert.ok(error instanceof DomainError, `atteso un errore di dominio, ricevuto ${String(error)}`);
    assert.equal(error.code, code, error.message);
    if (message !== undefined) {
      assert.match(error.message, message);
    }
    return true;
  });
}

async function expectRejection(code: 'VALIDATION' | 'NOT_FOUND' | 'CONFLICT', promise: Promise<unknown>, message?: RegExp) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof DomainError);
    assert.equal(error.code, code, error.message);
    if (message !== undefined) {
      assert.match(error.message, message);
    }
    return true;
  });
}

function rowCount(table: string): number {
  return Number(db.get<{ total: number }>(sql`select count(*) as total from ${sql.identifier(table)}`)?.total ?? 0);
}

/** Il documento in archivio, letto direttamente dalla tabella. */
function storedDocument(payslipId: string): Buffer | null {
  const row = db.get<{ content: Buffer }>(
    sql`select content from payslip_documents where payslip_id = ${payslipId}`,
  );

  return row === undefined ? null : Buffer.from(row.content);
}

function storedSha256(payslipId: string): string | null {
  return db.get<{ sha256: string }>(sql`select sha256 from payslips where id = ${payslipId}`)?.sha256 ?? null;
}

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

/** Un servizio con dipendenze scelte dal test: archivio, analisi e orologio. */
function serviceWith(
  overrides: { repository?: PayslipsRepository; analyses?: ReturnType<typeof createAnalysisStore>; now?: () => number } = {},
): Service {
  return createPayslipsService({
    repository: overrides.repository ?? payslipsRepository,
    analyses: overrides.analyses ?? createAnalysisStore(),
    parsers: PAYSLIP_PARSERS,
    extractText: extractPdfText,
    now: overrides.now ?? (() => Date.now()),
  });
}

/** Un guasto del database simulato: il messaggio non contiene dati del cedolino. */
class GuastoSimulato extends Error {
  constructor() {
    super('guasto simulato del database');
  }
}

describe('isolamento del test', () => {
  it('la radice dati è temporanea', () => {
    assert.ok(config.dataRoot.startsWith(dataRoot));
    assert.ok(config.tmpDir.startsWith(dataRoot));
  });
});

describe('analisi e conferma', () => {
  let ottobre: Analysis;
  const pdfOttobre = syntheticPayslipPdf();

  it('l\'analisi propone i dati senza creare il cedolino e senza scrivere file', async () => {
    ottobre = await payslipsService.analyze(pdfOttobre, 'ottobre.pdf');

    assert.equal(ottobre.status, 'complete');
    assert.equal(ottobre.draft.period, '2026-10');
    assert.equal(ottobre.conflict, null);
    assert.equal(payslipsService.list({ from: null, to: null, sortDirection: null }).items.length, 0);

    // Il PDF dell'analisi resta in memoria: sul disco non c'è niente.
    assert.deepEqual(fileEstranei(), []);
    assert.ok(!existsSync(path.join(config.dataRoot, 'payslips')));
    assert.ok(!existsSync(path.join(config.tmpDir, 'payslip-analyses')));
    assert.equal(rowCount('payslip_documents'), 0);
  });

  it('la conferma crea il cedolino e ne conserva il PDF in archivio', () => {
    const detail = confirm(ottobre);

    assert.equal(detail.period, '2026-10');
    assert.equal(detail.fileName, 'ottobre.pdf');
    assert.equal(detail.parserId, 'zucchetti-lul/1');
    assert.equal(detail.netCents, 169800);
    assert.equal(detail.items.length, 12);
    assert.deepEqual(detail.leaveBalances.map((balance) => balance.type), ['FERIE', 'PAR']);
    assert.equal(detail.hasDocument, true);

    // Il documento è nel database, byte per byte, con l'hash del cedolino.
    const document = payslipsService.document(detail.id);
    assert.ok(Buffer.isBuffer(document.content));
    assert.ok(document.content.equals(pdfOttobre));
    assert.equal(document.period, '2026-10');
    assert.equal(rowCount('payslip_documents'), 1);
    assert.equal(sha256(storedDocument(detail.id) ?? Buffer.alloc(0)), storedSha256(detail.id));

    // E sul disco, ancora, niente.
    assert.deepEqual(fileEstranei(), []);
  });

  it('il cedolino non ha più una colonna con un percorso di file', () => {
    const columns = db
      .all<{ name: string }>(sql`select name from pragma_table_info('payslips')`)
      .map((row) => row.name);
    assert.ok(!columns.includes('stored_path'));
  });

  it('un\'analisi confermata non si conferma due volte', () => {
    expectError('NOT_FOUND', () => confirm(ottobre), /scaduta/);
    assert.equal(rowCount('payslip_documents'), 1);
  });

  it('lo stesso PDF non entra due volte: lo dice l\'hash del contenuto', async () => {
    await expectRejection('CONFLICT', payslipsService.analyze(syntheticPayslipPdf(), 'copia.pdf'), /già stato importato/);
  });

  it('salva le correzioni dell\'utente, non la bozza', async () => {
    const analysis = await payslipsService.analyze(syntheticPayslipPdf({ month: 'Agosto 2026' }), 'agosto.pdf');
    const detail = confirm(analysis, { netCents: 150000, employer: '  ' });

    assert.equal(detail.netCents, 150000);
    assert.equal(detail.employer, null);
    assert.equal(detail.hasDocument, true);
  });

  it('rifiuta dati non validi senza toccare l\'archivio', async () => {
    const analysis = await payslipsService.analyze(syntheticPayslipPdf({ month: 'Luglio 2026' }), 'luglio.pdf');
    const before = rowCount('payslips');
    const documentsBefore = rowCount('payslip_documents');

    expectError('VALIDATION', () => confirm(analysis, { period: '2026-13' }), /Periodo/);
    expectError('VALIDATION', () => confirm(analysis, { netCents: 1698.5 }), /centesimi/);
    expectError('VALIDATION', () => confirm(analysis, { totalEarningsCents: null }));
    expectError(
      'VALIDATION',
      () =>
        confirm(analysis, {
          leaveBalances: [
            { type: 'FERIE', accrued: 1, used: 0, remaining: 1, unit: 'ORE' },
            { type: 'FERIE', accrued: 1, used: 0, remaining: 1, unit: 'ORE' },
          ],
        }),
      /una sola volta/,
    );

    assert.equal(rowCount('payslips'), before);
    assert.equal(rowCount('payslip_documents'), documentsBefore);
    payslipsService.discardAnalysis(analysis.id);
  });
});

describe('conflitto di periodo', () => {
  it('un secondo cedolino dello stesso mese è segnalato già in analisi', async () => {
    const analysis = await payslipsService.analyze(
      syntheticPayslipPdf({ edit: (lines) => [...lines, [60, 30, 'Rettifica']] }),
      'ottobre-bis.pdf',
    );

    assert.equal(analysis.conflict?.period, '2026-10');
    expectError('CONFLICT', () => confirm(analysis), /conferma la sostituzione/);
    // Il conflitto non consuma l'analisi: l'utente può ancora scegliere.
    payslipsService.discardAnalysis(analysis.id);
  });

  it('la sostituzione esplicita rimpiazza righe e PDF del mese, in archivio', async () => {
    const before = payslipsService.list({ from: '2026-10', to: '2026-10', sortDirection: null }).items[0];
    assert.ok(before !== undefined);
    const documentsBefore = rowCount('payslip_documents');

    const pdfNuovo = syntheticPayslipPdf({ edit: (lines) => [...lines, [60, 30, 'Seconda rettifica']] });
    const analysis = await payslipsService.analyze(pdfNuovo, 'ottobre-nuovo.pdf');
    const replaced = confirm(analysis, { replaceExisting: true, netCents: 169900 });

    assert.notEqual(replaced.id, before.id);
    expectError('NOT_FOUND', () => payslipsService.getById(before.id));
    assert.equal(payslipsService.list({ from: '2026-10', to: '2026-10', sortDirection: null }).items.length, 1);

    // Il documento del cedolino sostituito non c'è più; quello nuovo sì.
    assert.equal(storedDocument(before.id), null);
    assert.ok(payslipsService.document(replaced.id).content.equals(pdfNuovo));
    assert.equal(rowCount('payslip_documents'), documentsBefore);
    assert.deepEqual(fileEstranei(), []);
  });

  it('una correzione non può spostare un cedolino su un mese già occupato', () => {
    const [ottobre] = payslipsService.list({ from: '2026-10', to: '2026-10', sortDirection: null }).items;
    assert.ok(ottobre !== undefined);

    expectError('CONFLICT', () => payslipsService.update(ottobre.id, { period: '2026-08' }));
  });
});

describe('correzione e cancellazione', () => {
  it('la correzione sostituisce voci e saldi per intero, e il documento resta', () => {
    const [agosto] = payslipsService.list({ from: '2026-08', to: '2026-08', sortDirection: null }).items;
    assert.ok(agosto !== undefined);
    const documento = storedDocument(agosto.id);
    assert.ok(documento !== null);

    const updated = payslipsService.update(agosto.id, {
      items: [{ code: 'Z00001', description: 'Retribuzione', section: 'earning', amountCents: 200000 }],
      leaveBalances: [],
      workedHours: 160.5,
    });

    assert.equal(updated.items.length, 1);
    assert.equal(updated.items[0]?.quantity, null);
    assert.deepEqual(updated.leaveBalances, []);
    assert.equal(updated.workedHours, 160.5);
    assert.equal(updated.netCents, 150000, 'i campi non indicati restano come sono');
    assert.equal(updated.hasDocument, true);
    assert.ok(storedDocument(agosto.id)?.equals(documento));
  });

  it('una correzione vuota non è una correzione', () => {
    const [agosto] = payslipsService.list({ from: '2026-08', to: '2026-08', sortDirection: null }).items;
    expectError('VALIDATION', () => payslipsService.update(agosto?.id ?? '', {}));
  });

  it('eliminare un cedolino elimina righe, voci, saldi e documento', async () => {
    const analysis = await payslipsService.analyze(syntheticPayslipPdf({ month: 'Giugno 2026' }), 'giugno.pdf');
    const detail = confirm(analysis);
    const items = rowCount('payslip_items');
    const balances = rowCount('payslip_leave_balances');
    const documents = rowCount('payslip_documents');
    assert.ok(storedDocument(detail.id) !== null);

    payslipsService.remove(detail.id);

    expectError('NOT_FOUND', () => payslipsService.getById(detail.id));
    expectError('NOT_FOUND', () => payslipsService.document(detail.id));
    assert.equal(rowCount('payslip_items'), items - 12);
    assert.equal(rowCount('payslip_leave_balances'), balances - 2);
    assert.equal(rowCount('payslip_documents'), documents - 1);
    assert.equal(storedDocument(detail.id), null);
  });

  it('un cedolino senza documento (versione precedente) si legge e si elimina comunque', async () => {
    const analysis = await payslipsService.analyze(syntheticPayslipPdf({ month: 'Maggio 2026' }), 'maggio.pdf');
    const detail = confirm(analysis);
    // Il caso di un cedolino importato dalla versione precedente il cui file
    // non è stato ritrovato: la riga c'è, il documento no.
    db.run(sql`delete from payslip_documents where payslip_id = ${detail.id}`);

    assert.equal(payslipsService.getById(detail.id).hasDocument, false);
    expectError('NOT_FOUND', () => payslipsService.document(detail.id), /non è più disponibile/);
    payslipsService.remove(detail.id);
    expectError('NOT_FOUND', () => payslipsService.getById(detail.id));
  });

  it('eliminare un cedolino inesistente è un 404', () => {
    expectError('NOT_FOUND', () => payslipsService.remove('inesistente'));
  });
});

describe('guasti del database durante la conferma', () => {
  it('se la scrittura fallisce a metà non resta niente, e l\'analisi resta confermabile', async () => {
    const analyses = createAnalysisStore();
    // Il guasto arriva dopo che testata, voci, saldi e documento sono stati
    // scritti: è la transazione, e non l'ordine delle scritture, a garantire
    // che non ne resti nessuno.
    const guasto: PayslipsRepository = {
      ...payslipsRepository,
      insert(payslip, document) {
        payslipsRepository.insert(payslip, document);
        throw new GuastoSimulato();
      },
    };
    const fragile = serviceWith({ repository: guasto, analyses });
    const sano = serviceWith({ analyses });

    const before = {
      payslips: rowCount('payslips'),
      items: rowCount('payslip_items'),
      balances: rowCount('payslip_leave_balances'),
      documents: rowCount('payslip_documents'),
    };

    const pdf = syntheticPayslipPdf({ month: 'Marzo 2025' });
    const analysis = await fragile.analyze(pdf, 'marzo.pdf');

    assert.throws(() => confirm(analysis, {}, fragile), GuastoSimulato);

    assert.deepEqual(
      {
        payslips: rowCount('payslips'),
        items: rowCount('payslip_items'),
        balances: rowCount('payslip_leave_balances'),
        documents: rowCount('payslip_documents'),
      },
      before,
      'nessuna riga del cedolino fallito resta in archivio',
    );
    assert.equal(payslipsService.list({ from: '2025-03', to: '2025-03', sortDirection: null }).items.length, 0);
    assert.deepEqual(fileEstranei(), []);

    // L'analisi non è stata consumata dal fallimento: si conferma di nuovo.
    const detail = confirm(analysis, {}, sano);
    assert.equal(detail.period, '2025-03');
    assert.ok(sano.document(detail.id).content.equals(pdf));
  });

  it('se l\'inserimento è rifiutato subito, l\'analisi resta confermabile', async () => {
    const analyses = createAnalysisStore();
    const guasto: PayslipsRepository = {
      ...payslipsRepository,
      insert() {
        throw new GuastoSimulato();
      },
    };
    const fragile = serviceWith({ repository: guasto, analyses });
    const sano = serviceWith({ analyses });
    const documents = rowCount('payslip_documents');

    const analysis = await fragile.analyze(syntheticPayslipPdf({ month: 'Aprile 2025' }), 'aprile.pdf');
    assert.throws(() => confirm(analysis, {}, fragile), GuastoSimulato);
    assert.equal(rowCount('payslip_documents'), documents);

    assert.equal(confirm(analysis, {}, sano).period, '2025-04');
  });

  it('un guasto durante una sostituzione lascia intatti il cedolino precedente e il suo documento', async () => {
    const analyses = createAnalysisStore();
    const guasto: PayslipsRepository = {
      ...payslipsRepository,
      insert(payslip, document) {
        payslipsRepository.insert(payslip, document);
        throw new GuastoSimulato();
      },
    };
    const fragile = serviceWith({ repository: guasto, analyses });

    const [precedente] = payslipsService.list({ from: '2025-03', to: '2025-03', sortDirection: null }).items;
    assert.ok(precedente !== undefined);
    const documentoPrecedente = storedDocument(precedente.id);
    assert.ok(documentoPrecedente !== null);
    const dettaglioPrecedente = payslipsService.getById(precedente.id);
    const documents = rowCount('payslip_documents');

    const analysis = await fragile.analyze(
      syntheticPayslipPdf({ month: 'Marzo 2025', edit: (lines) => [...lines, [60, 30, 'Rettifica marzo']] }),
      'marzo-bis.pdf',
    );
    assert.equal(analysis.conflict?.payslipId, precedente.id);

    assert.throws(() => confirm(analysis, { replaceExisting: true }, fragile), GuastoSimulato);

    // Rollback: il cedolino sostituito è ancora lì, con voci, saldi e PDF.
    assert.deepEqual(payslipsService.getById(precedente.id), dettaglioPrecedente);
    assert.ok(storedDocument(precedente.id)?.equals(documentoPrecedente));
    assert.equal(rowCount('payslip_documents'), documents);
    assert.equal(payslipsService.list({ from: '2025-03', to: '2025-03', sortDirection: null }).items.length, 1);
  });
});

describe('documenti non riconosciuti', () => {
  it('una scansione si analizza comunque, e i dati si inseriscono a mano', async () => {
    const scansione = buildPdf([[]]);
    const analysis = await payslipsService.analyze(scansione, 'scansione.pdf');

    assert.equal(analysis.status, 'unrecognized');
    assert.equal(analysis.draft.netCents, null);

    const detail = payslipsService.create({
      analysisId: analysis.id,
      period: '2026-01',
      totalEarningsCents: 200000,
      totalDeductionsCents: 40000,
      netCents: 160000,
      items: [],
      leaveBalances: [],
    });

    assert.equal(detail.parserId, 'manual');
    assert.equal(detail.hasDocument, true);
    assert.ok(payslipsService.document(detail.id).content.equals(scansione));
  });

  it('un PDF danneggiato non lascia nulla, né sul disco né in archivio', async () => {
    const documents = rowCount('payslip_documents');
    await expectRejection('VALIDATION', payslipsService.analyze(Buffer.from('%PDF-1.4 rotto'), 'rotto.pdf'));
    assert.deepEqual(fileEstranei(), []);
    assert.equal(rowCount('payslip_documents'), documents);
  });
});

describe('analisi in memoria: annullamento, scadenza, limite, riavvio', () => {
  it('annullare un\'analisi la toglie dalla memoria', async () => {
    const analysis = await payslipsService.analyze(syntheticPayslipPdf({ month: 'Aprile 2026' }), 'aprile.pdf');

    payslipsService.discardAnalysis(analysis.id);

    expectError('NOT_FOUND', () => payslipsService.discardAnalysis(analysis.id));
    expectError('NOT_FOUND', () => confirm(analysis));
    assert.deepEqual(fileEstranei(), []);
  });

  it('un\'analisi scaduta non si conferma', async () => {
    let now = Date.parse('2026-11-01T10:00:00Z');
    const service = serviceWith({ now: () => now });

    const stale = await service.analyze(syntheticPayslipPdf({ month: 'Marzo 2026' }), 'marzo.pdf');
    now += ANALYSIS_TTL_MS + 1;

    expectError('NOT_FOUND', () => confirm(stale, {}, service), /carica di nuovo il PDF/);
    assert.deepEqual(fileEstranei(), []);
  });

  it('annullare un\'analisi scaduta dice che non esiste più', async () => {
    let now = Date.parse('2026-11-01T10:00:00Z');
    const service = serviceWith({ now: () => now });

    const stale = await service.analyze(syntheticPayslipPdf({ month: 'Febbraio 2026' }), 'febbraio.pdf');
    now += ANALYSIS_TTL_MS + 1;

    expectError('NOT_FOUND', () => service.discardAnalysis(stale.id), /scaduta/);
  });

  it('il limite è di dieci analisi in attesa', () => {
    assert.equal(MAX_PENDING_ANALYSES, 10);
  });

  it('l\'undicesima analisi scarta la più vecchia', async () => {
    const service = serviceWith();
    const analisi: Analysis[] = [];

    for (let indice = 0; indice < MAX_PENDING_ANALYSES + 1; indice += 1) {
      analisi.push(
        await service.analyze(
          syntheticPayslipPdf({
            month: 'Dicembre 2024',
            edit: (lines) => [...lines, [60, 30, `Variante ${String(indice)}`]],
          }),
          `variante-${String(indice)}.pdf`,
        ),
      );
    }

    const [piuVecchia, seconda, ...resto] = analisi;
    assert.ok(piuVecchia !== undefined && seconda !== undefined);

    expectError('NOT_FOUND', () => confirm(piuVecchia, {}, service), /carica di nuovo il PDF/);

    // Le altre dieci sono ancora lì.
    for (const ancora of resto) {
      service.discardAnalysis(ancora.id);
    }
    const detail = confirm(seconda, {}, service);
    assert.equal(detail.period, '2024-12');
    payslipsService.remove(detail.id);
  });

  it('il limite si applica anche al deposito, con una soglia scelta', () => {
    const store = createAnalysisStore({ maxPending: 2 });
    const analisi = (id: string, expiresAt: number): PendingAnalysis => ({
      id,
      fileName: `${id}.pdf`,
      sha256: id.padEnd(64, '0'),
      bytes: new Uint8Array([1, 2, 3]),
      extraction: {} as PendingAnalysis['extraction'],
      expiresAt,
    });
    const now = Date.parse('2026-11-01T10:00:00Z');

    store.save(analisi('a', now + 1_000));
    store.save(analisi('b', now + 1_000));
    store.save(analisi('c', now + 1_000));

    assert.equal(store.get('a', now), null, 'la più vecchia è stata scartata');
    assert.equal(store.get('b', now)?.id, 'b');
    assert.equal(store.get('c', now)?.id, 'c');
    assert.deepEqual([...(store.get('c', now)?.bytes ?? [])], [1, 2, 3]);
  });

  it('dopo un riavvio le analisi non esistono più: si ricarica il PDF', async () => {
    const primaDelRiavvio = serviceWith();
    const analysis = await primaDelRiavvio.analyze(syntheticPayslipPdf({ month: 'Novembre 2024' }), 'novembre.pdf');

    // Un nuovo processo: stesso archivio, memoria nuova.
    const dopoIlRiavvio = serviceWith();

    expectError('NOT_FOUND', () => confirm(analysis, {}, dopoIlRiavvio), /carica di nuovo il PDF/);
    assert.equal(payslipsService.list({ from: '2024-11', to: '2024-11', sortDirection: null }).items.length, 0);
    assert.deepEqual(fileEstranei(), []);
  });
});

describe('confronti calcolati', () => {
  it('confronta ogni mese con il cedolino precedente, anche se ne manca uno in mezzo', () => {
    const summary = payslipsService.summaries({ from: '2026-08', to: '2026-10' });

    assert.deepEqual(summary.trend.map((point) => point.period), ['2026-08', '2026-10']);
    const ottobre = summary.comparisons.find((comparison) => comparison.period === '2026-10');
    assert.equal(ottobre?.previousPeriod, '2026-08');
    assert.equal(ottobre?.net.deltaCents, 169900 - 150000);
    assert.ok(ottobre?.items.some((delta) => delta.status === 'added' && delta.code === 'F02703'));

    const agosto = summary.comparisons.find((comparison) => comparison.period === '2026-08');
    assert.equal(agosto?.previousPeriod, '2026-01');
  });

  it('rifiuta un intervallo rovesciato o malformato', () => {
    expectError('VALIDATION', () => payslipsService.summaries({ from: '2026-10', to: '2026-09' }));
    expectError('VALIDATION', () => payslipsService.summaries({ from: '2026-1', to: null }));
  });

  it('nessun dato derivato è salvato: le tabelle hanno solo colonne del cedolino', () => {
    const columns = db
      .all<{ name: string }>(sql`select name from pragma_table_info('payslips')`)
      .map((row) => row.name);
    assert.ok(!columns.some((name) => /delta|trend|previous|comparison/.test(name)));
  });
});

describe('le altre feature restano intatte', () => {
  it('importare cedolini non crea movimenti né prestiti', () => {
    assert.equal(transactionsService.listAll().length, 0);
    assert.equal(loansService.list(DEFAULT_LOAN_QUERY).items.length, 0);
  });

  it('alla fine, nessun PDF è mai finito sul disco', () => {
    assert.deepEqual(fileEstranei(), []);
  });
});

import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { atomically } from '../../db/client.js';
import { ConflictError, NotFoundError, ValidationError } from '../../shared/errors.js';
import { parseOrThrow } from '../../shared/validation.js';
import { createAnalysisStore, type AnalysisStore } from './payslip-analysis.store.js';
import { summarize } from './payslip-comparison.js';
import {
  newPayslipSchema,
  payslipUpdateSchema,
  periodSchema,
  type Payslip,
  type PayslipKind,
} from './payslip.model.js';
import { PAYSLIP_PARSERS } from './parsing/parsers.js';
import { extractPayslip, type PayslipParser } from './parsing/payslip-parser.js';
import { extractPdfText, type PdfTextDocument } from './parsing/pdf-text.js';
import {
  payslipsRepository,
  type PayslipListFilter,
  type PayslipRow,
  type PayslipsRepository,
} from './payslips.repository.js';
import type {
  PayslipAnalysisViewModel,
  PayslipDetailViewModel,
  PayslipListViewModel,
  PayslipSummariesViewModel,
  PayslipSummary,
} from './payslips.view-model.js';

/**
 * Caso d'uso "cedolini".
 *
 * Le regole vivono qui:
 *
 *  - un PDF entra una volta sola (hash del contenuto);
 *  - un mese ha un solo cedolino: sostituirlo va chiesto esplicitamente;
 *  - nulla viene salvato senza che l'utente abbia visto e confermato i dati;
 *  - il PDF e le righe nascono e muoiono insieme, nella stessa transazione:
 *    il documento è una riga dell'archivio, non un file accanto.
 *
 * Il servizio non conosce Express. Non tocca movimenti, prestiti né altre
 * feature: il cedolino spiega lo stipendio, non lo registra.
 *
 * Nessun dato del cedolino finisce nei log: i messaggi d'errore vanno
 * all'utente nella risposta HTTP, non sul disco.
 */

/** Un cedolino pesa qualche decina di kilobyte: dieci megabyte sono già molto. */
export const MAX_PDF_BYTES = 10 * 1024 * 1024;

/** Quanto resta confermabile un'analisi. */
export const ANALYSIS_TTL_MS = 60 * 60 * 1000;

const monthFormatter = new Intl.DateTimeFormat('it-IT', { month: 'long', year: 'numeric' });

function monthLabel(period: string): string {
  return monthFormatter.format(new Date(`${period}-01T00:00:00`));
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Il nome del file come etichetta: senza cartelle e senza caratteri di
 * controllo. Non diventa mai un percorso.
 */
export function cleanFileName(raw: string | null | undefined): string {
  const base = path.basename((raw ?? '').replaceAll('\\', '/'));
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 200);

  return cleaned.length === 0 ? 'cedolino.pdf' : cleaned;
}

function toSummary(row: PayslipRow): PayslipSummary {
  return {
    id: row.id,
    period: row.period,
    kind: row.kind as PayslipKind,
    employer: row.employer,
    fileName: row.fileName,
    importedAt: row.importedAt,
    parserId: row.parserId,
    totalEarningsCents: row.totalEarningsCents,
    totalDeductionsCents: row.totalDeductionsCents,
    netCents: row.netCents,
  };
}

/** Un filtro di periodo facoltativo, validato come il resto dell'input. */
function optionalPeriod(value: string | null, name: string): string | null {
  return value === null ? null : parseOrThrow(periodSchema, value, `Parametro "${name}" non valido.`);
}

export interface PayslipsServiceDeps {
  repository: PayslipsRepository;
  analyses: AnalysisStore;
  parsers: readonly PayslipParser[];
  extractText: (bytes: Uint8Array) => Promise<PdfTextDocument>;
  now: () => number;
}

export function createPayslipsService(deps: PayslipsServiceDeps) {
  const { repository, analyses } = deps;

  function requirePayslip(id: string): Payslip {
    const payslip = repository.findById(id);
    if (payslip === null) {
      throw new NotFoundError(`Cedolino "${id}" non trovato.`);
    }

    return payslip;
  }

  function toDetail(payslip: Payslip): PayslipDetailViewModel {
    return {
      ...toSummary(payslip),
      roundingCents: payslip.roundingCents,
      taxableInpsCents: payslip.taxableInpsCents,
      taxableIrpefCents: payslip.taxableIrpefCents,
      workedHours: payslip.workedHours,
      items: payslip.items,
      leaveBalances: payslip.leaveBalances,
      hasDocument: repository.hasDocument(payslip.id),
    };
  }

  function rejectDuplicateFile(hash: string): void {
    const existing = repository.findRowBySha256(hash);
    if (existing !== null) {
      throw new ConflictError(
        `Questo PDF è già stato importato come cedolino di ${monthLabel(existing.period)}.`,
      );
    }
  }

  return {
    /**
     * Legge il PDF e propone i dati, senza creare il cedolino.
     *
     * Il PDF resta in memoria, insieme all'analisi, fino alla conferma o
     * alla scadenza: sul disco non si scrive nulla. Un documento che nessun
     * parser riconosce non è un errore: l'analisi esiste comunque, e
     * l'utente inserirà i dati a mano.
     */
    async analyze(bytes: Uint8Array, fileName: string | null): Promise<PayslipAnalysisViewModel> {
      if (bytes.byteLength > MAX_PDF_BYTES) {
        throw new ValidationError('Il file supera la dimensione massima di 10 MB.');
      }

      // Una copia: il documento che si conferma deve essere esattamente
      // quello di cui si è calcolato l'hash, qualunque cosa faccia poi chi
      // ha passato il buffer.
      const document = Buffer.from(bytes);
      const hash = sha256(document);
      rejectDuplicateFile(hash);

      const extraction = extractPayslip(await deps.extractText(document), deps.parsers);

      // Le analisi scadute si tolgono qui, al momento di aggiungerne una:
      // niente timer da fermare.
      const now = deps.now();
      analyses.evictExpired(now);

      const id = randomUUID();
      const expiresAt = now + ANALYSIS_TTL_MS;
      const cleanedName = cleanFileName(fileName);
      analyses.save({
        id,
        fileName: cleanedName,
        sha256: hash,
        bytes: document,
        extraction,
        expiresAt,
      });

      const period = extraction.draft.period;
      // Il parser non riconosce il tipo: la bozza è sempre ordinaria.
      const existing = period === null ? null : repository.findRowByPeriodAndKind(period, 'ordinary');

      return {
        id,
        fileName: cleanedName,
        parserId: extraction.parserId,
        status: extraction.status,
        confidence: extraction.confidence,
        warnings: extraction.warnings,
        draft: extraction.draft,
        conflict:
          existing === null
            ? null
            : { payslipId: existing.id, period: existing.period, kind: existing.kind as PayslipKind },
        expiresAt: new Date(expiresAt).toISOString(),
      };
    },

    /** Annulla un'analisi: il PDF tenuto in memoria viene dimenticato subito. */
    discardAnalysis(id: string): void {
      // Prima le scadute: `delete` dà esito positivo anche per un'analisi
      // scaduta ma ancora in memoria, e l'utente non deve vederla "annullata".
      analyses.evictExpired(deps.now());
      if (!analyses.delete(id)) {
        throw new NotFoundError('Analisi non trovata o scaduta.');
      }
    },

    /**
     * Crea il cedolino dai dati rivisti dall'utente.
     *
     * Un'unica transazione: l'eventuale cancellazione del cedolino
     * sostituito (il cascade porta via le sue voci, i saldi e il PDF) e
     * l'inserimento di testata, voci, saldi e documento del nuovo. Se una
     * qualunque scrittura fallisce non resta nulla, il cedolino precedente
     * resta com'era, e l'analisi resta in memoria: si può confermare di
     * nuovo. Solo dopo il commit l'analisi viene dimenticata.
     */
    create(input: unknown): PayslipDetailViewModel {
      analyses.evictExpired(deps.now());
      const data = parseOrThrow(newPayslipSchema, input, 'Dati del cedolino non validi.');

      const analysis = analyses.get(data.analysisId, deps.now());
      if (analysis === null) {
        throw new NotFoundError('Analisi non trovata o scaduta: carica di nuovo il PDF.');
      }

      rejectDuplicateFile(analysis.sha256);

      const existing = repository.findRowByPeriodAndKind(data.period, data.kind);
      if (existing !== null && !data.replaceExisting) {
        throw new ConflictError(
          `Esiste già un cedolino per ${monthLabel(data.period)}: conferma la sostituzione oppure annulla.`,
        );
      }

      const { analysisId: _analysisId, replaceExisting: _replace, ...payslipData } = data;
      const id = randomUUID();

      atomically(() => {
        if (existing !== null) {
          repository.delete(existing.id);
        }

        repository.insert(
          {
            ...payslipData,
            id,
            fileName: analysis.fileName,
            sha256: analysis.sha256,
            importedAt: new Date(deps.now()).toISOString(),
            parserId: analysis.extraction.parserId ?? 'manual',
          },
          analysis.bytes,
        );
      });

      analyses.delete(analysis.id);

      return toDetail(requirePayslip(id));
    },

    list(filter: { from: string | null; to: string | null; sortDirection: string | null }): PayslipListViewModel {
      const direction = filter.sortDirection ?? 'desc';
      if (direction !== 'asc' && direction !== 'desc') {
        throw new ValidationError('Parametro "sortDirection" non valido: asc oppure desc.');
      }

      const query: PayslipListFilter = {
        from: optionalPeriod(filter.from, 'from'),
        to: optionalPeriod(filter.to, 'to'),
        direction,
      };

      return { items: repository.list(query).map(toSummary) };
    },

    getById(id: string): PayslipDetailViewModel {
      return toDetail(requirePayslip(id));
    },

    /** Corregge un cedolino confermato. Voci e saldi, se indicati, si sostituiscono per intero. */
    update(id: string, input: unknown): PayslipDetailViewModel {
      const current = requirePayslip(id);
      const { items, leaveBalances, ...header } = parseOrThrow(
        payslipUpdateSchema,
        input,
        'Modifica del cedolino non valida.',
      );

      if (header.period !== undefined && header.period !== current.period) {
        const other = repository.findRowByPeriodAndKind(header.period, current.kind);
        if (other !== null) {
          throw new ConflictError(`Esiste già un cedolino per ${monthLabel(header.period)}.`);
        }
      }

      atomically(() => {
        repository.updateHeader(id, header);
        if (items !== undefined) {
          repository.replaceItems(id, items);
        }
        if (leaveBalances !== undefined) {
          repository.replaceLeaveBalances(id, leaveBalances);
        }
      });

      return toDetail(requirePayslip(id));
    },

    /**
     * Elimina il cedolino e il suo PDF.
     *
     * Una sola `delete`: voci, saldi e documento seguono per cascade, nella
     * stessa istruzione. O spariscono tutti, o resta tutto com'era.
     */
    remove(id: string): void {
      requirePayslip(id);
      repository.delete(id);
    },

    /** Il PDF originale, per aprirlo: i byte vengono dall'archivio. */
    document(id: string): { content: Buffer; period: string } {
      const payslip = requirePayslip(id);
      const content = repository.findDocument(id);
      if (content === null) {
        throw new NotFoundError('Il PDF originale di questo cedolino non è più disponibile.');
      }

      return { content, period: payslip.period };
    },

    summaries(filter: { from: string | null; to: string | null }): PayslipSummariesViewModel {
      const from = optionalPeriod(filter.from, 'from');
      const to = optionalPeriod(filter.to, 'to');
      if (from !== null && to !== null && from > to) {
        throw new ValidationError('Intervallo non valido: "from" è successivo a "to".');
      }

      return summarize(repository.listComplete(to), from, to);
    },
  };
}

export type PayslipsService = ReturnType<typeof createPayslipsService>;

/**
 * Le analisi in attesa del processo.
 *
 * Esportate perché la pulizia dell'azzeramento (`payslipsStorage.purge`) deve
 * svuotare proprio questa memoria, e non una copia: un'analisi sopravvissuta
 * a un azzeramento si potrebbe ancora confermare.
 */
export const payslipAnalyses = createAnalysisStore();

export const payslipsService = createPayslipsService({
  repository: payslipsRepository,
  analyses: payslipAnalyses,
  parsers: PAYSLIP_PARSERS,
  extractText: extractPdfText,
  now: () => Date.now(),
});

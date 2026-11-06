import type { PayslipExtraction } from './parsing/payslip-parser.js';

/**
 * Le analisi in attesa di conferma.
 *
 * Stanno in memoria, PDF compreso: un'analisi è un passaggio intermedio fra
 * il caricamento e la conferma, non un dato dell'archivio, e nulla deve
 * toccare il disco finché l'utente non conferma. Se l'applicazione si
 * riavvia nel mezzo, l'analisi è persa: basta caricare di nuovo il PDF.
 *
 * Il numero è limitato perché ogni analisi tiene in memoria fino a 10 MB:
 * oltre il limite si scarta la più vecchia, che è anche quella che l'utente
 * ha più probabilmente abbandonato.
 */
export interface PendingAnalysis {
  id: string;
  fileName: string;
  sha256: string;
  /** Il PDF caricato, che diventerà il documento del cedolino alla conferma. */
  bytes: Uint8Array;
  extraction: PayslipExtraction;
  expiresAt: number;
}

/** Quante analisi possono attendere la conferma nello stesso momento. */
export const MAX_PENDING_ANALYSES = 10;

export interface AnalysisStoreOptions {
  maxPending?: number;
}

export function createAnalysisStore({ maxPending = MAX_PENDING_ANALYSES }: AnalysisStoreOptions = {}) {
  // Una `Map` conserva l'ordine di inserimento: la prima chiave è la più vecchia.
  const pending = new Map<string, PendingAnalysis>();

  return {
    save(analysis: PendingAnalysis): void {
      pending.delete(analysis.id);
      pending.set(analysis.id, analysis);

      while (pending.size > maxPending) {
        const oldest = pending.keys().next();
        if (oldest.done === true) {
          break;
        }
        pending.delete(oldest.value);
      }
    },

    /** L'analisi, se esiste e non è scaduta. */
    get(id: string, now: number): PendingAnalysis | null {
      const analysis = pending.get(id);

      return analysis === undefined || analysis.expiresAt <= now ? null : analysis;
    },

    delete(id: string): boolean {
      return pending.delete(id);
    },

    /** Toglie le analisi scadute e ne restituisce gli identificativi. */
    evictExpired(now: number): string[] {
      const expired = [...pending.values()].filter((analysis) => analysis.expiresAt <= now);
      for (const analysis of expired) {
        pending.delete(analysis.id);
      }

      return expired.map((analysis) => analysis.id);
    },

    /** Dimentica tutte le analisi: l'archivio che dovevano arricchire non c'è più. */
    clear(): void {
      pending.clear();
    },
  };
}

export type AnalysisStore = ReturnType<typeof createAnalysisStore>;

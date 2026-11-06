import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { config } from '../../config.js';
import { atomically } from '../../db/client.js';
import type { AnalysisStore } from './payslip-analysis.store.js';
import { payslipsRepository, type PayslipsRepository } from './payslips.repository.js';
import { payslipAnalyses } from './payslips.service.js';

/**
 * I PDF dei cedolini rimasti sul disco dalla versione precedente.
 *
 * Oggi i documenti vivono nel database e le analisi in memoria: il disco non
 * vede mai un PDF. La versione precedente invece li scriveva in due cartelle
 * dentro `DATA_ROOT`:
 *
 *   payslips/<uuid>.pdf              il documento di un cedolino confermato
 *   tmp/payslip-analyses/<uuid>.pdf  il PDF di un'analisi non confermata
 *
 * Questo modulo fa due cose con quelle cartelle.
 *
 * **Riconciliazione** (all'avvio, dopo le migrazioni). Prudente: un file si
 * elimina solo con una prova, cioè quando il suo hash è quello di un
 * cedolino. Se il cedolino non ha ancora il documento, il contenuto entra in
 * archivio e poi il file si elimina; se lo ha già, il file è un doppione.
 * Un file che non corrisponde a nessun cedolino resta dov'è: potrebbe essere
 * l'unica copia di qualcosa che l'utente vuole, e nessuna regola sa dire il
 * contrario. Le analisi della versione precedente, invece, si eliminano
 * tutte: un'analisi non è mai stata un cedolino, e la memoria del processo
 * che l'ha creata non esiste più.
 *
 * **Pulizia** (all'azzeramento). Dimentica le analisi in memoria ed elimina
 * entrambe le cartelle: «da zero» vale anche per i PDF.
 *
 * Il filesystem passa da un adattatore perché i guasti — un file
 * illeggibile, una rimozione negata — si possano provare in modo
 * deterministico. Nessun nome di file, identificativo o contenuto esce da
 * qui: l'esito è fatto solo di conteggi.
 */

/** Ciò che serve del filesystem. `readdir` elenca soltanto i file, non le cartelle. */
export interface StorageFileSystem {
  readdir(dir: string): string[];
  readFile(file: string): Buffer;
  remove(file: string): void;
  /** Elimina la cartella con tutto il contenuto; una cartella che non esiste non è un errore. */
  removeDirectory(dir: string): void;
  exists(target: string): boolean;
}

export const nodeFileSystem: StorageFileSystem = {
  readdir: (dir) =>
    readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name),
  readFile: (file) => readFileSync(file),
  remove: (file) => {
    rmSync(file, { force: true });
  },
  removeDirectory: (dir) => {
    rmSync(dir, { recursive: true, force: true });
  },
  exists: (target) => existsSync(target),
};

/** L'esito di una riconciliazione: solo conteggi, mai contenuti. */
export interface ReconcileReport {
  /** File portati in archivio come documento del loro cedolino. */
  imported: number;
  /** File eliminati perché il loro documento era già in archivio. */
  duplicatesRemoved: number;
  /** File lasciati dove sono: nessun cedolino ha il loro hash. */
  unmatched: number;
  /** Operazioni non riuscite (lettura, import, rimozione): i file restano. */
  failures: number;
  /** Analisi della versione precedente eliminate. */
  pendingRemoved: number;
}

export interface PayslipStorageDeps {
  fs: StorageFileSystem;
  legacyDocumentsDir: string;
  legacyPendingDir: string;
  repository: Pick<PayslipsRepository, 'listWithoutDocument' | 'documentHashes' | 'attachDocument'>;
  analyses: AnalysisStore;
}

/**
 * Il solo nome che la versione precedente scriveva: un UUID e l'estensione.
 * Qualunque altro file non è suo, e non si legge né si elimina.
 */
const LEGACY_FILE_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$/;

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function createPayslipStorage(deps: PayslipStorageDeps) {
  const { fs, repository } = deps;

  /** I file di una cartella, o nessuno se non esiste. `null` se non si è potuta leggere. */
  function filesIn(dir: string): string[] | null {
    if (!fs.exists(dir)) {
      return [];
    }

    try {
      return fs.readdir(dir);
    } catch {
      return null;
    }
  }

  function reconcileDocuments(report: ReconcileReport): void {
    const names = filesIn(deps.legacyDocumentsDir);
    if (names === null) {
      report.failures += 1;
      return;
    }

    const candidates = names.filter((name) => LEGACY_FILE_NAME.test(name));
    if (candidates.length === 0) {
      return;
    }

    // Lo stato si aggiorna mentre si procede: due copie dello stesso file
    // devono dare un import e un doppione, non due import.
    const withoutDocument = new Map(repository.listWithoutDocument().map((row) => [row.sha256, row.id]));
    const withDocument = repository.documentHashes();

    for (const name of candidates) {
      const file = path.join(deps.legacyDocumentsDir, name);

      let content: Buffer;
      try {
        content = fs.readFile(file);
      } catch {
        // Illeggibile: nessuna prova, quindi il file resta. Gli altri si elaborano.
        report.failures += 1;
        continue;
      }

      const hash = sha256(content);
      const payslipId = withoutDocument.get(hash);

      if (payslipId !== undefined) {
        try {
          atomically(() => {
            repository.attachDocument(payslipId, content);
          });
        } catch {
          report.failures += 1;
          continue;
        }

        withoutDocument.delete(hash);
        withDocument.add(hash);
        report.imported += 1;

        // Il documento è già in archivio: se il file non si elimina adesso,
        // al prossimo avvio sarà un doppione e sparirà allora.
        try {
          fs.remove(file);
        } catch {
          report.failures += 1;
        }
        continue;
      }

      if (withDocument.has(hash)) {
        try {
          fs.remove(file);
          report.duplicatesRemoved += 1;
        } catch {
          report.failures += 1;
        }
        continue;
      }

      report.unmatched += 1;
    }
  }

  function removePendingAnalyses(report: ReconcileReport): void {
    const names = filesIn(deps.legacyPendingDir);
    if (names === null) {
      report.failures += 1;
      return;
    }

    for (const name of names) {
      try {
        fs.remove(path.join(deps.legacyPendingDir, name));
        report.pendingRemoved += 1;
      } catch {
        report.failures += 1;
      }
    }
  }

  return {
    /** Porta in archivio i PDF della versione precedente che hanno una prova, ed elimina le vecchie analisi. */
    reconcile(): ReconcileReport {
      const report: ReconcileReport = {
        imported: 0,
        duplicatesRemoved: 0,
        unmatched: 0,
        failures: 0,
        pendingRemoved: 0,
      };

      reconcileDocuments(report);
      removePendingAnalyses(report);

      return report;
    },

    /**
     * Dimentica le analisi in memoria ed elimina le cartelle della versione
     * precedente. Un errore si propaga: chi azzera deve fermarsi prima di
     * toccare il database.
     */
    purge(): void {
      deps.analyses.clear();
      fs.removeDirectory(deps.legacyDocumentsDir);
      fs.removeDirectory(deps.legacyPendingDir);
    },
  };
}

export type PayslipStorage = ReturnType<typeof createPayslipStorage>;

/**
 * Il deposito dell'applicazione: le cartelle della radice dati e la stessa
 * memoria delle analisi del servizio, così che la pulizia dimentichi proprio
 * le analisi che il servizio potrebbe ancora confermare.
 */
export const payslipsStorage = createPayslipStorage({
  fs: nodeFileSystem,
  legacyDocumentsDir: path.join(config.dataRoot, 'payslips'),
  legacyPendingDir: path.join(config.tmpDir, 'payslip-analyses'),
  repository: payslipsRepository,
  analyses: payslipAnalyses,
});

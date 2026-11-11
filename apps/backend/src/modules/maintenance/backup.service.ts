import { existsSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { APP_VERSION } from '../../app-version.js';
import { config } from '../../config.js';
import { databaseSchema, vacuumInto } from '../../db/client.js';
import type { SchemaVersion } from '../../db/schema-version.js';
import { openSqlite } from '../../db/sqlite.js';
import { ensureDataDirectories } from '../../paths.js';
import { logger } from '../../shared/logger.js';
import { auditPayslipDocuments, type PayslipDocumentsAudit } from '../payslips/index.js';
import {
  BACKUP_FORMAT,
  inspectDatabase,
  parseManifest,
  sha256OfFile,
  type BackupManifest,
} from './backup.manifest.js';
import {
  BACKUP_EXTENSION,
  PARTIAL_SUFFIX,
  backupName,
  localTimestampOf,
  manifestNameFor,
  parseBackupName,
  resolveBackupFile,
  type BackupKind,
} from './backup.naming.js';
import { backupsToPrune } from './backup.retention.js';

/**
 * Creazione, verifica ed elenco dei backup.
 *
 * L'ordine dei passaggi è la garanzia, non un dettaglio di implementazione:
 *
 *     VACUUM INTO  ->  integrity_check  ->  conteggi  ->  documenti dei cedolini  ->  impronta  ->  rename
 *
 * Un file entra in `backups/` **solo** dopo essere stato riaperto e
 * controllato. Fino a quel momento vive in `tmp/` con il suffisso `.partial`,
 * dove nessuna parte del sistema lo riconosce come backup — la convenzione sui
 * nomi lo esclude a priori. Questo è ciò che rende impossibile presentare
 * all'utente come riuscito un backup che non lo è: la cartella dei backup non
 * contiene candidati, contiene esiti.
 *
 * Il rename è l'ultimo passo e avviene all'interno dello stesso volume, quindi
 * è atomico: da fuori il backup non esiste o esiste completo.
 */

/** Il backup non è stato creato. L'archivio non è stato toccato. */
export class BackupFailedError extends Error {}

/** Un backup presente su disco, come lo vede l'applicazione. */
export interface BackupInfo {
  readonly name: string;
  readonly kind: BackupKind;
  /** L'istante di creazione dichiarato dal manifest, in ISO UTC. */
  readonly createdAt: string | null;
  /** L'ora locale ricavata dal nome del file: sempre disponibile. */
  readonly localTime: string;
  readonly bytes: number;
  readonly appVersion: string | null;
  readonly schemaVersion: SchemaVersion | null;
  readonly rowCounts: Record<string, number>;
  /**
   * `completo` significa che database e manifest sono entrambi presenti e
   * leggibili — non che il contenuto sia stato ricontrollato adesso. La
   * verifica completa costa la lettura dell'intero file e si paga quando
   * serve davvero, cioè al ripristino.
   */
  readonly status: 'completo' | 'senza-manifest' | 'manifest-non-valido';
  readonly problem: string | null;
}

/** L'esito di una verifica completa. */
export type BackupCheck =
  | {
      readonly ok: true;
      readonly file: string;
      readonly manifest: BackupManifest;
      readonly schema: SchemaVersion;
      readonly rowCounts: Record<string, number>;
      readonly sha256: string;
    }
  | { readonly ok: false; readonly problem: string };

function manifestPath(name: string): string {
  return path.join(config.backupsDir, manifestNameFor(name));
}

/**
 * Il primo nome libero a partire dall'istante indicato.
 *
 * La convenzione ha la risoluzione di un secondo, quindi due backup creati
 * nello stesso secondo vorrebbero lo stesso nome. Invece di aggiungere un
 * contraddistintivo — che romperebbe l'ordinamento alfabetico su cui si
 * appoggiano elenco e ritenzione — si avanza al secondo successivo. Il
 * manifest riporta lo stesso istante del nome, così i due non divergono.
 */
function freeName(kind: BackupKind, from: Date): { name: string; moment: Date } {
  let moment = from;

  for (let attempt = 0; attempt < 120; attempt += 1) {
    const name = backupName(kind, moment);
    if (!existsSync(path.join(config.backupsDir, name))) {
      return { name, moment };
    }

    moment = new Date(moment.getTime() + 1_000);
  }

  throw new BackupFailedError('Impossibile trovare un nome libero per il backup.');
}

/**
 * L'audit dei documenti dei cedolini dentro un file, aperto in sola lettura.
 *
 * Non solleva eccezioni, come `inspectDatabase`: un file che non si lascia
 * controllare è un esito che chi chiama deve saper rifiutare. La connessione
 * si chiude prima di restituire, così che il file si possa poi spostare.
 */
function auditFile(
  file: string,
): { readonly ok: true; readonly audit: PayslipDocumentsAudit } | { readonly ok: false } {
  let sqlite;
  try {
    sqlite = openSqlite(file, { readonly: true, fileMustExist: true });

    return { ok: true, audit: auditPayslipDocuments(sqlite) };
  } catch {
    return { ok: false };
  } finally {
    sqlite?.close();
  }
}

/**
 * Dove i documenti dei cedolini di un file non sono quelli che il manifest
 * dichiara, o `null` se coincidono.
 *
 * Il messaggio riporta soltanto conteggi: né identificativi né hash, e
 * tantomeno dati dei cedolini, perché finisce davanti all'utente e nei log.
 */
function documentsProblem(manifest: BackupManifest, audit: PayslipDocumentsAudit): string | null {
  if (audit.mismatched.length > 0) {
    return `${String(audit.mismatched.length)} documenti dei cedolini non hanno l'impronta registrata per il loro cedolino.`;
  }

  const declared = manifest.payslipDocuments;
  if (declared === undefined) {
    // Un manifest del formato 1 è stato scritto da una versione che i
    // documenti in archivio non li conosceva: se il database ne contiene,
    // manifest e database non vengono dallo stesso backup.
    return audit.entries.length === 0
      ? null
      : 'il database contiene documenti dei cedolini che un manifest del formato 1 non può descrivere.';
  }

  const same =
    declared.withoutDocument === audit.withoutDocument &&
    declared.entries.length === audit.entries.length &&
    declared.entries.every((entry, index) => {
      const found = audit.entries[index];

      return (
        found !== undefined &&
        found.payslipId === entry.payslipId &&
        found.sha256 === entry.sha256 &&
        found.bytes === entry.bytes
      );
    });

  return same ? null : 'i documenti dei cedolini nel database non corrispondono a quelli dichiarati dal manifest.';
}

/** Rimuove i file di lavoro rimasti da un tentativo precedente. */
function sweepPartials(): void {
  try {
    for (const name of readdirSync(config.tmpDir)) {
      if (name.endsWith(PARTIAL_SUFFIX)) {
        rmSync(path.join(config.tmpDir, name), { force: true });
      }
    }
  } catch {
    // La pulizia non è la garanzia: `VACUUM INTO` rifiuta comunque di
    // scrivere su un file esistente, quindi un residuo si farebbe notare.
  }
}

export const backupService = {
  /**
   * Crea un backup verificato e ne restituisce la descrizione.
   *
   * Solleva `BackupFailedError` se qualcosa non torna, senza lasciare tracce
   * in `backups/`: chi chiama può quindi trattare il ritorno come una
   * certezza — e chi deve migrare lo tratta come una condizione per procedere.
   *
   * `moment` è un parametro perché il nome dipende dall'orologio, e un test
   * deve poter creare backup di giorni diversi senza aspettare.
   *
   * `protect` sono nomi che la ritenzione di questa creazione non elimina:
   * il ripristino vi passa il backup scelto, che altrimenti potrebbe uscire
   * dalla finestra dei pre-restore proprio mentre lo si sta usando.
   */
  create(kind: BackupKind, moment: Date = new Date(), protect: readonly string[] = []): BackupInfo {
    ensureDataDirectories();
    sweepPartials();

    const { name, moment: stamp } = freeName(kind, moment);
    const partialDatabase = path.join(config.tmpDir, `${name}${PARTIAL_SUFFIX}`);
    const partialManifest = path.join(
      config.tmpDir,
      `${manifestNameFor(name)}${PARTIAL_SUFFIX}`,
    );

    const abort = (problem: string): never => {
      rmSync(partialDatabase, { force: true });
      rmSync(partialManifest, { force: true });

      throw new BackupFailedError(problem);
    };

    const expected = databaseSchema();

    try {
      vacuumInto(partialDatabase);
    } catch (error) {
      return abort(
        `Impossibile creare lo snapshot del database: ${
          error instanceof Error ? error.message : 'errore sconosciuto'
        }`,
      );
    }

    const inspection = inspectDatabase(partialDatabase);
    if (!inspection.ok) {
      return abort(`Il backup appena creato non ha superato la verifica: ${inspection.problem}`);
    }

    // Lo schema dello snapshot deve essere quello del database da cui proviene.
    // Le migrazioni non cambiano durante un backup, quindi una differenza qui
    // non è una corsa fra scritture: è un file che non è ciò che dovrebbe.
    if (
      inspection.schema.appliedCount !== expected.appliedCount ||
      inspection.schema.latestMillis !== expected.latestMillis
    ) {
      return abort(
        'Il backup appena creato dichiara una versione dello schema diversa da quella del database.',
      );
    }

    // I documenti dei cedolini dello snapshot, non dell'archivio vivo: il
    // manifest descrive il file che verrà pubblicato. Un documento che non ha
    // l'hash del suo cedolino non si archivia in un backup che si
    // dichiarerebbe verificato.
    const documents = auditFile(partialDatabase);
    if (!documents.ok) {
      return abort('Il backup appena creato non permette di controllare i documenti dei cedolini.');
    }
    if (documents.audit.mismatched.length > 0) {
      // Solo gli id: serve a sapere quale cedolino è corrotto, senza dati personali.
      logger.error('Backup annullato: documenti dei cedolini senza impronta corrispondente', {
        payslipIds: documents.audit.mismatched,
      });
      return abort(
        `Il backup non è stato creato: ${String(documents.audit.mismatched.length)} documenti dei cedolini in archivio non hanno l'impronta registrata per il loro cedolino.`,
      );
    }

    const manifest: BackupManifest = {
      format: BACKUP_FORMAT,
      kind,
      createdAt: stamp.toISOString(),
      appVersion: APP_VERSION,
      schemaVersion: inspection.schema,
      databaseFile: name,
      databaseBytes: inspection.bytes,
      databaseSha256: sha256OfFile(partialDatabase),
      rowCounts: inspection.rowCounts,
      payslipDocuments: {
        entries: documents.audit.entries,
        withoutDocument: documents.audit.withoutDocument,
      },
    };

    try {
      writeFileSync(partialManifest, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

      // Il manifest arriva a destinazione per primo: il database è il punto di
      // commit, e quando esiste il suo manifest c'è già. L'ordine opposto
      // lascerebbe, in caso di interruzione, un backup che sembra valido e non
      // si può verificare.
      renameSync(partialManifest, manifestPath(name));
      renameSync(partialDatabase, path.join(config.backupsDir, name));
    } catch (error) {
      return abort(
        `Impossibile archiviare il backup: ${
          error instanceof Error ? error.message : 'errore sconosciuto'
        }`,
      );
    }

    logger.info('Backup creato', {
      nome: name,
      byte: manifest.databaseBytes,
      righe: manifest.rowCounts,
    });

    backupService.prune(protect);

    return {
      name,
      kind,
      createdAt: manifest.createdAt,
      localTime: localTimestampOf(parseBackupName(name) ?? { kind, day: '', time: '' }),
      bytes: manifest.databaseBytes,
      appVersion: manifest.appVersion,
      schemaVersion: manifest.schemaVersion,
      rowCounts: manifest.rowCounts,
      status: 'completo',
      problem: null,
    };
  },

  /** I backup presenti, dal più recente al più vecchio. */
  list(): BackupInfo[] {
    ensureDataDirectories();

    const found: BackupInfo[] = [];

    for (const name of readdirSync(config.backupsDir).sort().reverse()) {
      const parsed = parseBackupName(name);
      if (parsed === null) {
        continue;
      }

      const file = path.join(config.backupsDir, name);
      const bytes = statSync(file).size;
      const base = {
        name,
        kind: parsed.kind,
        localTime: localTimestampOf(parsed),
        bytes,
      };

      const manifestFile = manifestPath(name);
      if (!existsSync(manifestFile)) {
        found.push({
          ...base,
          createdAt: null,
          appVersion: null,
          schemaVersion: null,
          rowCounts: {},
          status: 'senza-manifest',
          problem: 'manca il manifest: il backup non può essere verificato.',
        });
        continue;
      }

      let reading;
      try {
        reading = parseManifest(readFileSync(manifestFile, 'utf8'));
      } catch (error) {
        reading = {
          ok: false as const,
          problem: error instanceof Error ? error.message : 'manifest non leggibile.',
        };
      }

      if (!reading.ok) {
        found.push({
          ...base,
          createdAt: null,
          appVersion: null,
          schemaVersion: null,
          rowCounts: {},
          status: 'manifest-non-valido',
          problem: reading.problem,
        });
        continue;
      }

      found.push({
        ...base,
        createdAt: reading.manifest.createdAt,
        appVersion: reading.manifest.appVersion,
        schemaVersion: reading.manifest.schemaVersion,
        rowCounts: reading.manifest.rowCounts,
        status: 'completo',
        problem: null,
      });
    }

    return found;
  },

  /**
   * Verifica un backup fino in fondo: manifest, consistenza interna, impronta.
   *
   * Il nome arriva da fuori, quindi passa da `resolveBackupFile`: un nome che
   * non è un nome di backup non viene nemmeno trasformato in un percorso.
   */
  verify(name: string): BackupCheck {
    const file = resolveBackupFile(config.backupsDir, name);
    if (file === null) {
      return { ok: false, problem: `"${name}" non è il nome di un backup.` };
    }

    if (!existsSync(file)) {
      return { ok: false, problem: `Il backup "${name}" non esiste.` };
    }

    const manifestFile = manifestPath(name);
    if (!existsSync(manifestFile)) {
      return {
        ok: false,
        problem: `Il backup "${name}" non ha un manifest: non è un formato verificabile.`,
      };
    }

    let reading;
    try {
      reading = parseManifest(readFileSync(manifestFile, 'utf8'));
    } catch (error) {
      return {
        ok: false,
        problem: `Manifest di "${name}" non leggibile: ${
          error instanceof Error ? error.message : 'errore sconosciuto'
        }`,
      };
    }

    if (!reading.ok) {
      return { ok: false, problem: `Manifest di "${name}" non valido: ${reading.problem}` };
    }

    const inspection = inspectDatabase(file);
    if (!inspection.ok) {
      return { ok: false, problem: `Il backup "${name}" non è integro: ${inspection.problem}` };
    }

    const sha256 = sha256OfFile(file);
    if (sha256 !== reading.manifest.databaseSha256) {
      return {
        ok: false,
        problem: `Il backup "${name}" è stato modificato dopo la creazione: l'impronta non corrisponde.`,
      };
    }

    // L'impronta dice che il file è quello descritto dal manifest; l'audit
    // dice che i documenti dentro sono quelli che il manifest elenca.
    const documents = auditFile(file);
    if (!documents.ok) {
      return {
        ok: false,
        problem: `Il backup "${name}" non è integro: impossibile controllare i documenti dei cedolini.`,
      };
    }

    const problem = documentsProblem(reading.manifest, documents.audit);
    if (problem !== null) {
      return { ok: false, problem: `Il backup "${name}" non è valido: ${problem}` };
    }

    return {
      ok: true,
      file,
      manifest: reading.manifest,
      schema: inspection.schema,
      rowCounts: inspection.rowCounts,
      sha256,
    };
  },

  /**
   * Applica la politica di ritenzione e restituisce i nomi eliminati.
   *
   * Cancella soltanto ciò che riconosce: un file dal nome estraneo, o un
   * `.partial` finito per sbaglio in `backups/`, non viene toccato. Un
   * `.partial` non è mai un candidato all'eliminazione perché non è mai un
   * backup — la convenzione sui nomi lo esclude prima della politica.
   */
  prune(protect: readonly string[] = []): string[] {
    ensureDataDirectories();

    const names = readdirSync(config.backupsDir);
    const databases = names.filter((name) => parseBackupName(name) !== null);
    const removed: string[] = [];

    for (const name of backupsToPrune(databases).filter((name) => !protect.includes(name))) {
      rmSync(path.join(config.backupsDir, name), { force: true });
      rmSync(manifestPath(name), { force: true });
      removed.push(name);
    }

    // Un manifest senza il proprio database è un residuo di un'interruzione
    // fra i due rename: non descrive nulla e va rimosso.
    const survivors = new Set(
      readdirSync(config.backupsDir).filter((name) => parseBackupName(name) !== null),
    );
    for (const name of names) {
      if (!name.endsWith('.json')) {
        continue;
      }

      const database = `${name.slice(0, -'.json'.length)}${BACKUP_EXTENSION}`;
      if (parseBackupName(database) !== null && !survivors.has(database)) {
        rmSync(path.join(config.backupsDir, name), { force: true });
      }
    }

    if (removed.length > 0) {
      logger.info('Backup rimossi dalla ritenzione', { nomi: removed });
    }

    return removed;
  },
};

import { createHash } from 'node:crypto';
import { closeSync, openSync, readSync, statSync } from 'node:fs';
import type Database from 'better-sqlite3';
import { readDatabaseSchema, type SchemaVersion } from '../../db/schema-version.js';
import type { PayslipDocumentEntry } from '../payslips/index.js';
import { openSqlite } from '../../db/sqlite.js';
import type { BackupKind } from './backup.naming.js';

/**
 * Il manifest di un backup: ciò che permette di verificarlo invece di sperarci.
 *
 * Un file `.sqlite` che SQLite riesce ad aprire non è un backup: è un file che
 * SQLite riesce ad aprire. Potrebbe essere l'archivio di un'altra
 * applicazione, una versione futura dello schema, o lo stesso archivio con
 * qualche byte cambiato da un disco che sta cedendo. Il manifest è il
 * documento che dice cosa dovrebbe esserci dentro — impronta, versione dello
 * schema, conteggi — così che chi ripristina possa controllarlo prima di
 * sostituire i dati veri.
 *
 * Vive accanto al database, come file `.json` con lo stesso nome. Un backup
 * senza manifest non viene accettato per il ripristino: non è un formato che
 * questa applicazione sappia verificare.
 */

/**
 * Il formato scritto oggi. Rispetto al precedente aggiunge, obbligatorio,
 * l'elenco dei documenti dei cedolini contenuti nel database.
 */
export const BACKUP_FORMAT = 'appconto-backup/2';

/**
 * Il formato dei backup anteriori ai documenti dei cedolini: ancora
 * verificabile e ripristinabile. Qualunque altro valore significa "non so
 * verificarlo".
 */
export const LEGACY_BACKUP_FORMAT = 'appconto-backup/1';

/**
 * I documenti dei cedolini che il database dichiara di contenere.
 *
 * Solo identificativi, hash e byte: il manifest è un file in chiaro accanto
 * al backup, e nessun dato dei cedolini deve finirci. La verifica confronta
 * questo elenco con l'audit del file, voce per voce.
 */
export interface BackupPayslipDocuments {
  /** Un elemento per documento, ordinati per `payslipId`. */
  readonly entries: readonly PayslipDocumentEntry[];
  /** I cedolini senza documento nel database. */
  readonly withoutDocument: number;
}

export interface BackupManifest {
  readonly format: string;
  readonly kind: BackupKind;
  /** L'istante esatto, in UTC: il nome del file porta invece l'ora locale. */
  readonly createdAt: string;
  readonly appVersion: string;
  readonly schemaVersion: SchemaVersion;
  /** Il nome del database a cui questo manifest appartiene. */
  readonly databaseFile: string;
  readonly databaseBytes: number;
  readonly databaseSha256: string;
  /** Righe per tabella applicativa, a scopo di confronto e di lettura umana. */
  readonly rowCounts: Record<string, number>;
  /** Presente, e obbligatorio, dal formato 2; assente in un backup del formato 1. */
  readonly payslipDocuments?: BackupPayslipDocuments;
}

/** Quanto si legge alla volta calcolando l'impronta. */
const HASH_CHUNK_BYTES = 1024 * 1024;

/**
 * L'impronta SHA-256 di un file, letto a blocchi.
 *
 * A blocchi e non tutto in memoria: l'archivio di un conto usato per anni può
 * pesare centinaia di megabyte, e un backup non deve essere l'operazione che
 * fa mancare la memoria all'applicazione. Resta sincrona come tutto il resto
 * dell'accesso ai dati in questo progetto.
 */
export function sha256OfFile(file: string): string {
  const hash = createHash('sha256');
  const buffer = Buffer.allocUnsafe(HASH_CHUNK_BYTES);
  const handle = openSync(file, 'r');

  try {
    for (;;) {
      const read = readSync(handle, buffer, 0, HASH_CHUNK_BYTES, null);
      if (read === 0) {
        break;
      }
      hash.update(buffer.subarray(0, read));
    }
  } finally {
    closeSync(handle);
  }

  return hash.digest('hex');
}

/** Cosa si è trovato dentro un file candidato a essere un database. */
export type DatabaseInspection =
  | {
      readonly ok: true;
      readonly schema: SchemaVersion;
      readonly rowCounts: Record<string, number>;
      readonly bytes: number;
    }
  | { readonly ok: false; readonly problem: string };

/**
 * Apre un file in sola lettura e ne verifica la consistenza interna.
 *
 * Non solleva eccezioni: un file illeggibile o non-SQLite è un esito
 * previsto — è esattamente il caso che il ripristino deve saper rifiutare — e
 * chi chiama decide se è una richiesta sbagliata dell'utente o un guasto
 * interno.
 *
 * `integrity_check` e non `quick_check`: il controllo completo attraversa
 * l'intero file, e su un backup è il momento giusto per pagarlo.
 */
export function inspectDatabase(file: string): DatabaseInspection {
  let sqlite: Database.Database | undefined;

  try {
    const bytes = statSync(file).size;
    // `openSqlite` e non `new Database`: nel package il binario nativo va
    // indicato, e qui si apre un file che non è la connessione dell'app.
    sqlite = openSqlite(file, { readonly: true, fileMustExist: true });

    const integrity = sqlite.pragma('integrity_check', { simple: true });
    if (integrity !== 'ok') {
      return { ok: false, problem: `integrity_check ha risposto "${String(integrity)}".` };
    }

    const tables = (
      sqlite
        .prepare(
          `select name from sqlite_master where type = 'table' and name not like 'sqlite_%' order by name`,
        )
        .all() as { name: string }[]
    ).map((row) => row.name);

    const rowCounts: Record<string, number> = {};
    for (const table of tables) {
      // Le tabelle di servizio non sono dati dell'utente: la loro versione
      // viaggia già in `schema`, e nei conteggi sarebbero solo rumore.
      if (table.startsWith('__')) {
        continue;
      }

      const row = sqlite.prepare(`select count(*) as total from "${table}"`).get() as {
        total: number;
      };
      rowCounts[table] = Number(row.total);
    }

    return { ok: true, schema: readDatabaseSchema(sqlite), rowCounts, bytes };
  } catch (error) {
    return {
      ok: false,
      problem: error instanceof Error ? error.message : 'file non leggibile come database SQLite.',
    };
  } finally {
    sqlite?.close();
  }
}

/** Cosa si è trovato dentro un file candidato a essere un manifest. */
export type ManifestReading =
  | { readonly ok: true; readonly manifest: BackupManifest }
  | { readonly ok: false; readonly problem: string };

/** Il valore, se è una stringa non vuota. */
function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Il valore, se è un numero finito e non negativo. */
function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

/** Il valore, se è un intero non negativo. */
function integer(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

const SHA256_HEX = /^[0-9a-f]{64}$/;

/**
 * La sezione dei documenti, se ha esattamente la forma attesa.
 *
 * Nessuna tolleranza: un elemento malformato non si scarta in silenzio,
 * perché un elenco a cui manca una voce non si distinguerebbe più da un
 * archivio a cui manca un documento.
 */
function payslipDocumentsOf(value: unknown): BackupPayslipDocuments | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }

  const raw = value as Record<string, unknown>;
  const withoutDocument = integer(raw.withoutDocument);
  if (withoutDocument === null || !Array.isArray(raw.entries)) {
    return null;
  }

  const entries: PayslipDocumentEntry[] = [];
  for (const item of raw.entries as unknown[]) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      return null;
    }

    const entry = item as Record<string, unknown>;
    const bytes = integer(entry.bytes);
    if (
      typeof entry.payslipId !== 'string' ||
      entry.payslipId.length === 0 ||
      typeof entry.sha256 !== 'string' ||
      !SHA256_HEX.test(entry.sha256) ||
      bytes === null
    ) {
      return null;
    }

    entries.push({ payslipId: entry.payslipId, sha256: entry.sha256, bytes });
  }

  return { entries, withoutDocument };
}

/**
 * Interpreta il testo di un manifest.
 *
 * Ogni campo viene controllato: un manifest è un file su disco, e un file su
 * disco può essere stato scritto a metà, modificato a mano o prodotto da una
 * versione futura. Fidarsi della sua forma significherebbe far dipendere il
 * ripristino da un `JSON.parse` andato bene.
 */
export function parseManifest(content: string): ManifestReading {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { ok: false, problem: 'il manifest non è JSON valido.' };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, problem: 'il manifest non è un oggetto JSON.' };
  }

  const raw = parsed as Record<string, unknown>;

  const format = text(raw.format);
  if (format === null) {
    return { ok: false, problem: 'il manifest non dichiara il formato.' };
  }
  if (format !== BACKUP_FORMAT && format !== LEGACY_BACKUP_FORMAT) {
    return {
      ok: false,
      problem: `formato di backup non supportato: "${format}" (atteso "${BACKUP_FORMAT}" o "${LEGACY_BACKUP_FORMAT}").`,
    };
  }

  // Dal formato 2 l'elenco dei documenti è parte del manifest: senza, il
  // backup non si può verificare fino in fondo, quindi non è valido.
  let payslipDocuments: BackupPayslipDocuments | null = null;
  if (format === BACKUP_FORMAT) {
    payslipDocuments = payslipDocumentsOf(raw.payslipDocuments);
    if (payslipDocuments === null) {
      return { ok: false, problem: 'il manifest non descrive correttamente i documenti dei cedolini.' };
    }
  }

  const databaseSha256 = text(raw.databaseSha256);
  const databaseFile = text(raw.databaseFile);
  const createdAt = text(raw.createdAt);
  const kind = text(raw.kind);
  const databaseBytes = count(raw.databaseBytes);

  if (databaseSha256 === null || databaseFile === null || createdAt === null || kind === null) {
    return { ok: false, problem: 'il manifest è incompleto.' };
  }

  const schema = raw.schemaVersion;
  const asObject =
    typeof schema === 'object' && schema !== null ? (schema as Record<string, unknown>) : null;
  const appliedCount = asObject === null ? null : count(asObject.appliedCount);
  const latestMillis = asObject === null ? null : count(asObject.latestMillis);

  if (appliedCount === null || latestMillis === null) {
    return { ok: false, problem: 'il manifest non dichiara la versione dello schema.' };
  }

  const rowCounts: Record<string, number> = {};
  if (typeof raw.rowCounts === 'object' && raw.rowCounts !== null) {
    for (const [table, value] of Object.entries(raw.rowCounts as Record<string, unknown>)) {
      const total = count(value);
      if (total !== null) {
        rowCounts[table] = total;
      }
    }
  }

  return {
    ok: true,
    manifest: {
      format,
      kind: kind as BackupKind,
      createdAt,
      appVersion: text(raw.appVersion) ?? 'sconosciuta',
      schemaVersion: { appliedCount, latestMillis },
      databaseFile,
      databaseBytes: databaseBytes ?? 0,
      databaseSha256,
      rowCounts,
      ...(payslipDocuments === null ? {} : { payslipDocuments }),
    },
  };
}

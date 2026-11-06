import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';

/**
 * L'audit dei documenti dei cedolini dentro un file SQLite.
 *
 * Serve a backup e ripristino, che devono sapere se i PDF contenuti in un
 * archivio sono quelli che i cedolini dichiarano: uno per cedolino, con
 * l'hash registrato in `payslips.sha256`. L'impronta del file dice che il
 * database non è cambiato dopo il backup; l'audit dice che dentro c'è ciò
 * che deve esserci — e se ne accorge anche quando un documento è stato
 * alterato con la stessa lunghezza.
 *
 * Lavora su una connessione `better-sqlite3` qualunque, non su quella
 * dell'applicazione: la manutenzione la apre in sola lettura su uno
 * snapshot o su un backup, per questo qui si eseguono soltanto `SELECT`.
 * Nessuna query passa da Drizzle, perché il file può avere uno schema più
 * vecchio di quello corrente.
 *
 * Il risultato contiene identificativi, hash e byte: mai il contenuto dei
 * documenti né altri dati dei cedolini, perché finisce nei manifest.
 */

export interface PayslipDocumentEntry {
  readonly payslipId: string;
  /** SHA-256 calcolato dai byte del documento, non quello dichiarato. */
  readonly sha256: string;
  readonly bytes: number;
}

export interface PayslipDocumentsAudit {
  /** Un elemento per documento, ordinati per `payslipId`. */
  readonly entries: PayslipDocumentEntry[];
  /** I cedolini senza documento (versione precedente, file non ritrovato). */
  readonly withoutDocument: number;
  /** I `payslipId` il cui documento non ha l'hash del cedolino. */
  readonly mismatched: string[];
}

function hasTable(sqlite: Database.Database, name: string): boolean {
  return (
    sqlite.prepare(`select 1 from sqlite_master where type = 'table' and name = ?`).get(name) !== undefined
  );
}

export function auditPayslipDocuments(sqlite: Database.Database): PayslipDocumentsAudit {
  // Un backup anteriore alla feature: niente cedolini, niente da controllare.
  if (!hasTable(sqlite, 'payslips')) {
    return { entries: [], withoutDocument: 0, mismatched: [] };
  }

  // Un backup dello schema 0010: i PDF erano file su disco, quindi nessun
  // cedolino ha il documento in archivio.
  if (!hasTable(sqlite, 'payslip_documents')) {
    const row = sqlite.prepare('select count(*) as total from payslips').get() as { total: number };

    return { entries: [], withoutDocument: Number(row.total), mismatched: [] };
  }

  const entries: PayslipDocumentEntry[] = [];
  const mismatched: string[] = [];

  // `iterate` e non `all`: un documento alla volta in memoria, non l'intero
  // archivio dei PDF. Il `left join` fa emergere anche un documento senza
  // cedolino, possibile solo in un file scritto con le chiavi esterne spente.
  const rows = sqlite
    .prepare(
      `select d.payslip_id as payslipId, d.content as content, p.sha256 as expected
         from payslip_documents d
         left join payslips p on p.id = d.payslip_id
        order by d.payslip_id`,
    )
    .iterate() as IterableIterator<{ payslipId: string; content: unknown; expected: string | null }>;

  for (const row of rows) {
    const content = Buffer.isBuffer(row.content) ? row.content : Buffer.from(String(row.content ?? ''));
    const sha256 = createHash('sha256').update(content).digest('hex');

    entries.push({ payslipId: row.payslipId, sha256, bytes: content.length });
    if (row.expected !== sha256) {
      mismatched.push(row.payslipId);
    }
  }

  const without = sqlite
    .prepare(
      `select count(*) as total from payslips p
        where not exists (select 1 from payslip_documents d where d.payslip_id = p.id)`,
    )
    .get() as { total: number };

  return { entries, withoutDocument: Number(without.total), mismatched };
}

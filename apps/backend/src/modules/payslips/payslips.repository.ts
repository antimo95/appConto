import { randomUUID } from 'node:crypto';
import { and, asc, eq, gte, inArray, isNull, lte, sql, type SQL } from 'drizzle-orm';
import { db } from '../../db/client.js';
import {
  PAYSLIP_KINDS,
  type LeaveBalance,
  type LeaveType,
  type Payslip,
  type PayslipItem,
  type PayslipKind,
  type PayslipSection,
} from './payslip.model.js';
import { payslipDocuments, payslipItems, payslipLeaveBalances, payslips } from './payslips.schema.js';

/**
 * Accesso alle tabelle dei cedolini.
 *
 * Il repository non decide nulla: niente conflitti. Riceve e restituisce
 * cedolini interi — testata, voci, saldi — perché un cedolino a metà non ha
 * senso, né in lettura né in scrittura. L'atomicità delle scritture composte
 * è del servizio, che le racchiude in `atomically`.
 *
 * Il PDF si scrive insieme al cedolino ma si legge a parte: elenchi e
 * dettagli chiedono soltanto se c'è, e i suoi byte si caricano solo quando
 * qualcuno vuole aprirlo.
 */

export type PayslipRow = typeof payslips.$inferSelect;

/** Un cedolino che non ha il documento in archivio, con l'hash che il documento dovrebbe avere. */
export interface PayslipWithoutDocument {
  id: string;
  sha256: string;
}

type EditableHeader = Omit<PayslipRow, 'id' | 'fileName' | 'sha256' | 'importedAt' | 'parserId'>;

/** I byte come li vuole il driver: un `Buffer`, senza copiarli se lo sono già. */
function asBuffer(bytes: Uint8Array): Buffer {
  return Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/** I campi della testata che una correzione può cambiare; quelli assenti restano come sono. */
export type PayslipHeaderPatch = { [K in keyof EditableHeader]?: EditableHeader[K] | undefined };

export interface PayslipListFilter {
  from: string | null;
  to: string | null;
  direction: 'asc' | 'desc';
}

function periodRange(from: string | null, to: string | null): SQL | undefined {
  const conditions: SQL[] = [];
  if (from !== null) {
    conditions.push(gte(payslips.period, from));
  }
  if (to !== null) {
    conditions.push(lte(payslips.period, to));
  }

  return conditions.length === 0 ? undefined : and(...conditions);
}

/** L'ordine dei tipi a parità di mese: l'ordinario per primo. */
function kindRank(kind: string): number {
  return PAYSLIP_KINDS.indexOf(kind as PayslipKind);
}

function itemRows(payslipId: string, items: readonly PayslipItem[]) {
  return items.map((item, position) => ({ id: randomUUID(), payslipId, position, ...item }));
}

function leaveRows(payslipId: string, balances: readonly LeaveBalance[]) {
  return balances.map((balance) => ({ id: randomUUID(), payslipId, ...balance }));
}

/** Voci e saldi di più cedolini in due query, non due per cedolino. */
function hydrate(rows: readonly PayslipRow[]): Payslip[] {
  if (rows.length === 0) {
    return [];
  }

  const ids = rows.map((row) => row.id);
  const items = db
    .select()
    .from(payslipItems)
    .where(inArray(payslipItems.payslipId, ids))
    .orderBy(asc(payslipItems.position))
    .all();
  const balances = db
    .select()
    .from(payslipLeaveBalances)
    .where(inArray(payslipLeaveBalances.payslipId, ids))
    .orderBy(asc(payslipLeaveBalances.type))
    .all();

  return rows.map((row) => ({
    ...row,
    kind: row.kind as PayslipKind,
    items: items
      .filter((item) => item.payslipId === row.id)
      .map((item) => ({
        code: item.code,
        description: item.description,
        section: item.section as PayslipSection,
        amountCents: item.amountCents,
        quantity: item.quantity,
        unit: item.unit,
      })),
    leaveBalances: balances
      .filter((balance) => balance.payslipId === row.id)
      .map((balance) => ({
        type: balance.type as LeaveType,
        accrued: balance.accrued,
        used: balance.used,
        remaining: balance.remaining,
        unit: balance.unit,
      })),
  }));
}

export const payslipsRepository = {
  /** Per mese nella direzione richiesta; a parità di mese l'ordinario viene per primo. */
  list(filter: PayslipListFilter): PayslipRow[] {
    const sign = filter.direction === 'asc' ? 1 : -1;

    return db
      .select()
      .from(payslips)
      .where(periodRange(filter.from, filter.to))
      .all()
      .sort((a, b) => sign * a.period.localeCompare(b.period) || kindRank(a.kind) - kindRank(b.kind));
  },

  /** I cedolini completi di un tipo fino a `to` compreso: servono ai confronti, che sono fra ordinari. */
  listComplete(to: string | null, kind: PayslipKind = 'ordinary'): Payslip[] {
    return hydrate(
      db
        .select()
        .from(payslips)
        .where(and(periodRange(null, to), eq(payslips.kind, kind)))
        .orderBy(asc(payslips.period))
        .all(),
    );
  },

  findById(id: string): Payslip | null {
    const row = db.select().from(payslips).where(eq(payslips.id, id)).get();

    return row === undefined ? null : (hydrate([row])[0] ?? null);
  },

  findRowByPeriodAndKind(period: string, kind: PayslipKind): PayslipRow | null {
    return (
      db
        .select()
        .from(payslips)
        .where(and(eq(payslips.period, period), eq(payslips.kind, kind)))
        .get() ?? null
    );
  },

  findRowBySha256(sha256: string): PayslipRow | null {
    return db.select().from(payslips).where(eq(payslips.sha256, sha256)).get() ?? null;
  },

  /** Se il cedolino ha il documento in archivio, senza leggerne i byte. */
  hasDocument(id: string): boolean {
    return (
      db
        .select({ found: sql<number>`1` })
        .from(payslipDocuments)
        .where(eq(payslipDocuments.payslipId, id))
        .get() !== undefined
    );
  },

  /** I byte del PDF originale, o `null` se il cedolino non ha documento. */
  findDocument(id: string): Buffer | null {
    const row = db
      .select({ content: payslipDocuments.content })
      .from(payslipDocuments)
      .where(eq(payslipDocuments.payslipId, id))
      .get();

    return row?.content ?? null;
  },

  /** I cedolini senza documento: quelli della versione precedente, in attesa del loro file. */
  listWithoutDocument(): PayslipWithoutDocument[] {
    return db
      .select({ id: payslips.id, sha256: payslips.sha256 })
      .from(payslips)
      .leftJoin(payslipDocuments, eq(payslipDocuments.payslipId, payslips.id))
      .where(isNull(payslipDocuments.payslipId))
      .orderBy(asc(payslips.id))
      .all();
  },

  /** Gli hash dei cedolini che il documento ce l'hanno già. */
  documentHashes(): Set<string> {
    return new Set(
      db
        .select({ sha256: payslips.sha256 })
        .from(payslips)
        .innerJoin(payslipDocuments, eq(payslipDocuments.payslipId, payslips.id))
        .all()
        .map((row) => row.sha256),
    );
  },

  /** Aggiunge il documento a un cedolino che non lo ha: il controllo dell'hash spetta a chi chiama. */
  attachDocument(id: string, content: Uint8Array): void {
    db.insert(payslipDocuments).values({ payslipId: id, content: asBuffer(content) }).run();
  },

  /** Testata, voci, saldi e documento: chi chiama li racchiude in una transazione. */
  insert(payslip: Payslip, document: Uint8Array): void {
    const { items, leaveBalances, ...header } = payslip;

    db.insert(payslips).values(header).run();
    if (items.length > 0) {
      db.insert(payslipItems).values(itemRows(payslip.id, items)).run();
    }
    if (leaveBalances.length > 0) {
      db.insert(payslipLeaveBalances).values(leaveRows(payslip.id, leaveBalances)).run();
    }
    db.insert(payslipDocuments).values({ payslipId: payslip.id, content: asBuffer(document) }).run();
  },

  updateHeader(id: string, patch: PayslipHeaderPatch): void {
    const changes = Object.fromEntries(
      Object.entries(patch).filter(([, value]) => value !== undefined),
    ) as Partial<EditableHeader>;

    if (Object.keys(changes).length > 0) {
      db.update(payslips).set(changes).where(eq(payslips.id, id)).run();
    }
  },

  replaceItems(id: string, items: readonly PayslipItem[]): void {
    db.delete(payslipItems).where(eq(payslipItems.payslipId, id)).run();
    if (items.length > 0) {
      db.insert(payslipItems).values(itemRows(id, items)).run();
    }
  },

  replaceLeaveBalances(id: string, balances: readonly LeaveBalance[]): void {
    db.delete(payslipLeaveBalances).where(eq(payslipLeaveBalances.payslipId, id)).run();
    if (balances.length > 0) {
      db.insert(payslipLeaveBalances).values(leaveRows(id, balances)).run();
    }
  },

  /** Voci, saldi e documento seguono per `ON DELETE CASCADE`. */
  delete(id: string): void {
    db.delete(payslips).where(eq(payslips.id, id)).run();
  },
};

export type PayslipsRepository = typeof payslipsRepository;

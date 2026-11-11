import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { merchants } from '../merchants/merchants.schema.js';

/**
 * Tabella SQLite delle transazioni.
 *
 * L'importo è memorizzato in centesimi (intero) per evitare gli errori
 * di arrotondamento dei numeri in virgola mobile; la conversione da/verso
 * il dominio avviene nel repository.
 *
 * `fingerprint` è l'identità del movimento ed è univoco: è il database a
 * garantire che la stessa transazione non venga inserita due volte.
 *
 * `merchants` viene importato per dichiarare il vincolo di integrità
 * referenziale. Il repository scrive solo su questa tabella, ma in lettura la
 * unisce a `merchants` e `categories` per la ricerca e i filtri.
 */
export const transactions = sqliteTable('transactions', {
  id: text('id').primaryKey(),
  bookingDate: text('booking_date').notNull(),
  description: text('description').notNull(),
  amountCents: integer('amount_cents').notNull(),
  merchantId: text('merchant_id').references(() => merchants.id),
  fingerprint: text('fingerprint').unique(),
  type: text('type').notNull().default('EXPENSE'),
});

import { blob, index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

/**
 * Tabelle SQLite dei cedolini.
 *
 * Non hanno legami con movimenti, prestiti o categorie: lo stipendio che
 * arriva sul conto è già un movimento importato, e il cedolino lo spiega
 * senza toccarlo.
 *
 * Gli importi sono in centesimi interi. Quantità, ore e saldi di ferie non
 * sono denaro e restano `REAL`, come il cedolino li stampa. Nessuna colonna
 * per delta o confronti: si calcolano.
 *
 * Voci e saldi appartengono al cedolino e muoiono con lui (`ON DELETE
 * CASCADE`): non hanno un'esistenza propria da proteggere.
 */
export const payslips = sqliteTable(
  'payslips',
  {
    id: text('id').primaryKey(),
    /** Mese di competenza, `YYYY-MM`: uno solo per mese. */
    period: text('period').notNull(),
    employer: text('employer'),
    fileName: text('file_name').notNull(),
    /** SHA-256 del PDF: lo stesso file non entra due volte. */
    sha256: text('sha256').notNull(),
    importedAt: text('imported_at').notNull(),
    parserId: text('parser_id').notNull(),
    totalEarningsCents: integer('total_earnings_cents').notNull(),
    totalDeductionsCents: integer('total_deductions_cents').notNull(),
    netCents: integer('net_cents').notNull(),
    roundingCents: integer('rounding_cents'),
    taxableInpsCents: integer('taxable_inps_cents'),
    taxableIrpefCents: integer('taxable_irpef_cents'),
    workedHours: real('worked_hours'),
  },
  (table) => [
    uniqueIndex('payslips_period_unique').on(table.period),
    uniqueIndex('payslips_sha256_unique').on(table.sha256),
  ],
);

export const payslipItems = sqliteTable(
  'payslip_items',
  {
    id: text('id').primaryKey(),
    payslipId: text('payslip_id')
      .notNull()
      .references(() => payslips.id, { onDelete: 'cascade' }),
    /** L'ordine della riga sul cedolino. */
    position: integer('position').notNull(),
    code: text('code'),
    description: text('description').notNull(),
    /** `earning`, `deduction`, `employer_contribution`, `informational`. */
    section: text('section').notNull(),
    amountCents: integer('amount_cents').notNull(),
    quantity: real('quantity'),
    unit: text('unit'),
  },
  (table) => [index('payslip_items_payslip_id_idx').on(table.payslipId)],
);

export const payslipLeaveBalances = sqliteTable(
  'payslip_leave_balances',
  {
    id: text('id').primaryKey(),
    payslipId: text('payslip_id')
      .notNull()
      .references(() => payslips.id, { onDelete: 'cascade' }),
    /** `FERIE` oppure `PAR`: uno per tipo e per cedolino. */
    type: text('type').notNull(),
    accrued: real('accrued').notNull(),
    used: real('used').notNull(),
    remaining: real('remaining').notNull(),
    unit: text('unit').notNull(),
  },
  (table) => [uniqueIndex('payslip_leave_balances_payslip_type_unique').on(table.payslipId, table.type)],
);

/**
 * Il PDF originale di un cedolino confermato, dentro l'archivio.
 *
 * Nel database e non su disco: il filesystem non partecipa alle transazioni
 * SQLite, mentre qui documento e righe nascono, si sostituiscono e muoiono
 * nella stessa transazione. Backup, ripristino e azzeramento, che trattano
 * il database come un file unico e verificato, includono i documenti senza
 * un secondo meccanismo.
 *
 * Tabella a parte, e non una colonna di `payslips`: elenchi e dettagli non
 * devono trascinarsi dietro decine di kilobyte per riga. L'hash è
 * `payslips.sha256`, e non si duplica. Un cedolino può non avere documento
 * solo se viene dalla versione precedente e il suo file non è stato ritrovato.
 */
export const payslipDocuments = sqliteTable('payslip_documents', {
  payslipId: text('payslip_id')
    .primaryKey()
    .references(() => payslips.id, { onDelete: 'cascade' }),
  content: blob('content', { mode: 'buffer' }).notNull(),
});

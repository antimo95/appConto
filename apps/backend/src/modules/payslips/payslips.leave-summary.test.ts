import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

/**
 * Il riepilogo di ferie e P.A.R. su un archivio vero.
 *
 * Tre cedolini caricati fuori ordine cronologico: l'ordine di caricamento non
 * deve contare. Correzioni, sostituzioni e cancellazioni ricalcolano tutto,
 * perché nulla di derivato è salvato.
 *
 * Il database e la cartella dei dati sono temporanei.
 */

const dataRoot = mkdtempSync(path.join(tmpdir(), 'appconto-payslipsleave-'));
process.env.DATABASE_FILE = path.join(dataRoot, 'database.sqlite');

const { closeDatabase, db, runMigrations } = await import('../../db/client.js');
const { sql } = await import('drizzle-orm');
const { syntheticPayslipPdf } = await import('./testing/payslip-fixtures.js');
const { payslipsService } = await import('./payslips.service.js');
import type { FixtureLine } from './testing/payslip-fixtures.js';

runMigrations();

after(() => {
  closeDatabase();
  try {
    rmSync(dataRoot, { recursive: true, force: true });
  } catch {
    // su Windows il file può restare bloccato: è una cartella temporanea
  }
});

type Analysis = Awaited<ReturnType<typeof payslipsService.analyze>>;
type Balance = readonly [accrued: number, used: number, remaining: number];

const italiano = (value: number): string => value.toFixed(5).replace('.', ',');

/** Sostituisce i valori delle righe FERIE e P.A.R. del cedolino sintetico. */
function withBalances(ferie: Balance, par: Balance, apFerie: number, apPar: number, extra?: string) {
  return (lines: FixtureLine[]): FixtureLine[] => {
    const rows: Record<string, readonly number[]> = {
      '121.3': [ferie[0], ferie[1], ferie[2], apFerie],
      '110.9': [par[0], par[1], par[2], apPar],
    };
    const columns = [122.3, 188, 252, 316.6];
    const edited = lines.map((line): FixtureLine => {
      const values = rows[String(line[0])];
      const column = columns.indexOf(line[1]);
      return values !== undefined && column !== -1 && values[column] !== undefined
        ? [line[0], line[1], italiano(values[column])]
        : line;
    });
    return extra === undefined ? edited : [...edited, [60, 30, extra]];
  };
}

// Residuo AP: FERIE 10, P.A.R. 2. Maturato e goduto progressivi nell'anno.
const SERIE = {
  'Gennaio 2026': { ferie: [2, 0, 12], par: [1, 0, 3] },
  'Febbraio 2026': { ferie: [4, 1, 13], par: [2, 0, 4] },
  'Marzo 2026': { ferie: [6, 1, 15], par: [3, 1, 4] },
} as const satisfies Record<string, { ferie: Balance; par: Balance }>;

type Mese = keyof typeof SERIE;

async function importa(mese: Mese, extra?: string, ferie: Balance = SERIE[mese].ferie, replaceExisting = false) {
  const analysis: Analysis = await payslipsService.analyze(
    syntheticPayslipPdf({ month: mese, edit: withBalances(ferie, SERIE[mese].par, 10, 2, extra) }),
    `${mese}.pdf`,
  );
  return payslipsService.create({ analysisId: analysis.id, ...analysis.draft, replaceExisting });
}

const summaries = () => payslipsService.summaries({ from: null, to: null });
const ferieOf = (summary: ReturnType<typeof summaries>) => {
  const type = summary.leave.types.find((t) => t.type === 'FERIE');
  assert.ok(type !== undefined);
  return type;
};

const ids: Partial<Record<Mese, string>> = {};

describe('riepilogo ferie su tre cedolini caricati fuori ordine', () => {
  it('importa marzo, gennaio e febbraio: i saldi letti sono quelli attesi', async () => {
    for (const mese of ['Marzo 2026', 'Gennaio 2026', 'Febbraio 2026'] as const) {
      const detail = await importa(mese);
      ids[mese] = detail.id;
      assert.deepEqual(
        detail.leaveBalances.map((b) => [b.type, b.accrued, b.used, b.remaining]),
        [
          ['FERIE', ...SERIE[mese].ferie],
          ['PAR', ...SERIE[mese].par],
        ],
      );
    }
  });

  it('andamento crescente e verifica coerente, qualunque sia l\'ordine di caricamento', () => {
    const summary = summaries();

    assert.deepEqual(summary.trend.map((point) => point.period), ['2026-01', '2026-02', '2026-03']);
    assert.deepEqual(summary.leave.types.map((t) => t.type), ['FERIE', 'PAR']);
    for (const type of summary.leave.types) {
      assert.deepEqual(type.checks.map((c) => c.period), ['2026-01', '2026-02', '2026-03']);
      assert.deepEqual(type.checks.map((c) => c.status), ['non_verificabile', 'coerente', 'coerente']);
      assert.equal(type.status, 'coerente');
    }
    assert.deepEqual(summary.leave.anomalies, []);
    assert.deepEqual(summary.leave.coverage, { from: '2026-01', to: '2026-03', payslipCount: 3, missingPeriods: [] });
    assert.equal(ferieOf(summary).checks[2]?.previousPayslipId, ids['Febbraio 2026']);
    assert.equal(ferieOf(summary).latest?.remaining, 15);
  });

  it('una correzione che rompe la continuità fa comparire l\'anomalia sul mese giusto', () => {
    payslipsService.update(ids['Marzo 2026'] ?? '', {
      leaveBalances: [
        { type: 'FERIE', accrued: 6, used: 1, remaining: 16, unit: 'ORE' },
        { type: 'PAR', accrued: 3, used: 1, remaining: 4, unit: 'ORE' },
      ],
    });
    const summary = summaries();

    assert.deepEqual(summary.leave.anomalies.map((c) => [c.type, c.period, c.payslipId]), [
      ['FERIE', '2026-03', ids['Marzo 2026']],
    ]);
    const anomalia = summary.leave.anomalies[0];
    assert.equal(anomalia?.expectedRemaining, 15);
    assert.equal(anomalia?.observedRemaining, 16);
    assert.equal(anomalia?.difference, 1);
    assert.equal(ferieOf(summary).status, 'anomalia');
    assert.equal(summary.leave.types.find((t) => t.type === 'PAR')?.status, 'coerente');
  });

  it('riportare il valore com\'era ricalcola: l\'anomalia sparisce', () => {
    payslipsService.update(ids['Marzo 2026'] ?? '', {
      leaveBalances: [
        { type: 'FERIE', accrued: 6, used: 1, remaining: 15, unit: 'ORE' },
        { type: 'PAR', accrued: 3, used: 1, remaining: 4, unit: 'ORE' },
      ],
    });

    assert.deepEqual(summaries().leave.anomalies, []);
  });

  it('la sostituzione di un mese ricalcola: febbraio sbagliato genera anomalia, quello giusto la toglie', async () => {
    const sbagliato = await importa('Febbraio 2026', 'Rettifica A', [4, 1, 18], true);
    ids['Febbraio 2026'] = sbagliato.id;

    let summary = summaries();
    assert.deepEqual(
      summary.leave.anomalies.map((c) => c.period),
      ['2026-02', '2026-03'],
      'febbraio non discende da gennaio e marzo non discende dal febbraio stampato',
    );
    assert.equal(summary.leave.anomalies[0]?.payslipId, sbagliato.id);
    assert.equal(ferieOf(summary).checks[2]?.previousPayslipId, sbagliato.id);

    const giusto = await importa('Febbraio 2026', 'Rettifica B', undefined, true);
    ids['Febbraio 2026'] = giusto.id;
    summary = summaries();
    assert.deepEqual(summary.leave.anomalies, []);
    assert.equal(ferieOf(summary).status, 'coerente');
  });

  it('eliminare il mese di mezzo lo rende un periodo mancante; i valori coerenti restano coerenti', () => {
    payslipsService.remove(ids['Febbraio 2026'] ?? '');
    const summary = summaries();

    assert.deepEqual(summary.leave.coverage.missingPeriods, ['2026-02']);
    assert.equal(summary.leave.coverage.payslipCount, 2);
    const marzo = ferieOf(summary).checks.find((c) => c.period === '2026-03');
    assert.equal(marzo?.previousPeriod, '2026-01');
    assert.equal(marzo?.status, 'coerente');
    assert.ok(summary.leave.limitations.some((text) => /mancant/i.test(text)));
  });

  it('con il mese mancante e un valore che non torna, il verdetto è non verificabile', () => {
    payslipsService.update(ids['Marzo 2026'] ?? '', {
      leaveBalances: [{ type: 'FERIE', accrued: 6, used: 1, remaining: 99, unit: 'ORE' }],
    });
    const summary = summaries();

    assert.deepEqual(summary.leave.anomalies, []);
    assert.equal(ferieOf(summary).checks.find((c) => c.period === '2026-03')?.status, 'non_verificabile');
  });
});

describe('i cedolini non ordinari non entrano nella verifica', () => {
  it('una tredicesima con saldi incoerenti, nel mese che manca o in uno presente, non cambia nulla', async () => {
    const prima = summaries();
    assert.deepEqual(prima.leave.coverage.missingPeriods, ['2026-02']);

    // Saldi che non discendono da nessun ordinario, nel mese mancante e in marzo.
    for (const mese of ['Febbraio 2026', 'Marzo 2026'] as const) {
      const analysis = await payslipsService.analyze(
        syntheticPayslipPdf({ month: mese, edit: withBalances([6, 1, 77], [3, 1, 55], 10, 2, 'Tredicesima') }),
        'tredicesima.pdf',
      );
      const creato = payslipsService.create({ analysisId: analysis.id, ...analysis.draft, kind: 'thirteenth' });
      assert.equal(creato.kind, 'thirteenth');
    }

    const dopo = summaries();
    assert.deepEqual(dopo.leave.anomalies, []);
    assert.deepEqual(dopo, prima);
    assert.deepEqual(dopo.leave.coverage.missingPeriods, ['2026-02']);
  });
});

describe('nessun dato derivato è salvato', () => {
  it('nessuna tabella dei cedolini ha nomi di anomalie, verifiche o variazioni', () => {
    const tables = db
      .all<{ name: string }>(sql`select name from sqlite_master where type = 'table' and name like 'payslip%'`)
      .map((row) => row.name);
    assert.ok(tables.length > 0);
    assert.ok(!tables.some((name) => /anomal|check|verif|delta/i.test(name)), tables.join(', '));

    for (const table of tables) {
      const columns = db
        .all<{ name: string }>(sql`select name from pragma_table_info(${table})`)
        .map((row) => row.name);
      assert.ok(
        !columns.some((name) => /anomal|check|verif|delta/i.test(name)),
        `${table}: ${columns.join(', ')}`,
      );
    }
  });

  it('nessun indice, vista o trigger porta nomi di verifiche', () => {
    const names = db
      .all<{ name: string }>(sql`select name from sqlite_master where name like '%payslip%'`)
      .map((row) => row.name);
    assert.ok(!names.some((name) => /anomal|verif|delta|leave_check/i.test(name)), names.join(', '));
  });
});

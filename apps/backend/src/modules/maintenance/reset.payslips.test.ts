import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

/**
 * L'azzeramento e i cedolini.
 *
 * «Da zero» vale anche per i PDF: dopo l'azzeramento non devono restare né
 * righe, né file della versione precedente, né analisi in memoria — e
 * nemmeno i byte dei documenti nel file del database o nel suo `-wal`, dove
 * le pagine liberate sopravvivrebbero a un `DELETE` senza `VACUUM` e
 * checkpoint.
 *
 * Il PDF sintetico non è compresso: il nome inventato del dipendente compare
 * in chiaro nei suoi byte, ed è il marcatore che si cerca sul disco.
 *
 * ## Isolamento
 *
 * Radice dati temporanea scelta prima degli import.
 */

const dataRoot = mkdtempSync(path.join(tmpdir(), 'appconto-reset-payslips-'));
process.env.DATABASE_FILE = path.join(dataRoot, 'database.sqlite');

const { config } = await import('../../config.js');
const { closeDatabase, db, runMigrations } = await import('../../db/client.js');
const { sql } = await import('drizzle-orm');
const { DomainError } = await import('../../shared/errors.js');
const { payslipsService, payslipsStorage } = await import('../payslips/index.js');
const { syntheticPayslipPdf } = await import('../payslips/testing/payslip-fixtures.js');
const { backupService } = await import('./backup.service.js');
const { ResetFailedError, resetService, userTables } = await import('./reset.service.js');

runMigrations();

after(() => {
  closeDatabase();
  try {
    rmSync(dataRoot, { recursive: true, force: true });
  } catch {
    // su Windows il file può restare bloccato: è comunque una cartella temporanea
  }
});

/** Il nome sintetico stampato sul cedolino di prova, e il suo codice fiscale inventato. */
const MARCATORI = ['ROSSI MARIO', 'RSSMRA80A01H501U'];

const TABELLE_CEDOLINI = ['payslips', 'payslip_items', 'payslip_leave_balances', 'payslip_documents'];

const legacyDocuments = path.join(config.dataRoot, 'payslips');
const legacyPending = path.join(config.tmpDir, 'payslip-analyses');

function righe(tabella: string): number {
  return Number(db.get<{ total: number }>(sql`select count(*) as total from ${sql.identifier(tabella)}`)?.total ?? 0);
}

/** I byte grezzi del database e del suo `-wal`, come li vedrebbe chi apre la cartella. */
function byteSulDisco(): { database: Buffer; wal: Buffer } {
  const leggi = (file: string): Buffer => (existsSync(file) ? readFileSync(file) : Buffer.alloc(0));

  return { database: leggi(config.databaseFile), wal: leggi(`${config.databaseFile}-wal`) };
}

const contiene = (bytes: Buffer, marcatore: string): boolean => bytes.includes(Buffer.from(marcatore, 'latin1'));

async function conferma(month: string): Promise<string> {
  const analysis = await payslipsService.analyze(syntheticPayslipPdf({ month }), 'cedolino.pdf');

  return payslipsService.create({ analysisId: analysis.id, ...analysis.draft }).id;
}

/** I file della versione precedente: un documento e un'analisi abbandonata. */
function fileDellaVersionePrecedente(): void {
  mkdirSync(legacyDocuments, { recursive: true });
  mkdirSync(legacyPending, { recursive: true });
  writeFileSync(path.join(legacyDocuments, `${randomUUID()}.pdf`), syntheticPayslipPdf({ month: 'Gennaio 2020' }));
  writeFileSync(path.join(legacyPending, `${randomUUID()}.pdf`), syntheticPayslipPdf({ month: 'Febbraio 2020' }));
}

describe('isolamento del test', () => {
  it('lavora su una radice dati temporanea', () => {
    assert.ok(config.databaseFile.startsWith(dataRoot));
    assert.ok(legacyDocuments.startsWith(dataRoot));
    assert.ok(legacyPending.startsWith(dataRoot));
  });

  it('le tabelle dei cedolini, documenti compresi, sono fra quelle da svuotare', () => {
    for (const tabella of TABELLE_CEDOLINI) {
      assert.ok(userTables().includes(tabella), tabella);
    }
  });
});

describe('se la pulizia dei file fallisce, il database non si tocca', () => {
  it('ResetFailedError, e cedolini e documenti restano', async () => {
    const id = await conferma('Marzo 2026');
    const prima = Object.fromEntries(TABELLE_CEDOLINI.map((tabella) => [tabella, righe(tabella)]));

    // Il guasto si simula sostituendo per un momento il metodo del deposito
    // predefinito, quello che l'azzeramento usa.
    const originale = payslipsStorage.purge.bind(payslipsStorage);
    payslipsStorage.purge = () => {
      throw new Error('EBUSY: cartella in uso (simulata)');
    };

    try {
      assert.throws(
        () => resetService.run(new Date('2026-11-04T09:00:00')),
        (error: unknown) => {
          assert.ok(error instanceof ResetFailedError, `atteso ResetFailedError, ricevuto ${String(error)}`);

          return true;
        },
      );
    } finally {
      payslipsStorage.purge = originale;
    }

    assert.deepEqual(Object.fromEntries(TABELLE_CEDOLINI.map((tabella) => [tabella, righe(tabella)])), prima);
    assert.ok(payslipsService.document(id).content.length > 0);

    payslipsService.remove(id);
  });
});

describe('azzeramento con cedolini', () => {
  it('non lascia righe, file, analisi né byte dei PDF', async () => {
    await conferma('Ottobre 2026');
    await conferma('Settembre 2026');
    fileDellaVersionePrecedente();
    const inAttesa = await payslipsService.analyze(syntheticPayslipPdf({ month: 'Agosto 2026' }), 'agosto.pdf');

    for (const tabella of TABELLE_CEDOLINI) {
      assert.ok(righe(tabella) > 0, `${tabella} doveva contenere qualcosa`);
    }

    // Controllo: prima dell'azzeramento i byte dei PDF sono davvero sul disco.
    const prima = byteSulDisco();
    for (const marcatore of MARCATORI) {
      assert.ok(
        contiene(prima.database, marcatore) || contiene(prima.wal, marcatore),
        `il marcatore "${marcatore}" doveva comparire nei byte dell'archivio`,
      );
    }

    const esito = resetService.run(new Date('2026-11-04T10:00:00'));

    // Le righe eliminate sono riportate anche per i documenti.
    assert.equal(esito.removed.payslips, 2);
    assert.equal(esito.removed.payslip_documents, 2);

    for (const tabella of TABELLE_CEDOLINI) {
      assert.equal(righe(tabella), 0, `${tabella} deve essere vuota`);
    }

    // Le cartelle della versione precedente non esistono più.
    assert.ok(!existsSync(legacyDocuments));
    assert.ok(!existsSync(legacyPending));

    // L'analisi in memoria è stata dimenticata: non si conferma più.
    assert.throws(
      () => payslipsService.create({ analysisId: inAttesa.id, ...inAttesa.draft }),
      (error: unknown) => {
        assert.ok(error instanceof DomainError);
        assert.equal(error.code, 'NOT_FOUND');

        return true;
      },
    );
    assert.equal(righe('payslips'), 0);

    // Né il database né il suo `-wal` contengono ancora i byte dei PDF.
    const dopo = byteSulDisco();
    for (const marcatore of MARCATORI) {
      assert.ok(!contiene(dopo.database, marcatore), `"${marcatore}" è rimasto in database.sqlite`);
      assert.ok(!contiene(dopo.wal, marcatore), `"${marcatore}" è rimasto in database.sqlite-wal`);
    }
  });

  it('il backup pre-reset conserva i cedolini e i loro documenti: è la via per tornare indietro', () => {
    const preReset = backupService.list().find((info) => info.kind === 'pre-reset');
    assert.ok(preReset !== undefined);

    const check = backupService.verify(preReset.name);
    assert.ok(check.ok, check.ok ? '' : check.problem);
    assert.equal(check.manifest.payslipDocuments?.entries.length, 2);
  });

  it('dopo l\'azzeramento i cedolini si importano di nuovo, dallo stesso PDF', async () => {
    const id = await conferma('Ottobre 2026');
    assert.equal(payslipsService.getById(id).hasDocument, true);
  });
});

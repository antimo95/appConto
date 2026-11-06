import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * L'avvio riconcilia i PDF della versione precedente.
 *
 * `bootstrap()` è eseguito qui nello stesso processo: dopo le migrazioni deve
 * chiamare `payslipsStorage.reconcile()`, che porta in archivio i file la cui
 * impronta è quella di un cedolino senza documento, elimina i doppioni e le
 * vecchie analisi, e lascia tutto il resto.
 *
 * ## Isolamento
 *
 * Radice dati temporanea scelta prima degli import.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const migrazioniReali = path.resolve(here, '..', 'drizzle');

const dataRoot = mkdtempSync(path.join(tmpdir(), 'appconto-bootstrap-payslips-'));
process.env.DATABASE_FILE = path.join(dataRoot, 'database.sqlite');

const { bootstrap } = await import('./bootstrap.js');
const { config } = await import('./config.js');
const { closeDatabase, db } = await import('./db/client.js');
const { sql } = await import('drizzle-orm');
const { payslipsService } = await import('./modules/payslips/index.js');
const { syntheticPayslipPdf } = await import('./modules/payslips/testing/payslip-fixtures.js');

after(() => {
  closeDatabase();
  try {
    rmSync(dataRoot, { recursive: true, force: true });
  } catch {
    // su Windows il file può restare bloccato: è comunque una cartella temporanea
  }
});

const documentsDir = path.join(config.dataRoot, 'payslips');
const pendingDir = path.join(config.tmpDir, 'payslip-analyses');

function tuttiILog(): string {
  const logsDir = config.logsDir;
  if (!existsSync(logsDir)) {
    return '';
  }

  return readdirSync(logsDir)
    .map((nome) => readFileSync(path.join(logsDir, nome), 'utf8'))
    .join('\n');
}

describe('isolamento del test', () => {
  it('lavora su una radice dati temporanea', () => {
    assert.ok(config.dataRoot.startsWith(dataRoot));
    assert.ok(documentsDir.startsWith(dataRoot));
  });
});

describe('riconciliazione all\'avvio', () => {
  it('il primo avvio crea lo schema senza cartelle dei cedolini', () => {
    assert.equal(bootstrap(migrazioniReali).kind, 'inizializzato');
    assert.ok(!existsSync(documentsDir));
  });

  it('un PDF della versione precedente entra in archivio, il resto resta dov\'è', async () => {
    const pdf = syntheticPayslipPdf({ month: 'Settembre 2026' });
    const analysis = await payslipsService.analyze(pdf, 'settembre.pdf');
    const cedolino = payslipsService.create({ analysisId: analysis.id, ...analysis.draft });

    // Il cedolino come lo lascia la migrazione: la riga senza il documento,
    // e il PDF ancora nella cartella della versione precedente.
    db.run(sql`delete from payslip_documents where payslip_id = ${cedolino.id}`);
    assert.equal(payslipsService.getById(cedolino.id).hasDocument, false);

    mkdirSync(documentsDir, { recursive: true });
    mkdirSync(pendingDir, { recursive: true });
    writeFileSync(path.join(documentsDir, `${cedolino.id}.pdf`), pdf);
    const orfano = `${randomUUID()}.pdf`;
    writeFileSync(path.join(documentsDir, orfano), syntheticPayslipPdf({ month: 'Agosto 2019' }));
    writeFileSync(path.join(pendingDir, `${randomUUID()}.pdf`), syntheticPayslipPdf({ month: 'Luglio 2019' }));

    assert.equal(bootstrap(migrazioniReali).kind, 'allineato');

    assert.equal(payslipsService.getById(cedolino.id).hasDocument, true);
    assert.ok(payslipsService.document(cedolino.id).content.equals(pdf));
    assert.deepEqual(readdirSync(documentsDir), [orfano], 'resta solo il file senza prova');
    assert.deepEqual(existsSync(pendingDir) ? readdirSync(pendingDir) : [], []);

    // I log riportano conteggi, non contenuti né identificativi dei file.
    const log = tuttiILog();
    assert.ok(!log.includes('ROSSI'));
    assert.ok(!log.includes(orfano));
    assert.ok(!log.includes(cedolino.id));
  });

  it('un avvio successivo non ha più nulla da importare', () => {
    const prima = readdirSync(documentsDir);

    assert.equal(bootstrap(migrazioniReali).kind, 'allineato');
    assert.deepEqual(readdirSync(documentsDir), prima);
  });
});

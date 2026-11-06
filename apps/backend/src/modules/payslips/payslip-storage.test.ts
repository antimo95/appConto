import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

/**
 * La riconciliazione della versione precedente e la pulizia dei PDF su disco.
 *
 * La versione precedente teneva i PDF in `DATA_ROOT/payslips/<uuid>.pdf` e le
 * analisi in `tmp/payslip-analyses/`. La riconciliazione li porta in archivio
 * con una regola sola: **un file si elimina solo con una prova** — il suo
 * hash è quello di un cedolino. Tutto il resto resta dov'è.
 *
 * Due filesystem: quello vero, su cartelle temporanee, e uno finto in memoria
 * che fallisce a comando, per provare i guasti in modo deterministico.
 *
 * ## Isolamento
 *
 * Radice dati temporanea scelta prima degli import.
 */

const dataRoot = mkdtempSync(path.join(tmpdir(), 'appconto-payslip-storage-'));
process.env.DATABASE_FILE = path.join(dataRoot, 'database.sqlite');

import type { StorageFileSystem } from './payslip-storage.js';
import type { PendingAnalysis } from './payslip-analysis.store.js';

const { config } = await import('../../config.js');
const { closeDatabase, db, runMigrations } = await import('../../db/client.js');
const { sql } = await import('drizzle-orm');
const { syntheticPayslipPdf } = await import('./testing/payslip-fixtures.js');
const { payslipsService } = await import('./payslips.service.js');
const { payslipsRepository } = await import('./payslips.repository.js');
const { createAnalysisStore } = await import('./payslip-analysis.store.js');
const { createPayslipStorage, nodeFileSystem, payslipsStorage } = await import('./payslip-storage.js');
const featureIndex = await import('./index.js');

runMigrations();

after(() => {
  closeDatabase();
  try {
    rmSync(dataRoot, { recursive: true, force: true });
  } catch {
    // su Windows il file può restare bloccato: è comunque una cartella temporanea
  }
});

const pdfName = (): string => `${randomUUID()}.pdf`;

let mesi = 0;
const MESI = [
  'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
  'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre',
];

/** Un PDF sintetico con un mese mai usato prima in questo file: hash nuovo, periodo libero. */
function pdfNuovo(): Buffer {
  const indice = mesi;
  mesi += 1;
  const anno = 2010 + Math.floor(indice / 12);

  return syntheticPayslipPdf({ month: `${MESI[indice % 12] ?? 'Gennaio'} ${String(anno)}` });
}

/** Un cedolino confermato, con il suo documento in archivio. */
async function cedolinoConDocumento(pdf: Buffer = pdfNuovo()): Promise<{ id: string; pdf: Buffer }> {
  const analysis = await payslipsService.analyze(pdf, 'cedolino.pdf');
  const detail = payslipsService.create({ analysisId: analysis.id, ...analysis.draft });

  return { id: detail.id, pdf };
}

/**
 * Un cedolino come lo lascia la migrazione dalla versione precedente: la
 * riga c'è, il documento no — era un file su disco.
 */
async function cedolinoSenzaDocumento(pdf: Buffer = pdfNuovo()): Promise<{ id: string; pdf: Buffer }> {
  const cedolino = await cedolinoConDocumento(pdf);
  db.run(sql`delete from payslip_documents where payslip_id = ${cedolino.id}`);
  assert.equal(payslipsRepository.findDocument(cedolino.id), null);

  return cedolino;
}

let cartelle = 0;

/** Le due cartelle della versione precedente, vere e vuote. */
function cartelleLegacy(): { documentsDir: string; pendingDir: string } {
  cartelle += 1;
  const base = path.join(dataRoot, `legacy-${String(cartelle)}`);
  const documentsDir = path.join(base, 'payslips');
  const pendingDir = path.join(base, 'tmp', 'payslip-analyses');
  mkdirSync(documentsDir, { recursive: true });
  mkdirSync(pendingDir, { recursive: true });

  return { documentsDir, pendingDir };
}

const contenuto = (cartella: string): string[] => (existsSync(cartella) ? readdirSync(cartella).sort() : []);

function storageReale(dirs: { documentsDir: string; pendingDir: string }, analyses = createAnalysisStore()) {
  return createPayslipStorage({
    fs: nodeFileSystem,
    legacyDocumentsDir: dirs.documentsDir,
    legacyPendingDir: dirs.pendingDir,
    repository: payslipsRepository,
    analyses,
  });
}

/**
 * Un filesystem in memoria che fallisce dove gli si dice.
 *
 * I percorsi sono normalizzati con `path.resolve`, così il modulo può
 * comporli come preferisce.
 */
class FakeFileSystem implements StorageFileSystem {
  readonly files = new Map<string, Buffer>();
  readonly directories = new Set<string>();
  readonly unreadable = new Set<string>();
  readonly unremovable = new Set<string>();
  failRemoveDirectory = false;
  readonly removedDirectories: string[] = [];

  addDirectory(dir: string): void {
    this.directories.add(path.resolve(dir));
  }

  addFile(file: string, content: Buffer): void {
    this.addDirectory(path.dirname(file));
    this.files.set(path.resolve(file), content);
  }

  has(file: string): boolean {
    return this.files.has(path.resolve(file));
  }

  readdir(dir: string): string[] {
    const resolved = path.resolve(dir);
    if (!this.directories.has(resolved)) {
      throw Object.assign(new Error(`ENOENT: ${dir}`), { code: 'ENOENT' });
    }

    return [...this.files.keys()]
      .filter((file) => path.dirname(file) === resolved)
      .map((file) => path.basename(file))
      .sort();
  }

  readFile(file: string): Buffer {
    const resolved = path.resolve(file);
    if (this.unreadable.has(resolved)) {
      throw Object.assign(new Error('EACCES: lettura negata (simulata)'), { code: 'EACCES' });
    }
    const found = this.files.get(resolved);
    if (found === undefined) {
      throw Object.assign(new Error(`ENOENT: ${file}`), { code: 'ENOENT' });
    }

    return Buffer.from(found);
  }

  remove(file: string): void {
    const resolved = path.resolve(file);
    if (this.unremovable.has(resolved)) {
      throw Object.assign(new Error('EPERM: rimozione negata (simulata)'), { code: 'EPERM' });
    }
    this.files.delete(resolved);
  }

  removeDirectory(dir: string): void {
    const resolved = path.resolve(dir);
    if (this.failRemoveDirectory) {
      throw Object.assign(new Error('EBUSY: cartella in uso (simulata)'), { code: 'EBUSY' });
    }
    this.removedDirectories.push(resolved);
    this.directories.delete(resolved);
    for (const file of [...this.files.keys()]) {
      if (file.startsWith(`${resolved}${path.sep}`)) {
        this.files.delete(file);
      }
    }
  }

  exists(target: string): boolean {
    const resolved = path.resolve(target);

    return this.files.has(resolved) || this.directories.has(resolved);
  }
}

const FAKE_ROOT = path.join(dataRoot, 'finto');
const FAKE_DOCUMENTS = path.join(FAKE_ROOT, 'payslips');
const FAKE_PENDING = path.join(FAKE_ROOT, 'tmp', 'payslip-analyses');

function storageFinto(fs: FakeFileSystem, analyses = createAnalysisStore()) {
  fs.addDirectory(FAKE_DOCUMENTS);
  fs.addDirectory(FAKE_PENDING);

  return createPayslipStorage({
    fs,
    legacyDocumentsDir: FAKE_DOCUMENTS,
    legacyPendingDir: FAKE_PENDING,
    repository: payslipsRepository,
    analyses,
  });
}

/** Un'analisi in memoria, quanto basta per vederla sparire. */
function analisiInMemoria(id: string): PendingAnalysis {
  return {
    id,
    fileName: 'in-attesa.pdf',
    sha256: '0'.repeat(64),
    bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
    extraction: {} as PendingAnalysis['extraction'],
    expiresAt: Date.now() + 60 * 60 * 1000,
  };
}

const ZERO = { imported: 0, duplicatesRemoved: 0, unmatched: 0, failures: 0, pendingRemoved: 0 };

describe('isolamento del test', () => {
  it('lavora su una radice dati temporanea', () => {
    assert.ok(config.dataRoot.startsWith(dataRoot));
    assert.ok(config.tmpDir.startsWith(dataRoot));
  });

  it('il deposito predefinito e l\'adattatore reale sono esportati', () => {
    assert.equal(featureIndex.payslipsStorage, payslipsStorage);
    for (const metodo of ['readdir', 'readFile', 'remove', 'removeDirectory', 'exists'] as const) {
      assert.equal(typeof nodeFileSystem[metodo], 'function');
    }
  });
});

describe('riconciliazione su cartelle vere', () => {
  it('senza cartelle della versione precedente non fa nulla e non fallisce', () => {
    const base = path.join(dataRoot, 'mai-esistita');
    const storage = storageReale({
      documentsDir: path.join(base, 'payslips'),
      pendingDir: path.join(base, 'tmp', 'payslip-analyses'),
    });

    assert.deepEqual(storage.reconcile(), ZERO);
    assert.ok(!existsSync(base));
  });

  it('importa, scarta i doppioni, lascia ciò che non riconosce, svuota le analisi', async () => {
    const dirs = cartelleLegacy();
    const senzaDocumento = await cedolinoSenzaDocumento();
    const conDocumento = await cedolinoConDocumento();
    const sconosciuto = pdfNuovo();

    // Il file del cedolino senza documento, con il nome che gli dava la versione precedente.
    writeFileSync(path.join(dirs.documentsDir, `${senzaDocumento.id}.pdf`), senzaDocumento.pdf);
    // Un doppione di un documento già in archivio.
    const doppione = pdfName();
    writeFileSync(path.join(dirs.documentsDir, doppione), conDocumento.pdf);
    // Un PDF che nessun cedolino dichiara: nessuna prova, quindi resta.
    const orfano = pdfName();
    writeFileSync(path.join(dirs.documentsDir, orfano), sconosciuto);
    // Nomi che la versione precedente non avrebbe mai scritto: non si toccano.
    writeFileSync(path.join(dirs.documentsDir, 'note.txt'), 'non è un cedolino');
    writeFileSync(path.join(dirs.documentsDir, 'copia di cedolino.pdf'), senzaDocumento.pdf);
    // Analisi della versione precedente: non sono mai state cedolini.
    writeFileSync(path.join(dirs.pendingDir, pdfName()), pdfNuovo());
    writeFileSync(path.join(dirs.pendingDir, pdfName()), pdfNuovo());

    const report = storageReale(dirs).reconcile();

    assert.deepEqual(report, { imported: 1, duplicatesRemoved: 1, unmatched: 1, failures: 0, pendingRemoved: 2 });

    // Importato: il documento è in archivio, il file non c'è più.
    assert.ok(payslipsRepository.findDocument(senzaDocumento.id)?.equals(senzaDocumento.pdf));
    assert.equal(payslipsService.getById(senzaDocumento.id).hasDocument, true);
    // Il doppione è sparito, il documento in archivio è quello di prima.
    assert.ok(payslipsRepository.findDocument(conDocumento.id)?.equals(conDocumento.pdf));
    // Restano soltanto il file senza prova e quelli dai nomi estranei.
    assert.deepEqual(contenuto(dirs.documentsDir), ['copia di cedolino.pdf', 'note.txt', orfano].sort());
    assert.deepEqual(contenuto(dirs.pendingDir), []);
  });

  it('due copie dello stesso file: una si importa, l\'altra è un doppione', async () => {
    const dirs = cartelleLegacy();
    const cedolino = await cedolinoSenzaDocumento();
    writeFileSync(path.join(dirs.documentsDir, pdfName()), cedolino.pdf);
    writeFileSync(path.join(dirs.documentsDir, pdfName()), cedolino.pdf);

    const report = storageReale(dirs).reconcile();

    assert.deepEqual(report, { ...ZERO, imported: 1, duplicatesRemoved: 1 });
    assert.ok(payslipsRepository.findDocument(cedolino.id)?.equals(cedolino.pdf));
    assert.deepEqual(contenuto(dirs.documentsDir), []);
  });

  it('una seconda esecuzione non trova più nulla da fare', async () => {
    const dirs = cartelleLegacy();
    const cedolino = await cedolinoSenzaDocumento();
    writeFileSync(path.join(dirs.documentsDir, pdfName()), cedolino.pdf);
    const orfano = pdfName();
    writeFileSync(path.join(dirs.documentsDir, orfano), pdfNuovo());
    const storage = storageReale(dirs);

    assert.deepEqual(storage.reconcile(), { ...ZERO, imported: 1, unmatched: 1 });
    // Il file senza prova resta anche alla seconda: nessuna prova è comparsa.
    assert.deepEqual(storage.reconcile(), { ...ZERO, unmatched: 1 });
    assert.deepEqual(contenuto(dirs.documentsDir), [orfano]);
  });

  it('i cedolini senza documento, e i loro hash, si leggono dal repository', async () => {
    const cedolino = await cedolinoSenzaDocumento();
    const altro = await cedolinoConDocumento();

    const senza = payslipsRepository.listWithoutDocument();
    assert.ok(senza.some((voce) => voce.id === cedolino.id));
    assert.ok(!senza.some((voce) => voce.id === altro.id));

    const hash = payslipsRepository.documentHashes();
    const shaAltro = db.get<{ sha256: string }>(sql`select sha256 from payslips where id = ${altro.id}`)?.sha256;
    const shaCedolino = db.get<{ sha256: string }>(sql`select sha256 from payslips where id = ${cedolino.id}`)?.sha256;
    assert.ok(shaAltro !== undefined && hash.has(shaAltro));
    assert.ok(shaCedolino !== undefined && !hash.has(shaCedolino));

    payslipsRepository.attachDocument(cedolino.id, cedolino.pdf);
    assert.ok(payslipsRepository.findDocument(cedolino.id)?.equals(cedolino.pdf));
  });
});

describe('riconciliazione con guasti simulati', () => {
  it('un file illeggibile resta, conta come errore, e gli altri si elaborano', async () => {
    const fs = new FakeFileSystem();
    const storage = storageFinto(fs);
    const illeggibile = path.join(FAKE_DOCUMENTS, pdfName());
    const leggibile = path.join(FAKE_DOCUMENTS, pdfName());
    const cedolinoIlleggibile = await cedolinoSenzaDocumento();
    const cedolino = await cedolinoSenzaDocumento();

    fs.addFile(illeggibile, cedolinoIlleggibile.pdf);
    fs.unreadable.add(path.resolve(illeggibile));
    fs.addFile(leggibile, cedolino.pdf);

    const report = storage.reconcile();

    assert.deepEqual(report, { ...ZERO, imported: 1, failures: 1 });
    assert.ok(fs.has(illeggibile), 'un file illeggibile non si elimina');
    assert.ok(!fs.has(leggibile));
    assert.equal(payslipsRepository.findDocument(cedolinoIlleggibile.id), null);
    assert.ok(payslipsRepository.findDocument(cedolino.id)?.equals(cedolino.pdf));
  });

  it('rimozione fallita dopo l\'import: il documento è in archivio, il file sparisce al prossimo avvio', async () => {
    const fs = new FakeFileSystem();
    const storage = storageFinto(fs);
    const file = path.join(FAKE_DOCUMENTS, pdfName());
    const cedolino = await cedolinoSenzaDocumento();

    fs.addFile(file, cedolino.pdf);
    fs.unremovable.add(path.resolve(file));

    const primo = storage.reconcile();

    assert.equal(primo.imported, 1);
    assert.ok(payslipsRepository.findDocument(cedolino.id)?.equals(cedolino.pdf));
    assert.ok(fs.has(file), 'il file resta dove non si è potuto eliminare');

    // Il "prossimo avvio": il disco ora collabora, e il file è un doppione.
    fs.unremovable.clear();
    const secondo = storage.reconcile();

    assert.deepEqual(secondo, { ...ZERO, duplicatesRemoved: 1 });
    assert.ok(!fs.has(file));
    assert.ok(payslipsRepository.findDocument(cedolino.id)?.equals(cedolino.pdf));
  });

  it('un doppione che non si riesce a eliminare non ferma la riconciliazione', async () => {
    const fs = new FakeFileSystem();
    const storage = storageFinto(fs);
    const bloccato = path.join(FAKE_DOCUMENTS, pdfName());
    const daImportare = path.join(FAKE_DOCUMENTS, pdfName());
    const conDocumento = await cedolinoConDocumento();
    const senzaDocumento = await cedolinoSenzaDocumento();

    fs.addFile(bloccato, conDocumento.pdf);
    fs.unremovable.add(path.resolve(bloccato));
    fs.addFile(daImportare, senzaDocumento.pdf);

    const report = storage.reconcile();

    assert.equal(report.imported, 1);
    assert.ok(fs.has(bloccato));
    assert.ok(payslipsRepository.findDocument(senzaDocumento.id)?.equals(senzaDocumento.pdf));
  });

  it('i nomi che non sono <uuid>.pdf non vengono né letti né eliminati', async () => {
    const fs = new FakeFileSystem();
    const storage = storageFinto(fs);
    const cedolino = await cedolinoSenzaDocumento();
    const estranei = ['leggimi.txt', 'cedolino.pdf', '..pdf', 'abc.pdf.bak'];
    for (const nome of estranei) {
      fs.addFile(path.join(FAKE_DOCUMENTS, nome), cedolino.pdf);
      // Se il modulo provasse a leggerli, sarebbe un errore contato.
      fs.unreadable.add(path.resolve(FAKE_DOCUMENTS, nome));
    }

    const report = storage.reconcile();

    assert.deepEqual(report, ZERO);
    for (const nome of estranei) {
      assert.ok(fs.has(path.join(FAKE_DOCUMENTS, nome)), `${nome} deve restare`);
    }
    assert.equal(payslipsRepository.findDocument(cedolino.id), null);
  });

  it('le analisi della versione precedente si eliminano tutte', () => {
    const fs = new FakeFileSystem();
    const storage = storageFinto(fs);
    const analisi = [pdfName(), pdfName(), pdfName()].map((nome) => path.join(FAKE_PENDING, nome));
    for (const file of analisi) {
      fs.addFile(file, Buffer.from('%PDF-1.4 analisi abbandonata'));
    }

    const report = storage.reconcile();

    assert.deepEqual(report, { ...ZERO, pendingRemoved: 3 });
    for (const file of analisi) {
      assert.ok(!fs.has(file));
    }
  });

  it('l\'esito ha solo conteggi', async () => {
    const fs = new FakeFileSystem();
    const storage = storageFinto(fs);
    const cedolino = await cedolinoSenzaDocumento();
    fs.addFile(path.join(FAKE_DOCUMENTS, pdfName()), cedolino.pdf);

    const report = storage.reconcile();

    assert.deepEqual(Object.keys(report).sort(), [
      'duplicatesRemoved',
      'failures',
      'imported',
      'pendingRemoved',
      'unmatched',
    ]);
    for (const valore of Object.values(report)) {
      assert.equal(typeof valore, 'number');
    }
  });
});

describe('pulizia (reset)', () => {
  it('elimina le cartelle della versione precedente e svuota le analisi in memoria', () => {
    const dirs = cartelleLegacy();
    writeFileSync(path.join(dirs.documentsDir, pdfName()), pdfNuovo());
    writeFileSync(path.join(dirs.documentsDir, 'note.txt'), 'qualunque cosa');
    writeFileSync(path.join(dirs.pendingDir, pdfName()), pdfNuovo());
    const analyses = createAnalysisStore();
    analyses.save(analisiInMemoria('in-attesa'));
    assert.ok(analyses.get('in-attesa', Date.now()) !== null);

    storageReale(dirs, analyses).purge();

    assert.ok(!existsSync(dirs.documentsDir));
    assert.ok(!existsSync(dirs.pendingDir));
    assert.equal(analyses.get('in-attesa', Date.now()), null);
  });

  it('senza cartelle da eliminare non fallisce', () => {
    const base = path.join(dataRoot, 'niente-da-pulire');
    const storage = storageReale({
      documentsDir: path.join(base, 'payslips'),
      pendingDir: path.join(base, 'tmp', 'payslip-analyses'),
    });

    assert.doesNotThrow(() => {
      storage.purge();
    });
  });

  it('usa l\'adattatore per entrambe le cartelle', () => {
    const fs = new FakeFileSystem();
    const storage = storageFinto(fs);
    fs.addFile(path.join(FAKE_DOCUMENTS, pdfName()), Buffer.from('x'));
    fs.addFile(path.join(FAKE_PENDING, pdfName()), Buffer.from('y'));

    storage.purge();

    assert.equal(fs.files.size, 0);
    assert.ok(!fs.exists(FAKE_DOCUMENTS));
    assert.ok(!fs.exists(FAKE_PENDING));
  });

  it('un guasto nella pulizia si propaga: chi azzera deve fermarsi', () => {
    const fs = new FakeFileSystem();
    const analyses = createAnalysisStore();
    const storage = storageFinto(fs, analyses);
    fs.addFile(path.join(FAKE_DOCUMENTS, pdfName()), Buffer.from('x'));
    fs.failRemoveDirectory = true;

    assert.throws(() => {
      storage.purge();
    }, /EBUSY/);
  });
});

describe('deposito predefinito', () => {
  it('lavora sulle cartelle della radice dati', async () => {
    const cedolino = await cedolinoSenzaDocumento();
    const documentsDir = path.join(config.dataRoot, 'payslips');
    const pendingDir = path.join(config.tmpDir, 'payslip-analyses');
    mkdirSync(documentsDir, { recursive: true });
    mkdirSync(pendingDir, { recursive: true });
    writeFileSync(path.join(documentsDir, `${cedolino.id}.pdf`), cedolino.pdf);
    writeFileSync(path.join(pendingDir, pdfName()), pdfNuovo());

    const report = payslipsStorage.reconcile();

    assert.deepEqual(report, { ...ZERO, imported: 1, pendingRemoved: 1 });
    assert.ok(payslipsRepository.findDocument(cedolino.id)?.equals(cedolino.pdf));
    assert.deepEqual(contenuto(documentsDir), []);

    payslipsStorage.purge();
    assert.ok(!existsSync(documentsDir));
    assert.ok(!existsSync(pendingDir));
  });
});

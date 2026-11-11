import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { PAYSLIP_PARSERS } from './parsers.js';
import { extractPayslip } from './payslip-parser.js';
import { extractPdfText } from './pdf-text.js';

/**
 * Prova locale del parser sui cedolini veri.
 *
 * La cartella `samples/` alla radice del repo è ignorata da git: ci stanno i
 * PDF dell'utente, che non devono mai entrare nel repository. Senza PDF il
 * test è saltato, quindi sulle altre macchine e in CI non fa nulla.
 *
 * Riservatezza: né il nome dei test né i messaggi d'errore riportano nomi di
 * file o valori del cedolino. Le asserzioni usano messaggi fissi, perché
 * `assert.equal` stamperebbe i valori confrontati. Un file che non passa si
 * individua per posizione (`sample 1`, `sample 2`...), in ordine alfabetico.
 */

const samplesDir = path.resolve(import.meta.dirname, '../../../../../../samples');

const files = existsSync(samplesDir)
  ? readdirSync(samplesDir)
      .filter((name) => name.toLowerCase().endsWith('.pdf'))
      .sort()
  : [];

/** Gli scarti che il parser segnala quando i totali non tornano con le voci. */
const MISMATCH_CODES = ['earnings-mismatch', 'deductions-mismatch', 'net-mismatch'];

describe('parser sui PDF reali in samples/', { skip: files.length === 0 ? 'nessun PDF in samples/' : false }, () => {
  files.forEach((name, index) => {
    it(`sample ${String(index + 1)}`, async () => {
      const bytes = readFileSync(path.join(samplesDir, name));
      const extraction = extractPayslip(await extractPdfText(bytes), PAYSLIP_PARSERS);

      assert.ok(extraction.status === 'complete', 'il parser non ha letto il cedolino per intero');

      const mismatches = extraction.warnings
        .map((warning) => warning.code)
        .filter((code) => MISMATCH_CODES.includes(code));
      assert.ok(mismatches.length === 0, `totali non coerenti con le voci: ${mismatches.join(', ')}`);

      assert.ok(extraction.draft.period !== null, 'il periodo non è stato letto');
    });
  });
});

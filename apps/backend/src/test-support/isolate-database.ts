import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Preload dei test backend (`tsx --import ... --test`): gira in ogni processo
 * di test prima del file di test, e garantisce che nessun test apra il
 * database reale.
 *
 * - `DATABASE_FILE` mancante: punta a una cartella temporanea nuova.
 * - `DATABASE_FILE` già impostato: accettato solo sotto `os.tmpdir()` e fuori
 *   da `<APP_ROOT>/data`, altrimenti i test non partono.
 * - `MYFINANCE_DATA` o `dataRoot` in `config/settings.json`: i test non
 *   partono, perché vincono su `DATABASE_FILE` nella scelta della radice dati
 *   (vedi `resolvePaths`) e il ripristino in attesa verrebbe letto da lì.
 *
 * Non importa `paths.ts`: quel modulo risolve i percorsi al caricamento, e
 * lo farebbe prima che `DATABASE_FILE` sia impostato.
 */

/** La stessa radice che `resolveLayout` calcola nel layout repository. */
const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

/** Il percorso reale, risolvendo junction e symlink sull'antenato esistente più vicino. */
function realPath(target: string): string {
  const absolute = path.resolve(target);
  if (existsSync(absolute)) {
    return realpathSync.native(absolute);
  }
  const parent = path.dirname(absolute);

  return parent === absolute ? absolute : path.join(realPath(parent), path.basename(absolute));
}

function isInside(child: string, parent: string): boolean {
  const fold = (p: string) => (process.platform === 'win32' ? p.toLowerCase() : p);
  const relative = path.relative(fold(parent), fold(child));

  return relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function settingsDataRoot(appRoot: string): string | null {
  try {
    const parsed: unknown = JSON.parse(
      readFileSync(path.join(appRoot, 'config', 'settings.json'), 'utf8'),
    );
    const value = (parsed as { dataRoot?: unknown } | null)?.dataRoot;

    return typeof value === 'string' && value.trim().length > 0 ? value : null;
  } catch {
    // File assente o illeggibile: `paths.ts` lo ignora allo stesso modo.
    return null;
  }
}

/** Perché l'ambiente non è isolato, oppure `null`. */
export function isolationProblem(
  env: { readonly DATABASE_FILE?: string | undefined; readonly MYFINANCE_DATA?: string | undefined },
  appRoot: string,
  tempRoot: string,
  dataRootFromSettings: string | null,
): string | null {
  if (env.MYFINANCE_DATA?.trim()) {
    return `MYFINANCE_DATA è impostata (${env.MYFINANCE_DATA}): toglierla prima di eseguire i test.`;
  }
  if (dataRootFromSettings !== null) {
    return `config/settings.json dichiara dataRoot (${dataRootFromSettings}): i test non possono essere isolati.`;
  }

  const databaseFile = env.DATABASE_FILE?.trim();
  if (!databaseFile) {
    return null;
  }

  const resolved = realPath(path.resolve(appRoot, databaseFile));
  if (isInside(resolved, realPath(path.join(appRoot, 'data')))) {
    return `DATABASE_FILE punta ai dati dell'applicazione (${resolved}).`;
  }
  if (!isInside(resolved, realPath(tempRoot))) {
    return `DATABASE_FILE deve stare sotto ${tempRoot} durante i test, non in ${resolved}.`;
  }

  return null;
}

const problem = isolationProblem(process.env, APP_ROOT, tmpdir(), settingsDataRoot(APP_ROOT));
if (problem !== null) {
  throw new Error(`Test non isolati dal database reale: ${problem}`);
}

if (!process.env.DATABASE_FILE?.trim()) {
  const dir = mkdtempSync(path.join(tmpdir(), 'appconto-test-'));
  process.env.DATABASE_FILE = path.join(dir, 'database.sqlite');
  // Best effort: su Windows un database ancora aperto all'uscita dà EBUSY e la cartella resta.
  process.on('exit', () => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {}
  });
}

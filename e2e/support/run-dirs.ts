import { existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Le cartelle temporanee delle corse e2e: `<tmp>/appconto-e2e-<uuid>`.
 *
 * Ognuna contiene `data/` (la `MYFINANCE_DATA` del backend) e `server.json`,
 * scritto da `test-server.mjs` con i PID del server.
 */
export const RUN_DIR_PREFIX = 'appconto-e2e-';

export interface ServerPids {
  readonly wrapperPid: number;
  readonly backendPid: number;
}

export function readServerPids(runDir: string): ServerPids | null {
  try {
    return JSON.parse(readFileSync(path.join(runDir, 'server.json'), 'utf8')) as ServerPids;
  } catch {
    return null;
  }
}

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: il processo esiste ma non è nostro.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Cancella la cartella; su Windows ritenta finché i file non vengono rilasciati. */
export function removeRunDir(runDir: string): boolean {
  try {
    rmSync(runDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  } catch {
    // Il chiamante lo verifica sotto: una cartella rimasta non fa fallire la corsa.
  }

  return !existsSync(runDir);
}

/**
 * Le cartelle rimaste da corse precedenti interrotte (Ctrl+C, crash, file
 * bloccati su Windows). Si toccano solo quelle il cui server non è più vivo,
 * o che non hanno mai avuto un server e sono vecchie più di dieci minuti.
 */
export function sweepStaleRunDirs(current: string | undefined): string[] {
  const tmp = os.tmpdir();
  const removed: string[] = [];

  for (const entry of readdirSync(tmp)) {
    if (!entry.startsWith(RUN_DIR_PREFIX)) continue;

    const dir = path.join(tmp, entry);
    if (current !== undefined && path.resolve(dir) === path.resolve(current)) continue;

    const pids = readServerPids(dir);
    const stale =
      pids === null
        ? Date.now() - statSync(dir).mtimeMs > 10 * 60 * 1000
        : !isAlive(pids.backendPid) && !isAlive(pids.wrapperPid);

    if (stale && removeRunDir(dir)) {
      removed.push(dir);
    }
  }

  return removed;
}

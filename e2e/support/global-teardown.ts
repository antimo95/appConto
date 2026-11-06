import { existsSync } from 'node:fs';
import { isAlive, readServerPids, removeRunDir } from './run-dirs.js';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isAlive(pid)) return true;
    await sleep(100);
  }
  return !isAlive(pid);
}

/**
 * Dopo i test: si ferma il server e si cancella la cartella temporanea.
 *
 * Playwright esegue il global teardown *prima* di chiudere il `webServer`.
 * Su Windows un file SQLite aperto non si può cancellare, quindi il server
 * va fermato qui: si termina il processo intermedio (`test-server.mjs`), il
 * canale IPC si chiude e il backend si arresta da solo chiudendo il database.
 * Se non lo fa entro 15 secondi, lo si termina d'autorità. La cancellazione
 * ritenta per qualche secondo (EBUSY/EPERM); se fallisce ancora, la cartella
 * viene rimossa all'inizio della corsa successiva (`global-setup.ts`).
 */
export default async function globalTeardown(): Promise<void> {
  const runDir = process.env.APPCONTO_E2E_DIR;
  if (runDir === undefined || !existsSync(runDir)) return;

  const pids = readServerPids(runDir);
  if (pids !== null) {
    if (isAlive(pids.wrapperPid)) {
      try {
        process.kill(pids.wrapperPid);
      } catch {
        // Già terminato.
      }
    }

    if (!(await waitForExit(pids.backendPid, 15_000))) {
      try {
        process.kill(pids.backendPid, 'SIGKILL');
      } catch {
        // Già terminato.
      }
      await waitForExit(pids.backendPid, 5_000);
    }
  }

  if (!removeRunDir(runDir)) {
    console.warn(
      `[e2e] impossibile cancellare ${runDir}: verrà rimossa all'avvio della prossima corsa.`,
    );
  }
}

// Il server dei test end-to-end: il backend avviato dai sorgenti su una
// cartella dati temporanea, che serve anche la build del frontend.
//
// Lo avvia `playwright.config.ts` (webServer). Non è un'altra applicazione:
// è `apps/backend/src/main.ts`, eseguito con `node --import tsx` come fa
// `npm run start:backend`, con tre differenze imposte dall'ambiente:
//
//   MYFINANCE_DATA               la cartella temporanea della corsa, mai `data/`
//   MYFINANCE_PORT               una porta fissa, senza ripiego su altre porte
//   MYFINANCE_AUTO_BACKUP_HOURS  0: nessun backup automatico durante i test
//
// Il backend nasce con un canale IPC, come quando lo avvia il launcher (che
// qui non c'è: nessun browser viene aperto). Il canale serve all'arresto:
// quando questo processo termina, il canale si chiude e il backend si arresta
// da solo in modo ordinato, chiudendo il database. Su Windows è l'unico modo
// di liberare il file SQLite prima di cancellare la cartella (vedi
// `global-teardown.ts`).

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const runDir = process.env.APPCONTO_E2E_DIR;
const dataDir = process.env.MYFINANCE_DATA;

function fail(message) {
  process.stderr.write(`[e2e] ${message}\n`);
  process.exit(1);
}

if (!runDir || !dataDir) {
  fail('APPCONTO_E2E_DIR e MYFINANCE_DATA vanno impostate da playwright.config.ts.');
}

// Difesa in profondità: i dati dei test non devono mai finire nell'archivio vero.
const relative = path.relative(runDir, dataDir);
if (relative.startsWith('..') || path.isAbsolute(relative)) {
  fail(`MYFINANCE_DATA (${dataDir}) non sta dentro la cartella della corsa (${runDir}).`);
}

const indexHtml = path.join(repoRoot, 'apps', 'frontend', 'dist', 'frontend', 'browser', 'index.html');
if (!existsSync(indexHtml)) {
  fail('Build del frontend assente: esegui "npm run build:frontend" (o "npm run test:payslips:e2e").');
}

mkdirSync(dataDir, { recursive: true });

const backend = spawn(process.execPath, ['--import', 'tsx', path.join('apps', 'backend', 'src', 'main.ts')], {
  cwd: repoRoot,
  env: { ...process.env, MYFINANCE_PORT_FALLBACK: '0' },
  stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  windowsHide: true,
});

// Chi deve fermare il server a fine corsa legge qui i due processi.
writeFileSync(
  path.join(runDir, 'server.json'),
  JSON.stringify({ wrapperPid: process.pid, backendPid: backend.pid }),
);

// Il messaggio `ready` del backend non serve: la prontezza la verifica
// Playwright interrogando /api/health.
backend.on('message', () => undefined);

backend.on('exit', (code, signal) => {
  process.exit(code ?? (signal === null ? 0 : 1));
});

const shutdown = () => {
  if (backend.connected) {
    backend.send({ type: 'shutdown' });
  }
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

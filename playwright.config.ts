import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

/**
 * Test end-to-end (Playwright) dei cedolini.
 *
 * Isolamento:
 *  - il backend parte dai sorgenti su una cartella dati temporanea
 *    (`<tmp>/appconto-e2e-<uuid>/data`), mai su `data/` né su
 *    `config/settings.json`: le variabili d'ambiente hanno la precedenza sulla
 *    configurazione;
 *  - la cartella si decide qui, una volta per corsa: il valore finisce in
 *    `process.env`, che i worker ereditano, quindi non cambia fra un processo
 *    e l'altro. Viene creata solo all'avvio del server (elencare i test non
 *    crea nulla) e cancellata da `global-teardown.ts`;
 *  - `reuseExistingServer: false`: un server già acceso su quella porta — per
 *    esempio un'istanza di sviluppo con i dati veri — fa fallire la corsa
 *    invece di essere usato;
 *  - nessuna rete esterna: interfaccia e API stanno sulla stessa origine
 *    loopback, e i PDF sono sintetici, generati a ogni test.
 *
 * Il frontend va compilato prima (`npm run build:frontend`): lo fa
 * `npm run test:payslips:e2e`.
 */

const runDir = (process.env.APPCONTO_E2E_DIR ??= path.join(
  os.tmpdir(),
  `appconto-e2e-${randomUUID()}`,
));
const port = Number(process.env.APPCONTO_E2E_PORT ?? 4317);
const baseURL = `http://127.0.0.1:${String(port)}`;

/** `PLAYWRIGHT_CHANNEL=msedge` usa Edge installato, se Chromium di Playwright non è scaricabile. */
const channel = process.env.PLAYWRIGHT_CHANNEL;

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  outputDir: './test-results',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: Number(process.env.PLAYWRIGHT_RETRIES ?? 0),
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  globalSetup: './e2e/support/global-setup.ts',
  globalTeardown: './e2e/support/global-teardown.ts',
  use: {
    baseURL,
    locale: 'it-IT',
    timezoneId: 'Europe/Rome',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], ...(channel ? { channel } : {}) },
    },
  ],
  webServer: {
    command: 'node e2e/support/test-server.mjs',
    url: `${baseURL}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
    env: {
      APPCONTO_E2E_DIR: runDir,
      MYFINANCE_DATA: path.join(runDir, 'data'),
      MYFINANCE_PORT: String(port),
      MYFINANCE_AUTO_BACKUP_HOURS: '0',
    },
  },
});

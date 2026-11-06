# Test dei cedolini

La funzionalità «Cedolini» ha tre livelli di test:

| Livello | Dove | Strumento | Script npm |
| --- | --- | --- | --- |
| Backend (unità e integrazione) | `apps/backend/src/modules/payslips/**/*.test.ts`, `apps/backend/src/modules/maintenance/*payslips*.test.ts`, `apps/backend/src/*payslips*.test.ts` | `node:test` tramite `tsx` | `npm run test:payslips:backend` |
| Frontend (unità) | `apps/frontend/src/app/features/payslips/**/*.spec.ts` | Angular CLI (`@angular/build:unit-test`) + Vitest | `npm run test:payslips:frontend` |
| End-to-end | `e2e/*.spec.ts` | Playwright 1.64.1 + Chromium | `npm run test:payslips:e2e` |

`npm run test:payslips` esegue i tre livelli in sequenza e si ferma al primo che fallisce.

Tutti i comandi si lanciano dalla radice del repository.

## Prima volta

```sh
npm install
npx playwright install chromium
```

Il secondo comando scarica una sola volta il Chromium usato da Playwright
(in `%LOCALAPPDATA%\ms-playwright` su Windows). I test, dopo, non usano la rete.

Se il download non è possibile, si può usare Microsoft Edge già installato:

```sh
# bash
PLAYWRIGHT_CHANNEL=msedge npm run test:payslips:e2e
# PowerShell
$env:PLAYWRIGHT_CHANNEL = 'msedge'; npm run test:payslips:e2e
```

## Da terminale

```sh
npm run test:payslips:backend     # node:test, solo i test dei cedolini
npm run test:payslips:frontend    # Angular/Vitest, solo src/app/features/payslips
npm run test:payslips:e2e         # build del frontend, poi Playwright
npm run test:payslips             # tutto, in sequenza
```

Altri comandi utili per gli e2e (il frontend deve essere già compilato con
`npm run build:frontend`):

```sh
npx playwright test                       # solo i test, senza ricompilare
npx playwright test -g "conflitto"        # un test per nome
npx playwright test --headed              # con la finestra del browser visibile
npx playwright test --ui                  # interfaccia interattiva di Playwright
npx playwright show-report                # report HTML dell'ultima corsa
npx playwright show-trace test-results/<test>/trace.zip   # traccia di un test fallito
```

Le suite complete del progetto restano `npm run test:backend` e
`npm run test:frontend`.

## Da VS Code

Estensioni raccomandate (`.vscode/extensions.json`), entrambe open source:

- **Node.js Testing** (`connor4312.nodejs-testing`): mostra i test del backend
  nella vista *Testing*. È configurata in `.vscode/settings.json` per cercare
  in `apps/backend/src` (quindi anche i test dei cedolini e quelli di
  manutenzione) ed escludere `e2e/`.
- **Playwright Test for VS Code** (`ms-playwright.playwright`): mostra i test
  di `e2e/` nella vista *Testing*, con esecuzione, debug e «Show browser». Usa
  `playwright.config.ts`, quindi parte lo stesso server isolato del terminale.
  Non ricompila il frontend: dopo una modifica all'interfaccia lanciare prima
  `npm run build:frontend` (o il task e2e).

I test del frontend non compaiono nella vista *Testing*: li esegue il builder
Angular (`ng test` con `@angular/build:unit-test`), che genera al volo la
configurazione di Vitest. Non c'è un `vitest.config` che un'estensione possa
leggere, e lanciare Vitest direttamente salterebbe la compilazione Angular.
Si usano quindi i task.

Task (`Terminale > Esegui attività…`, oppure `Ctrl+Shift+P` → *Tasks: Run Test Task*):

- `Cedolini: test backend`
- `Cedolini: test frontend`
- `Cedolini: test e2e (Playwright)`
- `Cedolini: suite completa` (task di test predefinito)
- `Test backend`, `Test frontend` (le suite complete del progetto)

## Isolamento degli e2e

- **Cartella dati temporanea.** `playwright.config.ts` sceglie una volta per
  corsa `<tmp>/appconto-e2e-<uuid>` e passa al backend `MYFINANCE_DATA` (la
  sottocartella `data/`), `MYFINANCE_PORT=4317` e
  `MYFINANCE_AUTO_BACKUP_HOURS=0`. Le variabili d'ambiente hanno la precedenza
  su `config/settings.json`: la cartella `data/` del repository e la
  configurazione dell'utente non vengono mai lette né scritte. Il server di
  prova (`e2e/support/test-server.mjs`) rifiuta di partire se la cartella dati
  non sta dentro quella della corsa.
- **Server dedicato.** Il backend parte dai sorgenti (`node --import tsx
  apps/backend/src/main.ts`) e serve la build del frontend sulla stessa
  origine (`http://127.0.0.1:4317`). `reuseExistingServer: false`: se la porta
  è occupata (per esempio da un'istanza con i dati veri) la corsa fallisce
  invece di usarla. La porta si cambia con `APPCONTO_E2E_PORT`. Nessun browser
  viene aperto dal backend: il launcher non è coinvolto.
- **PDF sintetici.** I PDF si generano a ogni test con il costruttore usato dai
  test del backend (`apps/backend/src/modules/payslips/testing/payslip-fixtures.ts`):
  nomi e importi di fantasia, nessun cedolino vero nel repository.
- **Nessuna rete esterna.** Interfaccia e API sono sulla stessa origine
  loopback.
- **Test indipendenti.** Prima di ogni test si eliminano tutti i cedolini
  tramite l'API pubblica (`DELETE /api/payslips/:id`); ogni test usa mesi
  fissi. Un solo worker, nessun retry in locale (in CI si possono chiedere con
  `PLAYWRIGHT_RETRIES`).
- **Pulizia.** A fine corsa `e2e/support/global-teardown.ts` ferma il server e
  cancella la cartella temporanea.

## Risoluzione dei problemi

**La cartella `appconto-e2e-*` resta in `%TEMP%` (Windows).** Su Windows un
file SQLite aperto non si può cancellare, e Playwright esegue il global
teardown *prima* di chiudere il `webServer`. Per questo il teardown ferma il
server da sé: termina `test-server.mjs`, il canale IPC si chiude e il backend si
arresta in modo ordinato chiudendo il database (oltre 15 secondi viene
terminato d'autorità); poi la cancellazione ritenta per qualche secondo. Se la
corsa viene interrotta (Ctrl+C, crash) o un antivirus tiene il file, la
cartella resta: il global setup della corsa successiva rimuove le cartelle
`appconto-e2e-*` il cui server non è più in esecuzione. Si possono anche
cancellare a mano.

**`http://127.0.0.1:4317/api/health is already used`.** Un altro processo usa
la porta: chiuderlo, oppure usare un'altra porta con `APPCONTO_E2E_PORT=4318`.

**`Build del frontend assente`.** Eseguire `npm run build:frontend`, oppure
usare `npm run test:payslips:e2e`, che compila prima di lanciare i test.

**`Executable doesn't exist ... ms-playwright`.** Manca il browser: eseguire
`npx playwright install chromium`, oppure usare `PLAYWRIGHT_CHANNEL=msedge`.

**Un test fallisce.** Il report HTML (`npx playwright show-report`) contiene
screenshot e traccia del test; le righe `[WebServer]` nel terminale sono gli
errori del backend.

## Difetti noti

- Il test e2e «3-bis. il datore di lavoro viene estratto dal PDF» è marcato
  `test.fail`: estraendo il testo dal PDF, `pdfjs-dist` fonde le etichette
  «Codice azienda» e «Ragione sociale» in un solo elemento, e il lettore
  (`textBelow` in `zucchetti-lul.parser.ts`) non trova più il valore sotto
  «Ragione sociale». Quando il difetto sarà corretto il test segnalerà un
  «passaggio inatteso»: va tolto `test.fail`.

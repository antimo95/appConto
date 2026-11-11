# AGENTS.md

Istruzioni per agenti che lavorano su questo repository. Installazione, avvio
e variabili d'ambiente: [README.md](README.md). Architettura e regole:
[docs/architecture/architecture.md](docs/architecture/architecture.md). Indice
dei documenti (attuali e storici): [docs/README.md](docs/README.md).

## Verificare

- `npm run check`: typecheck backend, test backend, test frontend, build. Circa
  due minuti. È la definizione di "fatto": deve uscire con 0.
- Un solo test backend:
  `npx tsx --import ./apps/backend/src/test-support/isolate-database.ts --test <file>`
- Solo frontend: `npm run test:frontend` (Vitest su jsdom).
- Le righe "Not implemented: HTMLCanvasElement's getContext()" nei test
  frontend sono avvisi di jsdom, non errori.

## Mai toccare l'archivio reale

- Senza configurazione l'app apre `<repo>/data/database.sqlite`, cioè i dati
  veri. Per prove manuali imposta sempre `MYFINANCE_DATA` su una cartella
  temporanea (PowerShell: `$env:MYFINANCE_DATA = "$env:TEMP\appconto-prova"`).
- Non leggere né copiare file sotto `data/`, `apps/backend/data/` o
  `apps/backend/data-backup-*`.

## Dove intervenire

- Backend: `apps/backend/src/modules/<modulo>/`, file piatti con suffisso
  (`.routes.ts`, `.service.ts`, `.repository.ts`, `.schema.ts`, `index.ts`).
  Le rotte si montano in `apps/backend/src/app.ts` sotto `/api`.
- Frontend: `apps/frontend/src/app/features/<feature>/`; componenti condivisi
  in `shared/`, che non importa mai da `features/`.
- Percorsi dei dati: solo `apps/backend/src/paths.ts` li decide.
- Schema del database: modifica `*.schema.ts`, poi `npm run db:generate`; le
  migrazioni in `apps/backend/drizzle/` sono solo in avanti.

## Convenzioni

- Nomi, commenti, messaggi e test in italiano.
- Denaro in centesimi interi nel database e nei calcoli; l'euro compare solo ai
  bordi (DTO, interfaccia). Niente float negli importi.
- Errori applicativi: classi di `apps/backend/src/shared/errors.ts`
  (`ValidationError` 400, `NotFoundError` 404, `ConflictError` 409), tradotte
  in HTTP da `shared/http/error-handler.ts` con corpo `{ "error": "<messaggio>" }`.
- Un vincolo che un modulo impone a un altro passa per una porta iniettata in
  `app.ts` (esempio: `TransactionDependents`), non per un import circolare.

## Invarianti da non rompere

- **Scrittore unico.** `better-sqlite3` è sincrono: negli handler nessun
  `await` fra un controllo e la scrittura che ne dipende. Un solo processo per
  archivio (lock del launcher, `launcher/instance-lock.ts`).
- **Stato derivato.** Credito residuo e stato dei prestiti, totali e
  aggregazioni si calcolano sempre; non aggiungere colonne che li memorizzano.
- **LO1 e D9.** Un movimento d'origine di prestiti resta `LOAN`, uno collegato
  a una restituzione resta `INCOME`. Vale tramite `requiredType` nei legami di
  `loans` e solo se `transactionsService.updateType` riceve `dependents`:
  ogni nuovo chiamante di produzione deve passarlo, ricevendolo dalla
  composizione in `app.ts` (non importando `loans`). Il frontend non ripete la
  regola, legge `requiredType`.
- **I1.** Un movimento cancellato torna reimportando lo stesso estratto: la
  cancellazione non tocca fingerprint né deduplicazione. È una decisione.
- **Nuovo tipo di movimento.** Va aggiunto in
  `apps/backend/src/modules/transactions/transaction-type.ts` e verificato nel
  cash flow (`modules/cash-flow/`), che tratta `LOAN` in modo speciale.
- **Backup e restore.** Il ripristino è differito (si applica al riavvio) e lo
  stage non deve mai eliminare il backup scelto. Dettagli e stati in
  [docs/architecture-audit/STATE_MACHINES.md](docs/architecture-audit/STATE_MACHINES.md).

## Test

- Backend: SQLite reale in una cartella temporanea. In un file di test,
  `startTestApp` (`test-support/http-app.ts`) o l'impostazione di
  `DATABASE_FILE` vanno fatti **prima** di qualunque import che raggiunga
  `db/client`; i servizi si importano dopo con `await import(...)`.
- Frontend: `provideHttpClientTesting()` e `HttpTestingController`; nessuna
  spec fa richieste HTTP reali.
- Un difetto si corregge partendo da un test che fallisce.

## Lavoro in corso

Il consolidamento architetturale segue
[docs/architecture-audit/PLAN.md](docs/architecture-audit/PLAN.md); per
riprenderlo si parte da
[docs/architecture-audit/HANDOFF.md](docs/architecture-audit/HANDOFF.md).
`docs/superpowers/` e `docs/plans/` sono storici.

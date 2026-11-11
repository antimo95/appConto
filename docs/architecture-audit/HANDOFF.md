# Handoff — consolidamento architetturale

Punto di ingresso per la prossima sessione. Fotografia dello stato operativo: le informazioni superate si sostituiscono, la storia sta in `PROGRESS.md`.

## Stato generale

- **Ultimo aggiornamento:** 2026-11-11.
- **Branch:** `consolidamento/fase-2`, da `master` a `46302f9` (merge della fase 1, PR #12). Non pubblicato.
- **HEAD:** commit di C-04 (vedi `git log --oneline -3`); prima `2470868` (C-03).
- **Working tree:** pulito dopo il commit di C-04.
- **Roadmap:** fasi 1 e 2 chiuse (A-04, A-05a, A-02, A-03, C-06, C-03, C-04 COMPLETED; A-05b BLOCKED da A-01). Prossima: fase 3. DEFERRED fuori perimetro: A-01, E-02, F-05. Osservazione G-03 aperta. Dettaglio in `PLAN.md` §3.

## Ultimo lavoro completato

- **C-03 (LO1):** il tipo di un movimento d'origine di prestiti è bloccato (409 dal backend, select disabilitata con motivo nel frontend). D9 usa lo stesso `requiredType`.
- **C-04 (I1):** la conferma di cancellazione avverte che un nuovo import dello stesso estratto riporterà i movimenti; un test di caratterizzazione fissa il comportamento.
- Evidenze: schede C-03 e C-04 in `PLAN.md`, SM4 in `STATE_MACHINES.md`, `PROGRESS.md`.

## Lavoro in corso

Nessuna attività parziale.

## Prossima attività

- **ID:** B-02 — README eseguibile (fase 3, ordine §7: B-02 → B-03 → B-01).
- **Perché ora:** fase 3, ora che LO1 e I1 sono implementate e si possono documentare.
- **Prerequisiti:** A-05a (completata).
- **Cosa fare** (scheda B-02 in `PLAN.md`): correggere il percorso del database nel `README.md` (il file reale è `database.sqlite`, precedenza di `DATA_ROOT` in `apps/backend/src/paths.ts`), elencare le variabili d'ambiente, citare `npm run check`.
- **Poi:** B-03 (`docs/architecture.md`: elenco reale degli 11 moduli, regole false da correggere, LO1 e I1 ora implementate) e B-01 (`AGENTS.md` < 120 righe, con il contratto di `dependents` in `updateType`, le regole LO1/I1, `npm run check`).
- **Pubblicazione:** il branch `consolidamento/fase-2` contiene C-03 e C-04 e non è ancora pubblicato; chiedere al proprietario se pubblicarlo ora o a fine fase 3.
- **Da non dimenticare:** G-03, `scripts/verify-package.mjs` attende 22 categorie invece di 24; `verify:package` è 12/17 per questa causa.

## Verifiche

- **Ultimo `npm run check`:** 2026-11-11, dopo C-04: uscita 0, 109 s (backend 1084/1084, frontend 844/844, build ok).
- **Ultimo `npm run verify:package`:** 12/17; i 5 fallimenti dipendono da G-03, non dalle attività svolte.
- **Non eseguito:** doppio clic manuale (sostituito da prova scriptata); prove con antivirus aggressivo, OneDrive, chiavette FAT/exFAT.
- **Ambiente:** Windows 11, Node v24.11.1. Comandi eseguiti da Git Bash e PowerShell. Le righe "Not implemented: HTMLCanvasElement's getContext()" nei test frontend sono avvisi di jsdom.

## Invarianti e attenzioni

- Denaro in centesimi interi; nessun calcolo float sugli importi.
- Stato dei prestiti derivato, mai memorizzato.
- SQLite sincrono, scrittore unico (`better-sqlite3`). Negli handler non introdurre `await` tra lettura e scrittura.
- Test backend sempre con il preload `isolate-database` (già nello script `test:backend`). Mai leggere o usare l'archivio reale; per prove manuali `MYFINANCE_DATA` verso una cartella di scratch.
- LO1 e I1 sono decisioni definitive (`PLAN.md` §2). Non riaprirle.
- Aree da non toccare in parallelo: `maintenance/` (A-02 → C-06 → C-05), `launcher/` (A-03 → E-07), `transactions.service.ts` (C-03), `loans/` backend (C-03 → D-02).
- Fuori perimetro e ancora aperte: A-01 (dati personali nel repo pubblico e cronologia git), A-05b (CI, bloccata da A-01), E-02 (vulnerabilità delle dipendenze), F-05 (hardening HTTP).
- Non committare, non fare force push, nessuna operazione git distruttiva, salvo richiesta esplicita.

## Istruzioni per riprendere

1. Leggere questo file, poi la scheda della prossima attività in `PLAN.md` §6 e l'ultima sezione di `PROGRESS.md`.
2. Verificare `git branch --show-current`, `git rev-parse --short HEAD`, `git status --porcelain` e confrontarli con "Stato generale". Se divergono, aggiornare questo file prima di continuare.
3. Eseguire `npm run check` per confermare che la base è verde (circa 2 minuti).
4. Riprendere da B-02 (`PLAN.md` §6, Fase 3).
5. A fine attività: `npm run check`; aggiornare `PLAN.md` §3 e la scheda, aggiungere una sezione a `PROGRESS.md`, riscrivere questo file. Aggiornare `STATE_MACHINES.md` solo se cambia il comportamento implementato (la fase 3 è documentazione: di norma no).

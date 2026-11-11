# Handoff — consolidamento architetturale

Punto di ingresso per la prossima sessione. Fotografia dello stato operativo: le informazioni superate si sostituiscono, la storia sta in `PROGRESS.md`.

## Stato generale

- **Ultimo aggiornamento:** 2026-11-11.
- **Branch:** `consolidamento/fase-2`, da `master` a `46302f9` (merge della fase 1, PR #12). Contiene fasi 2 e 3. Non pubblicato: il proprietario farà il merge a fine fase 3, quindi va pubblicato e unito prima di iniziare la fase 4 (chiedere).
- **HEAD:** commit della fase 3 (vedi `git log --oneline -5`).
- **Working tree:** pulito dopo il commit della fase 3.
- **Roadmap:** fasi 1, 2 e 3 chiuse (A-04, A-05a, A-02, A-03, C-06, C-03, C-04, B-02, B-03, B-01 COMPLETED; A-05b BLOCKED da A-01). Prossima: fase 4. DEFERRED fuori perimetro: A-01, E-02, F-05. Osservazioni aperte: G-03, G-04, G-05 (§9). Dettaglio in `PLAN.md` §3.

## Ultimo lavoro completato

- **B-02:** README con installazione (incluso il ripiego `npm ci --ignore-scripts` su Windows senza Visual Studio), avvio, `npm run check`, `DATA_ROOT` e variabili d'ambiente. Verificato su clone pulito.
- **B-03:** `architecture.md` allineato al codice (11 moduli, dipendenze reali, regole corrette, LO1/D9/I1); `docs/README.md` classifica i documenti in attuali e storici.
- **B-01:** `AGENTS.md` (86 righe) e `CLAUDE.md`. Gli agenti nuovi partono da lì; questo file resta il punto di ripresa del consolidamento.
- Evidenze: schede in `PLAN.md`, `PROGRESS.md`.

## Lavoro in corso

Nessuna attività parziale.

## Prossima attività

- **Prima:** il merge di `consolidamento/fase-2` (chiesto dal proprietario a fine fase 3). Verificare con `git fetch` e `git merge-base --is-ancestor consolidamento/fase-2 origin/master`; poi un nuovo branch per la fase 4.
- **ID:** C-01 — Impostazioni coerenti dopo il reset (ordine §7: C-01 → C-05).
- **Perché ora:** prima attività della fase 4; unico caso noto in cui l'interfaccia può riscrivere dati appena azzerati.
- **Prerequisiti:** A-04 (completata).
- **File da esaminare:** `apps/frontend/src/app/features/settings/settings-page.{ts,html}` (caricamento solo in `ngOnInit`), `apps/frontend/src/app/features/maintenance/reset-panel.ts` (nessun output dopo il reset), `reset-panel.spec.ts`; manca `settings-page.spec.ts`.
- **Progetto deciso** (scheda C-01): `ResetPanel` espone `reset = output<void>()`; `SettingsPage` estrae `load()` e lo richiama su `(reset)`, azzerando `saved` ed `errors`. Nessun servizio di eventi, nessuno store.
- **Primo passo consigliato:** nuova `settings-page.spec.ts` con `HttpTestingController`: `GET /api/settings` con saldo valorizzato, reset riuscito, ci si aspetta un secondo `GET` e il form a `0` con data vuota. Oggi fallisce.
- **Poi:** C-05 (pannello backup e ripristino, dipende da A-02, C-06 e C-01), C-02, D-01, D-02, E-01, E-03.
- **Da non dimenticare:** G-03 (`verify:package` 12/17 per 22 categorie attese invece di 24), da correggere prima del prossimo rilascio.

## Verifiche

- **Ultimo `npm run check`:** 2026-11-11, dopo la fase 3: uscita 0, 104 s (backend 1084/1084, frontend 844/844, build ok). Su clone pulito: vedi B-02 (G-04, G-05).
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
4. Verificare il merge della fase 2-3, poi riprendere da C-01 (`PLAN.md` §6, Fase 4) con un test che fallisce prima della correzione.
5. A fine attività: `npm run check`; aggiornare `PLAN.md` §3 e la scheda, aggiungere una sezione a `PROGRESS.md`, riscrivere questo file. Aggiornare `STATE_MACHINES.md` se cambia il comportamento implementato (C-01 chiude F5 di SM7; C-05 tocca SM1). Aggiornare `AGENTS.md` se cambia un invariante o un comando.

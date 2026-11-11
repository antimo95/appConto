# Handoff — consolidamento architetturale

Punto di ingresso per la prossima sessione. Fotografia dello stato operativo: le informazioni superate si sostituiscono, la storia sta in `PROGRESS.md`.

## Stato generale

- **Ultimo aggiornamento:** 2026-11-11.
- **Branch:** `consolidamento/fase-2`, da `master` a `46302f9` (merge della fase 1, PR #12). Non pubblicato.
- **HEAD:** commit di C-03 (vedi `git log --oneline -3`).
- **Working tree:** pulito dopo il commit di C-03.
- **Roadmap:** fase 1 chiusa (A-04, A-05a, A-02, A-03, C-06; A-05b BLOCKED da A-01). Fase 2: C-03 COMPLETED, C-04 da fare (PARTIALLY COMPLETED come stato di partenza). DEFERRED fuori perimetro: A-01, E-02, F-05. Osservazione G-03 aperta. Dettaglio in `PLAN.md` §3.

## Ultimo lavoro completato

- **C-03 (LO1):** un movimento d'origine di prestiti non cambia tipo finché esiste un prestito (409); la regola D9 usa lo stesso meccanismo (`requiredType` sui legami). Il frontend disabilita la select del tipo, con il motivo, solo se il tipo attuale è già quello richiesto: le righe legacy restano correggibili verso `LOAN`.
- Evidenze: scheda C-03 in `PLAN.md`, SM4 in `STATE_MACHINES.md`, `PROGRESS.md`.

## Lavoro in corso

Nessuna attività parziale.

## Prossima attività

- **ID:** C-04 — I1: la conferma di cancellazione dichiara la possibile reimportazione.
- **Perché ora:** seconda e ultima attività della fase 2 (§7: C-03 → C-04). XS. Decisione I1 definitiva (§2.2): comportamento invariato, nessuna tombstone, tabella, migrazione o modifica alla deduplicazione.
- **Prerequisiti:** A-05a (completata).
- **File da esaminare:** `apps/frontend/src/app/shared/transactions/transactions-table-panel/transactions-table-panel.html` (blocco di conferma "Eliminare definitivamente?", intorno a `:51-60`), `transactions-table-panel.spec.ts`, `features/transactions/transactions-delete.spec.ts`; per il test backend `modules/import/` o `modules/transactions/` (`transactions.delete.test.ts`).
- **Progetto deciso:** frase "Se reimporti un estratto conto che li contiene, questi movimenti verranno importati di nuovo." nel blocco di conferma; test di caratterizzazione backend (import, cancellazione, reimport: il movimento torna, gli altri sono duplicati). Il test passa subito: fissa un comportamento esistente.
- **Primo passo consigliato:** spec frontend che cerca la frase nel blocco di conferma (fallisce), poi il testo; poi il test backend.
- **Dopo C-04:** fase 3 (B-02 → B-03 → B-01), con `AGENTS.md` che deve riportare il contratto di `dependents` e le regole LO1/I1.
- **Da non dimenticare:** G-03, `scripts/verify-package.mjs` attende 22 categorie invece di 24; `verify:package` è 12/17 per questa causa.

## Verifiche

- **Ultimo `npm run check`:** 2026-11-11, dopo C-03: uscita 0, 110 s (backend 1083/1083, frontend 843/843, build ok).
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
4. Riprendere da C-04 (`PLAN.md` §6, Fase 2).
5. A fine attività: `npm run check`; aggiornare `PLAN.md` §3 e la scheda, aggiungere una sezione a `PROGRESS.md`, riscrivere questo file. Aggiornare `STATE_MACHINES.md` se cambia il comportamento implementato (C-04 non lo cambia: aggiungere solo una nota su SM5/I1 se utile).

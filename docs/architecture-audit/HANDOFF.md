# Handoff — consolidamento architetturale

Punto di ingresso per la prossima sessione. Fotografia dello stato operativo: le informazioni superate si sostituiscono, la storia sta in `PROGRESS.md`.

## Stato generale

- **Ultimo aggiornamento:** 2026-11-11.
- **Branch:** `master`.
- **HEAD:** `f072a59` (baseline dell'audit). Nessun commit dopo l'audit.
- **Working tree:** non committato.
  - `M apps/frontend/src/app/app.spec.ts` (A-04);
  - `M package.json` (A-05a);
  - `?? docs/architecture-audit/` (AUDIT, STATE_MACHINES, PLAN, PROGRESS, HANDOFF).
- **Roadmap:** fase 1 in corso. COMPLETED: A-04, A-05a. BLOCKED: A-05b (da A-01). DEFERRED fuori perimetro: A-01, E-02, F-05. Tutto il resto NOT STARTED, tranne C-04 PARTIALLY COMPLETED (stato di partenza). Dettaglio in `PLAN.md` §3.

## Ultimo lavoro completato

- **A-04:** `npm run test:frontend` esce con 0 (840/840, nessun errore non gestito). `app.spec.ts` usa le rotte reali con pagine vuote.
- **A-05a:** `npm run check` = typecheck backend, test backend, test frontend, build. Uscita 0 a progetto sano; uscita 1 provata per ciascuno dei quattro passi.
- Evidenze complete: schede A-04 e A-05a in `PLAN.md`, sessione 2026-11-11 in `PROGRESS.md`.

## Lavoro in corso

Nessuna attività parziale.

## Prossima attività

- **ID:** A-02 — Restore che non cancella la propria sorgente e non lascia marker orfani (R1, R2).
- **Perché ora:** P1, fase 1, nessun prerequisito. È la prima attività non completata e non bloccata. A-03 viene dopo, in una sessione separata: non affrontarle insieme.
- **Prerequisiti:** nessuno. `npm run check` è disponibile per la verifica finale.
- **File da esaminare** (`apps/backend/src/modules/maintenance/`):
  - `restore.service.ts`: `stage()` a `:62`, `create('pre-restore')` a `:90`, sostituzione del candidato a `:104-105`, scrittura del marker a `:131`;
  - `backup.service.ts`: `create()` (chiama `prune()` a `:218`), `prune()` a `:377`;
  - `backup.retention.ts`, `restore-pending.ts`;
  - test: `restore.service.test.ts`, `backup.service.test.ts`, `backup.retention.test.ts`, `restore-pending.test.ts`, più `apps/backend/src/restore.runtime.test.ts`.
- **Progetto deciso** (scheda A-02 in `PLAN.md`, non ridiscuterlo):
  - opzione `create(kind, moment, { protect?: string[] })` inoltrata a `prune()`; `stage()` protegge il backup sorgente;
  - `clearPendingRestore()` subito prima di `rmSync(candidate)`, dopo verifica, controllo dello schema e backup pre-restore;
  - niente tmp+rename del marker, niente riordino dei passi.
- **Primo passo consigliato:** scrivere il test T1 (tre backup `pre-restore` esistenti, `stage` del più vecchio, il backup deve restare elencato) e vederlo fallire. Poi T2–T4 come da scheda.

## Verifiche

- **Ultimo `npm run check`:** 2026-11-11, uscita 0, 121 s (backend 1059/1059, frontend 840/840, build ok).
- **Ultimi test separati:** `npm run test:frontend` uscita 0, 840/840.
- **Non eseguito:** nessuna prova manuale dell'app avviata (non necessaria finora). Comando eseguito da Git Bash, non provato direttamente in `cmd`/PowerShell.
- **Ambiente:** Windows 11, Node v24.11.1. Le righe "Not implemented: HTMLCanvasElement's getContext()" nei test frontend sono avvisi di jsdom, non errori.

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
4. Riprendere da A-02 con test che fallisce prima della correzione (`PLAN.md` §8.2).
5. A fine attività: `npm run check`; aggiornare `PLAN.md` §3 e la scheda, aggiungere una sezione a `PROGRESS.md`, riscrivere questo file. Aggiornare `STATE_MACHINES.md` solo se cambia il comportamento implementato del restore.

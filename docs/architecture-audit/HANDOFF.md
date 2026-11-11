# Handoff — consolidamento architetturale

Punto di ingresso per la prossima sessione. Fotografia dello stato operativo: le informazioni superate si sostituiscono, la storia sta in `PROGRESS.md`.

## Stato generale

- **Ultimo aggiornamento:** 2026-11-11.
- **Branch:** `consolidamento/fase-1` (da `master` a `f072a59`). Non pushato.
- **HEAD:** ultimo commit del branch, A-02 (vedi `git log --oneline -4`). Commit precedenti: `4e7fcf5` (A-04, A-05a), `2a5e7f8` (documenti di audit e piano).
- **Working tree:** pulito dopo il commit di A-02.
- **Roadmap:** fase 1. COMPLETED: A-04, A-05a, A-02. Prossima: A-03. BLOCKED: A-05b (da A-01). DEFERRED fuori perimetro: A-01, E-02, F-05. C-04 PARTIALLY COMPLETED (stato di partenza). Tutto il resto NOT STARTED. Dettaglio in `PLAN.md` §3.

## Ultimo lavoro completato

- **A-02:** lo stage di un ripristino non elimina più il backup scelto (`prune(protect)`) e non lascia un marcatore senza candidato (`clearPendingRestore()` subito prima di sostituire il candidato). Test T1–T4; T1, T3 e T4 fallivano prima della correzione.
- **Limite accettato:** un backup creato dopo lo stage, anche automatico, può eliminare il backup scelto mentre il ripristino è in attesa. L'apply usa la copia in `tmp/`. Da considerare in C-05.
- Evidenze: scheda A-02 in `PLAN.md`, SM1 in `STATE_MACHINES.md`, `PROGRESS.md`.

## Lavoro in corso

Nessuna attività parziale.

## Prossima attività

- **ID:** A-03 — Lock d'istanza: un solo processo può acquisire l'archivio (L1).
- **Perché ora:** ultima P1 della fase 1 non bloccata. Il furto di un lock considerato morto è un `rmSync` senza verifica: due avvii concorrenti possono acquisire entrambi l'archivio.
- **Prerequisiti:** nessuno. Area `launcher/` in esclusiva (poi E-07).
- **File da esaminare:**
  - `apps/backend/src/launcher/instance-lock.ts`: hook iniettabile `live` (`:136`, usato a `:150`), furto del lock con `rmSync` a `:241` (e `:198`). I riferimenti di riga della scheda sono slittati;
  - `apps/backend/src/launcher/instance-lock.test.ts`;
  - `docs/rilascio.md` (documentare il caso residuo).
- **Progetto deciso** (scheda A-03 in `PLAN.md`, non ridiscuterlo): rivendicazione del furto con `wx` su `<lockFile>.steal-<token>`; il vincitore rilegge il lock, se coincide lo rimuove, crea il proprio con `wx` e rimuove la rivendicazione; altrimenti rilascia e ritenta. Crash fra rivendicazione e sostituzione: errore esplicito che nomina i due file, con commento `shortcut:`. Nessuna libreria, nessun mutex a scadenza.
- **Primo passo consigliato:** test T1 con interleaving deterministico tramite l'hook `live`, due acquisizioni concorrenti su un lock morto: oggi entrambe acquisiscono. Vederlo fallire, poi T2–T5 come da scheda.

## Verifiche

- **Ultimo `npm run check`:** 2026-11-11, dopo A-02: uscita 0, 94 s (backend 1063/1063, frontend 840/840, build ok).
- **Non eseguito:** nessuna prova manuale dell'app avviata. Comando eseguito da Git Bash, non direttamente in `cmd`/PowerShell.
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
4. Riprendere da A-03 con un test che fallisce prima della correzione (`PLAN.md` §8.2).
5. A fine attività: `npm run check`; aggiornare `PLAN.md` §3 e la scheda, aggiungere una sezione a `PROGRESS.md`, riscrivere questo file. Aggiornare `STATE_MACHINES.md` se cambia il comportamento implementato (per A-03: la macchina del lock d'istanza).

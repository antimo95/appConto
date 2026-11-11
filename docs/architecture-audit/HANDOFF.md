# Handoff — consolidamento architetturale

Punto di ingresso per la prossima sessione. Fotografia dello stato operativo: le informazioni superate si sostituiscono, la storia sta in `PROGRESS.md`.

## Stato generale

- **Ultimo aggiornamento:** 2026-11-11.
- **Branch:** `consolidamento/fase-1` (da `master` a `f072a59`). Non pushato.
- **HEAD:** commit di A-03 (vedi `git log --oneline -5`). Precedenti: `ffb527d` (A-02), `4e7fcf5` (A-04, A-05a), `2a5e7f8` (documenti di audit e piano).
- **Working tree:** pulito dopo il commit di A-03.
- **Roadmap:** fase 1 quasi chiusa. COMPLETED: A-04, A-05a, A-02, A-03. Resta C-06. BLOCKED: A-05b (da A-01). DEFERRED fuori perimetro: A-01, E-02, F-05. C-04 PARTIALLY COMPLETED (stato di partenza). Nuova osservazione G-03 (§9). Tutto il resto NOT STARTED. Dettaglio in `PLAN.md` §3.

## Ultimo lavoro completato

- **A-03:** il furto di un lock abbandonato passa per una rivendicazione `wx` legata a quella specifica istanza del lock (byte più identità del file). Due avvii concorrenti non possono più acquisire entrambi. Verificato con test unitari, stress tra processi reali (50/50 con 10 processi; il codice precedente falliva 6 volte su 6) e prova sul pacchetto dopo `taskkill /F`.
- **Caso residuo:** un avvio terminato fra rivendicazione e sostituzione lascia due file da rimuovere a mano; l'errore li nomina (`docs/rilascio.md`).
- Evidenze: scheda A-03 in `PLAN.md`, SM3 in `STATE_MACHINES.md`, `PROGRESS.md`.

## Lavoro in corso

Nessuna attività parziale.

## Prossima attività

- **ID:** C-06 — Reset: esito corretto anche se `VACUUM` fallisce.
- **Perché ora:** ultima attività della fase 1 (ordine §7: A-02 → C-06). XS, area `maintenance/` libera.
- **Prerequisiti:** A-02 (completata).
- **File da esaminare:** `apps/backend/src/modules/maintenance/reset.service.ts` (blocco `atomically` e chiamata a `vacuum()` dopo il commit), `reset.service.test.ts`, `maintenance.routes.ts` (risposta del reset).
- **Progetto deciso:** `try/catch` attorno a `vacuum()` con un warning nel log; nessun nuovo campo di risposta; il testo dell'interfaccia appartiene a C-05.
- **Primo passo consigliato:** test con `vacuum` che solleva un errore: oggi il reset risponde con un errore anche se i dati sono già azzerati. Vederlo fallire, poi correggere.
- **Dopo C-06:** fase 2, C-03 → C-04 (`PLAN.md` §7).
- **Da non dimenticare:** G-03, `scripts/verify-package.mjs` attende 22 categorie invece di 24; `verify:package` è oggi 12/17 per questa causa. Va corretta prima del prossimo rilascio.

## Verifiche

- **Ultimo `npm run check`:** 2026-11-11, dopo A-03: uscita 0, 114 s (backend 1070/1070, frontend 840/840, build ok).
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
4. Riprendere da C-06 con un test che fallisce prima della correzione (`PLAN.md` §8.2).
5. A fine attività: `npm run check`; aggiornare `PLAN.md` §3 e la scheda, aggiungere una sezione a `PROGRESS.md`, riscrivere questo file. Aggiornare `STATE_MACHINES.md` se cambia il comportamento implementato (per C-06: SM7, reset).

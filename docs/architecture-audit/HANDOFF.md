# Handoff — consolidamento architetturale

Punto di ingresso per la prossima sessione. Fotografia dello stato operativo: le informazioni superate si sostituiscono, la storia sta in `PROGRESS.md`.

## Stato generale

- **Ultimo aggiornamento:** 2026-11-11.
- **Branch:** `consolidamento/fase-1` (da `master` a `f072a59`). Non pushato.
- **HEAD:** commit di C-06 (vedi `git log --oneline -6`). Precedenti: `f52071c` (A-03), `ffb527d` (A-02), `4e7fcf5` (A-04, A-05a), `2a5e7f8` (documenti di audit e piano).
- **Working tree:** pulito dopo il commit di C-06.
- **Roadmap:** fase 1 chiusa (A-04, A-05a, A-02, A-03, C-06 COMPLETED; A-05b BLOCKED da A-01). Prossima: fase 2, C-03 → C-04. DEFERRED fuori perimetro: A-01, E-02, F-05. C-04 PARTIALLY COMPLETED (stato di partenza). Osservazione G-03 aperta (§9). Dettaglio in `PLAN.md` §3.

## Ultimo lavoro completato

- **C-06:** se la ricompattazione (`VACUUM`) fallisce dopo lo svuotamento già committato, il reset restituisce comunque l'esito con il backup `pre-reset`; l'errore va nel log. Test che falliva prima della correzione.
- Evidenze: scheda C-06 in `PLAN.md`, SM7 in `STATE_MACHINES.md`, `PROGRESS.md`.

## Lavoro in corso

Nessuna attività parziale.

## Prossima attività

- **ID:** C-03 — LO1: il tipo di un movimento d'origine di prestiti è bloccato.
- **Perché ora:** prima attività della fase 2 (§7: C-03 → C-04). Decisione LO1 definitiva (§2.1): non riaprirla.
- **Prerequisiti:** A-05a (completata). Esclusività su `transactions.service.ts` e `loans.service.ts`.
- **File da esaminare:**
  - `apps/backend/src/modules/transactions/transactions.service.ts`: `updateType` a `:209`, filtro su `requiresIncome` a `:216`, campo `requiresIncome` a `:25`;
  - `apps/backend/src/modules/loans/loans.service.ts`: `transactionUsages`, `requiresIncome: link.role === 'REPAYMENT'` a `:478`;
  - `apps/backend/src/modules/transactions/transactions.routes.ts:101-108` (passa sempre `dependents`);
  - `GET /api/loans/links` (rotte dei prestiti) e, lato frontend, la pagina movimenti e `transactions-table`;
  - test da ribaltare: `loans.repayment-rules.test.ts:187-192`; da ricontrollare: `loans.partial-expense.test.ts:224-249`, `loans.service.test.ts:752-768`, `loans.validation.test.ts:284`.
- **Progetto deciso** (scheda C-03): `requiredType` (`'LOAN'` per ORIGIN, `'INCOME'` per REPAYMENT) calcolato in `linkOf`, copiato da `transactionUsages` al posto di `requiresIncome`; `updateType` rifiuta con 409 se `requiredType !== type`, con il messaggio della scheda; `dependents` resta opzionale (commento sul contratto e test di rotta); `requiredType` esposto in `GET /api/loans/links`; frontend: select del tipo disabilitata con `aria-describedby` quando il tipo coincide con `requiredType`, righe legacy con select normale.
- **Primo passo consigliato:** test backend che cambia il tipo di un movimento d'origine di un prestito completamente restituito e si aspetta 409; oggi passa (nessun blocco). Vederlo fallire.
- **Da non dimenticare:** G-03, `scripts/verify-package.mjs` attende 22 categorie invece di 24; `verify:package` è 12/17 per questa causa. Va corretta prima del prossimo rilascio.

## Verifiche

- **Ultimo `npm run check`:** 2026-11-11, dopo C-06: uscita 0, 109 s (backend 1071/1071, frontend 840/840, build ok).
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
4. Riprendere da C-03 con un test che fallisce prima della correzione (`PLAN.md` §8.2).
5. A fine attività: `npm run check`; aggiornare `PLAN.md` §3 e la scheda, aggiungere una sezione a `PROGRESS.md`, riscrivere questo file. Aggiornare `STATE_MACHINES.md` se cambia il comportamento implementato (per C-03: la macchina dei prestiti e il cambio di tipo).

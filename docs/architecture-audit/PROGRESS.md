# Registro di avanzamento del consolidamento

Registro cronologico delle sessioni di lavoro sul piano `PLAN.md` (revisione 2).
Una sezione per sessione, la più recente in fondo. Le sezioni precedenti non si modificano.

Lo stato corrente e il prossimo passo sono in `HANDOFF.md`; lo stato di ogni attività è in `PLAN.md` §3.

---

## Sessione 2026-11-11 — A-04, A-05a

- **Branch:** `master`.
- **Commit iniziale:** `f072a59`.
- **Commit finale:** invariato (`f072a59`). Nessun commit eseguito: le modifiche sono nel working tree.
- **Stato iniziale del working tree:** solo `?? docs/architecture-audit/` (AUDIT.md, PLAN.md, STATE_MACHINES.md della fase di audit e pianificazione). Nessuna modifica preesistente al codice.
- **Ambiente:** Windows 11, Node v24.11.1, npm via Git Bash.

### Attività affrontate

| ID | Esito |
|---|---|
| A-04 | COMPLETED |
| A-05a | COMPLETED |

### File modificati

- `apps/frontend/src/app/app.spec.ts` (A-04).
- `package.json` radice: script `check` (A-05a).
- `docs/architecture-audit/PLAN.md`: §3 e schede A-04, A-05a.
- `docs/architecture-audit/PROGRESS.md`, `docs/architecture-audit/HANDOFF.md`: nuovi.

### A-04 — modifiche e verifiche

- **Riproduzione prima della correzione:** `npm run test:frontend` → uscita 1; 77 file e 840 test passati; 2 errori non gestiti (`HttpErrorResponse ... /api/categories` e `/api/merchants/summary`, `0 Unknown Error`), originati in `src/app/app.spec.ts` dal test "aggiorna il titolo quando si naviga verso un'altra rotta" (montaggio di `AnalyticsPage`).
- **Primo tentativo, scartato:** `provideHttpClientTesting()` come da piano. Gli errori spariscono, ma i due test di navigazione vanno in timeout a 5 s: `fixture.whenStable()` attende le richieste pendenti, che il backend finto non risolve mai.
- **Correzione adottata:** la spec usa `routes.map(...)` con le pagine sostituite da un componente vuoto `EmptyPage`. Percorsi, titoli e redirect restano quelli reali. Rimossi dalla spec `provideHttpClient()` e l'import relativo: la shell `App` non usa HTTP.
- **Verifica:** `npm run test:frontend` → uscita 0; 77 file, 840 test passati; nessun "Unhandled Errors".

### A-05a — modifiche e verifiche

- **Modifica:** `"check": "npm run typecheck:backend && npm run test:backend && npm run test:frontend && npm run build"`.
- **Verifica positiva:** `npm run check` → uscita 0 in 121 s. Backend 1059/1059, frontend 840/840, build frontend e backend riuscite.
- **Verifiche negative** (file sonda temporanei non tracciati, cancellati dopo ogni esecuzione):

  | Sonda | Passo che fallisce | Uscita |
  |---|---|---|
  | `apps/backend/src/zz-check-probe.ts` con errore TS2322 | `typecheck:backend` | 1 |
  | `apps/backend/src/zz-check-probe.test.ts` con assert falso | `test:backend` (`fail 1`) | 1 |
  | `apps/frontend/src/app/zz-check-probe.spec.ts` con expect falso | `test:frontend` | 1 |
  | `apps/frontend/src/app/zz-check-probe.ts` con errore TS2322, non importato dai test | `build:frontend` | 1 |

- **Working tree dopo le esecuzioni:** solo `M apps/frontend/src/app/app.spec.ts`, `M package.json`, `?? docs/architecture-audit/`. Nessun output di build tracciato.

### Review

- Diff riletto: due file applicativi, circa 20 righe. Nessuna nuova dipendenza, configurazione o astrazione di produzione.
- `shellRoutes` lascia intatta la rotta `**` (solo `redirectTo`, nessun `component`).
- Comportamento dell'applicazione invariato: la modifica tocca una spec e uno script npm.
- Nessun subagent di review: diff troppo piccolo per giustificarlo.

### Decisioni tecniche

- A-04: pagine vuote nella spec della shell invece di `provideHttpClientTesting()` più risposte finte. Motivo: la spec verifica la shell; payload finti per ogni pagina sarebbero fragili e fuori tema.

### Verifiche non eseguite

- Nessuna verifica manuale dell'applicazione avviata: non necessaria per queste attività.
- `npm run check` non provato in `cmd.exe` né in PowerShell; eseguito via Git Bash. npm esegue comunque gli script con `cmd` su Windows.
- Nessun database reale letto o usato: i test backend usano il preload `isolate-database`.

### In sospeso

- Nessuna attività parziale.
- Prossima attività: A-02 (vedi `HANDOFF.md`).
- Osservazione, non affrontata: `apps/frontend/tsconfig.app.json` dichiara `"outDir": "./src/app"`. Senza effetti su `ng build` oggi. Non aggiunta al piano.

---

## Sessione 2026-11-11 (seconda parte) — commit e A-02

- **Branch:** `consolidamento/fase-1`, creato da `master` su richiesta di commit.
- **Commit della prima parte:** `2a5e7f8` (documenti di audit e piano), `4e7fcf5` (A-04, A-05a).
- **Commit iniziale di questa parte:** `4e7fcf5`. **Commit finale:** quello che contiene A-02 (vedi `git log`).

### Attività affrontate

| ID | Esito |
|---|---|
| A-02 | COMPLETED |

### File modificati

- `apps/backend/src/modules/maintenance/backup.service.ts`: parametro `protect` in `create()` e `prune()`.
- `apps/backend/src/modules/maintenance/restore.service.ts`: `create('pre-restore', moment, [name])`; `clearPendingRestore()` subito prima di `rmSync(candidate)`.
- `apps/backend/src/modules/maintenance/restore.service.test.ts`: T1, T2, T3.
- `apps/backend/src/modules/maintenance/backup.service.test.ts`: T4.
- `docs/architecture-audit/PLAN.md`, `STATE_MACHINES.md` (SM1: transizione e nota di aggiornamento), `PROGRESS.md`, `HANDOFF.md`.

### Verifiche

- **Prima della correzione** (solo i due file di test): T1 fallisce con `ENOENT ... copyfile '...pre-restore-20270101-100100.sqlite'` (R1 riprodotto); T3 fallisce (marker vecchio ancora presente); T4 fallisce; T2 verde, come previsto.
- **Dopo la correzione:** suite `modules/maintenance/*.test.ts` più `restore.runtime.test.ts` 168/168.
- **`npm run check`:** il primo giro è fallito al typecheck (TS2322/TS2345 nei nuovi test: destrutturazione di array con `noUncheckedIndexedAccess`). Corretto, secondo giro uscita 0 in 94 s: backend 1063/1063, frontend 840/840, build riuscita.

### Review

- Subagent revisore indipendente (Sonnet, sola lettura): nessun problema bloccante. I-R1 e I-R2 reggono su ogni ramo di errore di `stage()`, compreso il fallimento di `copyFileSync` (candidato parziale senza marker, ignorato al boot e rimosso dallo stage successivo).
- Osservazioni accettate, senza modifiche al codice:
  - la protezione vale solo per la creazione del pre-restore; un backup successivo di qualsiasi tipo può eliminare il backup scelto mentre il ripristino è in attesa. L'apply usa il candidato in `tmp/`; `backupName` resta solo un'etichetta nei log. Documentato in PLAN (scheda A-02) e STATE_MACHINES, da considerare in C-05;
  - T2 passa anche senza la correzione: protegge dallo spostare `clearPendingRestore()` troppo presto, come previsto dal piano;
  - T1 presume che nel file nessun altro pre-restore abbia una data successiva al 2027-01-01 (scritto nel commento del test);
  - T3 si basa su `rmSync` di una cartella che fallisce con `EISDIR`.

### Decisioni tecniche

- `protect` come parametro posizionale (array) invece dell'oggetto `{ protect }` della scheda: un solo chiamante, meno codice.

### Verifiche non eseguite

- Nessuna prova manuale di restore sull'app avviata: prevista dal piano solo con C-05.

### In sospeso

- Nessuna attività parziale.
- Prossima attività: A-03, in una sessione separata.
- I riferimenti di riga della scheda A-03 sono slittati: `live` è a `instance-lock.ts:136,150`, il furto del lock con `rmSync` a `:241` (e `:198`).

---

## Sessione 2026-11-11 (terza parte) — A-03

- **Branch:** `consolidamento/fase-1`.
- **Commit iniziale:** `ffb527d` (A-02). **Commit finale:** quello che contiene A-03 (vedi `git log`).
- **Nota sull'ordine:** l'ordine consigliato (§7) mette C-06 subito dopo A-02. A-03 è stata anticipata su richiesta di procedere: le dipendenze lo consentono, le aree sono diverse (`launcher/` e `maintenance/`).

### Attività affrontate

| ID | Esito |
|---|---|
| A-03 | COMPLETED |

### File modificati

- `apps/backend/src/launcher/instance-lock.ts`: rivendicazione del furto, lettura con identità del file (`snapshot`), `stealClaimFor` esportata per i test, gestione di `EPERM`, `release()` più restrittivo.
- `apps/backend/src/launcher/instance-lock.test.ts`: 8 nuovi test.
- `docs/rilascio.md`: sezione "Se l'avvio dice «L'archivio risulta bloccato da un avvio interrotto…»".
- `docs/architecture-audit/PLAN.md` (§3, scheda A-03, nuova osservazione G-03 in §9), `STATE_MACHINES.md` (SM3), `PROGRESS.md`, `HANDOFF.md`.

### Sequenza e verifiche

1. **Test prima della correzione:** T1, T3, T5 falliscono (T1: "B deve trovare A, non togliergli il lock"; T5: più vincitori alla ripetizione 0); T2 verde.
2. **Prima implementazione** come da scheda, con chiave = sha256 dei byte del lock. Suite `launcher/` 73/73, `npm run check` verde.
3. **Review indipendente** (subagent Opus, sola lettura), 7 osservazioni, nessuna bloccante. Accolte:
   - lock vuoti: tutti con la stessa chiave, quindi un lock nuovo non ancora scritto sembrava quello morto. Chiave estesa con `ino` e `birthtimeNs` letti dallo stesso handle;
   - un errore di lettura diverso da `ENOENT` faceva ripartire subito il ciclo e poteva esaurire i tentativi in microsecondi. Ora segue l'attesa di grazia e non porta mai al furto;
   - `release()` cancellava un file illeggibile. Ora rimuove solo un lock leggibile con il proprio token;
   - messaggio d'errore e `docs/rilascio.md` estesi al caso del file che non si lascia rimuovere.
   Documentata e non corretta: un avvio fermo più di 600 ms fra creazione e scrittura del proprio lock è giudicato morto (preesistente). Coperta diversamente: mancanza di un test tra processi (vedi punto 4).
4. **Stress tra processi reali** (script `lock-stress.mts` nella scratchpad di sessione, fuori dal repository): da 6 a 10 processi Node concorrenti su un lock morto, liveness TCP vera, il vincitore resta in ascolto 4 s.
   - codice di `HEAD` (prima di A-03): 0/6 ripetizioni corrette, da 2 a 4 processi acquisivano insieme; in un caso anche `EPERM` sul `wx`;
   - codice nuovo, 6 processi: 30/30;
   - codice nuovo, 10 processi: 28/30. Esclusione sempre rispettata, ma 2 perdenti terminavano con `EPERM` sul `wx` di una rivendicazione in cancellazione. Corretto trattando `EPERM` come transitorio (con l'errore originale mostrato se persiste);
   - dopo la correzione, 10 processi: 50/50.
5. **Prova sul pacchetto** (`npm run package`; `MYFINANCE_DATA` temporanea, `MYFINANCE_NO_BROWSER=1`, cartella rimossa al termine): avvio, `taskkill /F` di launcher e server, lock residuo presente, due `start.bat` lanciati quasi insieme. Un solo launcher vivo; il secondo stampa "MyFinance è già in esecuzione per questo archivio". Eseguita da script PowerShell, non con doppio clic.
6. **`npm run verify:package`:** 12/17. Superate K (istanza unica) e N (lock residuo dopo terminazione brusca). Falliscono A/C/I, D, Q, R ("24 categorie invece di 22", "le migrazioni sono state riapplicate") ed E/G/J ("già in esecuzione", probabilmente un'istanza rimasta da D). Causa indipendente da A-03: lo script attende 22 categorie, il commit `a0ac8f8` ne ha aggiunte 2. Registrata come G-03; non verificato sulla baseline. Nessun processo del pacchetto rimasto attivo.
7. **`npm run check` finale:** uscita 0 in 114 s; backend 1070/1070, frontend 840/840, build riuscita.

### Decisioni tecniche

- Chiave della rivendicazione = sha256(byte + `ino` + `birthtimeNs`) invece del token (vedi scheda A-03).
- `stealClaimFor()` esportata solo perché il test del caso residuo deve conoscere il nome della rivendicazione.
- Nessuna libreria, nessuna scadenza per età.

### Verifiche non eseguite

- Doppio clic manuale su `start.bat` (sostituito dalla prova scriptata al punto 5).
- Comportamento con antivirus aggressivo o su cartella sincronizzata (OneDrive) e su chiavette FAT/exFAT, dove `ino` e `birthtime` hanno garanzie più deboli.

### In sospeso

- Nessuna attività parziale.
- Prossima attività: C-06.
- G-03 (verify-package con attese obsolete) va corretta prima del prossimo rilascio.

---

## Sessione 2026-11-11 (quarta parte) — C-06

- **Branch:** `consolidamento/fase-1`. **Commit iniziale:** `f52071c` (A-03). **Commit finale:** quello che contiene C-06.

| ID | Esito |
|---|---|
| C-06 | COMPLETED |

### File modificati

- `apps/backend/src/modules/maintenance/reset.service.ts`: parametro `compact` (default `vacuum`) e `try/catch` con `logger.error`.
- `apps/backend/src/modules/maintenance/reset.service.test.ts`: nuovo describe "quando la ricompattazione fallisce".
- `docs/architecture-audit/PLAN.md`, `STATE_MACHINES.md` (SM7), `PROGRESS.md`, `HANDOFF.md`.

### Sequenza e verifiche

1. Test scritto prima. Primo tentativo dentro "quando NON si azzera": falliva per l'ordine dei test (`riempi()` su un archivio ancora pieno dal test precedente). Spostato in un describe proprio, dopo l'azzeramento.
2. Con il codice originale il test passava per il motivo sbagliato: il parametro veniva ignorato e il VACUUM vero riusciva. Introdotto il parametro senza `try/catch`: il test fallisce con `Error: database or disk is full` (F13 riprodotto).
3. Aggiunto il `try/catch`: test verde. Suite `maintenance/` 166/166.
4. `npm run check`: uscita 0 in 109 s; backend 1071/1071, frontend 840/840, build riuscita.

### Review

- Diff piccolo (2 file, circa 30 righe), riletto senza subagent. L'unico chiamante di `resetService.run` non cambia.
- Livello di log `error` invece del "warning" della scheda: il logger ha solo `info` ed `error`, e aggiungere un livello per questo caso non è giustificato.

### Verifiche non eseguite

- Nessun VACUUM fallito per davvero (disco pieno): simulato tramite il parametro.

### In sospeso

- Nessuna attività parziale. Fase 1 chiusa, salvo A-05b (BLOCKED da A-01).
- Prossima attività: C-03.

---

## Sessione 2026-11-11 (quinta parte) — merge della fase 1 e C-03

- **Merge:** il proprietario ha unito `consolidamento/fase-1` in `master` (PR #12, `46302f9`). Verificato con `git merge-base --is-ancestor`. `master` locale allineato con fast-forward.
- **Branch:** `consolidamento/fase-2`, da `46302f9`. **Commit finale:** quello che contiene C-03.

| ID | Esito |
|---|---|
| C-03 | COMPLETED |

### File modificati

- Backend: `modules/loans/loans.service.ts`, `loans.view-model.ts`, `modules/transactions/transactions.service.ts`; test `loans.type-lock.test.ts` (nuovo), `loans.repayment-rules.test.ts`, `loans.partial-expense.test.ts`, `loans.service.test.ts` (solo commenti), `transactions.routes.test.ts`.
- Frontend: `features/loans/loan.model.ts`, `features/transactions/transactions-page.{ts,html}`, `shared/transactions/transactions-table-panel/transactions-table-panel.{ts,html}`, `shared/transactions/transactions-table/transactions-table.{ts,html,scss,model.ts}`; spec `transactions-page.spec.ts`, `transaction-edits.spec.ts`, `transactions-table.spec.ts`, `loan-create-page.spec.ts` (fixture).
- Documenti: `PLAN.md`, `STATE_MACHINES.md` (SM4), `PROGRESS.md`, `HANDOFF.md`.

### Sequenza e verifiche

1. Test backend scritti prima (`loans.type-lock.test.ts`): 8 su 11 falliscono sul codice di partenza ("Missing expected exception" per i 409; `requiredType` assente).
2. Backend implementato; suite backend 1082/1082; test di rotta aggiunto (12/12 nel file).
3. Frontend implementato; specs aggiornate. Un primo giro di `npm run check` falliva sulla nuova spec del 409: avevo supposto il corpo `{ error: { message } }`, ma `error-handler.ts:70` risponde `{ error: message }`. Corretta la fixture.
4. Review indipendente (Sonnet): 0 bloccanti, 3 rischi, 1 domanda. Accolti: istruzioni di tutti i legami nel 409; `requiredTypes` nel lock del frontend (un movimento legacy origine e restituzione insieme veniva lasciato modificabile o bloccato a seconda dell'ordine dei legami); spec della tabella in sola lettura. Non accolto: rendere obbligatorio `dependents` (deciso nella scheda).
5. `npm run check` finale: uscita 0 in 110 s; backend 1083/1083, frontend 843/843, build riuscita.

### Verifiche non eseguite

- Nessuna prova manuale nell'app avviata della select bloccata.
- Nessun test sul caso legacy "origine e restituzione insieme": il backend rifiuta ogni tipo (nessuno soddisfa entrambi i legami), il che obbliga a eliminare un legame. Comportamento ritenuto corretto, non fissato da test.

### In sospeso

- Nessuna attività parziale. Prossima: C-04.
- Il contratto di `dependents` va scritto in `AGENTS.md` (B-01).

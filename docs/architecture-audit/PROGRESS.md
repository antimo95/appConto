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

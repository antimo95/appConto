# Cedolini: interventi dell'audit — Piano di implementazione

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Dentro ogni task: superpowers:test-driven-development; prima di chiuderlo: superpowers:verification-before-completion.

**Goal:** correggere i bug, eliminare le perdite di lavoro dell'utente, colmare i buchi di test e aggiungere il tipo di cedolino (ordinario, tredicesima, quattordicesima, conguaglio) alla feature Cedolini.

**Architecture:** i task 1–13 sono interventi locali sul codice esistente, senza cambiare lo schema. I task 14–17 aggiungono `kind` al cedolino: colonna + unicità `(period, kind)` nel backend, e un selettore del tipo nella revisione e nell'elenco del frontend. Confronti, andamento e verifica ferie restano calcolati solo sugli ordinari.

**Tech Stack:** Node 24, TypeScript strict, Express 5, drizzle-orm + better-sqlite3, zod 4, `node:test` via `tsx --test`; Angular (standalone, signals, `httpResource`), Vitest per le spec frontend, Playwright per gli e2e.

**Spec:** `docs/superpowers/specs/2026-11-10-cedolini-audit.md` (problemi con ID B/R/U/A/T, la decisione su A1 e ciò che resta fuori piano).

## Global Constraints

- Perimetro: solo la feature Cedolini. Unici file condivisi modificabili: `apps/frontend/src/app/app.routes.ts` (task 7) e, per i test, `docs/testing-cedolini.md`. **Non modificare** `apps/frontend/src/app/core/amount.ts` (usato da altre feature), `error-handler.ts`, `validation.ts`, `backup.*`, `reset.service.ts`, `safe-migrate.ts`.
- Nessuna nuova dipendenza npm.
- Gli importi viaggiano in centesimi interi; messaggi all'utente e commenti in italiano, con il perché; nessun dato del cedolino nei log.
- Backend: import con suffisso `.js`; test con `node:test` e `node:assert/strict`, nello stile dei file accanto.
- Frontend: component standalone, signals, nessun `any`; selettori nelle spec come nei file esistenti.
- Comandi di verifica (dalla radice del repo):
  - un file backend: `npx tsx --test apps/backend/src/modules/payslips/<file>.test.ts`
  - tutti i test backend dei cedolini: `npm run test:payslips:backend`
  - un file frontend: `npm test --prefix apps/frontend -- --watch=false --include "src/app/features/payslips/<file>.spec.ts"`
  - tutti i test frontend dei cedolini: `npm run test:payslips:frontend`
  - tipi backend: `npm run typecheck:backend`
  - e2e (costruisce il frontend): `npm run test:payslips:e2e`
- Un commit per task, messaggio `tipo(cedolini): …` in italiano, terminato da `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Lavora sul branch `features`.
- Prima di ogni task, la suite dei cedolini deve essere verde; se non lo è, fermarsi e riferire.

## Review Focus

1. **Un PATCH che non indica `kind` non deve riportare il cedolino a `ordinary`** (rischio: `.default()` di zod dentro `.partial()`) → test nel task 15.
2. **Il secondo cedolino dello stesso mese ma di tipo diverso non deve produrre anomalie ferie né righe di confronto** → test nel task 15.
3. **Dopo un salvataggio riuscito la revisione non deve chiedere di scartare le modifiche** (la guardia di U1 non deve scattare sul `select` interno a `afterChange`) → test nel task 7.
4. **Importi come `1e3`, `0x10`, `12,345`, `--5`, `1,2,3` non diventano mai un importo valido** → test nel task 1.
5. **Un nome file con `%` malformato, caratteri di controllo o percorso (`..\x.pdf`) diventa etichetta innocua** → test nel task 10.

---

## Fase 1 — Bug

### Task 1: B2 — lettura rigorosa degli importi digitati

**Files:**
- Modify: `apps/frontend/src/app/features/payslips/payslip-format.ts` (funzioni a riga 76-80)
- Modify: `apps/frontend/src/app/features/payslips/payslip-review.ts` (`checkNumber` riga 95-111, `toData` riga 387-416)
- Test: `apps/frontend/src/app/features/payslips/payslip-format.spec.ts`, `payslip-review.spec.ts`

**Interfaces:**
- Produces in `payslip-format.ts`:
  - `parseNumberInput(text: string): number | null` — toglie spazi e `€`; se resta qualcosa che non sia cifre, `.`, `,` o un `-` iniziale, `null`; altrimenti delega a `parseAmount`.
  - `parseCents(text: string): number | null` — usa `parseNumberInput`; `null` anche se il valore non è un numero intero di centesimi.
- `checkNumber` guadagna l'ultimo parametro `cents = false`: con `cents` true, un testo che `parseNumberInput` legge ma `parseCents` rifiuta dà l'errore `'Al massimo due decimali.'`.

- [ ] **Step 1: test** in `payslip-format.spec.ts`: `parseCents('1e3')`, `('0x10')`, `('--5')`, `('1,2,3')`, `('12,345')` → `null`; `('12,30')` → `1230`; `('1.234,56')` → `123456`; `('12,3')` → `1230`; `('-0,5')` → `-50`. `parseNumberInput('1e3')` → `null`; `('168,5')` → `168.5`.
- [ ] **Step 2: test** in `payslip-review.spec.ts`: scrivere `1e3` nel netto → `aria-invalid="true"` e messaggio `Valore non valido.`; scrivere `12,345` nel netto → messaggio `Al massimo due decimali.`; scrivere `1e3` nella quantità di una voce e in un campo saldo → `Valore non valido.`; `168,5` nelle ore lavorate resta valido.
- [ ] **Step 3: esegui** i due file → falliscono.
- [ ] **Step 4: implementa** le due funzioni e usale in `checkNumber` e `toData` al posto di `parseAmount` (importi: `cents = true`; quantità, ore e saldi: `false`). Il campo con testo non valido segue già `INVALID`.
- [ ] **Step 5: esegui** `npm run test:payslips:frontend` → verde.
- [ ] **Step 6: commit** `fix(cedolini): lettura rigorosa degli importi digitati`.

### Task 2: B1 + B3 — nessuna azione concorrente

**Files:**
- Modify: `payslips-page.ts` (`openFilePicker` 231, `startEdit` 314, `deleteSelected` 345), `payslips-page.html` (righe 6-11, 44-51, 147-151), `payslip-detail.ts`, `payslip-detail.html` (riga 73-74)
- Test: `payslips-page.spec.ts`, `payslip-detail.spec.ts`

**Interfaces:**
- `PayslipsPage`: `protected readonly deleting = signal(false)`; `canUpload = computed(() => phase() === 'idle' && !editing() && !deleting())`; `canModify = computed(() => phase() === 'idle' && !deleting())`.
- `PayslipDetailView`: `readonly busy = input(false)` che disabilita Modifica ed Elimina.

- [ ] **Step 1: test** in `payslips-page.spec.ts`: (a) archivio vuoto, scelto un file, durante l'analisi il pulsante dello stato vuoto è disabilitato o non apre il selettore (`http.expectNone` per un secondo POST dopo aver cliccato); (b) due clic ravvicinati su Elimina con `confirm` che risponde true → un solo `DELETE`; (c) durante `analyzing` i pulsanti Modifica ed Elimina del dettaglio sono `disabled`. In `payslip-detail.spec.ts`: con `busy` true entrambi sono `disabled`.
- [ ] **Step 2: esegui** → falliscono.
- [ ] **Step 3: implementa**: `openFilePicker`, `startEdit` e `deleteSelected` escono subito se il rispettivo computed è false; `deleteSelected` imposta `deleting` a true prima della chiamata e a false in `next` ed `error`; il pulsante dell'intestazione usa `[disabled]="!canUpload()"`; lo stato vuoto non emette `action` quando `!canUpload()`; il dettaglio riceve `[busy]="!canModify()"`.
- [ ] **Step 4: esegui** `npm run test:payslips:frontend` → verde.
- [ ] **Step 5: commit** `fix(cedolini): niente azioni concorrenti su caricamento, modifica ed eliminazione`.

### Task 3: B4 — messaggio chiaro per il file troppo grande

**Files:**
- Modify: `apps/backend/src/modules/payslips/payslips.routes.ts` (`createPayslipAnalysesRouter`, riga 46-67)
- Test: `apps/backend/src/modules/payslips/payslips.routes.test.ts` (test a riga 137-142)

**Interfaces:**
- Produces: dentro `createPayslipAnalysesRouter`, dopo le route, un middleware di errore `(error, _req, res, next)` che per `error.type === 'entity.too.large'` risponde `413` con `{ error: 'Il file supera la dimensione massima di 10 MB.' }` e per ogni altro errore chiama `next(error)`.

- [ ] **Step 1: test**: nel test del 413 aggiungi `assert.equal(errore(risposta), 'Il file supera la dimensione massima di 10 MB.')`.
- [ ] **Step 2: esegui** `npx tsx --test apps/backend/src/modules/payslips/payslips.routes.test.ts` → fallisce sul messaggio.
- [ ] **Step 3: implementa** il middleware; il controllo in `payslips.service.ts:148` resta per i chiamanti diretti del service.
- [ ] **Step 4: esegui** il file → verde; poi `npm run typecheck:backend`.
- [ ] **Step 5: commit** `fix(cedolini): messaggio chiaro per un PDF oltre il limite`.

### Task 4: B5 — messaggi di validazione in italiano

**Files:**
- Modify: `apps/backend/src/modules/payslips/payslip.model.ts` (schemi da riga 150 a 210)
- Test: `payslips.routes.test.ts`

- [ ] **Step 1: test** in `payslips.routes.test.ts`, un caso per ciascuno, tutti con risposta `400` e `errore(risposta)` che **non** corrisponde a `/invalid|expected|received|required/i`: `POST /payslips` senza corpo e senza `Content-Type`; corpo `[]`; corpo valido con `items: 'x'`; con `replaceExisting: 'si'`; con `leaveBalances: 'x'`; `PATCH /payslips/:id` con `{ items: 'x' }`; con `{ leaveBalances: [{}] }`. Parti da un corpo valido ottenuto come negli altri test del file.
- [ ] **Step 2: esegui** → falliscono quelli che escono in inglese.
- [ ] **Step 3: implementa**: dai un `error` in italiano agli schemi che non lo hanno (gli oggetti `z.object`, `z.array` di voci e saldi, `z.boolean` di `replaceExisting`); non toccare `parseOrThrow`. Ripeti finché tutti i casi passano.
- [ ] **Step 4: esegui** `npm run test:payslips:backend` → verde.
- [ ] **Step 5: commit** `fix(cedolini): messaggi di validazione sempre in italiano`.

---

## Fase 2 — Perdite di lavoro

### Task 5: U2 — errore di salvataggio accanto al pulsante

**Files:**
- Modify: `payslip-review.ts`, `payslip-review.html` (sopra `.actions`, riga 280), `payslips-page.html` (righe 26-28, 34-41, 139-145)
- Test: `payslip-review.spec.ts`, `payslips-page.spec.ts`

**Interfaces:**
- `PayslipReview`: `readonly error = input<string | null>(null)`; se presente rende `<p class="message--error" role="alert">` subito sopra le azioni.
- La pagina passa `[error]="actionError()"` a entrambe le istanze della revisione e mostra l'avviso in cima solo se `!showNewReview() && !editing()`.

- [ ] **Step 1: test** `payslip-review.spec.ts`: con `error` valorizzato compare un solo `[role=alert]` con quel testo dentro il componente. `payslips-page.spec.ts`: dopo un 409 sulla conferma l'errore è dentro `app-payslip-review` e non c'è un secondo `[role=alert]` in pagina; un file non PDF (nessuna revisione aperta) mostra l'errore in cima.
- [ ] **Step 2: esegui** → falliscono.
- [ ] **Step 3: implementa** come da Interfaces.
- [ ] **Step 4: esegui** `npm run test:payslips:frontend` → verde (aggiorna i selettori `[role=alert]` dei test esistenti dove l'errore ora vive dentro la revisione).
- [ ] **Step 5: commit** `fix(cedolini): l'errore di salvataggio compare accanto al pulsante`.

### Task 6: R1 — analisi scaduta: ricaricare il PDF senza perdere i valori

**Files:**
- Modify: `payslips-page.ts` (`confirmNew` 278-300, `onFileSelected` 235-263, `openFilePicker`), `payslips-page.html` (riquadro revisione, righe 31-42)
- Test: `payslips-page.spec.ts`

**Interfaces:**
- `PayslipsPage`: `protected readonly expired = signal(false)`; `protected readonly retained = signal<PayslipData | null>(null)`; `canUpload` (task 2) diventa vera anche se `phase() === 'reviewing' && expired()`.
- Nel template la bozza passata alla revisione è `retained() ?? analysis()!.draft`.
- Un `HttpErrorResponse` con `status === 404` su `create` imposta `expired` a true e `retained` ai dati inviati; qualunque altro errore resta com'è.

- [ ] **Step 1: test** in `payslips-page.spec.ts` (riprendi il flusso del test a riga 793-808): (a) 404 sulla conferma → compare l'avviso `L'analisi è scaduta` con un pulsante `Ricarica il PDF` dentro il riquadro, i campi mantengono i valori digitati; (b) cliccare il pulsante apre il selettore (`click` sull'input file spiato); (c) scelto un nuovo file e risposta `a-2` all'analisi → l'avviso sparisce, i campi mostrano ancora i valori digitati (non quelli della nuova bozza) e la conferma invia `analysisId: 'a-2'` con quei valori; (d) Annulla dopo la scadenza azzera `expired` e `retained`; (e) un 500 sulla conferma non mostra l'avviso di scadenza.
- [ ] **Step 2: esegui** → falliscono.
- [ ] **Step 3: implementa**: salva `result.data` prima della chiamata; azzera `expired` e `retained` su conferma riuscita, su `cancelNew` e quando il nuovo file viene scartato dalla validazione resta tutto com'è.
- [ ] **Step 4: esegui** `npm run test:payslips:frontend` → verde.
- [ ] **Step 5: commit** `fix(cedolini): un'analisi scaduta si ricarica senza perdere i valori digitati`.

### Task 7: U1 — avviso per le modifiche non salvate

**Files:**
- Modify: `payslip-review.ts`, `payslips-page.ts` (`select` 367, `cancelNew` 302, `cancelEdit` 319, `afterChange` 381), `apps/frontend/src/app/app.routes.ts` (rotta `payslips`, riga 65-72)
- Test: `payslip-review.spec.ts`, `payslips-page.spec.ts`

**Interfaces:**
- `PayslipReview`: `isDirty(): boolean`, vera dopo qualsiasi modifica di campo, voce, saldo o casella di sostituzione, e falsa dopo `load` (nuova bozza).
- `PayslipsPage`: `confirmLeave(): boolean` pubblico — se la revisione aperta è sporca chiede `window.confirm('Hai modifiche non salvate. Scartarle?')`, altrimenti `true`. `select(period)` (usato dal template) e `cancelNew`/`cancelEdit` passano da `confirmLeave`; un metodo privato `go(period)` naviga senza chiedere ed è l'unico usato da `afterChange`.
- Rotta: `canDeactivate: [(page: PayslipsPage) => page.confirmLeave()]`; la pagina registra anche `@HostListener('window:beforeunload')` che fa `preventDefault` se la revisione è sporca.

- [ ] **Step 1: test** `payslip-review.spec.ts`: `isDirty()` falso all'inizio, vero dopo aver scritto nel netto, falso dopo il cambio di `draft`. `payslips-page.spec.ts` (adatta il test a riga 486-501): modulo non toccato + altro mese → nessun `confirm` e si chiude; modulo toccato + `confirm` false → resta aperto; con `confirm` true → si chiude. Annulla su revisione toccata chiede conferma, su revisione non toccata no. **Dopo un salvataggio riuscito di una modifica `confirm` non viene mai chiamato.**
- [ ] **Step 2: esegui** → falliscono.
- [ ] **Step 3: implementa**; usa `viewChild(PayslipReview)` nella pagina per leggere `isDirty()`.
- [ ] **Step 4: esegui** `npm run test:payslips:frontend` → verde; poi `npm run build:frontend` per verificare i tipi della rotta.
- [ ] **Step 5: commit** `feat(cedolini): avviso prima di scartare modifiche non salvate`.

---

## Fase 3 — Robustezza e test del backend

### Task 8: R4 — analisi scadute fuori dalla memoria

**Files:**
- Modify: `payslips.service.ts` (`create` 211, `discardAnalysis` 195)
- Test: `payslip-analysis.store.test.ts` (nuovo), `payslips.service.test.ts`

- [ ] **Step 1: test** nuovo `payslip-analysis.store.test.ts` su `createAnalysisStore`: `evictExpired(now)` restituisce gli id scaduti e li toglie; un'analisi con `expiresAt === now` è scaduta (`get` → `null`, evicted); `clear()` svuota; la capacità `maxPending` elimina la più vecchia. `payslips.service.test.ts` (stesso modo del test a riga 493-502, con `now` iniettato): `discardAnalysis` su un'analisi scaduta lancia `NotFoundError`.
- [ ] **Step 2: esegui** → il test sul service fallisce.
- [ ] **Step 3: implementa**: `discardAnalysis` e `create` chiamano `analyses.evictExpired(deps.now())` come prima istruzione.
- [ ] **Step 4: esegui** `npm run test:payslips:backend` → verde.
- [ ] **Step 5: commit** `fix(cedolini): le analisi scadute escono dalla memoria anche su conferma e scarto`.

### Task 9: A2 — modello a schema e coerenza dei limiti col frontend

**Files:**
- Modify: `payslip.model.ts` (esporta `MAX_CENTS` e un nuovo `MAX_DECIMAL = 1_000_000` usato da `decimalSchema`)
- Create: `apps/backend/src/modules/payslips/payslip.model.test.ts`, `apps/backend/src/modules/payslips/frontend-contract.test.ts`

**Interfaces:**
- Produces: `export const MAX_CENTS`, `export const MAX_DECIMAL`.

- [ ] **Step 1: test** `payslip.model.test.ts` su `newPayslipSchema` e `payslipUpdateSchema` con un corpo base valido costruito nel test; ogni caso fallisce con il messaggio italiano indicato dallo schema: totale negativo; `section` sconosciuta; codice voce con spazi o oltre 16 caratteri; descrizione vuota e oltre 200; 301 voci; `workedHours` oltre `MAX_DECIMAL`; importo oltre `MAX_CENTS`; `analysisId` vuoto; due saldi dello stesso tipo; saldo senza unità. Il caso valido passa e normalizza `''` in `null` (employer, code, unit). Update: oggetto vuoto → `Nessuna modifica indicata.`
- [ ] **Step 2: test** `frontend-contract.test.ts`: legge come testo `apps/frontend/src/app/features/payslips/payslip-review.ts` e `payslip-format.ts` (percorso con `import.meta.dirname`) ed estrae con regex `MAX_EUROS = ([\d_]+)`, `MAX_DECIMAL = ([\d_]+)`, `MAX_PAYSLIP_BYTES = (.+);`; asserisce `MAX_EUROS * 100 === MAX_CENTS`, il `MAX_DECIMAL` del frontend uguale a quello esportato dal backend, e `10 * 1024 * 1024 === MAX_PDF_BYTES`. Un commento in testa spiega che è un controllo di deriva fra due app che non condividono codice.
- [ ] **Step 3: esegui** → il primo file fallisce dove lo schema non ha ancora il messaggio atteso o l'export manca.
- [ ] **Step 4: implementa** gli export e correggi gli schemi dove un caso lo richiede.
- [ ] **Step 5: esegui** `npm run test:payslips:backend` e `npm run typecheck:backend` → verdi.
- [ ] **Step 6: commit** `test(cedolini): schemi di validazione e limiti coerenti col frontend`.

### Task 10: scenari backend scoperti

**Files:**
- Create: `apps/backend/src/modules/payslips/testing/migrate-until.ts`, `apps/backend/src/db/migrations.payslips.test.ts`
- Modify: `payslips.routes.test.ts`, `payslip-documents.audit.test.ts`, `payslips.service.test.ts`

**Interfaces:**
- Produces: `migrateUntil(databaseFile: string, lastIdx: number): void` in `testing/migrate-until.ts` — copia in una cartella temporanea le migrazioni con `idx <= lastIdx` (come `backupV1Anteriore` in `backup.payslips.test.ts:312-326`) ed esegue `migrate` sul file. Riusa quella logica senza modificare quel test.

- [ ] **Step 1: test routes** in `payslips.routes.test.ts`: (a) `POST /payslip-analyses` con `Origin: https://evil.example` → 403; stessa cosa con `Sec-Fetch-Site: cross-site` (se `fetch` rifiuta l'intestazione usa `node:http`); (b) `GET /payslips/:id/document` per un cedolino a cui hai tolto il documento (`delete from payslip_documents`, come a `payslips.service.test.ts:338`) → 404 con il messaggio del service; (c) `POST` senza intestazione `X-File-Name` → `fileName` `cedolino.pdf`.
- [ ] **Step 2: test service** in `payslips.service.test.ts` su `cleanFileName`: `'..\\..\\x.pdf'` → `'x.pdf'`; `'a\u0000b\u001f.pdf'` → `'ab.pdf'`; stringa di 300 caratteri → 200; `''`, `null`, `undefined` → `'cedolino.pdf'`.
- [ ] **Step 3: test** `migrations.payslips.test.ts`: con `migrateUntil(file, 10)` crea lo schema fino a 0010; inserisci con SQL grezzo un cedolino (con `stored_path`) e una voce; applica la migrazione completa (`migrate` con `config.migrationsFolder`); asserisci che il cedolino e la voce esistono ancora, la colonna `stored_path` non c'è più e `payslip_documents` esiste vuota.
- [ ] **Step 4: test** in `payslip-documents.audit.test.ts`: database migrato fino a 0010 con due cedolini → `{ entries: [], withoutDocument: 2, mismatched: [] }`.
- [ ] **Step 5: esegui** `npm run test:payslips:backend`; correggi solo i test (il codice di produzione qui non cambia: se un caso rivela un bug, fermati e riferisci).
- [ ] **Step 6: commit** `test(cedolini): guardia locale, migrazione 0010→0011, nome file, documento mancante`.

### Task 11: prova locale con i PDF reali

**Files:**
- Create: `apps/backend/src/modules/payslips/parsing/samples.local.test.ts`

- [ ] **Step 1: scrivi il test**: legge i file `*.pdf` di `<radice>/samples/` (cartella ignorata da git); se non ce ne sono, il `describe` è `{ skip: 'nessun PDF in samples/' }`. Per ogni file: `extractPdfText` poi `extractPayslip(…, PAYSLIP_PARSERS)`; asserisce `status === 'complete'`, nessun warning con codice `earnings-mismatch`, `deductions-mismatch`, `net-mismatch`, `period` non nullo. Il nome del test usa l'indice (`sample 1`), mai il nome del file né i valori.
- [ ] **Step 2: esegui** `npx tsx --test apps/backend/src/modules/payslips/parsing/samples.local.test.ts` → saltato se la cartella è vuota, altrimenti riferisci l'esito all'utente senza riportare dati del cedolino.
- [ ] **Step 3: commit** `test(cedolini): verifica del parser sui PDF reali locali, saltata se assenti`.

---

## Fase 4 — UX e test del frontend

### Task 12: U3, U4, U5

**Files:**
- Modify: `payslip-leave-overview.html` (tabella a riga 67-90), `payslip-review.html` (riga 43, 40-53, 72-166, 183-249, 273-278), `payslip-review.ts`, `payslips-page.html`
- Test: `payslip-leave-overview.spec.ts`, `payslip-review.spec.ts`

- [ ] **Step 1: test U3** (overview): una cronologia con un mese `non_verificabile` mostra nella riga di quel mese il `reason` della verifica; un mese coerente mostra `Coerente`.
- [ ] **Step 2: test U4/U5** (review): il campo mese ha `placeholder="AAAA-MM"` e `pattern="\d{4}-(0[1-9]|1[0-2])"`; un errore su un campo di voce o saldo collega l'input con `aria-describedby` all'id dell'errore (`payslip-item-<id>-<campo>-error`, `payslip-leave-<id>-<campo>-error`); l'avviso del conteggio ha `role="status"` e non `role="alert"`; alla creazione la revisione porta il fuoco sul proprio contenitore (`tabindex="-1"`, `role="group"`, `aria-label="Verifica del cedolino"` oppure `"Modifica del cedolino"` secondo `analysis()`): `document.activeElement` è quel contenitore.
- [ ] **Step 3: esegui** → falliscono.
- [ ] **Step 4: implementa** (U3: colonna `Verifica` con la `check` del periodo; fuoco con `afterNextRender`).
- [ ] **Step 5: esegui** `npm run test:payslips:frontend` → verde (aggiorna i selettori `.problems`/`role=alert` dei test esistenti).
- [ ] **Step 6: commit** `feat(cedolini): motivi di verifica, formato del mese e accessibilità della revisione`.

### Task 13: rafforzare i test frontend

**Files:**
- Modify: `payslips-page.spec.ts`, `payslip-leave-overview.spec.ts`, `payslip-detail.spec.ts`, `payslip-comparison.spec.ts`, `payslip-trend.spec.ts`
- Create: `apps/frontend/src/app/core/http-error.spec.ts`

- [ ] **Step 1: correggi i test deboli**, uno alla volta, verificando che ciascuno possa fallire:
  - `payslips-page.spec.ts:402`: titolo "lascia la revisione aperta" → "non apre la revisione e mostra l'errore".
  - `:433-448` (elimina): dopo i flush asserisci che l'URL non ha più `period` e che il dettaglio mostra agosto; `:462-484` (modifica): asserisci che `app-payslip-review` è sparito e `app-payslip-detail` è tornato.
  - `:1027-1036` e `:1053-1067`: rinomina i titoli per dire ciò che verificano davvero (assenza di `tabindex`; `click` su un pulsante), la tastiera è coperta dall'e2e.
  - `payslip-leave-overview.spec.ts:4-52`: importa i tipi da `./payslip.model` invece di ridichiararli e togli il commento superato; stringi le asserzioni a riga 206-207, 226, 246-247, 293, 300 limitandole all'elemento giusto (`.totals`, `.missing`, `.anomalies li`).
  - `payslip-detail.spec.ts:52-54` e `100-101`: confronto sul testo esatto della cella, non `toContain('500,00')`.
  - `payslip-comparison.spec.ts:70,81`: asserisci il delta negativo `−30,00` della voce scomparsa.
- [ ] **Step 2: aggiungi i test mancanti**:
  - `core/http-error.spec.ts`: `HttpErrorResponse` con `{ error: { error: 'x' } }` → `'x'`; `status 0` → messaggio backend non raggiungibile; corpo senza messaggio → `'Si è verificato un errore imprevisto.'`; un `Error` qualunque → stesso messaggio generico.
  - `payslips-page.spec.ts`: `?period=2099-01` ricade sul mese più recente; sottotitolo con 0, 1 e 3 cedolini; KPI con delta netto negativo → tono `negative`; delta con `deltaPercent: null` → nessun delta; un file `cedolino è.pdf` parte con `X-File-Name: cedolino%20%C3%A8.pdf`.
- [ ] **Step 3: esegui** `npm run test:payslips:frontend` → verde; per ciascun test rafforzato, rompi temporaneamente il codice di produzione corrispondente e verifica che fallisca, poi ripristina.
- [ ] **Step 4: commit** `test(cedolini): asserzioni più rigorose e scenari frontend mancanti`.

---

## Fase 5 — Tipo di cedolino (A1)

### Task 14: dati — `kind` e unicità `(period, kind)`

**Files:**
- Modify: `payslips.schema.ts`, `payslip.model.ts`, `payslips.repository.ts`, `payslips.view-model.ts`, `payslips.service.ts` (solo il minimo perché compili: le chiamate a `findRowByPeriod` passano a `findRowByPeriodAndKind(period, data.kind)` o `(period, 'ordinary')` per l'analisi; messaggi e regole sono nel task 15)
- Create: `apps/backend/drizzle/0012_*.sql` e `apps/backend/drizzle/meta/*` (generati con `npm run db:generate`)
- Test: `apps/backend/src/db/migrations.payslips.test.ts`

**Interfaces:**
- Produces in `payslip.model.ts`: `PAYSLIP_KINDS = ['ordinary', 'thirteenth', 'fourteenth', 'adjustment'] as const`; `type PayslipKind`; `Payslip` e `PayslipData` hanno `kind: PayslipKind`. In `payslipDataShape` `kind` è `z.enum(PAYSLIP_KINDS, { error: 'Tipo di cedolino non valido.' })` **senza default**; `newPayslipSchema` lo sovrascrive con `.default('ordinary')`; `payslipUpdateSchema` resta `.partial()` senza default.
- Produces in schema: `kind: text('kind').notNull().default('ordinary')`; l'indice unico `payslips_period_unique` è sostituito da `payslips_period_kind_unique` su `(period, kind)`.
- Produces nel repository: `findRowByPeriodAndKind(period: string, kind: PayslipKind): PayslipRow | null` (sostituisce `findRowByPeriod`); `listComplete(to: string | null, kind: PayslipKind = 'ordinary'): Payslip[]`; `list` ordina per periodo nella direzione richiesta e, a parità di mese, l'ordinario per primo (ordinamento in JS dopo la query, rango `ordinary < thirteenth < fourteenth < adjustment`).
- Produces in `payslips.view-model.ts`: `kind: PayslipKind` in `PayslipSummary`; `PeriodConflict` diventa `{ payslipId, period, kind }`.

- [ ] **Step 1: test** in `migrations.payslips.test.ts` (aggiunta): con lo schema fino a 0011 e due cedolini inseriti, applicare 0012 lascia entrambi con `kind = 'ordinary'`; dopo si può inserire un terzo cedolino con lo stesso `period` e `kind = 'thirteenth'`; inserire un altro `(period, 'thirteenth')` viola il vincolo unico; inserire un altro `(period, 'ordinary')` lo viola.
- [ ] **Step 2: esegui** → fallisce (manca la migrazione).
- [ ] **Step 3: implementa** schema e modello, genera la migrazione con `npm run db:generate`, **leggi l'SQL generato** (deve fare `ALTER TABLE … ADD kind text DEFAULT 'ordinary' NOT NULL`, `DROP INDEX`, `CREATE UNIQUE INDEX`, senza ricreare la tabella né toccare `payslip_documents`), poi adegua repository, view-model e `toSummary`.
- [ ] **Step 4: esegui** `npm run typecheck:backend` e `npm run test:payslips:backend` → verdi (aggiorna i test esistenti che costruiscono cedolini o conflitti: `kind: 'ordinary'`).
- [ ] **Step 5: commit** `feat(cedolini): tipo di cedolino e unicità per mese e tipo`.

### Task 15: regole di dominio per i tipi

**Files:**
- Modify: `payslips.service.ts` (righe 129-136, 179, 221-226, 282-287, 314-322, 331), `payslips.routes.ts` (riga 91-99)
- Test: `payslips.service.test.ts`, `payslips.routes.test.ts`, `payslips.leave-summary.test.ts`

**Interfaces:**
- Consumes: `findRowByPeriodAndKind`, `listComplete(to, kind)` dal task 14.
- Produces: `KIND_LABELS: Record<PayslipKind, string>` in `payslips.service.ts` (`ordinary: 'ordinario'`, `thirteenth: 'di tredicesima'`, `fourteenth: 'di quattordicesima'`, `adjustment: 'di conguaglio'`); `document(id)` restituisce `{ content, period, kind }`; il nome del file scaricato è `cedolino-<period>.pdf` per l'ordinario e `cedolino-<period>-<kind>.pdf` per gli altri.

- [ ] **Step 1: test** (service/routes):
  - un ordinario e una `thirteenth` dello stesso mese coesistono (due `POST` con PDF diversi) e `GET /payslips` li restituisce con l'ordinario per primo;
  - un secondo ordinario dello stesso mese → 409 `Esiste già un cedolino ordinario per <mese>…`; con `replaceExisting: true` sostituisce solo quello ordinario e la tredicesima resta;
  - `PATCH /payslips/:id` con `{ netCents }` su una `thirteenth` la lascia `thirteenth` (**Review Focus 1**); `PATCH { kind: 'ordinary' }` su di essa quando esiste già un ordinario dello stesso mese → 409;
  - `GET /payslip-summaries` con un ordinario e una tredicesima dello stesso mese: `trend` e `comparisons` non crescono per la tredicesima, e `leave.anomalies` è vuoto anche se la tredicesima ha saldi ferie incoerenti (**Review Focus 2**, in `payslips.leave-summary.test.ts`);
  - l'analisi di un PDF il cui mese ha già un ordinario ha `conflict.kind === 'ordinary'`;
  - `Content-Disposition` del documento: ordinario `cedolino-2025-10.pdf`, tredicesima `cedolino-2025-10-thirteenth.pdf`.
- [ ] **Step 2: esegui** → falliscono.
- [ ] **Step 3: implementa** (creazione e correzione cercano il conflitto su `(period, kind)` di destinazione; `summaries` passa `'ordinary'` a `listComplete`).
- [ ] **Step 4: esegui** `npm run test:payslips:backend` e `npm run typecheck:backend` → verdi.
- [ ] **Step 5: commit** `feat(cedolini): conflitti, confronti e ferie considerano il tipo di cedolino`.

### Task 16: frontend — selettore del tipo ed elenco

**Files:**
- Modify: `payslip.model.ts`, `payslip-format.ts`, `payslip-review.ts` e `.html`, `payslips-page.ts` e `.html`, `payslip-detail.html`
- Test: `payslip-review.spec.ts`, `payslips-page.spec.ts`, `payslip-detail.spec.ts`, `payslip-format.spec.ts`

**Interfaces:**
- Consumes: il contratto del backend del task 14-15.
- Produces: `PayslipKind` e `kind` in `PayslipSummary`, `PayslipData` (obbligatorio), `PayslipDraft` (opzionale) e `PeriodConflict`; in `payslip-format.ts` `KINDS: readonly PayslipKind[]` e `KIND_LABELS: Record<PayslipKind, string>` (`Ordinario`, `Tredicesima`, `Quattordicesima`, `Conguaglio`).
- `PayslipReview`: l'input `takenPeriods` diventa `taken = input<readonly { period: string; kind: PayslipKind }[]>([])`; nuovo stato `kind` (default `draft.kind ?? 'ordinary'`) con una `<select>` etichettata `Tipo di cedolino` prima del mese; il conflitto vale su `(period, kind)`; in modifica il cedolino non confligge con sé stesso (stesso `period` e `kind` di partenza); cambiare tipo azzera `replaceExisting` come il mese; `confirmed` emette `data.kind`; il messaggio di conflitto è `Esiste già un cedolino <tipo in minuscolo> per <mese>.`.
- `PayslipsPage`: `selected` cerca `item.period === ?period && item.kind === (?kind ?? 'ordinary')` e ricade sul primo; `select(period: string, kind: PayslipKind = 'ordinary')` mette `kind` nell'URL solo se non è ordinario; le righe dell'elenco mostrano il tipo con un `app-badge` se non è ordinario e chiamano `select(item.period, item.kind)`; per un cedolino non ordinario il riquadro del confronto mostra `Il confronto riguarda solo i cedolini ordinari.`, `selectedPeriod` del grafico è `null` e i KPI non mostrano il delta; `afterChange` riceve anche `kind`. Il dettaglio mostra la riga `Tipo`.

- [ ] **Step 1: test** (review): la select ha le quattro opzioni; analisi con conflitto ordinario e tipo cambiato in `Tredicesima` → nessun conflitto; stesso mese e tipo già presente in `taken` → conflitto con il testo atteso; cambiare tipo azzera la casella; `confirmed` contiene `data.kind`; in modifica nessun conflitto con sé stesso.
- [ ] **Step 2: test** (page): elenco con ordinario e tredicesima dello stesso mese: due righe, badge solo sulla tredicesima; `?period=2026-09&kind=thirteenth` seleziona la tredicesima; senza `kind` seleziona l'ordinario; sulla tredicesima il riquadro confronto mostra il messaggio e il grafico non ha mese selezionato; cliccare la riga della tredicesima mette `kind=thirteenth` nell'URL, quella dell'ordinario lo toglie. (detail): compare la riga `Tipo`.
- [ ] **Step 3: esegui** → falliscono.
- [ ] **Step 4: implementa** e aggiorna i test esistenti che usano `takenPeriods`.
- [ ] **Step 5: esegui** `npm run test:payslips:frontend` e `npm run build:frontend` → verdi.
- [ ] **Step 6: commit** `feat(cedolini): selettore del tipo di cedolino nella revisione e nell'elenco`.

### Task 17: e2e e documentazione

**Files:**
- Modify: `e2e/support/cedolini.ts`, `e2e/payslips.spec.ts`, `docs/testing-cedolini.md`

**Interfaces:**
- Produces in `e2e/support/cedolini.ts`: una variante del PDF di settembre con un importo diverso (stesso mese, hash diverso), per caricare due cedolini dello stesso mese.

- [ ] **Step 1: scrivi gli e2e** in `e2e/payslips.spec.ts`, contro il backend vero, senza mock:
  - carica un ordinario di settembre e poi la variante scegliendo `Tredicesima` nella revisione: l'elenco ha due righe per settembre, il confronto dell'ordinario non cambia;
  - modifica dall'interfaccia: cambia il netto di un cedolino salvato, salva, ricarica la pagina e il valore è persistito;
  - apri il PDF: la richiesta `GET /api/payslips/<id>/document` (con `page.request`) risponde 200, `content-type` `application/pdf` e il corpo comincia con `%PDF`;
  - file oltre 10 MB (`setInputFiles` con un buffer) → messaggio `Il file supera il limite di 10 MB.` e nessuna richiesta di analisi;
  - modifiche non salvate: apri la modifica, cambia un campo, clicca un altro mese, un dialogo `confirm` compare (`page.once('dialog', d => d.dismiss())`) e il modulo resta aperto.
- [ ] **Step 2: esegui** `npm run test:payslips:e2e` → verde (richiede alcuni minuti); se un selettore `role=alert` dei test esistenti trova due elementi, correggi il test (task 5 sposta l'errore dentro la revisione).
- [ ] **Step 3: aggiorna** `docs/testing-cedolini.md` con i nuovi file di test (`payslip-analysis.store.test.ts`, `payslip.model.test.ts`, `frontend-contract.test.ts`, `migrations.payslips.test.ts`, `samples.local.test.ts`, `http-error.spec.ts`) e con il fatto che `samples.local.test.ts` si attiva solo se `samples/` contiene PDF.
- [ ] **Step 4: verifica finale**: `npm test` (tutto il repo) e `npm run typecheck:backend` → verdi; `git status` pulito dopo il commit.
- [ ] **Step 5: commit** `test(cedolini): e2e di tipi, modifica, PDF, file grande e modifiche non salvate`.

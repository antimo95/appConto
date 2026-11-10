# Cedolini — audit tecnico e interventi

Data: 2026-11-10. Perimetro: solo la feature Cedolini (`apps/backend/src/modules/payslips`, `apps/frontend/src/app/features/payslips`, tabelle `payslip*`, e2e dei cedolini) e i punti in cui altre parti dell'app la toccano (backup, ripristino, azzeramento, `app.routes.ts`).

Esito: nessun problema Critical. Il backend è solido (livelli separati, transazione unica per riga + PDF, errori di dominio, perimetro locale). Restano bug piccoli, punti in cui l'utente perde lavoro senza avviso, buchi di test e un limite di dominio (A1). Suite alla data dell'audit: 209 test backend e 108 frontend verdi; e2e non eseguiti.

I problemi sono dedotti dalla lettura del codice; solo B4 e B5 sono stati riprodotti avviando l'app.

## Problemi inclusi nel piano

| ID | Gravità | Problema | Dove |
|---|---|---|---|
| B1 | Medium | Ad archivio vuoto il pulsante dello stato vuoto non è disabilitato durante l'analisi: partono due caricamenti | `payslips-page.html:44-51`, `payslips-page.ts:231` |
| B2 | Medium | `parseCents` arrotonda un terzo decimale (`12,345`) e accetta `1e3` e `0x10` come importi; il parser backend invece rifiuta il terzo decimale | `payslip-format.ts:76-80`, `core/amount.ts:33` |
| B3 | Low | Modifica ed Elimina sempre attivi durante analisi, salvataggio, eliminazione: doppio clic su Elimina dà un 404 a cancellazione riuscita | `payslips-page.ts:314-365` |
| B4 | Low | File oltre 10 MB: 413 con messaggio "il corpo non è leggibile"; il controllo del service è irraggiungibile via HTTP | `payslips.routes.ts:27`, `error-handler.ts:49` |
| B5 | Low | Messaggi zod in inglese su corpo assente o tipi sbagliati | `payslip.model.ts`, `validation.ts:14` |
| R1 | Medium | Analisi scaduta (1 h o riavvio): la conferma dà 404 e la revisione resta aperta senza via d'uscita; `expiresAt` non è usato | `payslips-page.ts:295-298` |
| R4 | Low | Le analisi scadute restano in memoria finché non arriva un nuovo caricamento; `discardAnalysis` risponde 204 su un'analisi scaduta | `payslips.service.ts:164,196` |
| U1 | Medium | Cambiare mese, Annulla, cambiare pagina scartano le modifiche senza avviso | `payslips-page.ts:302-373` |
| U2 | Medium | L'errore di salvataggio compare in cima alla pagina, lontano dal pulsante in fondo al modulo | `payslips-page.html:26-28` |
| U3 | Low | I mesi "non verificabile" non mostrano il motivo, che il backend già calcola | `payslip-leave-overview.html:14-33` |
| U4 | Low | Il campo mese, dove `type="month"` non è supportato, diventa testo libero senza indicare il formato | `payslip-review.html:43` |
| U5 | Low | Errori delle righe non collegati ai campi; avviso del conteggio riannunciato a ogni tasto; fuoco non gestito all'apertura della revisione | `payslip-review.html` |
| A1 | Decisione dell'utente | Un solo cedolino per mese (`payslips_period_unique`): tredicesima, quattordicesima, conguaglio non possono coesistere con l'ordinario | `payslips.schema.ts:38` |
| A2 | Medium | Limiti di validazione copiati a mano nel frontend, senza test di deriva | `payslip-review.ts:85-87` |
| T1–T5 | Medium/Low | Test: nessun PDF reale; scenari scoperti; asserzioni deboli | vedi il piano |

### A1 — decisione presa

L'utente non sa se il suo datore emette mensilità aggiuntive come cedolino separato: si implementa il supporto, che non cambia nulla per chi ha solo cedolini ordinari.

- Ogni cedolino ha un `kind`: `ordinary` (default), `thirteenth`, `fourteenth`, `adjustment`.
- L'unicità passa da `period` a `(period, kind)`. I cedolini esistenti diventano `ordinary`.
- Confronti, andamento e verifica ferie considerano **solo** gli ordinari: una tredicesima non deve generare anomalie né confronti.
- Il parser non riconosce il tipo (manca un PDF reale di tredicesima): è una scelta manuale nella revisione, default ordinario.
- L'URL di selezione resta `?period=YYYY-MM`; si aggiunge `&kind=` solo per i non ordinari.

## Fuori piano, con motivo

- **R2** (PDF con hash errato blocca backup, azzeramento e migrazione): tocca avvio e backup, condivisi con tutta l'app; serve una decisione su come segnalarlo e se permettere un backup marcato come anomalo.
- **R3** (azzeramento non atomico sui file legacy): non esiste un'operazione atomica sul filesystem; il caso riguarda solo PDF rimasti dalla versione precedente. Rischio accettato.
- **R5** (parsing sul thread principale senza timeout), **R6** (POST non idempotente, PATCH senza versione): irrilevanti per un'app monoutente locale.
- **A3** (stato `phase`/`editing` della pagina da unificare): da rivalutare dopo A1, che tocca la selezione; B3 e U1 coprono i sintomi.
- **A4** (avvisi di coerenza ricalcolati durante la modifica): richiederebbe di duplicare la logica nel frontend.
- **A5** (filtri API inutilizzati): nessun danno.
- **T2** (test backend dipendenti dall'ordine): riscrittura di due file da 350 e 600 righe verdi, a basso beneficio.
- PDF protetto da password: nessun fixture semplice; il ramo è coperto solo per lettura.
- Il file `apps/backend/data-backup-p2-20260901/appconto.db` è versionato in git e potrebbe contenere dati personali: fuori perimetro, da guardare a parte.

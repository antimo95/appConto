# Personal Finance Tracker

Applicazione web locale per analizzare gli estratti conto bancari esportati in CSV.

La documentazione di progetto è indicizzata in [docs/README.md](docs/README.md).

## Stato

- **WP1 — CSV Import Foundation**: import di un CSV, persistenza delle transazioni
  in SQLite e visualizzazione dell'elenco.
- **WP2 — Merchant Domain**: ogni transazione importata viene associata ad un
  merchant, creato una sola volta a partire dalla descrizione normalizzata.
- **WP3 — Category**: ad ogni merchant può essere assegnata una categoria di
  spesa; le sue transazioni la ereditano automaticamente.
- **WP4 — Import Reliability**: l'importazione è idempotente. Reimportare lo
  stesso estratto conto non crea duplicati e restituisce un riepilogo.
- **WP5 — Monthly Summary**: la home mostra entrate, uscite, saldo e spese per
  categoria del mese selezionato, sempre ricalcolate dalle transazioni.
- **WP6 — Merchant Workspace**: una sezione dedicata ai merchant, con totali
  calcolati, ricerca, filtri e rinomina.
- **WP7 — Transaction Types & Cash Flow**: ogni movimento ha una natura
  (spesa, entrata, prelievo, prestito, trasferimento, altro); solo le spese
  reali entrano nel riepilogo, mentre il cash flow considera tutto.
- **WP7.2 — Cash Flow Dashboard**: card "Liquidità" nella home e pagina
  impostazioni per il saldo di partenza.
- **WP8 — Dashboard Analytics**: filtri condivisi (mese, tipo, categoria,
  merchant), drill down categoria → merchant → transazioni, top merchant e
  confronto con il mese precedente.
- **WP8.1 — Analytics & Time Range**: una pagina dedicata all'analisi storica,
  con periodo libero, filtri combinabili, andamento nel tempo, distribuzione
  per categoria e merchant e sezione prestiti.
- **WP8.2 — Transaction Explorer**: la pagina **Movimenti**, con ricerca,
  filtri, ordinamento e paginazione eseguiti dal database e criteri scritti
  nell'indirizzo. Analytics resta una dashboard e vi rimanda già filtrata.
- **WP9 — Loan Management & Repayments**: un dominio dedicato ai prestiti. Una
  transazione `LOAN` racconta cosa è uscito dal conto; il **prestito** racconta
  quanto denaro si attende indietro, e le **restituzioni** — bancarie o in
  contanti — lo riducono. Credito residuo e stato sono sempre calcolati.

## Installazione

Serve Node.js 24 (il package portatile incorpora la v24.11.1, vedi
`scripts/node-runtime.json`). Backend e frontend hanno dipendenze separate:

```bash
npm ci
npm ci --prefix apps/frontend
```

Su Windows senza gli strumenti di compilazione C++ di Visual Studio il primo
comando può fallire su `better-sqlite3`: npm prova a compilarlo con `node-gyp`
anche se il pacchetto contiene già i binari per Windows (`prebuilds/`). In quel
caso usa `npm ci --ignore-scripts` per la radice: il backend carica i binari
inclusi e `npm run check` passa (verificato con npm 11.6.2).

## Avvio in sviluppo

Servono due terminali.

```bash
# 1. backend Express -> http://127.0.0.1:3000
npm run dev:backend

# 2. frontend Angular -> http://localhost:4200 (inoltra /api al backend)
npm run dev:frontend
```

Il proxy del frontend (`apps/frontend/proxy.conf.json`) punta alla porta 3000:
se `config/settings.json` o `MYFINANCE_PORT` ne indicano un'altra, il frontend
in sviluppo non trova il backend.

## Verifica

```bash
npm run check
```

Esegue typecheck del backend, test del backend, test del frontend e build, e
si ferma al primo errore (circa due minuti). Esce con 0 solo se tutto è sano.

## Dove stanno i dati

Database, backup, log e temporanei stanno sotto una sola cartella, `DATA_ROOT`.
Il database è `<DATA_ROOT>/database.sqlite`; accanto ci sono `backups/`,
`logs/` e `tmp/`. `DATA_ROOT` si sceglie, in quest'ordine
(`apps/backend/src/paths.ts`):

1. la variabile `MYFINANCE_DATA`;
2. `dataRoot` in `config/settings.json` (vedi `config/settings.example.json`);
3. la cartella del file indicato da `DATABASE_FILE` (alias storico);
4. altrimenti `data/` nella radice del repository (o del package).

Un percorso relativo si risolve rispetto alla radice dell'applicazione, non
alla cartella da cui si lancia il comando.

Il database viene creato al primo avvio applicando le migrazioni di
`apps/backend/drizzle/`; le successive si applicano a ogni avvio, dopo un
backup automatico, senza perdere i dati. Per ripartire da zero c'è l'azzeramento
(`POST /api/reset`), che crea prima una copia `pre-reset`; i backup si creano,
si scaricano e si ripristinano con le API `/api/backups` e `/api/restore`
(tabella sotto).

> **Per prove manuali e test usa sempre una cartella temporanea**: senza, l'app
> apre il tuo archivio reale. I test del backend si isolano da soli
> (`apps/backend/src/test-support/isolate-database.ts`).
>
> ```powershell
> # PowerShell
> $env:MYFINANCE_DATA = "$env:TEMP\appconto-prova"; npm run dev:backend
> ```
>
> ```bash
> # Git Bash, macOS, Linux
> MYFINANCE_DATA="$(mktemp -d)" npm run dev:backend
> ```

### Variabili d'ambiente

| Variabile | Effetto |
|---|---|
| `MYFINANCE_DATA` | Radice dei dati (`DATA_ROOT`), con la precedenza più alta |
| `DATABASE_FILE` | Percorso del database; se `MYFINANCE_DATA` e `dataRoot` mancano, la sua cartella diventa `DATA_ROOT` |
| `MYFINANCE_PORT`, `PORT` | Porta del backend, in quest'ordine; poi `port` di `config/settings.json`; poi 3000 |
| `MYFINANCE_AUTO_BACKUP_HOURS` | Ogni quante ore creare un backup automatico (`0` lo disattiva; predefinito 24) |
| `MYFINANCE_NO_BROWSER` | `1`: il launcher del package non apre il browser |
| `MYFINANCE_PORT_FALLBACK` | `1`: se la porta è occupata ne usa un'altra. La imposta il launcher, non va impostata a mano |
| `MYFINANCE_CONSOLE_TEMPORANEA` | `1`: la finestra del launcher attende un tasto prima di chiudersi. La imposta `start.bat` |

## Utilizzo

1. Aprire <http://localhost:4200>. In **Impostazioni** indicare il saldo del
   conto ad una certa data: è il punto di partenza del calcolo della liquidità.
2. Nella schermata **Import CSV** selezionare un estratto conto: la pagina mostra
   subito quali colonne ha riconosciuto. Se sono giuste basta premere *Importa*;
   altrimenti si passa alla modalità **Manuale** e le si indica a mano.
3. Nel **Riepilogo** scegliere il mese: tutte le sezioni — liquidità, spese per
   categoria, top merchant, confronto col mese precedente e tabella dei
   movimenti — seguono la stessa selezione. Cliccando un merchant o *filtra* su
   una categoria si restringe l'analisi; *Azzera filtri* la riapre.
4. In **Analytics** scegliere un periodo — un mese, un trimestre, un anno o due
   date qualsiasi — e combinare i filtri per tipo, categoria, merchant e stato
   di classificazione. L'**andamento nel tempo** è una spezzata di entrate e
   uscite a passo settimanale (commutabile su giorno o mese) che segue gli
   stessi filtri: scegliendo *Tabacco* mostra solo quelle uscite, settimana per
   settimana. I valori si leggono passando il mouse, con le freccie da tastiera
   o aprendo la tabella sotto il grafico; i punti vuoti sono intervalli
   incompleti. Cliccando una categoria o un merchant si passa ai movimenti.
5. In **Movimenti** cercare e filtrare l'archivio: la ricerca guarda la
   descrizione della banca, il nome dell'esercente e quello scelto da te.
   I criteri stanno nell'indirizzo, quindi un filtro si può ricaricare,
   condividere e ritrovare con il tasto *indietro*. Da Analytics si arriva qui
   già filtrati cliccando una categoria, un merchant o i prestiti.
   Nella colonna **Tipo** correggere i movimenti che non sono spese reali:
   un prelievo al bancomat, un giroconto o un prestito escono dal totale delle
   uscite e dalle categorie, ma restano nel cash flow.
6. In **Prestiti** vedere quanto denaro è ancora fuori casa: prestato,
   restituito, da ricevere e quanti prestiti sono aperti. Un prestito **non**
   nasce dall'import — l'estratto conto non sa chi ha ricevuto il denaro: si
   crea da **Movimenti**, dove ogni riga di tipo *Prestito* offre *Crea
   prestito*. Nel dettaglio si registrano le restituzioni, con o senza il
   movimento bancario corrispondente, e il credito residuo si aggiorna da sé.
7. In **Merchant** filtrare su *Da classificare* per assegnare una categoria
   agli esercenti non ancora classificati, partendo da quelli su cui si è speso
   di più. Qui è anche possibile rinominarli: il nome originale della banca
   resta comunque memorizzato.

Il pulsante **Modalità notte**, in alto a destra, passa al tema scuro; in
*Impostazioni → Aspetto* si può anche lasciare che il tema segua quello del
sistema operativo, che è il comportamento di partenza. La scelta resta su questo
computer — è una preferenza dello schermo, non un dato del conto, quindi non
finisce nell'archivio né nei backup.

### Prestiti e liquidità sono due cose diverse

Sono la distinzione più importante da tenere a mente:

| | Risponde a | |
|---|---|---|
| **Liquidità** | cosa è successo al conto | un prestito di 80 € sposta il saldo di −80 € |
| **Prestito** | quanto denaro devo ancora ricevere | quegli 80 € sono un credito, non una spesa |

Le conseguenze pratiche:

- una restituzione **in contanti** riduce il credito ma **non** muove la
  liquidità: nessun movimento bancario è avvenuto, e non ne viene inventato uno;
- una restituzione **bancaria** viene collegata alla transazione già importata,
  che resta la normale entrata che è. Il collegamento aggiunge significato, non
  cambia il tipo del movimento e non conta il denaro due volte: la transazione
  appartiene alla liquidità, la restituzione al calcolo del credito;
- Analytics continua a essere una proiezione delle sole transazioni e non
  duplica i dati dei prestiti: la sezione *Prestiti* rimanda al workspace.

### Prestiti parziali

Una stessa transazione può finanziare **più prestiti** — un pagamento che copre
l'assicurazione di due persone — purché la somma dei crediti non superi l'importo
del movimento.

Da qui la regola che conta: **la quota di un movimento `LOAN` non attribuita a
nessun prestito è una spesa tua**, e viene trattata come tale.

Un pagamento di 1.920 € di cui 1.030 € anticipati per un'altra persona:

| | Importo | Perché |
|---|---|---|
| Liquidità | −1.920 € | dal conto sono usciti tutti |
| Uscite del mese e categoria | 890 € | quelli non prestati li hai spesi tu |
| Patrimonio | −890 € | i 1.030 € sono diventati un credito, non una perdita |
| Prestato | 1.030 € | il credito da incassare |

Finché non registri il prestito la ripartizione non è nota, e il movimento resta
**tutto** credito: è l'ipotesi prudente, perché contare come spesa denaro che ti
aspetti indietro sarebbe peggio. Registrato il prestito, la ripartizione diventa
nota e le uscite si aggiornano. Incassare la restituzione non cambia gli 890 €:
quella spesa è già avvenuta.

Il modulo *Crea prestito* mostra la conseguenza mentre digiti l'importo, e il
dettaglio del prestito la ripete accanto al movimento d'origine.

Un file di esempio è disponibile in [samples/estratto-conto-esempio.csv](samples/estratto-conto-esempio.csv).

### Formato CSV atteso

Ogni banca esporta l'estratto conto a modo suo, con nomi di colonna, ordine e
numero di colonne diversi: le colonne vengono quindi riconosciute dal loro
**contenuto**, non dall'intestazione. Una colonna di date è la data, una di
numeri è un importo, il testo libero è la descrizione. L'intestazione resta un
indizio, utile solo a sciogliere i casi ambigui (`Data contabile` viene
preferita a `Data valuta`, `Importo` al `Saldo`).

Servono tre informazioni: **data**, **descrizione** e **importo**. Le colonne in
più — divisa, IBAN, saldo, categoria della banca — vengono ignorate. L'esito
dell'import elenca le colonne che sono state usate per ogni campo, così il
riconoscimento è verificabile.

### Modalità automatica e manuale

Scelto il file, la schermata **Import CSV** lo legge e mostra quali colonne ha
riconosciuto **prima** di importare qualsiasi cosa. Da lì si scelgono le colonne
da leggere:

- **Automatica** — quelle riconosciute dal contenuto. È la modalità di
  partenza, quando il riconoscimento è completo.
- **Manuale** — le indichi tu, con una tendina per campo. Accanto a ogni
  tendina compare un valore d'esempio preso dal file: è quel che permette di
  riconoscere la colonna giusta anche quando l'intestazione non dice niente
  (`F3`, `Column2`). Le tendine partono già dalla proposta automatica, quindi
  di solito basta correggere un campo.

La modalità manuale serve in due casi: quando il riconoscimento **non arriva**
a un campo obbligatorio — e allora è l'unica strada, la pagina ci si porta da sé
— e quando arriva ma **sceglie male**, per esempio prendendo il saldo
progressivo al posto dell'importo del movimento. Per questo resta disponibile
sempre, non solo quando qualcosa non funziona.

La strada seguita non cambia l'identità dei movimenti: un file importato a mano
e poi reimportato in automatico non crea duplicati.

- separatore `,` oppure `;` (riconosciuto automaticamente);
- date `31/12/2025`, `31-12-2025`, `31.12.2025` oppure `2025-12-31`;
- importi `-1.234,56`, `1234.56`, `€ 12,00`, `120,00-` — negativo = uscita;
- l'importo può anche stare su **due colonne** mutuamente esclusive
  (`Uscite`/`Entrate`, `Dare`/`Avere`, `Debit`/`Credit`): il segno lo dà la
  colonna in cui compare il valore;
- se il file ha più colonne compatibili con lo stesso campo, per ogni riga viene
  usato il **primo valore non vuoto**: una riga con `Descrizione` vuota ricade
  sulla colonna di testo successiva invece di essere scartata;
- una colonna con la dicitura del movimento (`Tipo operazione`, `Tipologia`)
  viene usata per distinguere prelievi e accrediti; in sua assenza decide il
  segno dell'importo.

Le righe non convertibili vengono scartate e segnalate nell'esito dell'import;
le altre vengono comunque importate.

### Importazioni ripetute

Ogni transazione è identificata da un **fingerprint** calcolato su data
contabile, importo in centesimi e descrizione, più un progressivo che distingue
movimenti realmente identici avvenuti lo stesso giorno. Reimportare lo stesso
file, o due estratti conto con periodi sovrapposti, non crea duplicati:
vengono archiviate solo le transazioni non ancora presenti.

Al termine l'import restituisce un riepilogo con righe lette, transazioni
nuove, duplicate, righe scartate e merchant creati.

## API

Tutte le rotte hanno il prefisso `/api` (per esempio `GET /api/transactions`).

| Metodo | Rotta                        | Descrizione                                                  |
|--------|------------------------------|--------------------------------------------------------------|
| POST   | `/import/csv/analysis`       | Dice quali colonne contiene il file e quali sono state riconosciute, senza importare (body testuale, `text/csv`) |
| POST   | `/import/csv`                | Importa un CSV con le colonne riconosciute dal contenuto (body testuale, `text/csv`) |
| POST   | `/import/csv/mapped`         | Importa un CSV con le colonne indicate a mano (`{"content": "…", "mapping": {…}}`, `application/json`) |
| GET    | `/transactions`              | Ricerca paginata: `from`, `to`, `search`, `types`, `categoryIds`, `merchantIds`, `classification`, `minAmount`, `maxAmount`, `page`, `pageSize`, `sortBy`, `sortDirection` |
| GET    | `/transactions/:id`          | Una singola transazione, con il proprio merchant             |
| GET    | `/merchants`                 | Elenco dei merchant, con la categoria assegnata              |
| GET    | `/merchants/summary`         | Merchant con transazioni, totale speso e ultima transazione  |
| PATCH  | `/merchants/:id`             | Rinomina il merchant (`{"displayName": "…"}`, `""` ripristina) |
| PATCH  | `/merchants/:id/category`    | Assegna la categoria (`{"categoryId": "…"}`, `null` la toglie) |
| GET    | `/categories`                | Elenco delle categorie                                       |
| PATCH  | `/transactions/:id/type`     | Corregge la natura del movimento (`{"type": "WITHDRAWAL"}`)  |
| GET    | `/dashboard?month=YYYY-MM`   | Vista aggregata della home; accetta `type`, `categoryId`, `merchantId` |
| GET    | `/analytics?from=&to=`       | Analisi di un periodo; accetta `types`, `categoryIds`, `merchantIds` (elenchi separati da virgole), `classification` e `granularity` (`day`, `week`, `month`) |
| GET    | `/summary?month=YYYY-MM`     | Riepilogo del mese (calcolato, mai memorizzato)              |
| GET    | `/cash-flow?month=YYYY-MM`   | Saldo di partenza, movimenti netti e saldo disponibile del mese (senza `month`: tutto l'archivio) |
| GET    | `/loans`                     | Prestiti con residuo e stato, più i totali della posizione; accetta `status` (`open`, `settled`, `all`), `borrower`, `search`, `sortBy` (`remainingAmount`, `lentAt`, `amount`, `borrower`), `sortDirection` |
| GET    | `/loans/links`               | Indice dei movimenti che hanno un prestito dietro, per l'esplorazione |
| GET    | `/loans/:id`                 | Dettaglio con movimento d'origine e storico delle restituzioni |
| POST   | `/loans`                     | Crea il credito nato da una transazione `LOAN` (`transactionId`, `borrowerName`, `description`, `amount`, `lentAt`) |
| PATCH  | `/loans/:id`                 | Corregge persona, descrizione, importo o data                 |
| DELETE | `/loans/:id`                 | Elimina un prestito **senza** restituzioni (altrimenti `409`) |
| POST   | `/loans/:id/repayments`      | Registra una restituzione (`amount`, `repaymentDate`, `note`, `transactionId` opzionale) |
| PATCH  | `/loans/:id/repayments/:rid` | Corregge una restituzione                                     |
| DELETE | `/loans/:id/repayments/:rid` | Elimina una restituzione: il credito torna a comprenderla     |
| DELETE | `/transactions`              | Elimina i movimenti indicati (`{"ids": ["…"]}`), tutti o nessuno: `409` se uno è collegato a un prestito |
| GET    | `/settings`                  | Saldo iniziale e sua data                                    |
| PATCH  | `/settings`                  | Aggiorna `initialBalance` e/o `balanceDate`                  |
| GET    | `/backups`                   | I backup presenti e un eventuale ripristino in attesa        |
| POST   | `/backups`                   | Crea un backup verificato, che la ritenzione non cancella    |
| GET    | `/backups/:name`             | Scarica un backup, per portarlo fuori dal computer           |
| GET    | `/restore`                   | Lo stato di un ripristino preparato                          |
| POST   | `/restore`                   | **Prepara** il ripristino (`{"name": "…"}`): si applica al riavvio |
| DELETE | `/restore`                   | Annulla un ripristino preparato e non ancora applicato       |
| POST   | `/reset`                     | Azzera l'archivio (`{"confirm": "AZZERA"}`): crea prima una copia `pre-reset` |
| GET    | `/health`                    | Stato del servizio                                           |

## Comandi

| Comando                      | Descrizione                                   |
|------------------------------|-----------------------------------------------|
| `npm run check`              | Typecheck, test backend e frontend, build: il controllo prima di un commit |
| `npm run dev:backend`        | Backend in watch mode                         |
| `npm run start:backend`      | Backend senza watch                           |
| `npm run typecheck:backend`  | Type check del backend                        |
| `npm test`                   | Test backend + frontend                       |
| `npm run test:backend`       | Test del backend (`node:test`)                |
| `npm run test:frontend`      | Test del frontend (vitest)                    |
| `npm run db:generate`        | Genera le migrazioni Drizzle dallo schema     |
| `npm run dev:frontend`       | Dev server Angular                            |
| `npm run build:frontend`     | Build di produzione del frontend              |
| `npm run build:backend`      | Build di produzione del backend (bundle unico) |
| `npm run build`              | Frontend + backend                            |
| `npm start`                  | Esegue la build di produzione                 |
| `npm run package`            | Costruisce e confeziona `dist-package\MyFinance` |
| `npm run verify:package`     | Prova la cartella confezionata, fuori dal repository |

Per la procedura completa — dal codice alla cartella da consegnare, e come
aggiornare un'installazione senza toccare i dati — vedi
[docs/rilascio.md](docs/rilascio.md).

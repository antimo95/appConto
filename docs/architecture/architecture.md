# Software Architecture

## Overview

Personal Finance Tracker è un'applicazione web locale composta da un frontend Angular e da un backend Express.

L'architettura segue una filosofia **Domain First**: il dominio finanziario rappresenta il cuore del sistema, mentre UI, API e database sono considerati adattatori.

L'obiettivo è mantenere il dominio indipendente dalle tecnologie utilizzate.

---

# High Level Architecture

```
                    +--------------------+
                    |      Angular       |
                    |        UI          |
                    +---------+----------+
                              |
                           REST API
                              |
                    +---------v----------+
                    |      Express       |
                    |      Backend       |
                    +---------+----------+
                              |
                     Application Services
                              |
                    +---------v----------+
                    |   Finance Domain   |
                    +---------+----------+
                              |
                         Repositories
                              |
                    +---------v----------+
                    | SQLite + Drizzle   |
                    +--------------------+
```

---

# Architectural Principles

L'intero progetto segue alcuni principi fondamentali.

## Domain First

La logica di business appartiene esclusivamente al dominio.

Frontend, database e API non devono contenere regole di business.

---

## Feature Oriented

Il codice viene organizzato per funzionalità.

Esempio:

```
transactions/

categories/

import/

analytics/
```

e non

```
controllers/

services/

repositories/
```

Ogni feature contiene tutto ciò che le appartiene.

---

## Separation of Concerns

Ogni componente possiede una sola responsabilità.

Esempio:

Parser

↓

Importer

↓

Classification

↓

Persistence

↓

Analytics

Ogni passaggio può evolvere indipendentemente.

---

## Incremental Evolution

L'architettura deve permettere di introdurre nuove funzionalità senza modificare quelle esistenti.

Si preferiscono estensioni rispetto a riscritture.

---

# System Layers

Il sistema viene suddiviso in quattro livelli.

---

## Presentation Layer

Responsabilità

- visualizzazione dati
- interazione utente
- chiamate REST

Non contiene logica finanziaria.

---

## Application Layer

Coordina i casi d'uso.

Esempio

Importazione CSV

↓

Parsing

↓

Classificazione

↓

Persistenza

↓

Risposta API

Non contiene logica di dominio.

---

## Domain Layer

È il cuore dell'applicazione.

Contiene:

- Transaction
- Merchant
- Category
- servizi di classificazione
- analytics

Questo livello deve essere completamente indipendente.

---

## Infrastructure Layer

Gestisce:

- SQLite
- Drizzle
- filesystem
- parsing CSV
- Express

Il dominio non deve conoscere queste implementazioni.

---

# Feature Modules

La struttura del backend è organizzata per domini, in `apps/backend/src/modules/`.
Gli undici moduli, allineati al codice nel novembre 2026:

| Modulo | Responsabilità |
|---|---|
| `import` | Analisi e importazione dei CSV: riconoscimento delle colonne, parsing, fingerprint, deduplicazione, import atomico |
| `transactions` | I movimenti: ricerca, correzione del tipo, cancellazione |
| `merchants` | Gli esercenti, creati una sola volta per nome normalizzato; rinomina e categoria |
| `categories` | Le categorie, gestite a runtime; la categoria di riserva è protetta |
| `loans` | Prestiti e restituzioni; credito residuo e stato sono derivati |
| `settings` | Saldo di partenza e sua data |
| `summary` | Riepilogo del mese |
| `dashboard` | Vista aggregata della home |
| `analytics` | Analisi di un periodo, con andamento nel tempo |
| `cash-flow` | Liquidità: saldo di partenza, movimenti netti, correzione dei prestiti |
| `maintenance` | Backup, ripristino differito, azzeramento, backup automatici |

Fuori da `modules/`: `db/` (connessione, migrazioni sicure, `atomically`),
`shared/` (errori, logger, HTTP), `launcher/` (avvio del package, istanza
unica), `paths.ts` (l'unico punto che decide dove vivono i dati), `app.ts`
(composizione delle rotte e delle dipendenze fra moduli).

Ogni modulo è un insieme di **file piatti con suffissi**, non di sottocartelle:
`<modulo>.routes.ts`, `.service.ts`, `.repository.ts`, `.schema.ts`, modelli,
DTO e view model, più i test accanto (`*.test.ts`) e un `index.ts` che espone
ciò che gli altri moduli possono usare.

## Dipendenze reali

- **Nucleo ledger.** `transactions`, `merchants` e `categories` si importano a
  vicenda (servizi, DTO, schema per i vincoli di integrità): sono un unico
  cluster, e una modifica a uno di essi va verificata sugli altri due.
- **Read model trasversali.** `summary`, `dashboard`, `analytics` e `cash-flow`
  leggono da più moduli (transazioni, prestiti, merchant, categorie,
  impostazioni). È voluto: sono proiezioni.
- **Vincoli fra moduli tramite porte.** `transactions` non importa `loans`:
  riceve da `app.ts` una `TransactionDependents` (`usagesOf`) che `loans`
  implementa. È così che un movimento collegato a un prestito non si cancella e
  non cambia tipo. È il modello da seguire per nuovi vincoli.
- **Eccezioni note.** `categories.repository.ts` aggiorna `merchants` (togliendo
  una categoria eliminata); `reset.service.ts` svuota le tabelle e reinserisce
  `settings` con SQL diretto; `db/client.ts` importa
  `maintenance/restore-pending.ts` per applicare un ripristino all'apertura.

La mappa completa delle dipendenze è in
[architecture-audit/AUDIT.md §3.1](../architecture-audit/AUDIT.md).

---

# Import Pipeline

L'importazione rappresenta il primo workflow dell'applicazione.

```
CSV

↓

CSV Parser

↓

Column Binding          ← rilevato dal contenuto, oppure indicato dall'utente

↓

Normalized Transaction

↓

Merchant Resolver

↓

Classification

↓

Persistence

↓

Analytics
```

Ogni fase ha una responsabilità ben definita.

Il **binding delle colonne** è il solo punto con due strade: il rilevamento
guarda i valori e propone, l'utente può indicare le colonne a mano quando il
rilevamento non arriva a un campo obbligatorio o sceglie la colonna sbagliata.
Da `Normalized Transaction` in avanti la pipeline non sa quale delle due strade
è stata percorsa — riceve un binding completo — e l'identità dei movimenti non
dipende da essa.

---

# Classification Pipeline

La classificazione è indipendente dall'importazione.

```
Merchant

↓

Known Merchant

↓

Category

↓

Save
```

In futuro potranno essere introdotte ulteriori strategie.

Ad esempio:

```
Regex

↓

Rules

↓

AI

↓

Manual Override
```

senza modificare il resto dell'architettura.

---

# Analytics

Le statistiche vengono sempre calcolate.

Non vengono mai salvate.

```
Transactions

↓

Aggregation

↓

Dashboard
```

Questo evita inconsistenze tra dati e statistiche.

---

# Persistence

SQLite rappresenta l'unica fonte di verità.

Ogni modifica passa attraverso i repository, con le eccezioni elencate in
*Dipendenze reali* (azzeramento e categorie).

Il dominio non accede direttamente al database. I join in lettura fra tabelle
di moduli diversi sono ammessi nei repository: è un solo file SQLite.

Il database è a **scrittore unico**: `better-sqlite3` è sincrono, gli handler
non contengono `await` fra un controllo e la scrittura che ne dipende, e un
solo processo per archivio può aprire il database (lock d'istanza del
launcher). Il denaro è memorizzato in **centesimi interi**.

---

# API Design

Le API sono orientate ai casi d'uso.

Esempi:

```
POST /import/csv/analysis

POST /import/csv

GET /transactions

GET /dashboard

PATCH /merchants/:id/category
```

Le API servono esclusivamente il frontend.

Non costituiscono un'API pubblica.

---

# Error Handling

Gli errori vengono gestiti centralmente.

Le feature non devono conoscere il protocollo HTTP.

Il dominio genera errori di business.

L'application layer li traduce in risposte HTTP.

---

# Logging

Le operazioni importanti vengono registrate.

Ad esempio:

- importazioni
- errori
- parsing falliti

Le operazioni di dominio non devono conoscere il sistema di logging. Fanno
eccezione, consapevolmente, i servizi di manutenzione e di import, che
registrano direttamente le operazioni sull'archivio.

---

# Prestiti, manutenzione e launcher

Tre aree con un ciclo di vita proprio, descritte in dettaglio in
[architecture-audit/STATE_MACHINES.md](../architecture-audit/STATE_MACHINES.md).

- **Prestiti** (SM4). Un prestito nasce da un movimento di tipo `LOAN` e può
  coprirne solo una parte; un movimento può originare più prestiti. Credito
  residuo e stato derivano dalle restituzioni e non sono memorizzati. Una
  restituzione bancaria si collega a un movimento `INCOME`.
- **Manutenzione** (SM1, SM6, SM7). Backup verificati (manifest, integrità,
  impronta) con ritenzione per tipo; ripristino **differito**: si prepara mentre
  l'app è in funzione e si applica al riavvio, prima di aprire il database;
  azzeramento preceduto da un backup `pre-reset`.
- **Launcher** (SM3). Avvia il server del package e garantisce un solo processo
  per archivio con un lock dentro `DATA_ROOT`; il lock di un processo morto si
  prende con una rivendicazione atomica.

---

# Future Extensions

L'architettura deve consentire l'introduzione di:

- Account
- Ledger
- Cash
- Budget
- Forecast
- Rule Engine
- AI Classification

senza modificare il dominio esistente.

---

# Architectural Rules

Le seguenti regole sono vincolanti.

## Il frontend non accede mai direttamente al database.

---

## Il parser CSV non contiene logica di classificazione.

---

## Le statistiche vengono sempre calcolate.

Mai memorizzate.

---

## I dati bancari di una transazione importata sono immutabili.

Data, descrizione e importo restano quelli della banca. Il `type` è
correggibile, salvo i vincoli dei prestiti (sotto). I movimenti si possono
cancellare, salvo quelli collegati a un prestito.

---

## Il dominio non dipende da Express.

---

## Il dominio non dipende da SQLite.

Le funzioni di calcolo sono pure. I servizi usano `atomically` per le
transazioni: è la dipendenza ammessa.

---

## Le feature comunicano attraverso servizi pubblici e porte.

Si importa da un altro modulo il suo `index.ts` o il suo servizio. I join in
lettura e l'import degli schema per i vincoli di integrità sono ammessi; le
scritture su tabelle di altri moduli no, salvo le eccezioni elencate in
*Dipendenze reali*. Un vincolo che una feature impone a un'altra passa per una
porta iniettata in `app.ts` (`TransactionDependents`).

---

## Il tipo di un movimento collegato a un prestito non cambia.

LO1: un movimento d'origine di prestiti resta `LOAN` finché esiste almeno uno
di quei prestiti, aperto o restituito. D9: un movimento collegato a una
restituzione resta `INCOME`. Il backend lo garantisce con `requiredType` sui
legami e una risposta 409; il frontend legge `requiredType` e non ripete la
regola.

---

## Un movimento cancellato torna se si reimporta lo stesso estratto.

I1: l'import deduplica solo rispetto ai movimenti presenti, e la cancellazione
non lascia traccia. La conferma di cancellazione lo dice all'utente.

---

# MVP Scope

*Sezione storica: descrive la prima versione. Lo stato attuale delle
funzionalità è nel [README](../../README.md).*

La prima versione implementa solamente:

- importazione CSV
- visualizzazione transazioni
- classificazione merchant
- dashboard mensile

Ogni altra funzionalità rappresenta un'estensione futura.

---

# Architecture Philosophy

L'architettura privilegia:

- semplicità
- leggibilità
- evoluzione incrementale
- basso accoppiamento
- alta coesione

L'obiettivo non è costruire un framework, ma un software facilmente comprensibile e facilmente estendibile.
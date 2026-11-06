# Cedolini — integrità dei documenti, backup, ripristino e reset

Contratto fra il lead, l'agente Implementazione e l'agente Testing. Ogni
comportamento qui descritto deve essere coperto da un test prima di essere
implementato.

## Decisione: i PDF vivono in SQLite

I PDF dei cedolini confermati sono conservati come BLOB in una tabella
dedicata, non come file in `DATA_ROOT/payslips/`.

Motivo: il filesystem non partecipa alle transazioni SQLite. Con i PDF nel
database ogni operazione che riguarda un cedolino (creazione, sostituzione,
correzione, cancellazione) è **una sola transazione**, e backup, ripristino e
reset — che già trattano il database come un file unico e verificato —
includono i documenti senza un secondo meccanismo.

Le analisi non confermate restano **in memoria** (bytes del PDF compresi):
nulla tocca il disco finché l'utente non conferma.

## Modello dati (migrazione 0011)

```sql
CREATE TABLE payslip_documents (
  payslip_id text PRIMARY KEY NOT NULL
    REFERENCES payslips(id) ON UPDATE no action ON DELETE cascade,
  content blob NOT NULL
);
ALTER TABLE payslips DROP COLUMN stored_path;
```

- Nessuna ricostruzione di tabella (`DROP TABLE` dentro la transazione delle
  migrazioni farebbe scattare il cascade sulle voci): solo `ALTER TABLE ... DROP COLUMN`.
- L'hash del documento è `payslips.sha256` (già presente): non viene duplicato.
- Un cedolino può non avere documento solo se proviene dalla versione
  precedente e il file non è stato ritrovato (vedi riconciliazione):
  `hasDocument: false` nelle API.

## API REST (invariate)

`POST /api/payslip-analyses`, `DELETE /api/payslip-analyses/:id`,
`GET|POST /api/payslips`, `GET|PATCH|DELETE /api/payslips/:id`,
`GET /api/payslips/:id/document`, `GET /api/payslip-summaries`.

Cambia solo la provenienza dei byte: `GET /:id/document` legge il BLOB
(`Content-Type: application/pdf`, `Cache-Control: no-store`,
`X-Content-Type-Options: nosniff`), 404 se il documento non c'è.

## Analisi in memoria

- `PendingAnalysis` contiene `bytes: Uint8Array`.
- TTL 1 ora; al massimo `MAX_PENDING_ANALYSES = 10` analisi: oltre, si scarta
  la più vecchia.
- Un riavvio perde le analisi: la conferma risponde 404
  `Analisi non trovata o scaduta: carica di nuovo il PDF.`
- Nessun file scritto su disco da `analyze`.

## Transazioni del servizio

- `create`: dentro una sola `atomically`: eventuale cancellazione del cedolino
  sostituito, inserimento di testata, voci, saldi e documento. Se una qualunque
  scrittura fallisce, nulla resta e l'analisi resta confermabile.
- `remove`: una sola `delete` (il cascade porta via voci, saldi, documento).
- Dopo il commit: l'analisi viene tolta dalla memoria.

## Riconciliazione della versione precedente (`payslipsStorage`)

Eseguita da `bootstrap()` dopo le migrazioni. Prudente: un file si elimina
solo con una prova.

Cartella `DATA_ROOT/payslips/` (file `<uuid>.pdf` della versione precedente):

| Caso | Prova | Azione |
|---|---|---|
| Hash del file = `sha256` di un cedolino **senza** documento | hash | importa il contenuto nella stessa transazione, poi elimina il file |
| Hash del file = `sha256` di un cedolino **con** documento | hash | elimina il file (è un doppione) |
| Hash che non corrisponde a nessun cedolino | nessuna | **lascia il file**, lo conta come non riconciliato |
| File illeggibile | — | lascia il file, lo conta come errore, prosegue con gli altri |
| Rimozione fallita dopo l'import | — | il documento è in archivio; il file resta e sparisce al prossimo avvio (caso "doppione") |

Cartella `DATA_ROOT/tmp/payslip-analyses/` (analisi su disco della versione
precedente): tutti i file vanno eliminati — un'analisi non è mai stata un
cedolino, e la memoria del processo che l'ha creata non esiste più.

Il filesystem è accessibile tramite un adattatore iniettabile
(`readdir`, `readFile`, `remove`, `removeDirectory`, `exists`) per simulare
guasti in modo deterministico.

Esito restituito (solo conteggi, mai contenuti):
`{ imported, duplicatesRemoved, unmatched, failures, pendingRemoved }`.
I log riportano solo questi numeri.

## Audit dei documenti (per backup e ripristino)

Funzione della feature payslips, usata da maintenance:

```ts
auditPayslipDocuments(sqlite: BetterSqlite3.Database): {
  entries: { payslipId: string; sha256: string; bytes: number }[]; // ordinate per payslipId
  withoutDocument: number;  // cedolini senza documento
  mismatched: string[];     // payslipId il cui BLOB non ha l'hash del cedolino
}
```

Su un database senza le tabelle dei cedolini (backup anteriore alla feature)
restituisce `{ entries: [], withoutDocument: 0, mismatched: [] }`.

## Backup — manifest v2

- `BACKUP_FORMAT = 'appconto-backup/2'`; `parseManifest` accetta anche
  `appconto-backup/1` (backup anteriori: nessun campo documenti).
- Il manifest v2 aggiunge, obbligatorio:

```json
"payslipDocuments": {
  "entries": [{ "payslipId": "…", "sha256": "…", "bytes": 1234 }],
  "withoutDocument": 0
}
```

- `create`: dopo `VACUUM INTO` e `integrity_check` sul file parziale, l'audit
  dello snapshot. Se `mismatched` non è vuoto il backup **fallisce**
  (`BackupFailedError`), nulla arriva in `backups/`. Il manifest scritto
  contiene `entries` e `withoutDocument` dell'audit. Staging in `tmp/` e
  pubblicazione per rename: invariati.
- `verify` di un v2: l'audit del file deve coincidere **esattamente** con il
  manifest (stessi `payslipId`, stessi `sha256` e `bytes`, stesso
  `withoutDocument`, nessun `mismatched`). Qualunque differenza: backup non
  valido, con un messaggio che non contiene dati dei cedolini.
- `verify` di un v1: come prima; se il database contiene documenti dei
  cedolini (impossibile per un v1 autentico), il backup è non valido.
- Un manifest v2 senza `payslipDocuments` è incompleto: non valido.

## Ripristino

Invariato nel meccanismo (verifica → backup pre-restore → candidato →
scambio all'avvio). Poiché i documenti sono nel database, la verifica del
candidato (impronta SHA-256 del file) copre anche i PDF. Un backup v1 resta
ripristinabile; dopo lo scambio, all'avvio, le migrazioni portano lo schema
alla versione corrente e la riconciliazione importa i file della versione
precedente se presenti.

## Reset

Ordine:

1. backup `pre-reset` verificato (condizione per procedere, invariato);
2. `payslipsStorage.purge()`: svuota le analisi in memoria, elimina
   `DATA_ROOT/payslips/` e `DATA_ROOT/tmp/payslip-analyses/`. Se fallisce, il
   reset si ferma con `ResetFailedError` e **il database non è toccato**;
3. svuotamento delle tabelle (comprese `payslips`, `payslip_items`,
   `payslip_leave_balances`, `payslip_documents`);
4. `VACUUM`, poi `PRAGMA wal_checkpoint(TRUNCATE)`: né il file del database né
   il `-wal` devono contenere ancora i byte dei PDF.

I backup restano (come per ogni altro dato): il `pre-reset` è la via per
tornare indietro.

## Scenari di guasto e dove sono coperti

| # | Scenario | Garanzia |
|---|---|---|
| 1–3 | PDF scritto/spostato/eliminato e commit DB fallito (o viceversa) | non esistono più: una sola transazione |
| 4 | commit riuscito, rimozione file fallita | non esiste più (nessun file) |
| 5 | arresto durante l'import | l'analisi era in memoria: nulla su disco |
| 6 | arresto durante la sostituzione | rollback SQLite: resta il cedolino precedente |
| 7 | arresto durante la cancellazione | rollback SQLite |
| 8 | arresto durante backup / reset / ripristino | backup: `.partial` in `tmp/` ripulito; reset: vedi ordine; ripristino: marcatore `applying` |
| 9 | file temporanei e orfani | riconciliazione prudente all'avvio |

## Privacy

Nessun contenuto di cedolino in log, messaggi d'errore o manifest (solo id,
hash, byte). Le fixture sono sintetiche (`testing/payslip-fixtures.ts`).

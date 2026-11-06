# Cedolini — selezione della riga e riepilogo di ferie e P.A.R.

Contratto fra lead, agente Testing e agente Implementazione. Ogni punto va
coperto da un test che fallisce prima dell'implementazione.

## A. Selezione del cedolino

Evidenza nel codice: in `payslips-page.html` solo il pulsante con il nome del
mese (prima colonna) seleziona; un click sulle altre celle non fa nulla. Il
backend ordina già per periodo, quindi l'ordine di caricamento non è assunto
come causa: va provato o escluso con un test (tre cedolini caricati fuori
ordine).

Comportamento richiesto:

- un click su **qualunque cella** della riga seleziona quel cedolino
  (`(click)` sulla `<tr>`);
- il controllo da tastiera resta il `<button class="month">` nella prima
  cella: Tab lo raggiunge, Invio e Spazio selezionano (comportamento nativo);
  focus visibile (`:focus-visible`) e cursore a mano sulla riga;
- `aria-current="true"` sul pulsante della riga selezionata, e classe
  `selected` sulla `<tr>` — un solo cedolino attivo;
- la selezione aggiorna `?period=YYYY-MM`, il dettaglio, i KPI e il confronto;
- dopo salvataggio, ricaricamento dell'elenco e navigazione indietro/avanti
  vale l'URL.

## B. Riepilogo complessivo di ferie e permessi

`GET /api/payslip-summaries` mantiene `from`, `to`, `trend`, `comparisons`
invariati e aggiunge il campo `leave: LeaveOverview`, calcolato a ogni
richiesta e mai salvato.

```ts
type LeaveCheckStatus = 'coerente' | 'anomalia' | 'non_verificabile';
type LeaveCheckRule = 'primo-cedolino' | 'stesso-anno' | 'cambio-anno' | 'nessuna';

interface LeaveObservation {          // dati osservati: come stampati
  period: string; payslipId: string;
  accrued: number; used: number; remaining: number; unit: string;
}

interface LeaveCheck {                // dati calcolati + stato
  type: 'FERIE' | 'PAR';
  period: string; payslipId: string;
  previousPeriod: string | null; previousPayslipId: string | null;
  rule: LeaveCheckRule;
  status: LeaveCheckStatus;
  expectedRemaining: number | null;   // calcolato
  observedRemaining: number | null;   // osservato
  difference: number | null;          // observed − expected
  reason: string;                     // italiano, mai dati personali
}

interface LeaveTypeOverview {
  type: 'FERIE' | 'PAR';
  unit: string | null;                // null se nel periodo le unità differiscono
  latest: LeaveObservation | null;    // ultimo residuo noto
  yearTotals: { year: string; period: string; payslipId: string; accrued: number; used: number }[];
  history: LeaveObservation[];        // crescente per periodo
  status: LeaveCheckStatus;           // aggregato (vedi sotto)
  checks: LeaveCheck[];               // uno per cedolino dell'intervallo, crescente
}

interface LeaveOverview {
  semantics: 'progressivo-annuo';
  coverage: {
    from: string | null; to: string | null;   // primo e ultimo periodo presenti
    payslipCount: number;
    missingPeriods: string[];                 // mesi assenti fra from e to
  };
  types: LeaveTypeOverview[];         // FERIE poi PAR; solo i tipi presenti in almeno un cedolino
  anomalies: LeaveCheck[];            // tutti i check con status 'anomalia', crescenti
  limitations: string[];              // limiti dichiarati della verifica
}
```

Non si sommano mai i residui. `yearTotals` riporta, per ogni anno, il
progressivo dell'**ultimo** cedolino di quell'anno che ha il saldo
(«maturato e goduto nell'anno fino a <mese>»), non una somma.

## C. Verifica della coerenza

### Semantica (verificata)

Nel formato supportato (`zucchetti-lul/1`) `Maturato` e `Goduto` sono
**progressivi dall'inizio dell'anno**; `Residuo AP` è il residuo dell'anno
precedente, costante nell'anno; `Residuo = Residuo AP + Maturato − Goduto`.
Evidenza: su un cedolino reale di settembre, con assunzione a fine giugno, il
maturato ferie vale circa tre mesi di maturazione e quello P.A.R. il rateo di
tre mesi di un monte annuo; un dato mensile non potrebbe avere quei valori.
Il residuo AP non è memorizzato: si ricava come
`ap = remaining − accrued + used`.

### Regola, per tipo e per cedolino P dell'intervallo (ordine crescente)

`prev` = il cedolino con il periodo immediatamente precedente fra **tutti**
quelli in archivio (anche prima di `from`). Tolleranza `0.0001` (il formato
stampa cinque decimali: l'errore di arrotondamento di quattro valori resta
sotto `0.00002`).

1. P non ha il saldo → `non_verificabile`, rule `nessuna`, «saldo non presente nel cedolino».
2. Nessun `prev` → `non_verificabile`, rule `primo-cedolino`.
3. `prev` non ha il saldo → `non_verificabile`, rule `nessuna`.
4. Unità diverse → `non_verificabile`, rule `nessuna`.
5. Stesso anno:
   - se `accrued` o `used` diminuiscono oltre la tolleranza → `non_verificabile`
     («i progressivi diminuiscono: valori non compatibili con la semantica
     progressiva»);
   - `expected = prev.remaining + (P.accrued − prev.accrued) − (P.used − prev.used)`;
   - `|observed − expected| ≤ tol` → `coerente` (se mancano mesi fra i due,
     la `reason` lo dice);
   - altrimenti, se mancano mesi fra `prev` e P → `non_verificabile`
     («la differenza può nascere nel mese mancante»); senza mesi mancanti →
     `anomalia`.
   Rule `stesso-anno`.
6. Anno diverso:
   - `prev` è dicembre dell'anno prima e P è gennaio →
     `expected = prev.remaining + P.accrued − P.used` (il riporto deve essere
     il residuo di dicembre); coerente o `anomalia`;
   - altrimenti → `non_verificabile` («mancano mesi a cavallo dell'anno»).
   Rule `cambio-anno`.

Stato aggregato del tipo: `anomalia` se almeno un check lo è; altrimenti
`non_verificabile` se non esiste alcun check diverso da `primo-cedolino`
o se almeno un check (escluso `primo-cedolino`) è `non_verificabile`;
altrimenti `coerente`.

Saldi negativi: valori validi, nessun trattamento speciale. Correzioni
(`PATCH`) e sostituzioni ricalcolano tutto perché nulla è memorizzato.

`limitations` contiene almeno: la semantica progressiva dichiarata dal
formato; il residuo AP ricavato e non letto; la tolleranza e il suo motivo;
i mesi mancanti, se ce ne sono.

## Moduli

- Backend: funzione pura `verifyLeave(payslips, from, to): LeaveOverview` in
  `apps/backend/src/modules/payslips/payslip-leave-verification.ts`, usata da
  `summarize` in `payslip-comparison.ts`; tipi in `payslips.view-model.ts`.
- Frontend: tipi in `payslip.model.ts`; componente
  `apps/frontend/src/app/features/payslips/payslip-leave-overview.{ts,html,scss}`,
  selettore `app-payslip-leave-overview`, input `overview: LeaveOverview`,
  output `selectPeriod: string` (emesso dal pulsante «Vai al cedolino» di
  un'anomalia e dai periodi della cronologia). Etichette di stato:
  `Coerente`, `Anomalia`, `Non verificabile`. Nella pagina sta in un pannello
  con titolo «Riepilogo ferie e permessi», dopo l'elenco e prima del mese
  selezionato; `selectPeriod` → stessa `select(period)` dell'elenco.
- La sezione mostra: periodo coperto, numero di cedolini, mesi mancanti,
  ultimo residuo di Ferie e P.A.R., maturato e goduto nell'anno (da
  `yearTotals`), cronologia dei residui (tabella), stato, elenco anomalie
  (mese, atteso, rilevato, differenza, motivo, «Vai al cedolino»), limiti.

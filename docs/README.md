# Documentazione

Indice dei documenti in `docs/`. **Attuali** descrivono il codice com'è e vanno
aggiornati quando cambia; **storici** raccontano decisioni e piani passati e non
vanno usati come riferimento sullo stato attuale.

Per installare, avviare e verificare il progetto: [README principale](../README.md).

## Attuali

| Documento | Contenuto |
|---|---|
| [architecture/architecture.md](architecture/architecture.md) | Architettura: moduli, dipendenze reali, regole |
| [architecture/project-context.md](architecture/project-context.md) | Visione, principi e perimetro del prodotto (la roadmap iniziale è superata) |
| [architecture/data-model.md](architecture/data-model.md) | Modello dei dati (non riverificato riga per riga dopo l'audit) |
| [rilascio.md](rilascio.md) | Come si confeziona, si verifica e si consegna una versione |
| [architecture-audit/STATE_MACHINES.md](architecture-audit/STATE_MACHINES.md) | Macchine a stati: restore, launcher, prestiti, reset e altre, con gli aggiornamenti dopo ogni intervento |
| [architecture-audit/PLAN.md](architecture-audit/PLAN.md) | Piano di consolidamento e stato di ogni attività |
| [architecture-audit/HANDOFF.md](architecture-audit/HANDOFF.md) | Punto di ripresa per la prossima sessione di lavoro |
| [architecture-audit/PROGRESS.md](architecture-audit/PROGRESS.md) | Registro cronologico del consolidamento |

## Storici

| Documento | Perché è storico |
|---|---|
| [architecture-audit/AUDIT.md](architecture-audit/AUDIT.md) | Fotografia dell'audit iniziale (commit `f072a59`): non si aggiorna, le correzioni sono in PLAN e PROGRESS |
| [architecture/offline-first-portable.md](architecture/offline-first-portable.md) | Progetto del package portatile; il risultato è descritto in `rilascio.md` |
| [architecture/frontend-shared-components-proposal.md](architecture/frontend-shared-components-proposal.md) | Proposta, in parte superata (cita componenti che non esistono) |
| [architecture/report_wp_p3.md](architecture/report_wp_p3.md), [report_wp_p4.md](architecture/report_wp_p4.md), [report_wp_p5.md](architecture/report_wp_p5.md) | Resoconti dei work package di affidabilità |
| [plans/](plans/) | Piani di lavoro passati |
| [superpowers/plans/](superpowers/plans/), [superpowers/specs/](superpowers/specs/) | Piani e specifiche delle singole funzionalità, scritti prima di implementarle |

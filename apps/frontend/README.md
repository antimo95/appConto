# Frontend

Il frontend Angular di Personal Finance Tracker. Installazione, avvio, verifica
e posizione dei dati sono descritti nel [README principale](../../README.md).

In breve, dalla radice del repository:

```bash
npm ci --prefix apps/frontend   # dipendenze del frontend
npm run dev:frontend            # http://localhost:4200, /api inoltrato al backend
npm run test:frontend           # test (Vitest)
```

Qui, in `apps/frontend`, c'è anche `npm run gate`: il controllo del design
system (`scripts/design-system-gate.sh`).

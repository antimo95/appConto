import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

/** Le API dei cedolini: metodi, codici di stato e forma delle risposte. */

const dataRoot = mkdtempSync(path.join(tmpdir(), 'appconto-payslipsapi-'));
process.env.DATABASE_FILE = path.join(dataRoot, 'database.sqlite');

const { createApp } = await import('../../app.js');
const { config } = await import('../../config.js');
const { closeDatabase, runMigrations } = await import('../../db/client.js');
const { syntheticPayslipPdf } = await import('./testing/payslip-fixtures.js');

runMigrations();

const frontendDir = mkdtempSync(path.join(tmpdir(), 'appconto-payslipsapi-fe-'));
const server = createApp(frontendDir).listen(0, config.host);
await new Promise<void>((resolve) => {
  server.once('listening', resolve);
});
const { port } = server.address() as AddressInfo;
const base = `http://${config.host}:${String(port)}/api`;

after(() => {
  server.close();
  closeDatabase();
  for (const cartella of [dataRoot, frontendDir]) {
    try {
      rmSync(cartella, { recursive: true, force: true });
    } catch {
      // su Windows il file può restare bloccato: sono cartelle temporanee
    }
  }
});

interface Risposta {
  status: number;
  body: unknown;
  headers: Headers;
}

async function chiama(metodo: string, percorso: string, init: { json?: unknown; pdf?: Uint8Array; headers?: Record<string, string> } = {}): Promise<Risposta> {
  const headers: Record<string, string> = { ...init.headers };
  let body: string | Uint8Array | undefined;
  if (init.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(init.json);
  }
  if (init.pdf !== undefined) {
    headers['Content-Type'] ??= 'application/pdf';
    body = init.pdf;
  }

  const risposta = await fetch(`${base}${percorso}`, { method: metodo, headers, ...(body === undefined ? {} : { body }) });
  const testo = await risposta.text();
  const tipo = risposta.headers.get('content-type') ?? '';

  return {
    status: risposta.status,
    body: tipo.includes('json') && testo.length > 0 ? JSON.parse(testo) : testo,
    headers: risposta.headers,
  };
}

interface Analisi {
  id: string;
  fileName: string;
  status: string;
  conflict: { period: string } | null;
  draft: Record<string, unknown> & { period: string };
}

interface Dettaglio {
  id: string;
  period: string;
  netCents: number;
  items: unknown[];
  hasDocument: boolean;
}

async function analizza(pdf: Uint8Array, nome = 'cedolino.pdf'): Promise<Analisi> {
  const risposta = await chiama('POST', '/payslip-analyses', {
    pdf,
    headers: { 'X-File-Name': encodeURIComponent(nome) },
  });
  assert.equal(risposta.status, 201, JSON.stringify(risposta.body));

  return risposta.body as Analisi;
}

const errore = (risposta: Risposta): string => (risposta.body as { error: string }).error;

describe('POST /payslip-analyses', () => {
  it('201: restituisce la bozza estratta, senza creare il cedolino', async () => {
    const analisi = await analizza(syntheticPayslipPdf(), 'Cedolino ottobre è.pdf');

    assert.equal(analisi.status, 'complete');
    assert.equal(analisi.fileName, 'Cedolino ottobre è.pdf');
    assert.equal(analisi.draft.period, '2026-10');
    assert.equal(analisi.draft.netCents, 169800);
    assert.equal(analisi.conflict, null);

    const elenco = await chiama('GET', '/payslips');
    assert.deepEqual(elenco.body, { items: [] });
  });

  it('il nome del file è un\'etichetta, mai un percorso', async () => {
    const analisi = await analizza(syntheticPayslipPdf({ month: 'Gennaio 2026' }), '..\\..\\segreti/../evil.pdf');
    assert.equal(analisi.fileName, 'evil.pdf');
  });

  it('400 senza Content-Type application/pdf', async () => {
    const risposta = await chiama('POST', '/payslip-analyses', {
      pdf: syntheticPayslipPdf(),
      headers: { 'Content-Type': 'application/octet-stream' },
    });
    assert.equal(risposta.status, 400);
    assert.match(errore(risposta), /application\/pdf/);
  });

  it('400 se il contenuto non è un PDF', async () => {
    const risposta = await chiama('POST', '/payslip-analyses', { pdf: Buffer.from('ciao') });
    assert.equal(risposta.status, 400);
    assert.match(errore(risposta), /non è un PDF/);
  });

  it('400 se il PDF è danneggiato', async () => {
    const risposta = await chiama('POST', '/payslip-analyses', { pdf: Buffer.from('%PDF-1.7\nrotto') });
    assert.equal(risposta.status, 400);
    assert.match(errore(risposta), /danneggiato/);
  });

  it('413 oltre i dieci megabyte', async () => {
    const enorme = Buffer.alloc(10 * 1024 * 1024 + 1, 0x20);
    enorme.write('%PDF-1.4\n');
    const risposta = await chiama('POST', '/payslip-analyses', { pdf: enorme });
    assert.equal(risposta.status, 413);
  });
});

describe('ciclo di vita di un cedolino', () => {
  let ottobre: Dettaglio;

  it('POST /payslips 201 dai dati rivisti', async () => {
    const analisi = await analizza(syntheticPayslipPdf({ month: 'Ottobre 2025' }));
    const risposta = await chiama('POST', '/payslips', {
      json: { analysisId: analisi.id, replaceExisting: false, ...analisi.draft },
    });

    assert.equal(risposta.status, 201, JSON.stringify(risposta.body));
    ottobre = risposta.body as Dettaglio;
    assert.equal(ottobre.period, '2025-10');
    assert.equal(ottobre.items.length, 12);
    assert.equal(ottobre.hasDocument, true);
  });

  it('409 per lo stesso PDF, già in analisi', async () => {
    const risposta = await chiama('POST', '/payslip-analyses', { pdf: syntheticPayslipPdf({ month: 'Ottobre 2025' }) });
    assert.equal(risposta.status, 409);
  });

  it('409 per un altro cedolino dello stesso mese senza sostituzione esplicita', async () => {
    const analisi = await analizza(
      syntheticPayslipPdf({ month: 'Ottobre 2025', edit: (lines) => [...lines, [60, 30, 'Rettifica']] }),
    );
    assert.equal(analisi.conflict?.period, '2025-10');

    const risposta = await chiama('POST', '/payslips', { json: { analysisId: analisi.id, ...analisi.draft } });
    assert.equal(risposta.status, 409);
    assert.match(errore(risposta), /Esiste già un cedolino/);

    await chiama('DELETE', `/payslip-analyses/${analisi.id}`);
  });

  it('400 per un payload non valido, 404 per un\'analisi inesistente', async () => {
    const analisi = await analizza(syntheticPayslipPdf({ month: 'Settembre 2025' }));

    const nonValido = await chiama('POST', '/payslips', { json: { analysisId: analisi.id, ...analisi.draft, period: 'settembre' } });
    assert.equal(nonValido.status, 400);

    const malformato = await fetch(`${base}/payslips`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{non json',
    });
    assert.equal(malformato.status, 400);

    const inesistente = await chiama('POST', '/payslips', { json: { ...analisi.draft, analysisId: 'nessuna' } });
    assert.equal(inesistente.status, 404);

    const confermata = await chiama('POST', '/payslips', { json: { analysisId: analisi.id, ...analisi.draft } });
    assert.equal(confermata.status, 201);
  });

  it('GET /payslips elenca dal più recente, con filtri e verso', async () => {
    const elenco = await chiama('GET', '/payslips');
    assert.equal(elenco.status, 200);
    assert.deepEqual(
      (elenco.body as { items: { period: string }[] }).items.map((item) => item.period),
      ['2025-10', '2025-09'],
    );

    const crescente = await chiama('GET', '/payslips?sortDirection=asc&from=2025-09&to=2025-12');
    assert.deepEqual(
      (crescente.body as { items: { period: string }[] }).items.map((item) => item.period),
      ['2025-09', '2025-10'],
    );

    assert.equal((await chiama('GET', '/payslips?sortDirection=up')).status, 400);
    assert.equal((await chiama('GET', '/payslips?from=2025')).status, 400);
  });

  it('GET /payslips/:id restituisce voci e saldi; 404 se non esiste', async () => {
    const dettaglio = await chiama('GET', `/payslips/${ottobre.id}`);
    assert.equal(dettaglio.status, 200);
    assert.equal((dettaglio.body as Dettaglio).items.length, 12);

    assert.equal((await chiama('GET', '/payslips/inesistente')).status, 404);
  });

  it('GET /payslips/:id/document restituisce il PDF originale', async () => {
    const risposta = await fetch(`${base}/payslips/${ottobre.id}/document`);

    assert.equal(risposta.status, 200);
    assert.equal(risposta.headers.get('content-type'), 'application/pdf');
    assert.equal(risposta.headers.get('cache-control'), 'no-store');
    assert.equal(risposta.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(risposta.headers.get('content-disposition'), 'inline; filename="cedolino-2025-10.pdf"');
    const bytes = Buffer.from(await risposta.arrayBuffer());
    assert.ok(bytes.equals(syntheticPayslipPdf({ month: 'Ottobre 2025' })));
  });

  it('il PDF arriva dall\'archivio, non da un file: nessuna cartella dei cedolini sul disco', async () => {
    // I PDF vivono nel database: la cartella della versione precedente non
    // esiste, e il documento si serve lo stesso.
    assert.ok(!existsSync(path.join(config.dataRoot, 'payslips')));
    assert.ok(!existsSync(path.join(config.tmpDir, 'payslip-analyses')));

    const risposta = await fetch(`${base}/payslips/${ottobre.id}/document`);
    assert.equal(risposta.status, 200);
    const bytes = Buffer.from(await risposta.arrayBuffer());
    assert.ok(bytes.equals(syntheticPayslipPdf({ month: 'Ottobre 2025' })));
  });

  it('PATCH /payslips/:id corregge; 400 se non valido, 409 se il mese è occupato', async () => {
    const corretto = await chiama('PATCH', `/payslips/${ottobre.id}`, { json: { netCents: 170000 } });
    assert.equal(corretto.status, 200);
    assert.equal((corretto.body as Dettaglio).netCents, 170000);

    assert.equal((await chiama('PATCH', `/payslips/${ottobre.id}`, { json: { netCents: 'molti' } })).status, 400);
    assert.equal((await chiama('PATCH', `/payslips/${ottobre.id}`, { json: { period: '2025-09' } })).status, 409);
    assert.equal((await chiama('PATCH', '/payslips/inesistente', { json: { netCents: 1 } })).status, 404);
  });

  it('GET /payslip-summaries calcola andamento e confronti', async () => {
    const risposta = await chiama('GET', '/payslip-summaries?from=2025-01&to=2025-12');
    assert.equal(risposta.status, 200);

    const sintesi = risposta.body as {
      trend: { period: string }[];
      comparisons: { period: string; previousPeriod: string; net: { deltaCents: number } }[];
    };
    assert.deepEqual(sintesi.trend.map((point) => point.period), ['2025-09', '2025-10']);
    assert.equal(sintesi.comparisons[0]?.previousPeriod, '2025-09');
    assert.equal(sintesi.comparisons[0]?.net.deltaCents, 170000 - 169800);

    assert.equal((await chiama('GET', '/payslip-summaries?from=2025-12&to=2025-01')).status, 400);
  });

  it('GET /payslip-summaries contiene il riepilogo di ferie e permessi con la forma del contratto', async () => {
    const risposta = await chiama('GET', '/payslip-summaries?from=2025-01&to=2025-12');
    assert.equal(risposta.status, 200);

    const sintesi = risposta.body as Record<string, unknown> & { leave?: Record<string, unknown> };
    assert.ok(sintesi.leave !== undefined, 'campo leave assente');
    for (const chiave of ['from', 'to', 'trend', 'comparisons']) {
      assert.ok(chiave in sintesi, `campo ${chiave} scomparso`);
    }
    assert.deepEqual(Object.keys(sintesi.leave).sort(), ['anomalies', 'coverage', 'limitations', 'semantics', 'types']);
    assert.equal(sintesi.leave.semantics, 'progressivo-annuo');
    assert.deepEqual(sintesi.leave.coverage, { from: '2025-09', to: '2025-10', payslipCount: 2, missingPeriods: [] });

    const tipi = sintesi.leave.types as Record<string, unknown>[];
    assert.deepEqual(tipi.map((tipo) => tipo.type), ['FERIE', 'PAR']);
    for (const tipo of tipi) {
      assert.deepEqual(
        Object.keys(tipo).sort(),
        ['checks', 'history', 'latest', 'status', 'type', 'unit', 'yearTotals'],
      );
    }
    const check = (tipi[0]?.checks as Record<string, unknown>[])[0];
    assert.deepEqual(
      Object.keys(check ?? {}).sort(),
      [
        'difference', 'expectedRemaining', 'observedRemaining', 'payslipId', 'period',
        'previousPayslipId', 'previousPeriod', 'reason', 'rule', 'status', 'type',
      ],
    );
  });

  it('un\'anomalia rimanda a un cedolino che si legge per id', async () => {
    // Si rompe la continuità: ottobre dichiara un residuo che non discende da settembre.
    const patch = await chiama('PATCH', `/payslips/${ottobre.id}`, {
      json: { leaveBalances: [{ type: 'FERIE', accrued: 13.33333, used: 8, remaining: 50, unit: 'ORE' }] },
    });
    assert.equal(patch.status, 200, JSON.stringify(patch.body));

    const risposta = await chiama('GET', '/payslip-summaries?from=2025-01&to=2025-12');
    const { leave } = risposta.body as { leave: { anomalies: { period: string; payslipId: string; previousPayslipId: string }[] } };

    assert.equal(leave.anomalies.length, 1);
    const anomalia = leave.anomalies[0];
    assert.equal(anomalia?.period, '2025-10');
    assert.equal(anomalia?.payslipId, ottobre.id);

    const dettaglio = await chiama('GET', `/payslips/${anomalia?.payslipId ?? ''}`);
    assert.equal(dettaglio.status, 200);
    assert.equal((dettaglio.body as Dettaglio).period, '2025-10');
    const precedente = await chiama('GET', `/payslips/${anomalia?.previousPayslipId ?? ''}`);
    assert.equal(precedente.status, 200);
    assert.equal((precedente.body as Dettaglio).period, '2025-09');
  });

  it('DELETE /payslips/:id 204, poi 404', async () => {
    const eliminato = await chiama('DELETE', `/payslips/${ottobre.id}`);
    assert.equal(eliminato.status, 204);
    assert.equal(eliminato.body, '');

    assert.equal((await chiama('GET', `/payslips/${ottobre.id}`)).status, 404);
    assert.equal((await chiama('GET', `/payslips/${ottobre.id}/document`)).status, 404);
    assert.equal((await chiama('DELETE', `/payslips/${ottobre.id}`)).status, 404);
  });

  it('DELETE /payslip-analyses/:id 204, poi 404', async () => {
    const analisi = await analizza(syntheticPayslipPdf({ month: 'Marzo 2025' }));

    assert.equal((await chiama('DELETE', `/payslip-analyses/${analisi.id}`)).status, 204);
    assert.equal((await chiama('DELETE', `/payslip-analyses/${analisi.id}`)).status, 404);
  });

  it('nessun verbo nei percorsi: un metodo non previsto è un 404 dell\'API', async () => {
    assert.equal((await chiama('PUT', '/payslips')).status, 404);
    assert.equal((await chiama('GET', '/payslip-analyses')).status, 404);
  });
});

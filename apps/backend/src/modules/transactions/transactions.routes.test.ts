import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

/**
 * L'API di eliminazione dei movimenti.
 *
 * Quello che si prova qui e non nel servizio: la forma della richiesta —
 * `DELETE` sulla collezione, con gli identificativi nel corpo — e il fatto che
 * il corpo di una `DELETE` arrivi davvero fino al gestore. È una combinazione
 * legittima ma inusuale, e se un giorno smettesse di funzionare lo farebbe in
 * silenzio.
 *
 * ## Isolamento
 *
 * Radice dati temporanea scelta prima degli import, e porta assegnata dal
 * sistema con `listen(0)`.
 */

const dataRoot = mkdtempSync(path.join(tmpdir(), 'appconto-txapi-'));
process.env.DATABASE_FILE = path.join(dataRoot, 'database.sqlite');

const { createApp } = await import('../../app.js');
const { config } = await import('../../config.js');
const { closeDatabase, runMigrations } = await import('../../db/client.js');
const { importService } = await import('../import/index.js');
const { transactionsService } = await import('./transactions.service.js');
const { loansService } = await import('../loans/index.js');

runMigrations();

const frontendDir = mkdtempSync(path.join(tmpdir(), 'appconto-txapi-fe-'));
const server = createApp(frontendDir).listen(0, config.host);
await new Promise<void>((resolve) => {
  server.once('listening', resolve);
});
const { port } = server.address() as AddressInfo;

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

const base = `http://${config.host}:${String(port)}`;

/** Una `DELETE` con il corpo JSON, che è la forma che questa rotta usa. */
async function elimina(ids: unknown): Promise<{ status: number; body: unknown }> {
  const risposta = await fetch(`${base}/api/transactions`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  });

  return { status: risposta.status, body: await risposta.json() };
}

/** Importa delle righe e restituisce gli identificativi creati. */
function importa(righe: readonly string[]): string[] {
  importService.importCsv(['Data contabile,Descrizione,Importo', ...righe].join('\r\n'));

  return transactionsService.listAll().map((transazione) => transazione.id);
}

function ripulisci(): void {
  const tutte = transactionsService.listAll().map((transazione) => transazione.id);
  if (tutte.length > 0) {
    transactionsService.remove(tutte, { usagesOf: () => [] });
  }
}

describe('isolamento del test', () => {
  it('il processo usa un database temporaneo', () => {
    assert.ok(config.databaseFile.startsWith(tmpdir()));
    assert.equal(path.dirname(config.databaseFile), dataRoot);
  });
});

describe('DELETE /api/transactions', () => {
  it('elimina gli identificativi indicati nel corpo', async () => {
    ripulisci();
    const ids = importa([
      '01/05/2026,PRIMO MOVIMENTO,-10.00',
      '02/05/2026,SECONDO MOVIMENTO,-20.00',
      '03/05/2026,TERZO MOVIMENTO,-30.00',
    ]);

    const esito = await elimina(ids.slice(0, 2));

    assert.equal(esito.status, 200);
    // Il corpo di una DELETE è arrivato fino al gestore: se fosse stato
    // scartato, la richiesta sarebbe stata malformata.
    assert.deepEqual(esito.body, { requested: 2, deleted: 2, notFound: [] });
    assert.equal(transactionsService.listAll().length, 1);
  });

  it('senza corpo è una richiesta malformata, non un-eliminazione di tutto', async () => {
    ripulisci();
    importa(['01/05/2026,DA NON ELIMINARE,-10.00']);

    const risposta = await fetch(`${base}/api/transactions`, { method: 'DELETE' });

    assert.equal(risposta.status, 400);
    assert.equal(transactionsService.listAll().length, 1, "l'archivio non è stato toccato");
  });

  it('rifiuta un elenco vuoto e uno smisurato', async () => {
    for (const ids of [[], Array.from({ length: 1001 }, (_v, i) => `id-${String(i)}`)]) {
      const esito = await elimina(ids);
      assert.equal(esito.status, 400, `avrebbe dovuto rifiutare ${String(ids.length)} id`);
    }
  });

  it('rifiuta un corpo della forma sbagliata', async () => {
    for (const ids of [null, 'una-stringa', [1, 2, 3], [''], {}]) {
      const esito = await elimina(ids);
      assert.equal(esito.status, 400, `avrebbe dovuto rifiutare ${JSON.stringify(ids)}`);
    }
  });

  it('un movimento collegato a un prestito produce un conflitto, non un errore di database', async () => {
    ripulisci();
    const ids = importa(['01/06/2026,ANTICIPO A LUCA,-250.00']);
    const anticipo = ids[0];
    assert.ok(anticipo !== undefined);

    transactionsService.updateType(anticipo, 'LOAN');
    loansService.create({
      transactionId: anticipo,
      borrowerName: 'Luca',
      amount: 250,
      lentAt: '2026-06-01',
    });

    const esito = await elimina([anticipo]);

    // 409 e non 500: la richiesta è comprensibile, è lo stato che non la
    // consente.
    assert.equal(esito.status, 409);
    const corpo = esito.body as { error?: { message?: string } };
    const messaggio = JSON.stringify(corpo);
    assert.match(messaggio, /prestito a Luca/);
    assert.equal(transactionsService.listAll().length, 1);
  });

  it('la porta è collegata: il servizio riceve davvero i prestiti reali', async () => {
    // Il collegamento fra le due feature avviene in `app.ts`. Se non fosse
    // collegato, il caso precedente sarebbe passato con un errore di
    // database invece che con un conflitto — e questo test lo distingue.
    const usi = loansService.transactionUsages(
      transactionsService.listAll().map((transazione) => transazione.id),
    );

    assert.equal(usi.length, 1);
    assert.match(usi[0]?.usedBy ?? '', /prestito a Luca/);
  });
});

describe('GET e PATCH su un movimento inesistente o malformato', () => {
  async function chiama(
    pathname: string,
    method: string,
    corpo?: unknown,
  ): Promise<{ status: number; body: unknown }> {
    const risposta = await fetch(`${base}${pathname}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      ...(corpo === undefined ? {} : { body: JSON.stringify(corpo) }),
    });

    return { status: risposta.status, body: await risposta.json() };
  }

  it('GET di un id che non esiste risponde 404 con il messaggio', async () => {
    const esito = await chiama('/api/transactions/inesistente', 'GET');

    assert.equal(esito.status, 404);
    assert.deepEqual(esito.body, { error: 'Transazione "inesistente" non trovata.' });
  });

  it('PATCH del tipo su un id che non esiste risponde 404', async () => {
    const esito = await chiama('/api/transactions/inesistente/type', 'PATCH', { type: 'EXPENSE' });

    assert.equal(esito.status, 404);
    assert.deepEqual(esito.body, { error: 'Transazione "inesistente" non trovata.' });
  });

  it('PATCH con un tipo non valido è 400 anche se l-id non esiste: la forma viene prima', async () => {
    const esito = await chiama('/api/transactions/nope/type', 'PATCH', { type: 'X' });

    assert.equal(esito.status, 400);
    assert.deepEqual(esito.body, {
      error:
        'Il corpo della richiesta deve contenere "type" fra: EXPENSE, INCOME, WITHDRAWAL, LOAN, TRANSFER, OTHER.',
    });
  });

  it('DELETE di id che non esistono è 200 e li riporta in notFound', async () => {
    const esito = await elimina(['fantasma-1', 'fantasma-2']);

    assert.equal(esito.status, 200);
    assert.deepEqual(esito.body, {
      requested: 2,
      deleted: 0,
      notFound: ['fantasma-1', 'fantasma-2'],
    });
  });

  it('PATCH del tipo su un movimento d-origine di un prestito risponde 409 (LO1)', async () => {
    importService.importCsv(
      ['Data contabile,Descrizione,Importo', '02/06/2026,PRESTITO A NADIA,-80.00'].join('\n'),
    );
    const origine = transactionsService.listAll().find((t) => t.description === 'PRESTITO A NADIA');
    assert.ok(origine !== undefined);
    transactionsService.updateType(origine.id, 'LOAN');
    loansService.create({
      transactionId: origine.id,
      borrowerName: 'Nadia',
      amount: 80,
      lentAt: '2026-06-02',
    });

    const esito = await chiama(`/api/transactions/${origine.id}/type`, 'PATCH', { type: 'EXPENSE' });

    // La rotta passa sempre `dependents`: senza, la regola non varrebbe.
    assert.equal(esito.status, 409);
    assert.match(JSON.stringify(esito.body), /prestito a Nadia/);
    assert.equal(transactionsService.findById(origine.id)?.type, 'LOAN');
  });
});

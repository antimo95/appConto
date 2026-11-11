import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express, { json, type Request, type Response } from 'express';
import { after, before, beforeEach, describe, it, mock } from 'node:test';
import { ConflictError, NotFoundError, ValidationError } from '../errors.js';
import { logger } from '../logger.js';
import { errorHandler } from './error-handler.js';

/**
 * Caratterizzazione di `errorHandler`: fissa le risposte di oggi, comprese
 * quelle del difetto D1 (ogni 4xx non di dominio esce come "corpo non
 * leggibile"), così che G3 possa riscriverne l'interno senza cambiarle.
 *
 * App Express minima, senza database; `json()` per rotta come in produzione.
 */

const UNREADABLE = { error: 'Richiesta non valida: il corpo non è leggibile.' };
const INTERNAL = { error: 'Errore interno del server.' };

const errorLog = mock.method(logger, 'error', () => {});

const app = express();
const throwing = (value: unknown) => () => {
  throw value;
};
app.get('/validation', throwing(new ValidationError('Dato non valido.')));
app.get('/not-found', throwing(new NotFoundError('Elemento inesistente.')));
app.get('/conflict', throwing(new ConflictError('Elemento già presente.')));
app.post('/body', json({ limit: '50b' }), (_req, res) => {
  res.json({ ok: true });
});
app.get('/item/:id', (_req, res) => {
  res.json({ ok: true });
});
app.get('/status-404', throwing(Object.assign(new Error('send'), { status: 404 })));
app.get('/status-code-416', throwing(Object.assign(new Error('range'), { statusCode: 416 })));
app.get('/status-503', throwing(Object.assign(new Error('dettaglio interno 503'), { status: 503 })));
app.get('/error', throwing(new Error('dettaglio interno segreto')));
app.get('/string', throwing('una stringa'));
app.get('/async', async () => {
  await Promise.resolve();
  throw new Error('rifiuto asincrono');
});
app.use(errorHandler);

let server: Server;
let baseUrl: string;

before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  errorLog.mock.restore();
});

beforeEach(() => {
  errorLog.mock.resetCalls();
});

async function call(path: string, init?: RequestInit): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${baseUrl}${path}`, init);

  return { status: response.status, body: await response.json() };
}

function post(body: string, headers: Record<string, string> = {}): Promise<{ status: number; body: unknown }> {
  return call('/body', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body,
  });
}

describe('errorHandler: errori di dominio', () => {
  for (const [path, status, error] of [
    ['/validation', 400, 'Dato non valido.'],
    ['/not-found', 404, 'Elemento inesistente.'],
    ['/conflict', 409, 'Elemento già presente.'],
  ] as const) {
    it(`${path} → ${status} con il messaggio, senza log`, async () => {
      assert.deepEqual(await call(path), { status, body: { error } });
      assert.equal(errorLog.mock.callCount(), 0);
    });
  }
});

describe('errorHandler: corpo non leggibile (body-parser)', () => {
  it('JSON malformato → 400', async () => {
    assert.deepEqual(await post('{"a":'), { status: 400, body: UNREADABLE });
  });

  it('valore non oggetto in strict → 400', async () => {
    assert.deepEqual(await post('"testo"'), { status: 400, body: UNREADABLE });
  });

  it('corpo oltre il limite → 413', async () => {
    assert.deepEqual(await post(JSON.stringify({ a: 'x'.repeat(100) })), {
      status: 413,
      body: UNREADABLE,
    });
  });

  it('charset non supportato → 415', async () => {
    assert.deepEqual(await post('{}', { 'content-type': 'application/json; charset=latin1' }), {
      status: 415,
      body: UNREADABLE,
    });
  });

  it('encoding non supportato → 415', async () => {
    assert.deepEqual(await post('{}', { 'content-encoding': 'x-sconosciuto' }), {
      status: 415,
      body: UNREADABLE,
    });
  });

  it('nessun log per gli errori del client', async () => {
    await post('{"a":');
    assert.equal(errorLog.mock.callCount(), 0);
  });
});

describe('errorHandler: altri 4xx di Express (D1, risposta invariata)', () => {
  it('URL con codifica non valida → 400 "corpo non leggibile"', async () => {
    assert.deepEqual(await call('/item/%ZZ'), { status: 400, body: UNREADABLE });
  });

  it('errore con status 404 → 404 "corpo non leggibile"', async () => {
    assert.deepEqual(await call('/status-404'), { status: 404, body: UNREADABLE });
  });

  it('errore con statusCode 416 → 416 "corpo non leggibile"', async () => {
    assert.deepEqual(await call('/status-code-416'), { status: 416, body: UNREADABLE });
    assert.equal(errorLog.mock.callCount(), 0);
  });
});

describe('errorHandler: errori interni', () => {
  for (const [path, name] of [
    ['/error', 'Error generico'],
    ['/string', 'valore lanciato non Error'],
    ['/status-503', 'errore con status 5xx'],
    ['/async', 'handler async che rifiuta'],
  ] as const) {
    it(`${name} → 500 generico, con un log`, async () => {
      const { status, body } = await call(path);
      assert.equal(status, 500);
      assert.deepEqual(body, INTERNAL);
      assert.equal(errorLog.mock.callCount(), 1);
    });
  }

  it('il log riporta metodo e URL completo della richiesta', async () => {
    await call('/error?search=caff%C3%A8');
    assert.equal(errorLog.mock.calls[0]?.arguments[0], 'Errore non gestito: GET /error?search=caff%C3%A8');
  });

  it('il messaggio originale non esce nella risposta', async () => {
    const response = await fetch(`${baseUrl}/error`);
    assert.doesNotMatch(await response.text(), /segreto/);
  });
});

describe('errorHandler: risposta già iniziata', () => {
  it('passa l’errore originale a next, senza riscrivere la risposta', () => {
    const error = new Error('guasto durante lo streaming');
    const nextCalls: unknown[] = [];
    const res = {
      headersSent: true,
      status: () => assert.fail('status non va chiamato dopo headersSent'),
      json: () => assert.fail('json non va chiamato dopo headersSent'),
    };

    errorHandler(
      error,
      { method: 'GET', originalUrl: '/api/backups/x' } as Request,
      res as unknown as Response,
      (value?: unknown) => {
        nextCalls.push(value);
      },
    );

    assert.deepEqual(nextCalls, [error]);
    assert.equal(errorLog.mock.callCount(), 1);
  });
});

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { startTestApp } from '../../test-support/http-app.js';

/** Contratto HTTP di `/api/loans` (T-B): risposte e messaggi di oggi. */

const app = await startTestApp('loansapi');

const { importService } = await import('../import/index.js');
const { transactionsService } = await import('../transactions/index.js');

importService.importCsv(
  [
    'Data contabile,Tipologia,Descrizione,Importo',
    '01/03/2033,Bonifico,R PRESTITO,-100.00',
    '02/03/2033,Bonifico,R PRESTITO SENZA RESTITUZIONI,-50.00',
    '03/03/2033,Pagamento,R SPESA,-20.00',
    '04/03/2033,Bonifico,R PRESTITO CHIUSO,-30.00',
  ].join('\r\n'),
);

function txId(description: string): string {
  const found = transactionsService.listAll().find((t) => t.description === description);
  assert.ok(found, `transazione "${description}" non trovata`);
  return found.id;
}

transactionsService.updateType(txId('R PRESTITO'), 'LOAN');
transactionsService.updateType(txId('R PRESTITO SENZA RESTITUZIONI'), 'LOAN');
transactionsService.updateType(txId('R PRESTITO CHIUSO'), 'LOAN');

const newLoan = (description: string, amount: number) => ({
  transactionId: txId(description),
  borrowerName: 'Mario',
  amount,
  lentAt: '2033-03-01',
});

interface Detail {
  id: string;
  repayments: { id: string }[];
}

describe('POST /api/loans', () => {
  it('senza corpo → 400 con il messaggio Zod', async () => {
    const reply = await app.request('/api/loans', { method: 'POST' });
    assert.equal(reply.status, 400);
    assert.deepEqual(reply.body, { error: 'Invalid input: expected object, received undefined' });
  });

  it('{} → 400 con il messaggio Zod', async () => {
    const reply = await app.request('/api/loans', { method: 'POST', json: {} });
    assert.equal(reply.status, 400);
    assert.deepEqual(reply.body, { error: 'Invalid input: expected string, received undefined' });
  });

  it('nome di 130 caratteri → 400 con il messaggio Zod', async () => {
    const reply = await app.request('/api/loans', {
      method: 'POST',
      json: { ...newLoan('R PRESTITO', 10), borrowerName: 'a'.repeat(130) },
    });
    assert.equal(reply.status, 400);
    assert.deepEqual(reply.body, { error: 'Too big: expected string to have <=120 characters' });
  });

  it('transazione inesistente → 404', async () => {
    const reply = await app.request('/api/loans', {
      method: 'POST',
      json: { ...newLoan('R PRESTITO', 10), transactionId: 'nope' },
    });
    assert.equal(reply.status, 404);
    assert.deepEqual(reply.body, { error: 'Transazione "nope" non trovata.' });
  });

  it('transazione non di tipo LOAN → 400', async () => {
    const reply = await app.request('/api/loans', { method: 'POST', json: newLoan('R SPESA', 10) });
    assert.equal(reply.status, 400);
    assert.deepEqual(reply.body, { error: 'Un prestito può nascere solo da un movimento di tipo prestito: correggi prima la natura del movimento.' });
  });
});

describe('PATCH /api/loans/:id', () => {
  it('prestito inesistente con {} → 404 (l\'esistenza prima della forma)', async () => {
    const reply = await app.request('/api/loans/nope', { method: 'PATCH', json: {} });
    assert.equal(reply.status, 404);
    assert.deepEqual(reply.body, { error: 'Prestito "nope" non trovato.' });
  });
});

describe('DELETE /api/loans/:id', () => {
  it('con restituzioni → 409; senza → 204 senza corpo', async () => {
    const withRepayments = await app.request('/api/loans', { method: 'POST', json: newLoan('R PRESTITO', 100) });
    assert.equal(withRepayments.status, 201);
    const loanId = (withRepayments.body as Detail).id;
    const repay = await app.request(`/api/loans/${loanId}/repayments`, {
      method: 'POST',
      json: { amount: 10, repaymentDate: '2033-03-05' },
    });
    assert.equal(repay.status, 201);

    const refused = await app.request(`/api/loans/${loanId}`, { method: 'DELETE' });
    assert.equal(refused.status, 409);
    assert.deepEqual(refused.body, { error: 'Il prestito ha 1 restituzioni registrate: eliminale prima di eliminare il prestito.' });

    const plain = await app.request('/api/loans', { method: 'POST', json: newLoan('R PRESTITO SENZA RESTITUZIONI', 50) });
    const removed = await app.request(`/api/loans/${(plain.body as Detail).id}`, { method: 'DELETE' });
    assert.deepEqual(removed, { status: 204, text: '', body: undefined });
  });
});

describe('DELETE /api/loans/:id/repayments/:rid', () => {
  it('→ 200 con il dettaglio del prestito, senza la restituzione eliminata', async () => {
    const loan = await app.request('/api/loans', { method: 'POST', json: newLoan('R PRESTITO SENZA RESTITUZIONI', 50) });
    const loanId = (loan.body as Detail).id;
    const added = await app.request(`/api/loans/${loanId}/repayments`, {
      method: 'POST',
      json: { amount: 5, repaymentDate: '2033-03-05' },
    });
    const repaymentId = (added.body as Detail).repayments[0]?.id;
    assert.ok(repaymentId);

    const reply = await app.request(`/api/loans/${loanId}/repayments/${repaymentId}`, { method: 'DELETE' });

    assert.equal(reply.status, 200);
    const body = reply.body as Detail & { repaymentCount: number; remainingAmount: number };
    assert.equal(body.id, loanId);
    assert.deepEqual(body.repayments, []);
    assert.equal(body.repaymentCount, 0);
    assert.equal(body.remainingAmount, 50);
  });
});

describe('GET /api/loans?status', () => {
  it('valore non valido → 400', async () => {
    const reply = await app.request('/api/loans?status=boh');
    assert.equal(reply.status, 400);
    assert.deepEqual(reply.body, { error: 'Stato "boh" non riconosciuto: usare uno fra open, settled, all.' });
  });

  it('status ripetuto: vale il primo', async () => {
    // un prestito aperto (quello con restituzione parziale) e uno saldato
    const open = await app.request('/api/loans?status=open');
    const closed = await app.request('/api/loans', { method: 'POST', json: newLoan('R PRESTITO CHIUSO', 30) });
    await app.request(`/api/loans/${(closed.body as Detail).id}/repayments`, {
      method: 'POST',
      json: { amount: 30, repaymentDate: '2033-03-06' },
    });

    const repeated = await app.request('/api/loans?status=open&status=all');
    const all = await app.request('/api/loans?status=all');
    const openNow = await app.request('/api/loans?status=open');

    assert.equal(repeated.status, 200);
    assert.deepEqual(repeated.body, openNow.body);
    assert.deepEqual(openNow.body, open.body);
    assert.notDeepEqual(repeated.body, all.body);
  });
});

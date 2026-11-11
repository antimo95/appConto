import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

/**
 * LO1: il tipo di un movimento d'origine di prestiti è bloccato.
 *
 * Finché esiste almeno un prestito nato da un movimento, quel movimento resta
 * di tipo `LOAN`, qualunque sia lo stato del prestito (aperto, parzialmente o
 * del tutto restituito). Il legame cessa solo quando il prestito viene
 * eliminato. Lo stesso vincolo, nella forma di `requiredType`, regge anche D9:
 * un accredito collegato a una restituzione resta `INCOME`.
 *
 * Radice dati temporanea scelta prima degli import.
 */

const databaseDir = mkdtempSync(path.join(tmpdir(), 'appconto-loans-type-lock-'));
process.env.DATABASE_FILE = path.join(databaseDir, 'database.sqlite');

const { closeDatabase, runMigrations } = await import('../../db/client.js');
const { DomainError } = await import('../../shared/errors.js');
const { importService } = await import('../import/index.js');
const { transactionsService } = await import('../transactions/index.js');
const { cashFlowService } = await import('../cash-flow/index.js');
const { loansService } = await import('./loans.service.js');

runMigrations();

after(() => {
  closeDatabase();
  try {
    rmSync(databaseDir, { recursive: true, force: true });
  } catch {
    // su Windows il file può restare bloccato: è comunque una cartella temporanea
  }
});

const MONTH = '2041-03';

importService.importCsv(
  [
    'Data contabile,Descrizione,Importo',
    '01/03/2041,ORIGINE APERTO,-100.00',
    '02/03/2041,ORIGINE PARZIALE,-100.00',
    '03/03/2041,ORIGINE RESTITUITO,-100.00',
    '04/03/2041,ORIGINE DOPPIA,-300.00',
    '05/03/2041,ORIGINE ELIMINATA,-50.00',
    '06/03/2041,ORIGINE LEGACY,-70.00',
    '07/03/2041,MOVIMENTO LIBERO,-20.00',
    '10/03/2041,RIENTRO PARZIALE,50.00',
    '11/03/2041,RIENTRO RESTITUITO,100.00',
    '12/03/2041,RIENTRO DOPPIA,100.00',
  ].join('\r\n'),
);

function transactionId(description: string): string {
  const transaction = transactionsService.listAll().find((t) => t.description === description);
  assert.ok(transaction, `transazione "${description}" non trovata`);
  return transaction.id;
}

const typeOf = (description: string): string | undefined =>
  transactionsService.findById(transactionId(description))?.type;

// Preparazione senza `dependents`: è lo stato di partenza, non l'oggetto del test.
for (const nome of [
  'ORIGINE APERTO',
  'ORIGINE PARZIALE',
  'ORIGINE RESTITUITO',
  'ORIGINE DOPPIA',
  'ORIGINE ELIMINATA',
  'ORIGINE LEGACY',
]) {
  transactionsService.updateType(transactionId(nome), 'LOAN');
}
for (const nome of ['RIENTRO PARZIALE', 'RIENTRO RESTITUITO', 'RIENTRO DOPPIA']) {
  transactionsService.updateType(transactionId(nome), 'INCOME');
}

function prestito(origine: string, borrowerName: string, amount: number) {
  return loansService.create({
    transactionId: transactionId(origine),
    borrowerName,
    amount,
    lentAt: '2041-03-08',
  });
}

function restituisci(loanId: string, rientro: string, amount: number): void {
  loansService.addRepayment(loanId, {
    amount,
    repaymentDate: '2041-03-15',
    transactionId: transactionId(rientro),
  });
}

const aperto = prestito('ORIGINE APERTO', 'Anna', 100);
const parziale = prestito('ORIGINE PARZIALE', 'Bruno', 100);
restituisci(parziale.id, 'RIENTRO PARZIALE', 50);
const restituito = prestito('ORIGINE RESTITUITO', 'Carla', 100);
restituisci(restituito.id, 'RIENTRO RESTITUITO', 100);
const doppiaRestituita = prestito('ORIGINE DOPPIA', 'Dario', 100);
restituisci(doppiaRestituita.id, 'RIENTRO DOPPIA', 100);
const doppiaAperta = prestito('ORIGINE DOPPIA', 'Elena', 200);
const legacy = prestito('ORIGINE LEGACY', 'Gino', 70);
// Un archivio con un'incoerenza già presente: il tipo cambiato prima di LO1.
transactionsService.updateType(transactionId('ORIGINE LEGACY'), 'EXPENSE');

const dependents = {
  usagesOf: (ids: readonly string[]) => loansService.transactionUsages(ids),
};

function expectConflict(fn: () => unknown, message: RegExp): void {
  assert.throws(fn, (error: unknown) => {
    assert.ok(error instanceof DomainError, `atteso un errore di dominio, ricevuto ${String(error)}`);
    assert.equal(error.code, 'CONFLICT', `atteso CONFLICT, ricevuto ${error.code}: ${error.message}`);
    assert.match(error.message, message);
    return true;
  });
}

const ALTRI_TIPI = ['EXPENSE', 'INCOME', 'WITHDRAWAL', 'TRANSFER', 'OTHER'] as const;

describe('LO1: un movimento d-origine di prestiti non cambia tipo', () => {
  const casi = [
    { origine: 'ORIGINE APERTO', nome: /prestito a Anna/, loanIds: [aperto.id] },
    { origine: 'ORIGINE PARZIALE', nome: /prestito a Bruno/, loanIds: [parziale.id] },
    { origine: 'ORIGINE RESTITUITO', nome: /prestito a Carla/, loanIds: [restituito.id] },
    {
      origine: 'ORIGINE DOPPIA',
      nome: /prestito a Dario.*prestito a Elena|prestito a Elena.*prestito a Dario/,
      loanIds: [doppiaRestituita.id, doppiaAperta.id],
    },
  ];

  for (const { origine, nome, loanIds } of casi) {
    it(`${origine}: 409 con il nome del prestito, tipo e prestito invariati`, () => {
      const prima = cashFlowService.getCashFlow(MONTH);

      for (const type of ALTRI_TIPI) {
        expectConflict(() => transactionsService.updateType(transactionId(origine), type, dependents), nome);
        assert.equal(typeOf(origine), 'LOAN');
      }

      for (const loanId of loanIds) {
        assert.equal(loansService.getById(loanId).transactionTypeMismatch, false);
      }
      assert.deepEqual(cashFlowService.getCashFlow(MONTH), prima, 'il cash flow non cambia');
    });
  }

  it('il messaggio spiega come procedere', () => {
    expectConflict(
      () => transactionsService.updateType(transactionId('ORIGINE RESTITUITO'), 'EXPENSE', dependents),
      /rimuovi prima le restituzioni ed elimina il prestito, poi correggi il tipo/,
    );
  });

  it('restare LOAN è sempre consentito', () => {
    const updated = transactionsService.updateType(transactionId('ORIGINE PARZIALE'), 'LOAN', dependents);
    assert.equal(updated.type, 'LOAN');
  });
});

describe('LO1: i casi consentiti', () => {
  it('un movimento senza legami cambia tipo', () => {
    const id = transactionId('MOVIMENTO LIBERO');
    assert.equal(transactionsService.updateType(id, 'OTHER', dependents).type, 'OTHER');
  });

  it('eliminato il suo unico prestito, l-origine cambia tipo', () => {
    const loan = prestito('ORIGINE ELIMINATA', 'Franco', 50);
    expectConflict(
      () => transactionsService.updateType(transactionId('ORIGINE ELIMINATA'), 'EXPENSE', dependents),
      /prestito a Franco/,
    );

    loansService.remove(loan.id);

    const updated = transactionsService.updateType(transactionId('ORIGINE ELIMINATA'), 'EXPENSE', dependents);
    assert.equal(updated.type, 'EXPENSE');
  });

  it('un-origine legacy si riporta a LOAN, e solo a LOAN', () => {
    assert.equal(loansService.getById(legacy.id).transactionTypeMismatch, true);
    expectConflict(
      () => transactionsService.updateType(transactionId('ORIGINE LEGACY'), 'OTHER', dependents),
      /prestito a Gino/,
    );

    const updated = transactionsService.updateType(transactionId('ORIGINE LEGACY'), 'LOAN', dependents);

    assert.equal(updated.type, 'LOAN');
    assert.equal(loansService.getById(legacy.id).transactionTypeMismatch, false);
  });

  it('D9 invariata: una restituzione resta INCOME', () => {
    const id = transactionId('RIENTRO PARZIALE');
    assert.equal(transactionsService.updateType(id, 'INCOME', dependents).type, 'INCOME');
    expectConflict(() => transactionsService.updateType(id, 'EXPENSE', dependents), /restituzione del prestito a Bruno/);
    assert.equal(typeOf('RIENTRO PARZIALE'), 'INCOME');
  });
});

describe('il vincolo esposto dall-indice dei legami', () => {
  it('ogni legame dichiara il tipo che il movimento deve avere', () => {
    const { links } = loansService.links();
    const origine = links.find((link) => link.loanId === aperto.id && link.role === 'ORIGIN');
    const rientro = links.find((link) => link.loanId === parziale.id && link.role === 'REPAYMENT');

    assert.equal(origine?.requiredType, 'LOAN');
    assert.equal(rientro?.requiredType, 'INCOME');
  });
});

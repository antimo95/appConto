import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { isolationProblem } from './isolate-database.js';

const appRoot = path.resolve(import.meta.dirname, '..', '..', '..', '..');
const temp = tmpdir();

describe('isolationProblem', () => {
  it('accetta DATABASE_FILE assente', () => {
    assert.equal(isolationProblem({}, appRoot, temp, null), null);
  });

  it('accetta DATABASE_FILE sotto la cartella temporanea', () => {
    const env = { DATABASE_FILE: path.join(temp, 'appconto-x', 'test.db') };
    assert.equal(isolationProblem(env, appRoot, temp, null), null);
  });

  it('rifiuta il database dell’applicazione, anche come percorso relativo', () => {
    for (const DATABASE_FILE of ['data/database.sqlite', path.join(appRoot, 'data', 'database.sqlite')]) {
      assert.match(isolationProblem({ DATABASE_FILE }, appRoot, temp, null) ?? '', /dati dell'applicazione/);
    }
  });

  it('rifiuta un percorso fuori dalla cartella temporanea', () => {
    const env = { DATABASE_FILE: path.join(appRoot, 'altro.sqlite') };
    assert.match(isolationProblem(env, appRoot, temp, null) ?? '', /deve stare sotto/);
  });

  it('rifiuta MYFINANCE_DATA e dataRoot nelle impostazioni', () => {
    assert.match(isolationProblem({ MYFINANCE_DATA: 'x' }, appRoot, temp, null) ?? '', /MYFINANCE_DATA/);
    assert.match(isolationProblem({}, appRoot, temp, 'D:/dati') ?? '', /dataRoot/);
  });
});

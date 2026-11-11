import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { CONTROL_PROTOCOL, startControlServer, type ControlChannel } from './control.js';
import {
  acquireInstanceLock,
  parseLockContent,
  readInstanceLock,
  stealClaimFor,
} from './instance-lock.js';

/**
 * Istanza unica per archivio.
 *
 * Ogni caso lavora su una radice dati temporanea: il lock è un file dentro
 * `DATA_ROOT`, quindi un test che usasse la radice reale vi scriverebbe
 * davvero. Nessun database viene aperto — il lock esiste proprio per venire
 * *prima* di quello.
 */

const temporanee: string[] = [];
const canali: ControlChannel[] = [];

function radice(nome: string): string {
  const creata = mkdtempSync(path.join(tmpdir(), `appconto-lock-${nome}-`));
  temporanee.push(creata);

  return creata;
}

const lockDi = (dataRoot: string): string => path.join(dataRoot, 'instance.lock');

/** Un canale di controllo vero, che dichiara una radice dati. */
async function canale(dataRoot: string): Promise<ControlChannel> {
  const aperto = await startControlServer({
    dataRoot,
    token: () => 'irrilevante',
    serverPort: () => null,
    shutdown: () => {
      // Nessun arresto in questi casi: si prova l'esclusione, non il ciclo di
      // vita.
    },
  });
  canali.push(aperto);

  return aperto;
}

interface Presa {
  readonly dataRoot: string;
  readonly lockFile: string;
  readonly canale: ControlChannel;
}

/** Prende il lock come farebbe il launcher: canale in ascolto, poi file. */
async function prendi(dataRoot: string): Promise<Presa & { release: () => void }> {
  const aperto = await canale(dataRoot);
  const esito = await acquireInstanceLock({
    lockFile: lockDi(dataRoot),
    dataRoot,
    appRoot: 'C:\\app',
    controlPort: aperto.port,
    now: () => new Date('2026-09-02T10:00:00.000Z'),
  });

  assert.equal(esito.acquired, true, 'il primo lock deve riuscire');
  if (!esito.acquired) {
    throw new Error('non raggiungibile');
  }

  return {
    dataRoot,
    lockFile: lockDi(dataRoot),
    canale: aperto,
    release: esito.lock.release,
  };
}

describe('§19 caso A — due istanze sulla stessa radice dati', () => {
  it('la seconda viene rifiutata e riceve chi è il proprietario', async () => {
    const dati = radice('a');
    const primo = await prendi(dati);

    const secondoCanale = await canale(dati);
    const secondo = await acquireInstanceLock({
      lockFile: lockDi(dati),
      dataRoot: dati,
      appRoot: 'C:\\altra-copia-del-package',
      controlPort: secondoCanale.port,
      now: () => new Date(),
    });

    assert.equal(secondo.acquired, false);
    if (secondo.acquired) {
      return;
    }

    assert.equal(secondo.running.controlPort, primo.canale.port);
    assert.equal(secondo.running.dataRoot, dati);
    assert.equal(secondo.running.pid, process.pid);
    // Il file non è stato riscritto dal secondo: il proprietario è ancora il
    // primo, con il suo token.
    const suDisco = readInstanceLock(primo.lockFile);
    assert.equal(suDisco?.controlPort, primo.canale.port);
  });
});

describe('§19 caso B — due istanze su radici diverse', () => {
  it('entrambe vengono ammesse', async () => {
    const uno = radice('b1');
    const due = radice('b2');

    const primo = await prendi(uno);
    const secondo = await prendi(due);

    assert.ok(existsSync(primo.lockFile));
    assert.ok(existsSync(secondo.lockFile));
    assert.notEqual(primo.lockFile, secondo.lockFile);
    // Nessuna chiave calcolata: il lock è *dentro* la radice dati, quindi due
    // radici diverse sono due file diversi per costruzione.
    assert.equal(readInstanceLock(primo.lockFile)?.dataRoot, uno);
    assert.equal(readInstanceLock(secondo.lockFile)?.dataRoot, due);
  });
});

describe('§19 caso C — rilascio e riavvio', () => {
  it('dopo il rilascio la stessa radice è di nuovo disponibile', async () => {
    const dati = radice('c');
    const primo = await prendi(dati);

    primo.release();
    assert.equal(existsSync(primo.lockFile), false, 'il rilascio deve rimuovere il file');
    await primo.canale.close();

    const secondo = await prendi(dati);
    assert.ok(existsSync(secondo.lockFile));
  });

  it('il rilascio è idempotente e non toglie il lock a un altro', async () => {
    const dati = radice('c2');
    const primo = await prendi(dati);

    primo.release();
    primo.release();
    await primo.canale.close();

    // Un altro prende il lock; il rilascio del primo non deve toccarlo.
    const secondo = await prendi(dati);
    const tokenDelSecondo = readInstanceLock(secondo.lockFile)?.token;

    primo.release();

    assert.equal(readInstanceLock(secondo.lockFile)?.token, tokenDelSecondo);
    assert.ok(existsSync(secondo.lockFile));
  });
});

describe('§19 caso D — dopo una terminazione anomala', () => {
  it('un lock il cui proprietario non risponde viene preso', async () => {
    const dati = radice('d');

    /*
     * Il residuo di un processo terminato di forza: il file c'è, con una porta
     * su cui non c'è più nessuno. È esattamente ciò che resta dopo un
     * `taskkill /F`, e ciò che rende inservibili i lock basati sulla sola
     * esistenza di un file.
     */
    const mortoCanale = await canale(dati);
    const portaMorta = mortoCanale.port;
    await mortoCanale.close();

    writeFileSync(
      lockDi(dati),
      JSON.stringify({
        protocol: CONTROL_PROTOCOL,
        pid: 999_999,
        startedAt: '2026-09-01T10:00:00.000Z',
        appRoot: 'C:\\app',
        dataRoot: dati,
        controlPort: portaMorta,
        token: 'token-del-processo-morto',
        serverPort: 4711,
      }),
      'utf8',
    );

    const nuovoCanale = await canale(dati);
    const esito = await acquireInstanceLock({
      lockFile: lockDi(dati),
      dataRoot: dati,
      appRoot: 'C:\\app',
      controlPort: nuovoCanale.port,
      now: () => new Date(),
    });

    assert.equal(esito.acquired, true, 'un lock abbandonato non deve bloccare l-avvio');
    assert.equal(readInstanceLock(lockDi(dati))?.controlPort, nuovoCanale.port);
    assert.notEqual(readInstanceLock(lockDi(dati))?.token, 'token-del-processo-morto');
  });

  it('un pid vivo non basta a tenere il lock', async () => {
    const dati = radice('d2');

    // Il pid è quello di *questo* processo — vivissimo — ma la porta di
    // controllo non risponde. È il caso del numero di processo riciclato: se
    // il pid decidesse, l'applicazione resterebbe bloccata per sempre.
    const mortoCanale = await canale(dati);
    const portaMorta = mortoCanale.port;
    await mortoCanale.close();

    writeFileSync(
      lockDi(dati),
      JSON.stringify({
        protocol: CONTROL_PROTOCOL,
        pid: process.pid,
        startedAt: '2026-09-01T10:00:00.000Z',
        appRoot: 'C:\\app',
        dataRoot: dati,
        controlPort: portaMorta,
        token: 'vecchio',
        serverPort: null,
      }),
      'utf8',
    );

    const nuovoCanale = await canale(dati);
    const esito = await acquireInstanceLock({
      lockFile: lockDi(dati),
      dataRoot: dati,
      appRoot: 'C:\\app',
      controlPort: nuovoCanale.port,
      now: () => new Date(),
    });

    assert.equal(esito.acquired, true);
  });

  it('un lock illeggibile viene sostituito, non rispettato', async () => {
    const dati = radice('d3');
    writeFileSync(lockDi(dati), 'questo non è JSON', 'utf8');

    const nuovoCanale = await canale(dati);
    const esito = await acquireInstanceLock({
      lockFile: lockDi(dati),
      dataRoot: dati,
      appRoot: 'C:\\app',
      controlPort: nuovoCanale.port,
      now: () => new Date(),
      // Il tempo di grazia per una scrittura a metà non serve attenderlo
      // davvero: qui è spazzatura, non un file in corso di scrittura.
      wait: () => Promise.resolve(),
    });

    assert.equal(esito.acquired, true, 'un file di spazzatura non deve bloccare l-applicazione');
    assert.equal(readLock(lockDi(dati)).controlPort, nuovoCanale.port);
  });

  it("un lock che nomina un'altra radice dati viene considerato abbandonato", async () => {
    const dati = radice('d4');
    const altra = radice('d5');

    // Il canale risponde, ma dichiara un altro archivio: il lock non descrive
    // il custode di *questa* cartella.
    const altroCanale = await canale(altra);

    writeFileSync(
      lockDi(dati),
      JSON.stringify({
        protocol: CONTROL_PROTOCOL,
        pid: process.pid,
        startedAt: '2026-09-01T10:00:00.000Z',
        appRoot: 'C:\\app',
        dataRoot: dati,
        controlPort: altroCanale.port,
        token: 'vecchio',
        serverPort: null,
      }),
      'utf8',
    );

    const nuovoCanale = await canale(dati);
    const esito = await acquireInstanceLock({
      lockFile: lockDi(dati),
      dataRoot: dati,
      appRoot: 'C:\\app',
      controlPort: nuovoCanale.port,
      now: () => new Date(),
    });

    assert.equal(esito.acquired, true);
  });
});

describe('la porta del server registrata nel lock', () => {
  it('viene scritta e resta leggibile da un secondo avvio', async () => {
    const dati = radice('porta');
    const aperto = await canale(dati);
    const esito = await acquireInstanceLock({
      lockFile: lockDi(dati),
      dataRoot: dati,
      appRoot: 'C:\\app',
      controlPort: aperto.port,
      now: () => new Date(),
    });

    assert.equal(esito.acquired, true);
    if (!esito.acquired) {
      return;
    }

    assert.equal(readLock(lockDi(dati)).serverPort, null);

    esito.lock.recordServerPort(47318);

    const dopo = readLock(lockDi(dati));
    assert.equal(dopo.serverPort, 47318);
    // Il token non cambia: chi lo ha in mano può ancora fermare l'istanza.
    assert.equal(dopo.token, esito.lock.content.token);
  });
});

describe('interpretazione del contenuto', () => {
  it('accetta un lock completo', () => {
    const contenuto = parseLockContent(
      JSON.stringify({
        protocol: CONTROL_PROTOCOL,
        pid: 42,
        startedAt: '2026-09-02T10:00:00.000Z',
        appRoot: 'C:\\app',
        dataRoot: 'C:\\dati',
        controlPort: 5000,
        token: 'abc',
        serverPort: 3000,
      }),
    );

    assert.deepEqual(contenuto, {
      protocol: CONTROL_PROTOCOL,
      pid: 42,
      startedAt: '2026-09-02T10:00:00.000Z',
      appRoot: 'C:\\app',
      dataRoot: 'C:\\dati',
      controlPort: 5000,
      token: 'abc',
      serverPort: 3000,
    });
  });

  it('rifiuta le forme che non permettono di riconoscere il proprietario', () => {
    const base = {
      protocol: CONTROL_PROTOCOL,
      pid: 42,
      startedAt: '2026-09-02T10:00:00.000Z',
      appRoot: 'C:\\app',
      dataRoot: 'C:\\dati',
      controlPort: 5000,
      token: 'abc',
      serverPort: null,
    };

    const forme: [string, unknown][] = [
      ['non JSON', undefined],
      ['un array', []],
      ['un numero', 7],
      ['senza protocollo', { ...base, protocol: undefined }],
      ['con un altro protocollo', { ...base, protocol: 'qualcosaltro/9' }],
      ['senza porta di controllo', { ...base, controlPort: undefined }],
      ['con porta zero', { ...base, controlPort: 0 }],
      ['con porta non intera', { ...base, controlPort: 1.5 }],
      ['senza token', { ...base, token: '' }],
      ['senza radice dati', { ...base, dataRoot: '' }],
      ['senza pid', { ...base, pid: undefined }],
    ];

    for (const [descrizione, forma] of forme) {
      const testo = forma === undefined ? 'non JSON' : JSON.stringify(forma);
      assert.equal(parseLockContent(testo), null, `doveva rifiutare: ${descrizione}`);
    }
  });

  it('tollera i campi solo descrittivi', () => {
    const contenuto = parseLockContent(
      JSON.stringify({
        protocol: CONTROL_PROTOCOL,
        pid: 42,
        dataRoot: 'C:\\dati',
        controlPort: 5000,
        token: 'abc',
      }),
    );

    // `startedAt` e `appRoot` servono a chi legge il file, non a decidere:
    // la loro assenza non rende il lock inservibile.
    assert.equal(contenuto?.startedAt, 'sconosciuto');
    assert.equal(contenuto?.appRoot, 'sconosciuto');
    assert.equal(contenuto?.serverPort, null);
  });

  it('un file che non esiste non è un lock', () => {
    assert.equal(readInstanceLock(path.join(radice('vuota'), 'instance.lock')), null);
  });
});

/*
 * A-03. Due avvii che giudicano morto lo stesso lock non possono prenderlo
 * entrambi: il furto passa per una rivendicazione `wx` legata a quella
 * specifica istanza del lock, e chi la vince ricontrolla il contenuto prima di
 * cancellare. Le porte qui sono finte: la liveness la decide l'hook `live`.
 */
describe('furto di un lock abbandonato da parte di avvii concorrenti', () => {
  const PORTA_MORTA = 1;

  /** Scrive il lock di un processo morto. */
  function lockMorto(dati: string): void {
    const byte = JSON.stringify({
      protocol: CONTROL_PROTOCOL,
      pid: 999_999,
      startedAt: '2026-09-01T10:00:00.000Z',
      appRoot: 'C:\\app',
      dataRoot: dati,
      controlPort: PORTA_MORTA,
      token: 'token-del-processo-morto',
      serverPort: null,
    });
    writeFileSync(lockDi(dati), byte, 'utf8');
  }

  function avvio(
    dati: string,
    porta: number,
    live: (port: number) => Promise<boolean>,
  ): ReturnType<typeof acquireInstanceLock> {
    return acquireInstanceLock({
      lockFile: lockDi(dati),
      dataRoot: dati,
      appRoot: 'C:\\app',
      controlPort: porta,
      now: () => new Date(),
      live,
      wait: () => Promise.resolve(),
    });
  }

  it('chi arriva secondo non cancella il lock appena preso dal primo', async () => {
    const dati = radice('l1');
    lockMorto(dati);

    // A e B hanno il canale di controllo in ascolto, come nel launcher reale.
    const vivo = (port: number): Promise<boolean> => Promise.resolve(port === 2001 || port === 2002);

    // B legge il lock morto; mentre ne verifica la liveness, A fa un'acquisizione completa.
    let esitoA: Awaited<ReturnType<typeof acquireInstanceLock>> | undefined;
    const esitoB = await avvio(dati, 2002, async (port) => {
      esitoA ??= await avvio(dati, 2001, vivo);

      return vivo(port);
    });

    assert.equal(esitoA?.acquired, true, 'A prende il lock abbandonato');
    assert.equal(esitoB.acquired, false, 'B deve trovare A, non togliergli il lock');
    assert.equal(readLock(lockDi(dati)).controlPort, 2001);

    // Il rilascio di A rimuove il suo lock: nessuno glielo ha sostituito.
    if (esitoA?.acquired) {
      esitoA.lock.release();
    }
    assert.ok(!existsSync(lockDi(dati)));
  });

  it('una rivendicazione orfana di un altro lock non impedisce il furto', async () => {
    const dati = radice('l2');
    lockMorto(dati);
    writeFileSync(`${lockDi(dati)}.steal-${'0'.repeat(64)}`, '', 'utf8');

    const esito = await avvio(dati, 2001, (port) => Promise.resolve(port === 2001));

    assert.equal(esito.acquired, true);
    assert.equal(readLock(lockDi(dati)).controlPort, 2001);
  });

  it('una rivendicazione rimasta per il lock morto attuale produce un errore che nomina i due file', async () => {
    const dati = radice('l3');
    lockMorto(dati);
    const rivendicazione = stealClaimFor(lockDi(dati));
    assert.ok(rivendicazione !== null);
    // Il residuo di un vincitore terminato fra rivendicazione e sostituzione.
    writeFileSync(rivendicazione, '', 'utf8');

    await assert.rejects(
      avvio(dati, 2001, () => Promise.resolve(false)),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.ok(error.message.includes(lockDi(dati)), error.message);
        assert.ok(error.message.includes(rivendicazione), error.message);

        return true;
      },
    );
    // Nessun file rimosso d'ufficio: la decisione resta a chi legge l'errore.
    assert.ok(existsSync(lockDi(dati)));
    assert.ok(existsSync(rivendicazione));
  });

  it('due lock vuoti successivi non hanno la stessa rivendicazione', () => {
    // Ogni lock appena creato con `wx` è vuoto: i soli byte non bastano a
    // distinguere il lock morto da quello appena creato da un altro avvio.
    const dati = radice('l6');
    writeFileSync(lockDi(dati), '', 'utf8');
    const primo = stealClaimFor(lockDi(dati));
    rmSync(lockDi(dati));
    writeFileSync(lockDi(dati), '', 'utf8');

    assert.ok(primo !== null);
    assert.notEqual(stealClaimFor(lockDi(dati)), primo);
  });

  it('un lock vuoto lasciato da un avvio interrotto viene preso', async () => {
    const dati = radice('l7');
    writeFileSync(lockDi(dati), '', 'utf8');

    const esito = await avvio(dati, 2001, (port) => Promise.resolve(port === 2001));

    assert.equal(esito.acquired, true);
    assert.equal(readLock(lockDi(dati)).controlPort, 2001);
  });

  it('il rilascio non cancella un file illeggibile: può essere il lock di un altro', async () => {
    const dati = radice('l8');
    const esito = await avvio(dati, 2001, () => Promise.resolve(false));
    assert.ok(esito.acquired);

    // Il lock è stato preso da un altro avvio, che lo ha appena creato vuoto.
    rmSync(lockDi(dati));
    writeFileSync(lockDi(dati), '', 'utf8');
    esito.lock.release();

    assert.ok(existsSync(lockDi(dati)));
  });

  it('fra molti avvii concorrenti su un lock abbandonato uno solo lo prende', async () => {
    const porte = [3001, 3002, 3003, 3004, 3005];
    const vivo = (port: number): Promise<boolean> => Promise.resolve(porte.includes(port));

    for (let ripetizione = 0; ripetizione < 50; ripetizione += 1) {
      const dati = radice(`l5-${String(ripetizione)}`);
      lockMorto(dati);

      const esiti = await Promise.all(porte.map((porta) => avvio(dati, porta, vivo)));
      const vincitori = esiti.filter((esito) => esito.acquired);

      assert.equal(vincitori.length, 1, `ripetizione ${String(ripetizione)}`);
      const vincitore = vincitori[0];
      assert.ok(vincitore?.acquired);
      assert.equal(readLock(lockDi(dati)).token, vincitore.lock.content.token);
    }
  });
});

/** Il lock su disco, preteso valido. */
function readLock(file: string): NonNullable<ReturnType<typeof parseLockContent>> {
  const contenuto = parseLockContent(readFileSync(file, 'utf8'));
  assert.ok(contenuto !== null, `il lock ${file} doveva essere leggibile`);

  return contenuto;
}

after(async () => {
  for (const aperto of canali) {
    await aperto.close();
  }
  for (const cartella of temporanee) {
    rmSync(cartella, { recursive: true, force: true });
  }
});

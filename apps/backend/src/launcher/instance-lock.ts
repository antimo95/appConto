import { createHash, randomBytes } from 'node:crypto';
import {
  closeSync,
  fstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { CONTROL_PROTOCOL, isLiveInstance } from './control.js';

/**
 * Una sola istanza per archivio.
 *
 * SQLite regge più connessioni, ma questa applicazione è costruita su un
 * assunto più forte: **uno scrittore solo**. Il WAL viene consolidato alla
 * chiusura, un ripristino differito sostituisce il file all'apertura, un
 * backup prende uno snapshot senza fermare nessuno. Due processi che aprono lo
 * stesso archivio non lo corrompono, ma trasformano quelle tre operazioni in
 * altrettante corse: il secondo processo può applicare un ripristino sotto i
 * piedi del primo, o migrare uno schema che il primo sta usando.
 *
 * Il vincolo è quindi sull'**archivio**, non sul programma: due copie della
 * cartella portatile che aprono due radici dati diverse sono due applicazioni
 * indipendenti, e devono poter girare insieme.
 *
 * ## Come è fatto il lock
 *
 * Un file dentro `DATA_ROOT`, creato con `wx` — cioè "crea, e falliscimi se
 * esiste già". È una singola chiamata di sistema che riesce a uno solo dei
 * concorrenti: è quello il punto di mutua esclusione, non il controllo
 * `if (esiste)`, che avrebbe una finestra fra la domanda e la risposta.
 *
 * Il file dice chi è il proprietario e **su quale porta risponde**. Da lì
 * viene la soluzione al problema che rende inservibili i lock su file: un file
 * sopravvive a chi l'ha scritto, un socket in ascolto no. Se il proprietario
 * dichiarato non risponde, il lock è di un processo che non c'è più e va
 * preso; se risponde, l'applicazione è davvero già in esecuzione.
 *
 * Il `pid` è registrato per la diagnosi e **non** viene usato per decidere: i
 * numeri di processo vengono riciclati, e un lock tenuto in vita da un pid
 * riassegnato a un programma qualsiasi bloccherebbe l'applicazione per sempre.
 *
 * ## Come si prende un lock abbandonato
 *
 * Cancellare il lock giudicato morto non basta: due avvii che lo leggono
 * insieme lo giudicano morto entrambi, e il secondo cancellerebbe il lock
 * appena creato dal primo. Il furto passa quindi per una **rivendicazione**:
 * il file `<lock>.steal-<impronta>`, creato con `wx`, dove l'impronta è lo
 * sha256 dei byte e dell'identità del file (numero e istante di creazione)
 * del lock giudicato morto. Per ogni istanza morta del lock la
 * rivendicazione riesce a uno solo; chi la ottiene rilegge il lock e lo
 * cancella solo se è ancora quello giudicato morto. La rivendicazione si
 * rimuove dopo aver creato il proprio lock, così nessuno la ottiene mentre il
 * nuovo lock non è ancora scritto per intero.
 *
 * L'impronta non usa il `token`: vale anche per un lock illeggibile, e non
 * mette in un nome di file un valore letto da un file.
 *
 * Caso residuo, precedente a questa logica: un avvio che resta fermo più di
 * `PARTIAL_WRITE_GRACE_MS` fra la creazione del lock e la sua scrittura viene
 * giudicato morto, perché il file è davvero immutato.
 */

/** Quanti tentativi di prendere un lock abbandonato prima di rinunciare. */
const MAX_STEAL_ATTEMPTS = 4;

/** Per quanto si dà tempo a un lock illeggibile di essere finito di scrivere. */
const PARTIAL_WRITE_GRACE_MS = 600;

/** Quanto attende chi trova il furto già rivendicato da un altro avvio. */
const CLAIM_BUSY_WAIT_MS = 200;

export interface LockContent {
  readonly protocol: string;
  readonly pid: number;
  readonly startedAt: string;
  readonly appRoot: string;
  readonly dataRoot: string;
  readonly controlPort: number;
  readonly token: string;
  /** La porta del server: `null` fino a quando non è pronto. */
  readonly serverPort: number | null;
}

/** Il valore, se è una stringa con del contenuto. */
function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Il valore, se è un intero positivo. */
function whole(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

/**
 * Interpreta il contenuto di un file di lock.
 *
 * `null` per qualunque forma inattesa. Un lock che non si capisce non va
 * rispettato: sarebbe un modo di bloccare l'applicazione scrivendo spazzatura
 * in un file. Va invece trattato come abbandonato, cioè sostituito.
 */
export function parseLockContent(raw: string): LockContent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return null;
  }

  const value = parsed as Record<string, unknown>;
  const protocol = text(value.protocol);
  const dataRoot = text(value.dataRoot);
  const token = text(value.token);
  const controlPort = whole(value.controlPort);
  const pid = whole(value.pid);

  if (
    protocol !== CONTROL_PROTOCOL ||
    dataRoot === null ||
    token === null ||
    controlPort === null ||
    pid === null
  ) {
    return null;
  }

  return {
    protocol,
    pid,
    startedAt: text(value.startedAt) ?? 'sconosciuto',
    appRoot: text(value.appRoot) ?? 'sconosciuto',
    dataRoot,
    controlPort,
    token,
    serverPort: whole(value.serverPort),
  };
}

/** Il lock acquisito, e ciò che si può farne. */
export interface HeldLock {
  readonly content: LockContent;
  /** Registra la porta del server, così un secondo avvio sa dove mandare il browser. */
  readonly recordServerPort: (port: number) => void;
  /** Rilascia il lock. Idempotente: non solleva se il file non c'è più. */
  readonly release: () => void;
}

export type AcquireOutcome =
  | { readonly acquired: true; readonly lock: HeldLock }
  | { readonly acquired: false; readonly running: LockContent };

export interface AcquireRequest {
  readonly lockFile: string;
  readonly dataRoot: string;
  readonly appRoot: string;
  /** Il canale di controllo, **già in ascolto**. */
  readonly controlPort: number;
  readonly now: () => Date;
  /** Iniettabile: i test devono poter descrivere un'istanza viva o morta. */
  readonly live?: (port: number, dataRoot: string) => Promise<boolean>;
  readonly wait?: (ms: number) => Promise<void>;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

interface LockSnapshot {
  readonly raw: Buffer;
  /** Byte più identità del file: due lock diversi non hanno mai la stessa chiave. */
  readonly key: string;
}

/**
 * Il lock com'è adesso: `'missing'` se non c'è, `'busy'` se c'è ma non si legge
 * (antivirus, indicizzatore, file in cancellazione).
 *
 * I soli byte non bastano a riconoscere un'istanza: ogni lock appena creato
 * con `wx` e non ancora scritto è vuoto. Numero del file e istante di
 * creazione, letti dallo stesso handle, distinguono il lock morto da uno nuovo
 * con lo stesso contenuto.
 */
function snapshot(lockFile: string): LockSnapshot | 'missing' | 'busy' {
  let fd: number;
  try {
    fd = openSync(lockFile, 'r');
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'busy';
  }

  try {
    const raw = readFileSync(fd);
    const { ino, birthtimeNs } = fstatSync(fd, { bigint: true });
    const key = createHash('sha256')
      .update(raw)
      .update(`\0${String(ino)}:${String(birthtimeNs)}`)
      .digest('hex');

    return { raw, key };
  } catch {
    return 'busy';
  } finally {
    closeSync(fd);
  }
}

const claimPath = (lockFile: string, key: string): string => `${lockFile}.steal-${key}`;

/** La rivendicazione di furto per il lock attuale. Esportata per i test. */
export function stealClaimFor(lockFile: string): string | null {
  const seen = snapshot(lockFile);

  return typeof seen === 'object' ? claimPath(lockFile, seen.key) : null;
}

/** Rimuove un file senza sollevare: se resta, il giro successivo se ne accorge. */
function removeQuietly(file: string): void {
  try {
    rmSync(file, { force: true });
  } catch {
    // Antivirus o indicizzatore (EPERM/EBUSY su Windows): si riprova al giro dopo.
  }
}

/**
 * Prende il lock, oppure dice chi ce l'ha.
 *
 * Il canale di controllo deve essere già in ascolto quando si chiama: il file
 * scritto ne contiene la porta, e chiunque lo legga si aspetta di trovarvi
 * qualcuno che risponde.
 */
export async function acquireInstanceLock(request: AcquireRequest): Promise<AcquireOutcome> {
  const live = request.live ?? isLiveInstance;
  const wait = request.wait ?? sleep;

  mkdirSync(path.dirname(request.lockFile), { recursive: true });

  /** La rivendicazione vinta da questo avvio: si rimuove dopo il `wx` del giro successivo. */
  let claim: string | null = null;
  const dropClaim = (): void => {
    if (claim !== null) {
      removeQuietly(claim);
      claim = null;
    }
  };
  /** La rivendicazione altrui che ha fermato l'ultimo tentativo, se c'è. */
  let blockedBy: string | null = null;
  /** L'EPERM dell'ultimo tentativo: se persiste non è transitorio, e va mostrato. */
  let denied: unknown = null;

  for (let attempt = 0; attempt < MAX_STEAL_ATTEMPTS; attempt += 1) {
    blockedBy = null;
    denied = null;
    const content: LockContent = {
      protocol: CONTROL_PROTOCOL,
      pid: process.pid,
      startedAt: request.now().toISOString(),
      appRoot: request.appRoot,
      dataRoot: request.dataRoot,
      controlPort: request.controlPort,
      // Il segreto che autorizza l'arresto. Nuovo a ogni avvio: un token
      // rimasto in un lock abbandonato non vale per l'istanza successiva.
      token: randomBytes(24).toString('hex'),
      serverPort: null,
    };

    try {
      writeFileSync(request.lockFile, `${JSON.stringify(content, null, 2)}\n`, {
        encoding: 'utf8',
        // Il punto di mutua esclusione: `wx` riesce a un solo processo.
        flag: 'wx',
      });
      dropClaim();

      let corrente = content;

      return {
        acquired: true,
        lock: {
          content,
          recordServerPort: (port: number): void => {
            corrente = { ...corrente, serverPort: port };
            try {
              writeFileSync(request.lockFile, `${JSON.stringify(corrente, null, 2)}\n`, 'utf8');
            } catch {
              // Il lock resta valido: la porta serve solo a un eventuale
              // secondo avvio per aprire il browser sull'istanza attiva.
            }
          },
          release: (): void => {
            try {
              // Si rilascia solo il proprio lock. Se il file contiene un
              // altro token, qualcun altro lo ha già preso — cancellarlo
              // significherebbe togliere il lock a lui. Lo stesso vale per un
              // file illeggibile: può essere il lock appena creato da un altro.
              const presente = parseLockContent(readFileSync(request.lockFile, 'utf8'));
              if (presente !== null && presente.token === content.token) {
                rmSync(request.lockFile, { force: true });
              }
            } catch {
              // Già rimosso: è lo stato desiderato.
            }
          },
        },
      };
    } catch (error) {
      dropClaim();
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EPERM') {
        // Su Windows un file in cancellazione rifiuta l'apertura con EPERM.
        denied = error;
        await wait(CLAIM_BUSY_WAIT_MS);
        continue;
      }
      if (code !== 'EEXIST') {
        throw error;
      }
    }

    // Il file esiste: c'è qualcuno, oppure c'era.
    let seen = snapshot(request.lockFile);
    let presente = typeof seen === 'object' ? parseLockContent(seen.raw.toString('utf8')) : null;

    if (seen !== 'missing' && presente === null) {
      /*
       * Illeggibile. Due possibilità: spazzatura, o un lock appena creato e
       * non ancora scritto per intero — la creazione e la scrittura del
       * contenuto non sono un'operazione unica. Si concede un attimo e si
       * rilegge una volta: se è ancora illeggibile, è spazzatura.
       */
      await wait(PARTIAL_WRITE_GRACE_MS);
      seen = snapshot(request.lockFile);
      presente = typeof seen === 'object' ? parseLockContent(seen.raw.toString('utf8')) : null;
    }

    if (typeof seen !== 'object') {
      // Sparito nel frattempo, oppure ancora non leggibile: si riprova. Ciò
      // che non si riesce a leggere non si ruba.
      continue;
    }

    if (presente !== null && (await live(presente.controlPort, presente.dataRoot))) {
      return { acquired: false, running: presente };
    }

    // Nessuno risponde: il lock è di un processo che non esiste più. Lo prende
    // solo chi ne rivendica il furto, e solo se è ancora quello giudicato morto.
    const dead = seen.key;
    const steal = claimPath(request.lockFile, dead);
    try {
      writeFileSync(steal, '', { flag: 'wx' });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EEXIST') {
        // Un altro avvio lo sta prendendo: al prossimo giro si troverà il suo lock.
        blockedBy = steal;
      } else if (code === 'EPERM') {
        // La rivendicazione di un altro avvio è in cancellazione (Windows).
        denied = error;
      } else {
        throw error;
      }

      await wait(CLAIM_BUSY_WAIT_MS);
      continue;
    }

    claim = steal;
    const current = snapshot(request.lockFile);
    if (typeof current === 'object' && current.key === dead) {
      // Se la rimozione non riesce, il prossimo giro lo rileggerà.
      removeQuietly(request.lockFile);
    }
  }

  dropClaim();

  if (denied !== null) {
    throw denied;
  }

  if (blockedBy !== null) {
    // shortcut: un avvio terminato fra la rivendicazione e la sostituzione del
    // lock (o una rivendicazione che non si è riusciti a rimuovere) lascia
    // entrambi i file, e nessuno prende più il lock da solo. Si chiede di
    // rimuoverli a mano invece di farli scadere per età, che riaprirebbe la
    // corsa. Rivedere se capita davvero (docs/rilascio.md).
    throw new Error(
      `L'archivio risulta bloccato da un avvio interrotto o da un file che non si è riusciti a rimuovere. Se MyFinance non è in esecuzione, elimina questi due file e riavvia: ${request.lockFile} e ${blockedBy}`,
    );
  }

  throw new Error(
    `Impossibile stabilire chi stia usando l'archivio: ${request.lockFile} cambia di continuo o non si riesce a leggere.`,
  );
}

/** Legge il lock presente, se c'è e se si capisce. */
export function readInstanceLock(lockFile: string): LockContent | null {
  try {
    return parseLockContent(readFileSync(lockFile, 'utf8'));
  } catch {
    return null;
  }
}

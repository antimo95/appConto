import { ValidationError } from '../../../shared/errors.js';

/**
 * Il testo di un PDF con la sua posizione sulla pagina.
 *
 * È il confine fra la libreria che legge il PDF e i parser: un parser vede
 * solo questi tipi, quindi si verifica con un documento descritto a mano e non
 * dipende da come `pdfjs-dist` rappresenta le pagine.
 *
 * Le coordinate sono quelle del PDF: origine in basso a sinistra, `y` cresce
 * verso l'alto, unità in punti tipografici.
 */
export interface PdfTextItem {
  text: string;
  x: number;
  y: number;
  width: number;
}

export interface PdfTextPage {
  /** Numero della pagina, da 1. */
  number: number;
  width: number;
  height: number;
  items: PdfTextItem[];
}

export interface PdfTextDocument {
  pages: PdfTextPage[];
}

/** Un cedolino non ha più pagine di così: oltre è un altro documento. */
export const MAX_PDF_PAGES = 10;

/** I primi byte di un PDF: la specifica tollera della spazzatura prima, entro 1024 byte. */
const PDF_SIGNATURE = Buffer.from('%PDF-');

export function hasPdfSignature(bytes: Uint8Array): boolean {
  return Buffer.from(bytes.buffer, bytes.byteOffset, Math.min(bytes.byteLength, 1024)).includes(
    PDF_SIGNATURE,
  );
}

type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs');
type PdfJsDocument = Awaited<ReturnType<PdfJs['getDocument']>['promise']>;

let loading: Promise<PdfJs> | null = null;

/**
 * `pdfjs-dist` viene caricato alla prima analisi, non all'avvio.
 *
 * Il worker è registrato su `globalThis` prima della libreria: così
 * `pdfjs-dist` lo esegue nello stesso processo invece di cercare un file da
 * avviare come worker, che nel bundle di produzione non esisterebbe.
 */
async function loadPdfJs(): Promise<PdfJs> {
  loading ??= (async () => {
    const worker: unknown = await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
    (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = worker;

    return import('pdfjs-dist/legacy/build/pdf.mjs');
  })();

  return loading;
}

function errorName(error: unknown): string {
  return typeof error === 'object' && error !== null && 'name' in error ? String(error.name) : '';
}

/**
 * Il messaggio per l'utente. Mai quello della libreria: è in inglese e
 * potrebbe ripetere frammenti del file.
 */
function unreadable(error: unknown): ValidationError {
  if (errorName(error) === 'PasswordException') {
    return new ValidationError('Il PDF è protetto da password: caricane una copia senza protezione.');
  }

  return new ValidationError('Il file non è un PDF valido oppure è danneggiato.');
}

/**
 * Estrae il testo di ogni pagina, con le coordinate.
 *
 * Tutto avviene in questo processo: il documento non lascia mai la macchina.
 * Nessun font viene caricato né cercato nel sistema: per leggere il testo
 * bastano le tabelle di codifica contenute nel file.
 */
export async function extractPdfText(bytes: Uint8Array): Promise<PdfTextDocument> {
  if (bytes.byteLength === 0) {
    throw new ValidationError('Il file è vuoto.');
  }
  if (!hasPdfSignature(bytes)) {
    throw new ValidationError('Il file non è un PDF.');
  }

  const pdfjs = await loadPdfJs();
  const loadingTask = pdfjs.getDocument({
    // Una copia: la libreria si appropria del buffer che riceve.
    data: new Uint8Array(bytes),
    disableFontFace: true,
    useSystemFonts: false,
    stopAtErrors: true,
    verbosity: 0,
  });

  let document: PdfJsDocument;
  try {
    document = await loadingTask.promise;
  } catch (error) {
    await loadingTask.destroy();
    throw unreadable(error);
  }

  try {
    if (document.numPages > MAX_PDF_PAGES) {
      throw new ValidationError(
        `Il PDF ha ${String(document.numPages)} pagine: un cedolino ne ha al massimo ${String(MAX_PDF_PAGES)}.`,
      );
    }

    const pages: PdfTextPage[] = [];
    for (let number = 1; number <= document.numPages; number++) {
      const page = await document.getPage(number);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();

      pages.push({
        number,
        width: viewport.width,
        height: viewport.height,
        items: content.items.flatMap((item) => {
          // Gli elementi senza `str` delimitano contenuti marcati: non sono testo.
          const text = 'str' in item ? item.str.trim() : '';
          if (!('str' in item) || text.length === 0) {
            return [];
          }

          const [, , , , x = 0, y = 0] = item.transform as number[];
          return [{ text, x, y, width: item.width }];
        }),
      });
    }

    return { pages };
  } catch (error) {
    throw error instanceof ValidationError ? error : unreadable(error);
  } finally {
    await loadingTask.destroy();
  }
}

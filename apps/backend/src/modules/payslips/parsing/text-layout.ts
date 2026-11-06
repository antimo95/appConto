import type { PdfTextItem, PdfTextPage } from './pdf-text.js';

/**
 * Strumenti per leggere una pagina come una griglia.
 *
 * Un cedolino è un modulo: il significato di un numero dipende dalla colonna
 * in cui sta, non dalle parole che lo precedono. Queste funzioni ricostruiscono
 * righe e colonne dalle coordinate, e non sanno nulla di un formato preciso.
 */

/** Una parola con la sua posizione. */
export interface Token {
  text: string;
  x: number;
  y: number;
  width: number;
}

/** Le parole che stanno alla stessa altezza, da sinistra a destra. */
export interface Row {
  y: number;
  tokens: Token[];
}

/** Due elementi più vicini di così in verticale stanno sulla stessa riga. */
const ROW_TOLERANCE = 2.5;

export function center(token: Pick<Token, 'x' | 'width'>): number {
  return token.x + token.width / 2;
}

/**
 * Spezza gli elementi in parole.
 *
 * La libreria che legge il PDF può restituire «Z00001 Retribuzione» come un
 * elemento solo oppure come due: lavorare per parole rende il parser
 * indifferente a quella scelta. La posizione di ogni parola si stima
 * ripartendo la larghezza dell'elemento in proporzione ai caratteri: basta a
 * distinguere colonne distanti decine di punti.
 */
export function tokenize(items: readonly PdfTextItem[]): Token[] {
  return items.flatMap((item) => itemTokens(item).map(({ token }) => token));
}

/** Le parole di un elemento, con la posizione stimata e dove stanno nel suo testo. */
function itemTokens(item: PdfTextItem): { token: Token; start: number; end: number }[] {
  const charWidth = item.text.length === 0 ? 0 : item.width / item.text.length;

  return [...item.text.matchAll(/\S+/g)].map((match) => ({
    token: {
      text: match[0],
      x: item.x + match.index * charWidth,
      y: item.y,
      width: match[0].length * charWidth,
    },
    start: match.index,
    end: match.index + match[0].length,
  }));
}

/** Le righe della pagina, dall'alto verso il basso. */
export function groupRows(tokens: readonly Token[]): Row[] {
  const sorted = [...tokens].sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: Row[] = [];

  for (const token of sorted) {
    const row = rows.at(-1);
    if (row !== undefined && Math.abs(row.y - token.y) <= ROW_TOLERANCE) {
      row.tokens.push(token);
    } else {
      rows.push({ y: token.y, tokens: [token] });
    }
  }

  for (const row of rows) {
    row.tokens.sort((a, b) => a.x - b.x);
  }

  return rows;
}

/**
 * Il testo ridotto alle sole lettere maiuscole, senza accenti.
 *
 * Le etichette prestampate arrivano in forme strane: alcuni generatori
 * codificano lo spazio con un glifo che la lettura restituisce come «s»
 * (`TOTALEsCOMPETENZE`), altri spezzano le lettere (`T OT ALE`). La chiave
 * compatta le riconduce tutte alla stessa sequenza.
 */
export function compactKey(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toUpperCase()
    .replace(/[^A-Z]/g, '');
}

/**
 * Se il testo è l'etichetta formata da `words`.
 *
 * Fra una parola e l'altra può comparire la «s» dello spazio mal codificato.
 * Il confronto è sull'intera etichetta: «TOTALE» non è «TOTALE COMPETENZE».
 */
export function isLabel(text: string, words: readonly string[]): boolean {
  return new RegExp(`^${words.join('S?')}$`).test(compactKey(text));
}

/**
 * Quante parole consecutive di un elemento si provano come etichetta.
 *
 * Le etichette più lunghe del modulo hanno tre parole; una in più lascia
 * margine a una parola spezzata in due.
 */
const MAX_WINDOW_TOKENS = 4;

/**
 * I tratti di parole consecutive dentro un elemento, come pseudo-elementi.
 *
 * pdfjs unisce in un solo elemento le parole vicine sulla stessa riga, quindi
 * un'etichetta può arrivare incollata a quella accanto («CodicesAzienda
 * RagionesSociale»). Ogni tratto porta il proprio testo e la posizione stimata
 * come in `tokenize`, così chi cerca «sotto l'etichetta» guarda sotto la
 * parola giusta e non sotto l'inizio dell'elemento. L'elemento intero è
 * escluso: è già un candidato per conto suo.
 */
function windowsOf(item: PdfTextItem, maxTokens: number): PdfTextItem[] {
  const tokens = itemTokens(item);
  const windows: PdfTextItem[] = [];

  for (let first = 0; first < tokens.length; first += 1) {
    const last = Math.min(tokens.length, first + maxTokens);
    for (let end = first + 1; end <= last; end += 1) {
      const from = tokens[first];
      const to = tokens[end - 1];
      if (from === undefined || to === undefined || (first === 0 && end === tokens.length)) {
        continue;
      }

      windows.push({
        text: item.text.slice(from.start, to.end),
        x: from.token.x,
        y: item.y,
        width: to.token.x + to.token.width - from.token.x,
      });
    }
  }

  return windows;
}

/**
 * Le etichette che un elemento è già per intero.
 *
 * `vocabulary` sono tutte le etichette che chi cerca conosce: un elemento che
 * è per intero un'altra etichetta non si spezza. «Residuo AP» è la colonna del
 * residuo dell'anno precedente, non la colonna «Residuo» seguita da «AP».
 */
function isOtherLabel(item: PdfTextItem, vocabulary: readonly (readonly string[])[]): boolean {
  return vocabulary.some((other) => isLabel(item.text, other));
}

/** Le opzioni della ricerca di un'etichetta. */
export interface LabelSearch {
  /** Le etichette conosciute: un elemento che è per intero una di loro non si cerca al suo interno. */
  vocabulary?: readonly (readonly string[])[];
}

function wholeLabels(page: PdfTextPage, words: readonly string[]): PdfTextItem[] {
  return page.items.filter((item) => isLabel(item.text, words));
}

function labelsInside(page: PdfTextPage, words: readonly string[], search: LabelSearch): PdfTextItem[] {
  const vocabulary = search.vocabulary ?? [];
  const maxTokens = Math.max(MAX_WINDOW_TOKENS, words.length);

  return page.items
    .filter((item) => !isLabel(item.text, words) && !isOtherLabel(item, vocabulary))
    .flatMap((item) => windowsOf(item, maxTokens).filter((window) => isLabel(window.text, words)));
}

/**
 * Le occorrenze dell'etichetta nella pagina.
 *
 * Prima gli elementi che sono l'etichetta per intero, poi i tratti dentro un
 * elemento più lungo: un'etichetta stampata da sola è la prova migliore, e chi
 * prende la prima occorrenza deve trovare quella.
 */
export function findLabels(page: PdfTextPage, words: readonly string[], search: LabelSearch = {}): PdfTextItem[] {
  return [...wholeLabels(page, words), ...labelsInside(page, words, search)];
}

/**
 * La prima occorrenza dell'etichetta.
 *
 * Gli elementi interi di tutte le pagine vengono prima dei tratti dentro un
 * elemento: un tratto a pagina uno non deve battere l'etichetta vera a pagina
 * due.
 */
export function findLabel(
  pages: readonly PdfTextPage[],
  words: readonly string[],
  search: LabelSearch = {},
): { page: PdfTextPage; label: PdfTextItem } | null {
  for (const find of [wholeLabels, (page: PdfTextPage) => labelsInside(page, words, search)]) {
    for (const page of pages) {
      const label = find(page, words)[0];
      if (label !== undefined) {
        return { page, label };
      }
    }
  }

  return null;
}

/** L'elemento più vicino a `target` fra quelli dati, o `null` se la lista è vuota. */
export function nearest<T>(candidates: readonly T[], distance: (candidate: T) => number): T | null {
  let best: T | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    const value = distance(candidate);
    if (value < bestDistance) {
      best = candidate;
      bestDistance = value;
    }
  }

  return best;
}

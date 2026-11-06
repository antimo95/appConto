import type { PdfTextDocument } from '../parsing/pdf-text.js';

/**
 * Un cedolino inventato, con la geometria del modello reale.
 *
 * Nessun dato viene da un cedolino vero: nomi, codici fiscali e importi sono
 * di fantasia, ma i conti tornano — competenze, trattenute, arrotondamento e
 * netto si chiudono al centesimo, e i saldi di ferie e permessi rispettano
 * maturato − goduto + residuo dell'anno precedente.
 *
 * La stessa descrizione produce due cose: il documento già estratto, per i
 * test del parser, e un PDF vero, per i test che attraversano `pdfjs-dist` e
 * le API. Un solo punto da tenere allineato.
 *
 * Le etichette prestampate riproducono la stranezza del modello originale:
 * lo spazio arriva come una «s» (`TOTALEsCOMPETENZE`).
 */

/** `[y, x, testo]`: coordinate PDF, origine in basso a sinistra. */
export type FixtureLine = readonly [number, number, string];

export interface FixtureOptions {
  /** Il periodo stampato, come lo scrive il cedolino: `Ottobre 2026`. */
  month?: string;
  /** Aggiunge o sostituisce righe della pagina delle voci. */
  edit?: (lines: FixtureLine[]) => FixtureLine[];
}

/** Larghezza media di un carattere a corpo 8: basta a stimare i centri delle colonne. */
export const FIXTURE_CHAR_WIDTH = 4.2;
export const FIXTURE_FONT_SIZE = 8;

function calendarPage(month: string): FixtureLine[] {
  return [
    [804.4, 84.8, 'Esempio Lavoro S.r.l.'],
    [728.5, 430.5, month],
    [700, 30, 'LU 1 8,00'],
    [520, 40, 'Ore ordinarie 168,00hm'],
  ];
}

function itemsPage(month: string): FixtureLine[] {
  return [
    // Testata
    [813.3, 26.8, 'CodicesAzienda'],
    [813.3, 86.3, 'RagionesSociale'],
    [804.5, 25.4, '000099'],
    [804.4, 84.8, 'Esempio Lavoro S.r.l.'],
    [739.4, 433.4, 'PERIODOsDIsRETRIBUZIONE'],
    [728.5, 430.5, month],
    [704.1, 98.2, 'COGNOMEsEsNOME'],
    [695.0, 99.0, 'ROSSI MARIO'],
    [694.8, 448.8, 'RSSMRA80A01H501U'],
    [657.2, 182.2, 'LAVORATO'],
    [652.6, 182.3, 'Ore ordinarie'],
    [652.6, 232.7, 'Ore straordinarie'],
    [642.8, 60.0, '26'],
    [642.8, 180.8, '168,00'],
    [572.4, 524.9, '2.100,00000'],
    [583.2, 519.7, 'TOTALE'],

    // Intestazioni delle voci
    [559.3, 86.3, 'VOCIsVARIABILIsDELsMESE'],
    [558.9, 251.3, 'IMPORTOsBASE'],
    [558.9, 352.3, 'RIFERIMENTO'],
    [558.9, 448.1, 'TRATTENUTE'],
    [558.9, 517.8, 'COMPETENZE'],

    // Voci del mese
    [546.0, 25.3, '* * Z00001 Retribuzione'],
    [545.8, 281.1, '12,50000'],
    [545.8, 363.9, '168,00000 ORE'],
    [545.9, 537.4, '2.100,00'],

    [535.6, 38.7, 'ZP9960 Arrotond. mese pr.'],
    [535.5, 477.6, '0,40'],

    [514.8, 38.7, 'Z20018 T.F.R. trasferito'],
    [514.9, 135.1, 'FONDO'],
    [514.7, 290.4, '145,00'],
    [514.7, 363.9, '100,00000'],
    [514.8, 404.0, '%'],
    [514.7, 462.6, '('],
    [514.7, 468.7, '145,00'],
    [514.7, 494.9, ')'],

    [504.4, 38.7, 'Z31270 Contributo SANITARIO c/ditta'],
    [504.4, 270.0, 'C/Ditta'],
    [504.3, 541.7, '('],
    [504.3, 548.5, '12,00'],
    [504.3, 570.9, ')'],

    [494.0, 25.3, '*'],
    [494.0, 38.7, 'Z00000 Contributo IVS'],
    [493.9, 283.7, '2.100,00'],
    [493.9, 372.8, '9,19000'],
    [494.0, 404.0, '%'],
    [493.9, 468.7, '192,99'],

    [473.2, 38.7, 'F02000 Imponibile IRPEF'],
    [473.1, 283.7, '1.907,01'],
    [462.8, 38.7, 'F02010 IRPEF lorda'],
    [462.7, 290.4, '438,96'],
    [452.4, 38.7, 'F02500 Detrazioni lav.dip.'],
    [452.3, 290.4, '150,00'],
    [442.0, 38.7, 'F02703 Indennità L.207/24'],
    [441.9, 548.5, '80,00'],
    [431.6, 38.7, 'F03020 Ritenute IRPEF'],
    [431.5, 468.7, '288,96'],

    [410.7, 68.6, 'Retribuzione utile T.F.R.'],
    [410.7, 282.8, '2.100,00'],
    [400.3, 68.6, 'Imp. INAIL'],
    [400.3, 283.7, '2.100,00'],
    [400.3, 322.3, 'Voce Tariffa'],
    [400.3, 378.3, '0722'],

    // Piede: la nota del modello sta dentro la fascia delle voci, ma non ha importi.
    [239.6, 22.1, 'sModellospersprocedure sdellasESEMPIOsRIPRODUZIONEsVIETATA'],
    [225.1, 28.2, 'CONGUAGLIO'],
    [190.1, 28.2, 'PROGRESSIVI'],
    [186.8, 92.1, 'Imp. INPS'],
    [174.0, 98.8, '6.300,00'],
    [161.1, 408.4, 'TFR a fondi'],
    [150.0, 425.4, '435,00'],

    // Ratei e totali
    [139.1, 28.2, 'RATEI'],
    [138.2, 423.0, 'TOTALEsCOMPETENZE'],
    [136.4, 546.8, '2.180,00'],
    [131.7, 122.3, 'Maturato'],
    [131.7, 188.0, 'Goduto'],
    [131.7, 252.0, 'Residuo'],
    [131.7, 316.6, 'Residuo AP'],
    [125.3, 423.6, 'TOTALEsTRATTENUTE'],
    [123.6, 553.4, '482,35'],
    [120.7, 30.3, 'FERIE'],
    [121.3, 122.3, '13,33333'],
    [121.3, 188.0, '8,00000'],
    [121.3, 252.0, '45,50000'],
    [121.3, 316.6, '40,16667'],
    [121.3, 373.7, 'ORE'],
    [113.3, 424.6, 'ARROTONDAMENTO'],
    [111.6, 562.3, '0,35'],
    [110.3, 30.3, 'Perm.P.A.R'],
    [110.9, 122.3, '6,00000'],
    [110.9, 188.0, '4,00000'],
    [110.9, 252.0, '2,00000'],
    [110.9, 373.7, 'ORE'],
    [105.9, 487.4, 'NETTOsDELsMESE'],
    [93.5, 510.2, '1.698,00 €'],
    [82.4, 28.2, 'COMUNICAZIONI'],
  ];
}

/** Le pagine del cedolino sintetico: presenze, poi voci e totali. */
export function syntheticPayslipPages(options: FixtureOptions = {}): FixtureLine[][] {
  const month = options.month ?? 'Ottobre 2026';
  const lines = itemsPage(month);

  return [calendarPage(month), options.edit === undefined ? lines : options.edit(lines)];
}

/** Il documento come lo restituirebbe l'estrazione del testo. */
export function syntheticPayslipDocument(options: FixtureOptions = {}): PdfTextDocument {
  return {
    pages: syntheticPayslipPages(options).map((lines, index) => ({
      number: index + 1,
      width: 595,
      height: 842,
      items: lines.map(([y, x, text]) => ({ text, x, y, width: text.length * FIXTURE_CHAR_WIDTH })),
    })),
  };
}

/** Testo PDF: parentesi e barre rovesciate vanno protette. */
function pdfString(text: string): string {
  return text.replace(/[\\()]/g, (char) => `\\${char}`);
}

/**
 * Un PDF vero, minimo, con il testo nelle posizioni indicate.
 *
 * Helvetica non incorporato, codifica WinAnsi: le lettere accentate passano
 * come byte Latin-1. Le pagine senza righe producono un PDF senza testo — la
 * forma di una scansione.
 */
export function buildPdf(pages: readonly (readonly FixtureLine[])[]): Buffer {
  const objects: string[] = [];
  const add = (body: string): number => {
    objects.push(body);
    return objects.length;
  };

  const catalog = add('');
  const pageTree = add('');
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');

  const pageIds = pages.map((lines) => {
    const content = lines
      .map(
        ([y, x, text]) =>
          `BT /F1 ${String(FIXTURE_FONT_SIZE)} Tf 1 0 0 1 ${String(x)} ${String(y)} Tm (${pdfString(text)}) Tj ET`,
      )
      .join('\n');
    const stream = add(
      `<< /Length ${String(Buffer.byteLength(content, 'latin1'))} >>\nstream\n${content}\nendstream`,
    );

    return add(
      `<< /Type /Page /Parent ${String(pageTree)} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${String(font)} 0 R >> >> /Contents ${String(stream)} 0 R >>`,
    );
  });

  objects[catalog - 1] = `<< /Type /Catalog /Pages ${String(pageTree)} 0 R >>`;
  objects[pageTree - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${String(id)} 0 R`).join(' ')}] /Count ${String(pageIds.length)} >>`;

  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body, 'latin1'));
    body += `${String(index + 1)} 0 obj\n${object}\nendobj\n`;
  });

  const xref = Buffer.byteLength(body, 'latin1');
  body += `xref\n0 ${String(objects.length + 1)}\n0000000000 65535 f \n`;
  body += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  body += `trailer\n<< /Size ${String(objects.length + 1)} /Root ${String(catalog)} 0 R >>\nstartxref\n${String(xref)}\n%%EOF\n`;

  return Buffer.from(body, 'latin1');
}

/** Il cedolino sintetico come PDF. Cambiare il mese cambia anche l'hash del file. */
export function syntheticPayslipPdf(options: FixtureOptions = {}): Buffer {
  return buildPdf(syntheticPayslipPages(options));
}

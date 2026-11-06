import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { syntheticPayslipDocument, type FixtureLine } from '../testing/payslip-fixtures.js';
import { extractPayslip } from './payslip-parser.js';
import { PAYSLIP_PARSERS } from './parsers.js';
import { zucchettiLulParser } from './zucchetti-lul.parser.js';

const extract = (edit?: (lines: FixtureLine[]) => FixtureLine[]) =>
  extractPayslip(syntheticPayslipDocument(edit === undefined ? {} : { edit }), PAYSLIP_PARSERS);

/** Toglie le righe il cui testo soddisfa il predicato. */
const without =
  (predicate: (text: string) => boolean) =>
  (lines: FixtureLine[]): FixtureLine[] =>
    lines.filter(([, , text]) => !predicate(text));

/** Sostituisce il testo di una riga. */
const replacing =
  (from: string, to: string) =>
  (lines: FixtureLine[]): FixtureLine[] =>
    lines.map(([y, x, text]) => [y, x, text === from ? to : text] as const);

describe('parser del cedolino (formato iniziale)', () => {
  it('riconosce il formato', () => {
    assert.equal(zucchettiLulParser.canParse(syntheticPayslipDocument()), true);
  });

  it('legge periodo, datore di lavoro, totali e netto in centesimi', () => {
    const result = extract();

    assert.equal(result.parserId, 'zucchetti-lul/1');
    assert.equal(result.status, 'complete');
    assert.equal(result.confidence, 'high', JSON.stringify(result.warnings));
    assert.deepEqual(result.warnings, []);

    const { draft } = result;
    assert.equal(draft.period, '2026-10');
    assert.equal(draft.employer, 'Esempio Lavoro S.r.l.');
    assert.equal(draft.totalEarningsCents, 218000);
    assert.equal(draft.totalDeductionsCents, 48235);
    assert.equal(draft.roundingCents, 35);
    assert.equal(draft.netCents, 169800);
    assert.equal(draft.taxableInpsCents, 210000);
    assert.equal(draft.taxableIrpefCents, 190701);
    assert.equal(draft.workedHours, 168);
  });

  it('assegna ogni voce alla colonna in cui sta il suo importo', () => {
    const { items } = extract().draft;
    const byCode = (code: string) => items.find((item) => item.code === code);

    assert.deepEqual(byCode('Z00001'), {
      code: 'Z00001',
      description: 'Retribuzione',
      section: 'earning',
      amountCents: 210000,
      quantity: 168,
      unit: 'ORE',
    });
    assert.equal(byCode('ZP9960')?.section, 'deduction');
    assert.equal(byCode('ZP9960')?.amountCents, 40);
    assert.equal(byCode('Z00000')?.section, 'deduction');
    assert.equal(byCode('Z00000')?.amountCents, 19299);
    assert.equal(byCode('Z00000')?.quantity, 9.19);
    assert.equal(byCode('Z00000')?.unit, '%');
    assert.equal(byCode('F02703')?.description, 'Indennità L.207/24');
    assert.equal(byCode('F02703')?.section, 'earning');
    assert.equal(byCode('F03020')?.section, 'deduction');
  });

  it('gli importi fra parentesi sono contributi figurativi dell\'azienda', () => {
    const { items } = extract().draft;

    const tfr = items.find((item) => item.code === 'Z20018');
    assert.equal(tfr?.section, 'employer_contribution');
    assert.equal(tfr?.description, 'T.F.R. trasferito FONDO');
    assert.equal(tfr?.amountCents, 14500);

    const sanitario = items.find((item) => item.code === 'Z31270');
    assert.equal(sanitario?.section, 'employer_contribution');
    assert.equal(sanitario?.amountCents, 1200);
  });

  it('una parentesi nella descrizione non rende figurativa la voce', () => {
    const { items } = extract(replacing('F02703 Indennità L.207/24', 'F02703 Indennità (L.207/24)')).draft;
    const indennita = items.find((item) => item.code === 'F02703');

    assert.equal(indennita?.description, 'Indennità (L.207/24)');
    assert.equal(indennita?.section, 'earning');
    assert.equal(indennita?.amountCents, 8000);
  });

  it('le righe senza competenze né trattenute sono informative, anche senza codice', () => {
    const { items } = extract().draft;
    const informative = items.filter((item) => item.section === 'informational');

    assert.deepEqual(
      informative.map((item) => [item.code, item.description, item.amountCents]),
      [
        ['F02000', 'Imponibile IRPEF', 190701],
        ['F02010', 'IRPEF lorda', 43896],
        ['F02500', 'Detrazioni lav.dip.', 15000],
        [null, 'Retribuzione utile T.F.R.', 210000],
        [null, 'Imp. INAIL', 210000],
      ],
    );
  });

  it('non prende per voci le righe fuori dalla fascia delle voci', () => {
    const descriptions = extract().draft.items.map((item) => item.description);

    assert.equal(descriptions.length, 12);
    assert.ok(!descriptions.some((text) => /Modello|INPS|TFR a fondi/.test(text)));
  });

  it('legge ferie e P.A.R. come saldi di fine mese', () => {
    assert.deepEqual(extract().draft.leaveBalances, [
      { type: 'FERIE', accrued: 13.33333, used: 8, remaining: 45.5, unit: 'ORE' },
      { type: 'PAR', accrued: 6, used: 4, remaining: 2, unit: 'ORE' },
    ]);
  });

  it('un residuo negativo resta negativo', () => {
    const result = extract((lines) =>
      replacing('45,50000', '-34,83334')(replacing('40,16667', '-40,16667')(lines)),
    );

    const ferie = result.draft.leaveBalances.find((balance) => balance.type === 'FERIE');
    assert.equal(ferie?.remaining, -34.83334);
    assert.ok(!result.warnings.some((warning) => warning.code === 'leave-mismatch'));
  });
});

/**
 * Etichette fuse: pdfjs-dist unisce in un solo elemento di testo le parole
 * vicine sulla stessa riga. Un'etichetta può quindi arrivare incollata a
 * quella accanto, e va riconosciuta anche dentro l'elemento, con la propria
 * posizione orizzontale.
 */
describe('etichette fuse dall\'estrazione del testo', () => {
  /** Sostituisce le righe indicate con un solo elemento, nella posizione data. */
  const merging =
    (texts: readonly string[], merged: FixtureLine) =>
    (lines: FixtureLine[]): FixtureLine[] => [
      ...lines.filter(([, , text]) => !texts.includes(text)),
      merged,
    ];

  it('il datore di lavoro si legge anche se "Codice Azienda" e "Ragione Sociale" sono un solo elemento', () => {
    const result = extract(
      merging(['CodicesAzienda', 'RagionesSociale'], [813.3, 26.8, 'CodicesAzienda RagionesSociale']),
    );

    assert.equal(result.draft.employer, 'Esempio Lavoro S.r.l.');
    // Il codice azienda, sotto la prima metà dell'elemento, non è il datore di lavoro.
    assert.notEqual(result.draft.employer, '000099');
  });

  it('il periodo si legge sotto la sua etichetta anche se è fusa con quella che la precede', () => {
    const result = extract(
      merging(['PERIODOsDIsRETRIBUZIONE'], [739.4, 360.0, 'Matricola PERIODOsDIsRETRIBUZIONE']),
    );

    assert.equal(result.draft.period, '2026-10');
    // Letto sotto l'etichetta, non dedotto dal resto del testo.
    assert.ok(
      !result.warnings.some((warning) => warning.code === 'period-inferred'),
      JSON.stringify(result.warnings),
    );
  });

  it('il datore di lavoro e il periodo restano quelli di sempre con le etichette separate', () => {
    const { draft } = extract();

    assert.equal(draft.employer, 'Esempio Lavoro S.r.l.');
    assert.equal(draft.period, '2026-10');
  });
});

describe('dati mancanti o ambigui', () => {
  it('un totale mancante resta null e rende l\'estrazione incompleta', () => {
    const result = extract(without((text) => text === '2.180,00'));

    assert.equal(result.draft.totalEarningsCents, null);
    assert.equal(result.status, 'incomplete');
    assert.equal(result.confidence, 'low');
    assert.ok(
      result.warnings.some(
        (warning) => warning.code === 'missing-field' && warning.field === 'totalEarningsCents',
      ),
    );
  });

  it('un importo illeggibile non viene indovinato', () => {
    const result = extract(replacing('1.698,00 €', '1.698,0O €'));

    assert.equal(result.draft.netCents, null);
    assert.equal(result.status, 'incomplete');
  });

  it('un importo con decimali oltre il centesimo è segnalato come illeggibile', () => {
    const result = extract(replacing('482,35', '482,35512'));

    assert.equal(result.draft.totalDeductionsCents, null);
    assert.ok(result.warnings.some((warning) => warning.code === 'unreadable-amount'));
  });

  it('se i conti non tornano la confidenza scende, ma nessun valore viene corretto', () => {
    const result = extract(replacing('1.698,00 €', '1.700,00 €'));

    assert.equal(result.status, 'complete');
    assert.equal(result.confidence, 'medium');
    assert.equal(result.draft.netCents, 170000);
    assert.ok(result.warnings.some((warning) => warning.code === 'net-mismatch'));
  });

  it('una voce persa fa scattare il controllo sulla somma delle competenze', () => {
    const result = extract(without((text) => text === '80,00'));

    assert.ok(result.warnings.some((warning) => warning.code === 'earnings-mismatch'));
  });

  it('senza l\'etichetta del periodo lo deduce dal testo, e lo dice', () => {
    const result = extract(without((text) => text === 'PERIODOsDIsRETRIBUZIONE'));

    assert.equal(result.draft.period, '2026-10');
    assert.ok(result.warnings.some((warning) => warning.code === 'period-inferred'));
  });

  it('due mesi diversi nel documento rendono il periodo indeterminabile', () => {
    const result = extract((lines) => [
      ...without((text) => text === 'PERIODOsDIsRETRIBUZIONE')(lines),
      [60, 30, 'Conguaglio di Settembre 2026'],
    ]);

    assert.equal(result.draft.period, null);
    assert.equal(result.status, 'incomplete');
    assert.ok(result.warnings.some((warning) => warning.code === 'period-ambiguous'));
  });

  it('un saldo letto a metà non viene completato a mano dal parser', () => {
    const result = extract(without((text) => text === '2,00000'));

    assert.deepEqual(
      result.draft.leaveBalances.map((balance) => balance.type),
      ['FERIE'],
    );
    assert.ok(result.warnings.some((warning) => warning.code === 'leave-incomplete'));
  });

  it('un residuo che non torna con maturato e goduto è segnalato', () => {
    const result = extract(replacing('2,00000', '3,00000'));

    assert.ok(result.warnings.some((warning) => warning.code === 'leave-mismatch'));
  });
});

describe('documenti non riconosciuti', () => {
  it('un PDF senza testo è una scansione: niente valori, revisione manuale', () => {
    const result = extractPayslip({ pages: [{ number: 1, width: 595, height: 842, items: [] }] }, PAYSLIP_PARSERS);

    assert.equal(result.status, 'unrecognized');
    assert.equal(result.parserId, null);
    assert.equal(result.draft.netCents, null);
    assert.deepEqual(result.draft.items, []);
    assert.equal(result.warnings[0]?.code, 'no-text');
  });

  it('un documento di altro formato non viene letto', () => {
    const result = extractPayslip(
      {
        pages: [
          {
            number: 1,
            width: 595,
            height: 842,
            items: [{ text: 'Fattura n. 123 del 01/10/2026 totale 100,00', x: 30, y: 700, width: 200 }],
          },
        ],
      },
      PAYSLIP_PARSERS,
    );

    assert.equal(result.status, 'unrecognized');
    assert.equal(result.warnings[0]?.code, 'unknown-format');
  });

  it('un parser che fallisce non fa fallire l\'analisi', () => {
    const result = extractPayslip(syntheticPayslipDocument(), [
      {
        id: 'guasto/1',
        canParse: () => true,
        parse: () => {
          throw new Error('dettaglio che non deve uscire');
        },
      },
    ]);

    assert.equal(result.status, 'unrecognized');
    assert.equal(result.warnings[0]?.code, 'parser-failure');
    assert.ok(!JSON.stringify(result).includes('dettaglio'));
  });
});

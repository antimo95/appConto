import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isItalianNumber, parseItalianCents, parseItalianDecimal } from './italian-numbers.js';

describe('importi del cedolino in centesimi', () => {
  it('legge migliaia e decimali senza passare dalla virgola mobile', () => {
    assert.equal(parseItalianCents('2.211,43'), 221143);
    assert.equal(parseItalianCents('1.803,00'), 180300);
    assert.equal(parseItalianCents('0,98'), 98);
    assert.equal(parseItalianCents('1.234.567,89'), 123456789);
  });

  it('accetta un solo decimale e gli zeri oltre il secondo', () => {
    assert.equal(parseItalianCents('12,5'), 1250);
    assert.equal(parseItalianCents('2.211,43000'), 221143);
  });

  it('non arrotonda: una cifra significativa oltre il centesimo non è un importo', () => {
    assert.equal(parseItalianCents('12,78283'), null);
  });

  it('riconosce il segno meno davanti o in coda', () => {
    assert.equal(parseItalianCents('-0,57'), -57);
    assert.equal(parseItalianCents('0,57-'), -57);
    assert.equal(parseItalianCents('-0,00'), 0);
  });

  it('rifiuta ciò che non è un importo invece di indovinarlo', () => {
    for (const testo of ['0722', '30', 'abc', '1.80,00', '1,2,3', '-1,00-', '', '€ 10,00', '10.00']) {
      assert.equal(parseItalianCents(testo), null, testo);
    }
  });
});

describe('quantità del cedolino', () => {
  it('legge ore, percentuali e saldi negativi', () => {
    assert.equal(parseItalianDecimal('173,00000'), 173);
    assert.equal(parseItalianDecimal('9,19000'), 9.19);
    assert.equal(parseItalianDecimal('-40,00000'), -40);
    assert.equal(parseItalianDecimal('12,78283'), 12.78283);
  });

  it('isItalianNumber distingue numeri e codici', () => {
    assert.equal(isItalianNumber('176,00'), true);
    assert.equal(isItalianNumber('Z00001'), false);
    assert.equal(isItalianNumber('0722'), false);
  });
});

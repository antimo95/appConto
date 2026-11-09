import { parseAmount } from './amount';

/**
 * La lettura di un importo digitato a mano.
 *
 * Il punto delicato è il punto: `1.234` sono mille e rotti, `0.500` è mezzo euro.
 * Un gruppo di migliaia non comincia mai per zero.
 */
describe('parseAmount', () => {
  it('un punto dopo lo zero è un decimale, non un separatore di migliaia', () => {
    expect(parseAmount('0.500')).toBe(0.5);
    expect(parseAmount('-0.125')).toBe(-0.125);
  });

  it('un punto con tre cifre dopo un numero non nullo raggruppa le migliaia', () => {
    expect(parseAmount('1.234')).toBe(1234);
    expect(parseAmount('12.345.678')).toBe(12345678);
  });

  it('legge sia 1.234,56 sia 1234.56', () => {
    expect(parseAmount('1.234,56')).toBe(1234.56);
    expect(parseAmount('1234.56')).toBe(1234.56);
  });

  it('vuoto e testo non numerico non sono importi', () => {
    expect(parseAmount('  ')).toBeNull();
    expect(parseAmount('abc')).toBeNull();
  });
});

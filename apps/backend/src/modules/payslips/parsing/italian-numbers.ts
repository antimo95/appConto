/**
 * I numeri come li stampa un cedolino italiano: `2.211,43`, `-40,00000`,
 * `0,98-`.
 *
 * Mai `parseFloat` sugli importi: le cifre si leggono come stringhe e si
 * ricompongono in centesimi interi, così `0,1 + 0,2` non può diventare
 * `0,30000000000000004` prima ancora di arrivare in archivio.
 *
 * La virgola decimale è obbligatoria. Un gruppo di sole cifre (`0722`, `30`)
 * su un cedolino è quasi sempre un codice o un conteggio di giorni: leggerlo
 * come importo significherebbe inventare denaro.
 */

const NUMBER_PATTERN = /^(-)?(\d{1,3}(?:\.\d{3})+|\d+),(\d{1,5})(-)?$/;

interface NumberParts {
  negative: boolean;
  integer: string;
  decimals: string;
}

function parts(text: string): NumberParts | null {
  const match = NUMBER_PATTERN.exec(text.trim());
  if (match === null) {
    return null;
  }

  const [, leadingMinus, integer = '', decimals = '', trailingMinus] = match;
  // Un segno da entrambe le parti non è un formato: è un errore di lettura.
  if (leadingMinus !== undefined && trailingMinus !== undefined) {
    return null;
  }

  return {
    negative: leadingMinus !== undefined || trailingMinus !== undefined,
    integer: integer.replaceAll('.', ''),
    decimals,
  };
}

/** Se il testo ha la forma di un numero italiano con decimali. */
export function isItalianNumber(text: string): boolean {
  return parts(text) !== null;
}

/**
 * Un importo in centesimi, oppure `null` se il testo non è un importo.
 *
 * Oltre il secondo decimale sono ammessi solo zeri (`2.211,43000`): una cifra
 * significativa al terzo decimale non è un importo in euro, e arrotondarla
 * sarebbe decidere al posto dell'utente.
 */
export function parseItalianCents(text: string): number | null {
  const parsed = parts(text);
  if (parsed === null) {
    return null;
  }

  const cents = parsed.decimals.padEnd(2, '0');
  if (!/^0*$/.test(cents.slice(2))) {
    return null;
  }

  const value = Number(parsed.integer) * 100 + Number(cents.slice(0, 2));
  if (!Number.isSafeInteger(value)) {
    return null;
  }

  return parsed.negative && value !== 0 ? -value : value;
}

/** Una quantità (ore, giorni, percentuali): non è denaro, resta decimale. */
export function parseItalianDecimal(text: string): number | null {
  const parsed = parts(text);
  if (parsed === null) {
    return null;
  }

  const value = Number(`${parsed.integer}.${parsed.decimals}`);
  if (!Number.isFinite(value)) {
    return null;
  }

  return parsed.negative && value !== 0 ? -value : value;
}

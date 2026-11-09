/**
 * Scala verticale di un grafico a linee.
 *
 * Gli estremi arrotondati a valori "tondi" e i valori delle linee guida sono una
 * funzione pura dei dati: stanno qui per poter essere verificati senza montare
 * il grafico.
 */

export interface ValueScale {
  min: number;
  max: number;
  /** Valori delle linee guida, dal basso verso l'alto. */
  ticks: number[];
}

/** Il passo "tondo" più vicino: 1, 2, 2,5 o 5 per una potenza di dieci. */
function niceStep(rough: number): number {
  const exponent = Math.floor(Math.log10(rough));
  const power = 10 ** exponent;
  const fraction = rough / power;

  if (fraction <= 1) {
    return power;
  }
  if (fraction <= 2) {
    return 2 * power;
  }
  if (fraction <= 2.5) {
    return 2.5 * power;
  }
  if (fraction <= 5) {
    return 5 * power;
  }

  return 10 * power;
}

/** Quota massima di asse che l'arrotondamento a un tick tondo può aggiungere oltre i dati. */
const MAX_OVERSHOOT = 0.1;
/** Margine lasciato sopra/sotto i dati quando non si arrotonda, in quota dell'intervallo. */
const PADDING = 0.04;

/**
 * La scala che contiene i valori indicati.
 *
 * Lo zero è sempre compreso: su una serie di importi nel tempo una base che non
 * parte da zero esagera le variazioni. Gli estremi si arrotondano al tick
 * tondo solo se lo spreco è contenuto; altrimenti (es. minimo -69 con passo
 * 5.000) l'asse segue i dati con un piccolo margine e le linee guida restano
 * quelle tonde che cadono dentro.
 */
export function niceScale(values: readonly number[], targetTicks = 4): ValueScale {
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);

  if (min === 0 && max === 0) {
    return { min: 0, max: 1, ticks: [0, 1] };
  }

  const step = niceStep((max - min) / Math.max(targetTicks, 1));
  const niceMin = Math.floor(min / step) * step;
  const niceMax = Math.ceil(max / step) * step;

  const niceSpan = niceMax - niceMin;
  const padding = (max - min) * PADDING;
  const tightMin = min < 0 && min - niceMin > niceSpan * MAX_OVERSHOOT ? min - padding : niceMin;
  const tightMax = max > 0 && niceMax - max > niceSpan * MAX_OVERSHOOT ? max + padding : niceMax;

  const ticks: number[] = [];
  // Il confronto con mezzo passo di margine tiene fuori gli errori di virgola mobile.
  for (let tick = niceMin; tick <= niceMax + step / 2; tick += step) {
    const rounded = Math.round(tick * 100) / 100;
    if (rounded >= tightMin && rounded <= tightMax) {
      ticks.push(rounded);
    }
  }

  return { min: tightMin, max: tightMax, ticks };
}

/**
 * La scala che segue i dati senza forzare lo zero.
 *
 * Serve a una serie che oscilla in una fascia stretta lontano da zero (es.
 * un netto mensile fra 1.638 e 1.818): con lo zero in vista la linea
 * sarebbe piatta. Il costo è che le variazioni appaiono ingrandite, perciò
 * si sceglie per asse, non come regola. Gli estremi sono sempre tick tondi
 * e i dati non li toccano mai: se un estremo cade esatto su un tick, l'asse
 * si allunga di un passo.
 */
export function fittedScale(values: readonly number[], targetTicks = 4): ValueScale {
  if (values.length === 0) {
    return { min: 0, max: 1, ticks: [0, 1] };
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;

  let step: number;
  let bottom: number;
  let top: number;

  if (span === 0) {
    // Un solo valore: un passo proporzionato e un tick tondo per lato.
    step = min === 0 ? 1 : niceStep(Math.abs(min) * 0.1);
    bottom = Math.floor(min / step) * step - step;
    top = Math.ceil(min / step) * step + step;
  } else {
    step = niceStep(span / Math.max(targetTicks, 1));
    bottom = Math.floor(min / step) * step;
    top = Math.ceil(max / step) * step;
    // La linea non deve toccare il bordo del grafico.
    if (Math.abs(bottom - min) < step * 1e-9) {
      bottom -= step;
    }
    if (Math.abs(top - max) < step * 1e-9) {
      top += step;
    }
  }

  const count = Math.round((top - bottom) / step);
  const ticks = Array.from({ length: count + 1 }, (_, index) =>
    Math.round((bottom + index * step) * 100) / 100
  );

  return { min: ticks[0] ?? bottom, max: ticks.at(-1) ?? top, ticks };
}

import { fittedScale, niceScale } from './value-scale';

describe('niceScale', () => {
  it('parte sempre da zero: una base diversa esagera le variazioni', () => {
    const scale = niceScale([1200, 1500, 1800]);

    expect(scale.min).toBe(0);
    expect(scale.max).toBeGreaterThanOrEqual(1800);
  });

  it('arrotonda gli estremi a valori tondi', () => {
    expect(niceScale([0, 1886.57]).max).toBe(2000);
    expect(niceScale([0, 37]).max).toBe(40);
    expect(niceScale([0, 4]).max).toBe(4);
  });

  it('le linee guida sono equidistanti e comprendono gli estremi', () => {
    const { min, max, ticks } = niceScale([0, 1886.57]);

    expect(ticks[0]).toBe(min);
    expect(ticks.at(-1)).toBe(max);

    const passi = ticks.slice(1).map((tick, index) => tick - (ticks[index] ?? 0));
    expect(new Set(passi.map((passo) => Math.round(passo * 100))).size).toBe(1);
  });

  it('comprende lo zero anche con valori negativi', () => {
    const scale = niceScale([-450, -120, 300]);

    expect(scale.min).toBeLessThanOrEqual(-450);
    expect(scale.max).toBeGreaterThanOrEqual(300);
    expect(scale.ticks).toContain(0);
  });

  it('tutto a zero resta una scala usabile', () => {
    expect(niceScale([0, 0, 0])).toEqual({ min: 0, max: 1, ticks: [0, 1] });
    expect(niceScale([])).toEqual({ min: 0, max: 1, ticks: [0, 1] });
  });

  it('produce un numero di linee guida ragionevole', () => {
    for (const massimo of [9, 87, 350, 1886.57, 12658.14, 250000]) {
      const ticks = niceScale([0, massimo]).ticks;

      expect(ticks.length).toBeGreaterThanOrEqual(3);
      expect(ticks.length).toBeLessThanOrEqual(8);
    }
  });

  it('non allunga l’asse fino al tick tondo se i dati ne restano lontani', () => {
    const scale = niceScale([-69, 4000, 9830]);

    // Prima il minimo diventava -5000: un terzo dell'altezza sprecato.
    expect(scale.min).toBeGreaterThanOrEqual(-600);
    expect(scale.min).toBeLessThan(-69);
    expect(scale.max).toBeGreaterThanOrEqual(9830);
    expect(scale.ticks).toEqual([0, 2500, 5000, 7500, 10000]);
  });

  it('con soli valori non negativi il minimo resta zero', () => {
    expect(niceScale([0, 120, 480]).min).toBe(0);
    expect(niceScale([300, 900]).min).toBe(0);
  });

  it('le linee guida cadono dentro l’intervallo dell’asse', () => {
    const { min, max, ticks } = niceScale([-69, 9830]);

    for (const tick of ticks) {
      expect(tick).toBeGreaterThanOrEqual(min);
      expect(tick).toBeLessThanOrEqual(max);
    }
  });
});

describe('fittedScale', () => {
  it('non forza lo zero e lascia i dati strettamente dentro i tick estremi', () => {
    const { min, max, ticks } = fittedScale([1638, 1698, 1818]);

    expect(min).toBeLessThanOrEqual(1638);
    expect(max).toBeGreaterThan(1818);
    expect(ticks[0]).toBeLessThanOrEqual(1638);
    expect(ticks.at(-1)).toBeGreaterThan(1818);
    expect(ticks[0]).toBe(min);
    expect(ticks.at(-1)).toBe(max);
    expect(min).toBeGreaterThan(0);
  });

  it('le linee guida crescono a passo tondo e restano fra 3 e 7', () => {
    const { ticks } = fittedScale([1638, 1698, 1818]);
    const passi = ticks.slice(1).map((tick, index) => tick - (ticks[index] ?? 0));

    expect(ticks.length).toBeGreaterThanOrEqual(3);
    expect(ticks.length).toBeLessThanOrEqual(7);
    expect(passi.every((passo) => passo > 0)).toBe(true);
    expect(new Set(passi).size).toBe(1);
    expect([1, 2, 2.5, 5]).toContain((passi[0] ?? 0) / 10 ** Math.floor(Math.log10(passi[0] ?? 1)));
  });

  it('un estremo che cade esattamente su un tick allunga l’asse di un passo', () => {
    const { min, max } = fittedScale([100, 200], 2);

    expect(min).toBeLessThan(100);
    expect(max).toBeGreaterThan(200);
  });

  it('con valori tutti uguali l’asse ha almeno tre linee guida attorno al valore', () => {
    const { min, max, ticks } = fittedScale([1698, 1698]);

    expect(ticks.length).toBeGreaterThanOrEqual(3);
    expect(min).toBeLessThan(1698);
    expect(max).toBeGreaterThan(1698);
  });

  it('un solo valore zero resta una scala con lo zero dentro', () => {
    const { min, max, ticks } = fittedScale([0, 0]);

    expect(ticks.length).toBeGreaterThanOrEqual(3);
    expect(min).toBeLessThan(0);
    expect(max).toBeGreaterThan(0);
  });

  it('funziona con soli valori negativi', () => {
    const { min, max, ticks } = fittedScale([-900, -700, -650]);

    expect(min).toBeLessThanOrEqual(-900);
    expect(max).toBeGreaterThan(-650);
    expect(ticks.length).toBeGreaterThanOrEqual(3);
    expect(ticks.slice(1).every((tick, index) => tick > (ticks[index] ?? 0))).toBe(true);
  });

  it('senza valori è la stessa scala di ripiego di niceScale', () => {
    expect(fittedScale([])).toEqual({ min: 0, max: 1, ticks: [0, 1] });
  });
});

import {
  CONFIDENCE_LABELS,
  EXTRACTION_STATUS_MESSAGES,
  LEAVE_LABELS,
  SECTION_LABELS,
  centsToEuros,
  centsToInput,
  eurosToCents,
  formatLeaveValue,
  formatQuantity,
  numberToInput,
  parseCents
} from './payslip-format';

describe('payslip-format', () => {
  it('converte centesimi in euro e viceversa', () => {
    expect(centsToEuros(123456)).toBe(1234.56);
    expect(eurosToCents(1234.56)).toBe(123456);
  });

  it('arrotonda al centesimo il rumore binario', () => {
    expect(eurosToCents(1.1)).toBe(110);
    expect(eurosToCents(19.99)).toBe(1999);
  });

  it("legge un importo digitato all'italiana o all'inglese", () => {
    expect(parseCents('1.234,56')).toBe(123456);
    expect(parseCents('1234.56')).toBe(123456);
    expect(parseCents('-40,5 €')).toBe(-4050);
  });

  it('un testo vuoto o illeggibile non è un importo', () => {
    expect(parseCents('')).toBeNull();
    expect(parseCents('abc')).toBeNull();
  });

  it('precompila gli importi con la virgola e senza migliaia', () => {
    expect(centsToInput(123456)).toBe('1234,56');
    expect(centsToInput(-500)).toBe('-5,00');
    expect(centsToInput(null)).toBe('');
    expect(parseCents(centsToInput(123456))).toBe(123456);
  });

  it('precompila i numeri non monetari con la virgola', () => {
    expect(numberToInput(7.5)).toBe('7,5');
    expect(numberToInput(null)).toBe('');
  });

  it("formatta quantità e residui all'italiana, col meno tipografico", () => {
    expect(formatQuantity(12345.5)).toBe('12.345,5');
    expect(formatLeaveValue(-40, 'ore')).toBe('−40 ore');
    expect(formatLeaveValue(10, 'giorni')).toBe('10 giorni');
    expect(formatLeaveValue(null, 'ore')).toBe('—');
  });

  it('ha le etichette italiane di sezioni, ferie e stati', () => {
    expect(SECTION_LABELS).toEqual({
      earning: 'Competenza',
      deduction: 'Trattenuta',
      employer_contribution: 'Contributo azienda',
      informational: 'Informativa'
    });
    expect(LEAVE_LABELS).toEqual({ FERIE: 'Ferie', PAR: 'P.A.R.' });
    expect(EXTRACTION_STATUS_MESSAGES.incomplete).toContain('incompleta');
    expect(CONFIDENCE_LABELS.low).toContain('bassa');
  });
});

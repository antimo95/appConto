import { HttpErrorResponse } from '@angular/common/http';
import { toErrorMessage } from './http-error';

const GENERIC = 'Si è verificato un errore imprevisto.';

describe('toErrorMessage', () => {
  it('restituisce il messaggio inviato dal backend', () => {
    const error = new HttpErrorResponse({ status: 409, error: { error: 'x' } });

    expect(toErrorMessage(error)).toBe('x');
  });

  it('con status 0 dice che il backend non è raggiungibile', () => {
    const error = new HttpErrorResponse({ status: 0 });

    expect(toErrorMessage(error)).toBe(
      "Backend non raggiungibile. Verifica che l'applicazione sia in esecuzione."
    );
  });

  it('il messaggio del backend vince anche con status 0', () => {
    const error = new HttpErrorResponse({ status: 0, error: { error: 'x' } });

    expect(toErrorMessage(error)).toBe('x');
  });

  it('un corpo senza messaggio dà il messaggio generico', () => {
    for (const body of [null, {}, { error: '' }, 'testo libero']) {
      const error = new HttpErrorResponse({ status: 500, error: body });

      expect(toErrorMessage(error)).toBe(GENERIC);
    }
  });

  it('un errore che non viene dal backend dà il messaggio generico', () => {
    expect(toErrorMessage(new Error('boom'))).toBe(GENERIC);
    expect(toErrorMessage('boom')).toBe(GENERIC);
    expect(toErrorMessage(undefined)).toBe(GENERIC);
  });
});

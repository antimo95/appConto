import type { ErrorRequestHandler, RequestHandler } from 'express';
import { DomainError, type DomainErrorCode } from '../errors.js';
import { logger } from '../logger.js';

const STATUS_BY_CODE: Record<DomainErrorCode, number> = {
  VALIDATION: 400,
  NOT_FOUND: 404,
  CONFLICT: 409,
};

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({ error: `Risorsa non trovata: ${req.method} ${req.originalUrl}` });
};

/**
 * Un corpo che non si riesce a leggere è colpa della richiesta, non del server.
 *
 * `express.json()` solleva un errore con uno `status` proprio quando il corpo
 * non è JSON valido, è troppo grande, o — in modalità strict — non è un oggetto
 * né un array. Senza questo riconoscimento quegli errori finivano nel ramo
 * generico e uscivano come **500**: al client veniva detto che il guasto era
 * del server, mentre era la sua richiesta a essere malformata.
 *
 * Il messaggio non viene ripetuto: quello di body-parser è in inglese e parla
 * di token e di byte. Quello che serve a chi chiama è la categoria.
 */
const BODY_PARSER_TYPES: ReadonlySet<string> = new Set([
  'entity.parse.failed',
  'entity.too.large',
  'charset.unsupported',
  'encoding.unsupported',
  'request.aborted',
  'request.size.invalid',
]);

function clientErrorStatus(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) {
    return null;
  }

  const fields = error as { type?: unknown; status?: unknown; statusCode?: unknown };
  const value = typeof fields.status === 'number' ? fields.status : fields.statusCode;
  if (typeof value !== 'number' || value < 400 || value >= 500) {
    return null;
  }

  if (typeof fields.type === 'string' && BODY_PARSER_TYPES.has(fields.type)) {
    return value;
  }

  // Ogni altro 4xx di Express (URL mal codificato, `send` 404/416) riceve per
  // ora la stessa risposta del corpo illeggibile: è il difetto D1, il cui
  // messaggio è contratto e si corregge solo con G7.
  return value;
}

/**
 * Unico punto in cui gli errori diventano risposte HTTP.
 */
export const errorHandler: ErrorRequestHandler = (error, req, res, next) => {
  // Risposta già iniziata (es. `res.download` interrotto): non si può più
  // scrivere uno status; Express chiude la connessione.
  if (res.headersSent) {
    logger.error(`Errore a risposta iniziata: ${req.method} ${req.originalUrl}`, error);
    next(error);
    return;
  }

  if (error instanceof DomainError) {
    res.status(STATUS_BY_CODE[error.code]).json({ error: error.message });
    return;
  }

  const client = clientErrorStatus(error);
  if (client !== null) {
    res.status(client).json({ error: 'Richiesta non valida: il corpo non è leggibile.' });
    return;
  }

  // URL completo, query compresa: scelta esplicita dell'utente (app locale).
  logger.error(`Errore non gestito: ${req.method} ${req.originalUrl}`, error);
  res.status(500).json({ error: 'Errore interno del server.' });
};

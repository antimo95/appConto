import { Router, json, raw } from 'express';
import { ValidationError } from '../../shared/errors.js';
import { queryParam, toSingle } from '../../shared/http/query-params.js';
import { MAX_PDF_BYTES, payslipsService, type PayslipsService } from './payslips.service.js';

/**
 * Le tre risorse della feature, ognuna col proprio router:
 *
 *   /payslip-analyses   il PDF letto e la bozza proposta, prima della conferma
 *   /payslips           i cedolini confermati
 *   /payslip-summaries  andamento e confronti, calcolati a ogni richiesta
 *
 * I nomi sono sostantivi: l'analisi è una risorsa che nasce con un POST e
 * muore con un DELETE, non un verbo nel percorso.
 */

/** Un identificativo mancante non è una risorsa inesistente: è una richiesta malformata. */
function required(value: string | undefined, what: string): string {
  if (value === undefined) {
    throw new ValidationError(`Identificativo ${what} mancante.`);
  }

  return value;
}

/** Il PDF arriva così com'è: `Content-Type: application/pdf`, nessun multipart. */
const pdfBody = raw({ type: 'application/pdf', limit: MAX_PDF_BYTES });

/** Un cedolino rivisto ha qualche decina di voci: un megabyte è abbondante. */
const jsonBody = json({ limit: '1mb' });

/** Il nome originale viaggia in un'intestazione, codificato come componente di URL. */
function fileNameHeader(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === undefined) {
    return null;
  }

  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export function createPayslipAnalysesRouter(service: Pick<PayslipsService, 'analyze' | 'discardAnalysis'>): Router {
  const router = Router();

  // POST /payslip-analyses — analizza il PDF, non crea il cedolino
  router.post('/', pdfBody, async (req, res) => {
    if (!Buffer.isBuffer(req.body)) {
      throw new ValidationError(
        'Il corpo della richiesta deve contenere il PDF con Content-Type "application/pdf".',
      );
    }

    res.status(201).json(await service.analyze(req.body, fileNameHeader(req.headers['x-file-name'])));
  });

  // DELETE /payslip-analyses/:id — l'utente ha annullato: l'analisi, PDF compreso, sparisce dalla memoria
  router.delete('/:id', (req, res) => {
    service.discardAnalysis(required(req.params.id, "dell'analisi"));
    res.status(204).end();
  });

  return router;
}

export function createPayslipsRouter(
  service: Pick<PayslipsService, 'list' | 'getById' | 'create' | 'update' | 'remove' | 'document'>,
): Router {
  const router = Router();

  // GET /payslips?from=YYYY-MM&to=YYYY-MM&sortDirection=asc|desc
  router.get('/', (req, res) => {
    res.json(
      service.list({
        from: toSingle(queryParam(req.query.from, 'from')),
        to: toSingle(queryParam(req.query.to, 'to')),
        sortDirection: toSingle(queryParam(req.query.sortDirection, 'sortDirection')),
      }),
    );
  });

  // GET /payslips/:id
  router.get('/:id', (req, res) => {
    res.json(service.getById(required(req.params.id, 'del cedolino')));
  });

  // GET /payslips/:id/document — il PDF originale, dall'archivio, mai in cache
  router.get('/:id/document', (req, res) => {
    const document = service.document(required(req.params.id, 'del cedolino'));

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="cedolino-${document.period}.pdf"`);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(document.content);
  });

  // POST /payslips — dai dati rivisti e dal riferimento all'analisi
  router.post('/', jsonBody, (req, res) => {
    res.status(201).json(service.create(req.body));
  });

  // PATCH /payslips/:id — correzione manuale di un cedolino confermato
  router.patch('/:id', jsonBody, (req, res) => {
    res.json(service.update(required(req.params.id, 'del cedolino'), req.body));
  });

  // DELETE /payslips/:id — righe e PDF insieme
  router.delete('/:id', (req, res) => {
    service.remove(required(req.params.id, 'del cedolino'));
    res.status(204).end();
  });

  return router;
}

export function createPayslipSummariesRouter(service: Pick<PayslipsService, 'summaries'>): Router {
  const router = Router();

  // GET /payslip-summaries?from=YYYY-MM&to=YYYY-MM
  router.get('/', (req, res) => {
    res.json(
      service.summaries({
        from: toSingle(queryParam(req.query.from, 'from')),
        to: toSingle(queryParam(req.query.to, 'to')),
      }),
    );
  });

  return router;
}

export const payslipAnalysesRouter = createPayslipAnalysesRouter(payslipsService);
export const payslipsRouter = createPayslipsRouter(payslipsService);
export const payslipSummariesRouter = createPayslipSummariesRouter(payslipsService);

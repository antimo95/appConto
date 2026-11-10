import { Router } from 'express';
import { queryParam } from '../../shared/http/query-params.js';
import { parseAnalyticsQuery } from './analytics.query.js';
import { analyticsService } from './analytics.service.js';

type AnalyticsService = Pick<typeof analyticsService, 'getAnalytics'>;

function createAnalyticsQuery(query: Record<string, unknown>) {
  return parseAnalyticsQuery({
    from: queryParam(query.from, 'from'),
    to: queryParam(query.to, 'to'),
    types: queryParam(query.types, 'types'),
    categoryIds: queryParam(query.categoryIds, 'categoryIds'),
    merchantIds: queryParam(query.merchantIds, 'merchantIds'),
    classification: queryParam(query.classification, 'classification'),
    granularity: queryParam(query.granularity, 'granularity'),
  });
}

export function createAnalyticsRouter(service: AnalyticsService = analyticsService): Router {
  const analyticsRouter = Router();
  // GET /analytics?from=&to=&types=&categoryIds=&merchantIds=&classification=
  analyticsRouter.get('/', (req, res) => {
    const query = createAnalyticsQuery(req.query);
    res.json(service.getAnalytics(query));
  });

  return analyticsRouter;
}

export const analyticsRouter = createAnalyticsRouter();

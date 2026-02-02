import express from 'express';
import * as Sentry from '@sentry/node';
import router from './routes';

const app = express();

app.use(express.json({ limit: '50mb' }));
app.use(router);

app.get('/debug-sentry', function mainHandler(req, res) {
  throw new Error('My first Sentry error!');
});

Sentry.setupExpressErrorHandler(app);

app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('[Error]', err);
  res.status(500).json({
    error: 'Internal server error',
    sentryId: (res as any).sentry
  });
});

export default app;

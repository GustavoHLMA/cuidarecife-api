import express from 'express';
import cors from 'cors';
import * as Sentry from '@sentry/node';
import router from './routes';

const app = express();

// CORS para permitir requests do frontend (web e mobile)
app.use(cors({
  origin: [
    'http://localhost:3000',
    'http://localhost:8081',
    'https://cuidarecife-estratificacao.vercel.app',
    // Permite conexões locais de túneis se existirem
    /https?:\/\/localhost:\d+/,
    /https?:\/\/.*\.ngrok-free\.app/
  ],
  credentials: true,
}));

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

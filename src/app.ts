import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import * as Sentry from '@sentry/node';
import router from './routes';

const app = express();

// SEGURANÇA: headers de proteção (X-Frame-Options, CSP, HSTS, etc.)
app.use(helmet());

// CORS para permitir requests do frontend (web e mobile)
const allowedOrigins: (string | RegExp)[] = [
  'http://localhost:3000',
  'http://localhost:8081',
  'https://cuidarecife-estratificacao.vercel.app',
  'https://cuidarecife-mobile.vercel.app',
];
// Em desenvolvimento, permite localhost em qualquer porta
if (process.env.NODE_ENV !== 'production') {
  allowedOrigins.push(/https?:\/\/localhost:\d+/);
}
// Origens extras via variável de ambiente (separadas por vírgula)
if (process.env.CORS_EXTRA_ORIGINS) {
  process.env.CORS_EXTRA_ORIGINS.split(',').forEach(o => allowedOrigins.push(o.trim()));
}

app.use(cors({
  origin: allowedOrigins,
  credentials: true,
}));

// SEGURANÇA: Rate limiting global (previne brute-force e DDoS)
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 200, // máximo 200 reqs por IP por janela
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas requisições. Tente novamente em alguns minutos.' },
});
app.use(globalLimiter);

// Rate limiting agressivo para rotas de autenticação (anti brute-force)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 10, // máximo 10 tentativas de login por IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas tentativas de login. Tente novamente em 15 minutos.' },
});
app.use('/auth', authLimiter);

// SEGURANÇA: body limit reduzido de 50mb para 5mb (previne DoS por payload)
app.use(express.json({ limit: '5mb' }));
app.use(router);

Sentry.setupExpressErrorHandler(app);

app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('[Error]', err);
  res.status(500).json({
    error: 'Internal server error',
    sentryId: (res as any).sentry
  });
});

export default app;

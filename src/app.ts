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
  windowMs: 5 * 60 * 1000, // 5 minutos
  max: 50, // máximo 50 tentativas de login por IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas tentativas de login. Tente novamente em 5 minutos.' },
});
app.use('/auth', authLimiter);

// Body limit: 50mb (suporta fotos de alta resolução para OCR)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(router);

Sentry.setupExpressErrorHandler(app);

app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('[Error]', err);
  
  if (err.type === 'entity.too.large') {
    return res.status(413).json({
      error: 'A foto enviada é muito pesada para o Doc ler. Tente afastar um pouquinho o celular ou enviar uma imagem mais leve.',
    });
  }

  res.status(500).json({
    error: 'Internal server error',
    sentryId: (res as any).sentry
  });
});

export default app;

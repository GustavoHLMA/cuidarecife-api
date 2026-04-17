import dotenv from 'dotenv';
dotenv.config(); // Must be called before any other imports that use env vars

import * as Sentry from '@sentry/node';

Sentry.init({
  dsn: process.env.SENTRY_DSN,

  // SEGURANÇA: desabilitado para não enviar dados sensíveis de pacientes (LGPD)
  sendDefaultPii: false,

  tracesSampleRate: 1.0,

  environment: process.env.NODE_ENV || 'development',
});

export default Sentry;

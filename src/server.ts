import './instrument';
import * as Sentry from '@sentry/node';
import * as path from 'path';

import app from './app';
import prisma from './db';
import { ragService } from './services';

const PORT = process.env.PORT || 3001;
const HOST = '0.0.0.0';

const server = app.listen(Number(PORT), HOST, async () => {
  console.log(`Server is running on http://${HOST}:${PORT}`);
  console.log('[Sentry] Error tracking initialized');

  // Inicializa o RAG com os protocolos de saúde
  try {
    const docsPath = path.resolve(__dirname, '..', 'docs');
    console.log('[RAG] Iniciando indexação de protocolos...');
    const result = await ragService.indexFolder(docsPath);
    console.log(`[RAG] Indexação completa: ${result.indexed} arquivos, ${ragService.getStatus().documentCount} chunks`);
  } catch (error) {
    console.warn('[RAG] Falha ao indexar protocolos (não crítico):', error);
  }
});

// Graceful shutdown
const shutdown = async (signal: string) => {
  console.log(`\n${signal} received. Closing server gracefully...`);

  server.close(async () => {
    console.log('HTTP server closed');

    try {
      await prisma.$disconnect();
      console.log('Database connection closed');
      process.exit(0);
    } catch (error) {
      console.error('Error during shutdown:', error);
      process.exit(1);
    }
  });

  // Force shutdown after 10 seconds
  setTimeout(() => {
    console.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

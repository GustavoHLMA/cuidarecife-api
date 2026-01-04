import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  log: process.env.NODE_ENV !== 'production' ? ['warn', 'error'] : [],
  errorFormat: process.env.NODE_ENV !== 'production' ? 'pretty' : 'colorless',
});

/**
 * Attempts to connect to the database with retry logic
 * @param maxRetries - Maximum number of connection attempts
 * @param delayMs - Initial delay between retries in milliseconds
 */
async function connectWithRetry(maxRetries = 5, delayMs = 3000): Promise<void> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await prisma.$connect();
      console.log('📦 Successfully connected with database');
      return;
    } catch (error: any) {
      const isLastAttempt = attempt === maxRetries;

      console.log(`❌ Connection attempt ${attempt}/${maxRetries} failed`);

      if (isLastAttempt) {
        console.error('❌ All connection attempts failed:', error.message);
        throw error;
      }

      // Exponential backoff: aumenta o delay a cada tentativa
      const currentDelay = delayMs * attempt;
      console.log(`⏳ Retrying in ${currentDelay / 1000}s...`);
      await new Promise(resolve => setTimeout(resolve, currentDelay));
    }
  }
}

// Inicia conexão com retry
connectWithRetry().catch((error) => {
  console.error('💥 Fatal: Could not connect to database after all retries');
  process.exit(1);
});

export default prisma;  
import { Pool, PoolClient } from 'pg';

// ============================================================
// Conexão separada para o banco do e-SUS PEC (somente leitura)
// Requer VPN ativa para acessar o host PEC.
// ============================================================

const isPecConfigured = !!(
  process.env.HOST_PEC &&
  process.env.BANCO_PEC &&
  process.env.USUARIO_PEC &&
  process.env.SENHA_PEC
);

let pecPool: Pool | null = null;

if (isPecConfigured) {
  pecPool = new Pool({
    host: process.env.HOST_PEC,
    database: process.env.BANCO_PEC,
    port: parseInt(process.env.PORTA_PEC || '5432', 10),
    user: process.env.USUARIO_PEC,
    password: process.env.SENHA_PEC,
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });

  // Configura o search_path do schema PEC em cada nova conexão
  pecPool.on('connect', (client: PoolClient) => {
    const schema = (process.env.SCHEMA_PEC || 'public').replace(/[^a-zA-Z0-9_]/g, '');
    client.query(`SET search_path TO "${schema}"`);
  });

  pecPool.on('error', (err) => {
    console.error('[PEC DB] Pool error (VPN ativa?):', err.message);
  });

  console.log(`[PEC DB] Pool configurado → ${process.env.HOST_PEC}:${process.env.PORTA_PEC}/${process.env.BANCO_PEC} (schema: ${process.env.SCHEMA_PEC})`);
} else {
  console.warn('[PEC DB] Variáveis PEC não configuradas. Usando dados mock como fallback.');
}

/**
 * Executa uma query contra o banco PEC.
 * Retorna null se o PEC não estiver configurado.
 */
export async function pecQuery<T = any>(text: string, params?: any[]): Promise<T[] | null> {
  if (!pecPool) return null;

  try {
    const result = await pecPool.query(text, params);
    return result.rows as T[];
  } catch (error: any) {
    console.error('[PEC DB] Query error:', error.message);
    throw error;
  }
}

/**
 * Testa a conexão com o banco PEC.
 * Retorna true se conectou, false caso contrário.
 */
export async function testPecConnection(): Promise<boolean> {
  if (!pecPool) return false;

  try {
    await pecPool.query('SELECT 1');
    console.log('[PEC DB] ✅ Conexão com banco PEC estabelecida!');
    return true;
  } catch (error: any) {
    console.error('[PEC DB] ❌ Falha ao conectar com banco PEC (VPN ativa?):', error.message);
    return false;
  }
}

/**
 * Encerra o pool de conexões PEC (para graceful shutdown)
 */
export async function closePecPool(): Promise<void> {
  if (pecPool) {
    await pecPool.end();
    console.log('[PEC DB] Pool encerrado.');
  }
}

export { pecPool, isPecConfigured };

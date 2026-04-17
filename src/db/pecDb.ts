import { Pool, PoolClient } from 'pg';

// ============================================================
// Conexão separada para o banco do e-SUS PEC (somente leitura)
// Requer VPN ativa para acessar o host PEC.
// SEGURANÇA: conexão forçada como READ-ONLY para impedir
// qualquer escrita acidental ou maliciosa no banco PEC.
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

  // SEGURANÇA: Configura CADA conexão como somente leitura + schema correto
  pecPool.on('connect', (client: PoolClient) => {
    const schema = (process.env.SCHEMA_PEC || 'public').replace(/[^a-zA-Z0-9_]/g, '');
    // Força read-only: qualquer INSERT/UPDATE/DELETE vai falhar
    client.query(`SET default_transaction_read_only = ON`);
    client.query(`SET search_path TO "${schema}"`);
  });

  pecPool.on('error', (err) => {
    console.error('[PEC DB] Pool error (VPN ativa?):', err.message);
  });

  console.log(`[PEC DB] Pool configurado (READ-ONLY) → ${process.env.HOST_PEC}:${process.env.PORTA_PEC}/${process.env.BANCO_PEC} (schema: ${process.env.SCHEMA_PEC})`);
} else {
  console.warn('[PEC DB] Variáveis PEC não configuradas. Usando dados mock como fallback.');
}

/**
 * Executa uma query contra o banco PEC (somente leitura).
 * Retorna null se o PEC não estiver configurado.
 * 
 * SEGURANÇA: 
 * - Conexão é read-only (SET default_transaction_read_only = ON)
 * - Apenas SELECT é permitido no nível da aplicação
 * - Cada acesso é logado para auditoria
 */
export async function pecQuery<T = any>(text: string, params?: any[]): Promise<T[] | null> {
  if (!pecPool) return null;

  // SEGURANÇA: bloqueia qualquer query que não seja SELECT
  const trimmed = text.trim().toUpperCase();
  if (!trimmed.startsWith('SELECT') && !trimmed.startsWith('WITH')) {
    console.error(`[PEC DB] [SECURITY] Query não-SELECT bloqueada: ${text.substring(0, 50)}...`);
    throw new Error('Apenas consultas SELECT são permitidas no banco PEC');
  }

  try {
    const start = Date.now();
    const result = await pecPool.query(text, params);
    const duration = Date.now() - start;
    
    // AUDITORIA: log de acesso a dados PEC (sem dados sensíveis)
    console.log(`[PEC DB] [AUDIT] Query executada: ${result.rowCount} rows, ${duration}ms`);
    
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

import { Response, NextFunction } from 'express';
import { AuthRequest } from './authMiddleware';

/**
 * SEGURANÇA: Middleware que restringe acesso SOMENTE a profissionais de saúde.
 * Dados sensíveis do PEC-eSUS (pacientes) NÃO podem ser acessados por
 * usuários comuns do app mobile.
 * 
 * Deve ser usado APÓS o authMiddleware padrão.
 */
export const professionalAuthMiddleware = (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): void => {
  const user = req.user as any;

  if (!user || user.role !== 'PROFESSIONAL') {
    console.warn(
      `[SECURITY] Tentativa de acesso a dados PEC por usuário não-profissional. ` +
      `userId=${user?.userId || 'unknown'}, role=${user?.role || 'none'}, ` +
      `ip=${req.ip}, path=${req.path}`
    );
    res.status(403).json({ 
      error: 'Acesso restrito a profissionais de saúde autorizados.' 
    });
    return;
  }

  next();
};

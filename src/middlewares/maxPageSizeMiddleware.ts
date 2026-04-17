import { Request, Response, NextFunction } from 'express';

/**
 * SEGURANÇA: Limita o tamanho máximo de página (pageSize) em endpoints paginados.
 * Previne data dumps (alguém pedindo pageSize=999999 para extrair todos os dados).
 * 
 * Se o pageSize do request exceder o máximo, ele é silenciosamente truncado.
 */
export function maxPageSizeMiddleware(maxSize: number = 50) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (req.query.pageSize) {
      const requested = parseInt(req.query.pageSize as string, 10);
      if (isNaN(requested) || requested < 1) {
        req.query.pageSize = '25'; // default seguro
      } else if (requested > maxSize) {
        req.query.pageSize = String(maxSize);
      }
    }
    next();
  };
}

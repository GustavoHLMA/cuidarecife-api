import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AuthRequest } from './authMiddleware';

export interface ExtendedAuthRequest extends AuthRequest {
  user?: {
    userId: string;
    email: string;
    microareas?: string[];
    unidades_saude?: string[];
    role?: string;
  };
}

export const optionalAuthMiddleware = (
  req: ExtendedAuthRequest,
  res: Response,
  next: NextFunction
): void => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next();
  }

  const token = authHeader.replace('Bearer ', '');

  try {
    const decoded = jwt.verify(
      token,
      process.env.JWT_ACCESS_SECRET as string
    ) as any;

    req.user = decoded;
  } catch (error) {
    // If token is invalid, just ignore it and proceed as unauthenticated
  }
  
  next();
};

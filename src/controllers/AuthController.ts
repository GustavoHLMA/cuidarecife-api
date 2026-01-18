import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { authRepository } from '../repositories/authRepository';
import { z } from 'zod';

const registerSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Invalid email format'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

const loginSchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(1, 'Password is required'),
});

export class AuthController {
  private generateAccessToken(userId: string, email: string): string {
    return jwt.sign(
      { userId, email },
      process.env.JWT_ACCESS_SECRET as string,
      { expiresIn: 900 } // 15 minutes in seconds
    );
  }

  private generateRefreshToken(userId: string, email: string): string {
    return jwt.sign(
      { userId, email },
      process.env.JWT_REFRESH_SECRET as string,
      { expiresIn: 604800 } // 7 days in seconds
    );
  }

  async register(req: Request, res: Response): Promise<Response> {
    try {
      const validatedData = registerSchema.parse(req.body);

      const existingUser = await authRepository.findByEmail(validatedData.email);
      if (existingUser) {
        return res.status(400).json({ error: 'Email already registered' });
      }

      const user = await authRepository.create(validatedData);

      return res.status(201).json({
        message: 'User created successfully',
        userId: user.id,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors[0].message });
      }
      console.error('Error registering user:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  async login(req: Request, res: Response): Promise<Response> {
    try {
      const validatedData = loginSchema.parse(req.body);

      const user = await authRepository.findByEmail(validatedData.email);
      if (!user) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      const isValidPassword = await authRepository.validatePassword(
        validatedData.password,
        user.password
      );
      if (!isValidPassword) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      const accessToken = this.generateAccessToken(user.id, user.email);
      const refreshToken = this.generateRefreshToken(user.id, user.email);

      await authRepository.updateRefreshToken(user.id, refreshToken);

      return res.json({
        accessToken,
        refreshToken,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
        },
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors[0].message });
      }
      console.error('Error logging in:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  async refreshToken(req: Request, res: Response): Promise<Response> {
    try {
      const { refreshToken } = req.body;

      if (!refreshToken) {
        return res.status(400).json({ error: 'Refresh token is required' });
      }

      let decoded: { userId: string; email: string };
      try {
        decoded = jwt.verify(
          refreshToken,
          process.env.JWT_REFRESH_SECRET as string
        ) as { userId: string; email: string };
      } catch {
        return res.status(401).json({ error: 'Invalid refresh token' });
      }

      const user = await authRepository.findById(decoded.userId);
      if (!user || user.refreshToken !== refreshToken) {
        return res.status(401).json({ error: 'Invalid refresh token' });
      }

      const newAccessToken = this.generateAccessToken(user.id, user.email);
      const newRefreshToken = this.generateRefreshToken(user.id, user.email);

      await authRepository.updateRefreshToken(user.id, newRefreshToken);

      return res.json({
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
      });
    } catch (error) {
      console.error('Error refreshing token:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  async logout(req: Request, res: Response): Promise<Response> {
    try {
      const { refreshToken } = req.body;

      if (refreshToken) {
        let decoded: { userId: string };
        try {
          decoded = jwt.verify(
            refreshToken,
            process.env.JWT_REFRESH_SECRET as string
          ) as { userId: string };
          await authRepository.updateRefreshToken(decoded.userId, null);
        } catch {
          // Token already invalid, proceed with logout
        }
      }

      return res.json({ message: 'Logged out successfully' });
    } catch (error) {
      console.error('Error logging out:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
}

import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { professionalRepository } from '../repositories/professionalRepository';
import { z } from 'zod';

const registerSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  cpf: z.string().min(11, 'Invalid CPF').max(14, 'Invalid CPF'),
  email: z.string().email('Invalid email format'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  microareas: z.array(z.string()).min(1, 'At least one microarea is required'),
});

const loginSchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(1, 'Password is required'),
});

export class ProfessionalAuthController {
  private generateAccessToken(userId: string, email: string, microareas: string[]): string {
    return jwt.sign(
      { userId, email, role: 'PROFESSIONAL', microareas },
      process.env.JWT_ACCESS_SECRET as string,
      { expiresIn: '8h' }
    );
  }

  async register(req: Request, res: Response): Promise<Response> {
    try {
      const validatedData = registerSchema.parse(req.body);

      const existingByEmail = await professionalRepository.findByEmail(validatedData.email);
      if (existingByEmail) {
        return res.status(400).json({ error: 'Email already registered' });
      }

      const existingByCpf = await professionalRepository.findByCpf(validatedData.cpf);
      if (existingByCpf) {
        return res.status(400).json({ error: 'CPF already registered' });
      }

      const user = await professionalRepository.create(validatedData);

      return res.status(201).json({
        message: 'Professional created successfully',
        userId: user.id,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors[0].message });
      }
      console.error('Error registering professional:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  async login(req: Request, res: Response): Promise<Response> {
    try {
      const validatedData = loginSchema.parse(req.body);

      const user = await professionalRepository.findByEmail(validatedData.email);
      if (!user) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      const isValidPassword = await professionalRepository.validatePassword(
        validatedData.password,
        user.password
      );
      if (!isValidPassword) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      const accessToken = this.generateAccessToken(user.id, user.email, user.microareas);

      return res.json({
        accessToken,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          cpf: user.cpf,
          microareas: user.microareas,
        },
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors[0].message });
      }
      console.error('Error logging in professional:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
}

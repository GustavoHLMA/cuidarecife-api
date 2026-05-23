import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { professionalRepository } from '../repositories/professionalRepository';
import { z } from 'zod';

const registerSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  cpf: z.string().min(11, 'Invalid CPF').max(14, 'Invalid CPF'),
  email: z.string().email('Formato de email inválido'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  microareas: z.array(z.string()).optional().default([]),
  unidades_saude: z.array(z.string()).optional().default([]),
  ine: z.string().optional().default(''),
});

const loginSchema = z.object({
  email: z.string().email('Formato de email inválido'),
  password: z.string().min(1, 'Password is required'),
});

const updateProfileSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').optional(),
  ine: z.string().optional(),
  password: z.string().min(6, 'Password must be at least 6 characters').optional(),
});

// Cache em memória para os códigos de recuperação de senha temporários
const resetCodes = new Map<string, { code: string; expires: number }>();

export class ProfessionalAuthController {
  private generateAccessToken(userId: string, email: string, microareas: string[], unidades_saude: string[], ine: string | null): string {
    return jwt.sign(
      { userId, email, role: 'PROFESSIONAL', microareas, unidades_saude, ine },
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
        return res.status(401).json({ error: 'Email ou senha inválidos' });
      }

      const isValidPassword = await professionalRepository.validatePassword(
        validatedData.password,
        user.password
      );
      if (!isValidPassword) {
        return res.status(401).json({ error: 'Email ou senha inválidos' });
      }

      const accessToken = this.generateAccessToken(user.id, user.email, user.microareas, user.unidades_saude, user.ine);

      return res.json({
        accessToken,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          cpf: user.cpf,
          microareas: user.microareas,
          unidades_saude: user.unidades_saude,
          ine: user.ine,
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

  async updateProfile(req: Request, res: Response): Promise<Response> {
    try {
      const authUser = (req as any).user;
      if (!authUser || !authUser.userId) {
        return res.status(401).json({ error: 'Não autorizado' });
      }

      const validatedData = updateProfileSchema.parse(req.body);

      const updateData: any = {};
      if (validatedData.name !== undefined) updateData.name = validatedData.name;
      if (validatedData.ine !== undefined) updateData.ine = validatedData.ine;
      if (validatedData.password !== undefined) updateData.password = validatedData.password;

      const updatedUser = await professionalRepository.update(authUser.userId, updateData);

      const accessToken = this.generateAccessToken(
        updatedUser.id,
        updatedUser.email,
        updatedUser.microareas,
        updatedUser.unidades_saude,
        updatedUser.ine
      );

      return res.json({
        message: 'Perfil atualizado com sucesso',
        accessToken,
        user: {
          id: updatedUser.id,
          name: updatedUser.name,
          email: updatedUser.email,
          cpf: updatedUser.cpf,
          microareas: updatedUser.microareas,
          unidades_saude: updatedUser.unidades_saude,
          ine: updatedUser.ine,
        },
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors[0].message });
      }
      console.error('Error updating professional profile:', error);
      return res.status(500).json({ error: 'Erro interno no servidor ao atualizar perfil' });
    }
  }

  async deleteAccount(req: Request, res: Response): Promise<Response> {
    try {
      const user = (req as any).user;
      if (!user || !user.userId) {
        return res.status(401).json({ error: 'Não autorizado' });
      }

      await professionalRepository.deleteProfessional(user.userId);

      return res.json({ message: 'Conta e dados deletados com sucesso' });
    } catch (error) {
      console.error('Error deleting professional account:', error);
      return res.status(500).json({ error: 'Erro interno no servidor ao deletar conta' });
    }
  }

  async forgotPassword(req: Request, res: Response): Promise<Response> {
    try {
      const { email } = req.body;
      if (!email) {
        return res.status(400).json({ error: 'E-mail é obrigatório' });
      }

      const user = await professionalRepository.findByEmail(email);
      if (!user) {
        return res.status(404).json({ error: 'Nenhum profissional cadastrado com este e-mail' });
      }

      const code = Math.floor(100000 + Math.random() * 900000).toString();
      const expires = Date.now() + 15 * 60 * 1000;

      resetCodes.set(email.toLowerCase(), { code, expires });

      console.log(`[RECOVERY CODE] Código de recuperação para ${email}: ${code}`);

      return res.json({
        message: 'Código de recuperação enviado com sucesso para seu e-mail corporativo',
        debugCode: code,
      });
    } catch (error) {
      console.error('Error in forgotPassword:', error);
      return res.status(500).json({ error: 'Erro interno no servidor ao solicitar recuperação' });
    }
  }

  async resetPassword(req: Request, res: Response): Promise<Response> {
    try {
      const { email, code, password } = req.body;
      if (!email || !code || !password) {
        return res.status(400).json({ error: 'E-mail, código e nova senha são obrigatórios' });
      }

      if (password.length < 6) {
        return res.status(400).json({ error: 'A senha deve ter pelo menos 6 caracteres' });
      }

      const resetData = resetCodes.get(email.toLowerCase());
      if (!resetData) {
        return res.status(400).json({ error: 'Código inválido ou não solicitado' });
      }

      if (Date.now() > resetData.expires) {
        resetCodes.delete(email.toLowerCase());
        return res.status(400).json({ error: 'Código expirado. Solicite novamente' });
      }

      if (resetData.code !== code) {
        return res.status(400).json({ error: 'Código incorreto' });
      }

      await professionalRepository.updatePasswordByEmail(email, password);

      resetCodes.delete(email.toLowerCase());

      return res.json({ message: 'Senha redefinida com sucesso' });
    } catch (error) {
      console.error('Error in resetPassword:', error);
      return res.status(500).json({ error: 'Erro interno no servidor ao redefinir senha' });
    }
  }
}

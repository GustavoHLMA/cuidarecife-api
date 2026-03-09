import { PrismaClient, Professional } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();
const SALT_ROUNDS = 10;

export const professionalRepository = {
  async create(data: Omit<Professional, 'id' | 'createdAt' | 'updatedAt'>): Promise<Professional> {
    const hashedPassword = await bcrypt.hash(data.password, SALT_ROUNDS);
    return prisma.professional.create({
      data: {
        ...data,
        password: hashedPassword,
      },
    });
  },

  async findByEmail(email: string): Promise<Professional | null> {
    return prisma.professional.findUnique({
      where: { email },
    });
  },

  async findByCpf(cpf: string): Promise<Professional | null> {
    return prisma.professional.findUnique({
      where: { cpf },
    });
  },

  async findById(id: string): Promise<Professional | null> {
    return prisma.professional.findUnique({
      where: { id },
    });
  },

  async validatePassword(plain: string, hashed: string): Promise<boolean> {
    return bcrypt.compare(plain, hashed);
  },
};

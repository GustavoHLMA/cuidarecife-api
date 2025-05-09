import { Prisma, UserTest } from '@prisma/client';
import prisma from '../db';

class UserTestRepository {
  async create(data: Prisma.UserTestCreateInput): Promise<UserTest> {
    const userTest = await prisma.userTest.create({ data });
    return userTest;
  }

  async findByEmail(email: string): Promise<UserTest | null> {
    const userTest = await prisma.userTest.findUnique({ where: { email } });
    return userTest;
  }

  async findById(id: string): Promise<UserTest | null> {
    const userTest = await prisma.userTest.findUnique({ where: { id } });
    return userTest;
  }

  async update(id: string, data: Prisma.UserTestUpdateInput): Promise<UserTest> {
    const userTest = await prisma.userTest.update({ where: { id }, data });
    return userTest;
  }

  async delete(id: string): Promise<UserTest> {
    const userTest = await prisma.userTest.delete({ where: { id } });
    return userTest;
  }

  async findAll(): Promise<UserTest[]> {
    const usersTest = await prisma.userTest.findMany();
    return usersTest;
  }
}

export default new UserTestRepository();
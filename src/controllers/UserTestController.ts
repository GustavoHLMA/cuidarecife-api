import { Request, Response, NextFunction } from 'express';
import { hash } from 'bcryptjs';
import { UserTestRepository } from '../repositories';
import { UserTest, UpdateUserTest } from '../DTOs';

class UserTestController {
  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const userTestData = UserTest.parse(req.body);

      const existsUserTestWithEmail = await UserTestRepository.findByEmail(
        userTestData.email,
      );

      if (existsUserTestWithEmail) {
        return res.status(400).json({ message: 'This email is already registred' });
      }

      const userTestDataWithHashedPassword = {
        ...userTestData,
        password: await hash(userTestData.password, 6),
      };

      const userTest = await UserTestRepository.create(userTestDataWithHashedPassword);

      return res.status(201).json({ message: 'UserTest created', data: userTest });
    } catch (error) {
      return next(error);
    }
  }

  async read(req: Request, res: Response, next: NextFunction) {
    try {
      const { userTestId } = req.params;

      const userTest = await UserTestRepository.findById(userTestId);

      if (!userTest) {
        return res.status(404).json({ message: 'UserTest not found' });
      }

      return res.status(200).json({ data: userTest });
    } catch (error) {
      return next(error);
    }
  }

  async readAll(req: Request, res: Response, next: NextFunction) {
    try {
      const usersTest = await UserTestRepository.findAll();

      return res.status(200).json({ data: usersTest });
    } catch (error) {
      return next(error);
    }
  }

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const { userTestId } = req.params;
      const userTestData = UpdateUserTest.parse(req.body);

      const userTest = await UserTestRepository.update(userTestId, userTestData);

      return res.status(200).json({ message: 'UserTest updated', data: userTest });
    } catch (error) {
      return next(error);
    }
  }

  async delete(req: Request, res: Response, next: NextFunction) {
    try {
      const { userTestId } = req.params;

      await UserTestRepository.delete(userTestId);

      return res.status(200).json({ message: 'UserTest deleted' });
    } catch (error) {
      return next(error);
    }
  }
}

export default new UserTestController();

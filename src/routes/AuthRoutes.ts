import { Router } from 'express';
import { AuthController } from '../controllers/AuthController';

const router = Router();
const authController = new AuthController();

import { authMiddleware } from '../middlewares/authMiddleware';

router.post('/register', (req, res) => authController.register(req, res));
router.post('/login', (req, res) => authController.login(req, res));
router.post('/refresh', (req, res) => authController.refreshToken(req, res));
router.post('/logout', (req, res) => authController.logout(req, res));
router.delete('/account', authMiddleware, (req, res) => authController.deleteAccount(req, res));
router.delete('/delete-account', authMiddleware, (req, res) => authController.deleteAccount(req, res));

export default router;

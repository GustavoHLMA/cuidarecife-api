import { Router } from 'express';
import { ProfessionalAuthController } from '../controllers/ProfessionalAuthController';
import { authMiddleware } from '../middlewares/authMiddleware';

const router = Router();
const authController = new ProfessionalAuthController();

// SEGURANÇA: registro protegido — apenas admins autenticados podem criar novos profissionais
router.post('/register', authMiddleware, authController.register.bind(authController));
// Login permanece público
router.post('/login', authController.login.bind(authController));

export default router;

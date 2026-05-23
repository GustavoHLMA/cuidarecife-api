import { Router } from 'express';
import { ProfessionalAuthController } from '../controllers/ProfessionalAuthController';
import { authMiddleware } from '../middlewares/authMiddleware';

const router = Router();
const authController = new ProfessionalAuthController();

// Cadastro liberado para o MVP
router.post('/register', authController.register.bind(authController));
// Login permanece público
router.post('/login', authController.login.bind(authController));
// Rota de deleção de conta (requer autenticação)
router.delete('/account', authMiddleware, authController.deleteAccount.bind(authController));
// Atualização de perfil
router.put('/profile', authMiddleware, authController.updateProfile.bind(authController));
// Recuperação de senha
router.post('/forgot-password', authController.forgotPassword.bind(authController));
router.post('/reset-password', authController.resetPassword.bind(authController));

export default router;

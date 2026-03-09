import { Router } from 'express';
import { ProfessionalAuthController } from '../controllers/ProfessionalAuthController';

const router = Router();
const authController = new ProfessionalAuthController();

router.post('/register', authController.register.bind(authController));
router.post('/login', authController.login.bind(authController));

export default router;

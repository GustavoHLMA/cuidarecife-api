import { Router } from 'express';
import VisionRoutes from './VisionRoutes';
import ChatRoutes from './ChatRoutes';
import PrescriptionRoutes from './PrescriptionRoutes';
import AuthRoutes from './AuthRoutes';
import ProfessionalAuthRoutes from './ProfessionalAuthRoutes';
import HealthRoutes from './HealthRoutes';
import MedicationRoutes from './MedicationRoutes';
import PharmacyRoutes from './PharmacyRoutes';
import { authMiddleware } from '../middlewares/authMiddleware';
import { professionalAuthMiddleware } from '../middlewares/professionalAuthMiddleware';
import { maxPageSizeMiddleware } from '../middlewares/maxPageSizeMiddleware';

const router = Router();

import RiskStratificationRoutes from './RiskStratificationRoutes';
import FeedbackRoutes from './FeedbackRoutes';
import MobileFeedbackRoutes from './MobileFeedbackRoutes';

// Public routes (sem autenticação)
router.use('/auth', AuthRoutes);
router.use('/auth/web', ProfessionalAuthRoutes); // login é público, register protegido internamente
router.use('/pharmacies', PharmacyRoutes);

router.route('/').get((_, res) => {
  res.status(200).send('The server is running');
});

// ============================================================
// DADOS PEC-eSUS: acesso RESTRITO a profissionais autenticados
// SEGURANÇA: professionalAuthMiddleware bloqueia usuários do app mobile
// maxPageSizeMiddleware(50) impede data dumps via pageSize grande
// ============================================================
router.use('/risk-stratification', authMiddleware, professionalAuthMiddleware, maxPageSizeMiddleware(50), RiskStratificationRoutes);

// Protected routes (require JWT — any authenticated user)
router.use('/vision', authMiddleware, VisionRoutes);
router.use('/chat', authMiddleware, ChatRoutes);
router.use('/prescription', authMiddleware, PrescriptionRoutes);
router.use('/health', authMiddleware, HealthRoutes);
router.use('/medications', authMiddleware, MedicationRoutes);
router.use('/feedback', authMiddleware, FeedbackRoutes);
router.use('/feedback/mobile', authMiddleware, MobileFeedbackRoutes);

export default router;
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

const router = Router();

import RiskStratificationRoutes from './RiskStratificationRoutes';
import FeedbackRoutes from './FeedbackRoutes';

// Public routes
router.use('/auth', AuthRoutes);
router.use('/auth/web', ProfessionalAuthRoutes);
router.use('/pharmacies', PharmacyRoutes);
router.use('/risk-stratification', RiskStratificationRoutes);
router.use('/feedback', FeedbackRoutes);
router.route('/').get((_, res) => {
  res.status(200).send('The server is running');
});

// Protected routes (require JWT)
router.use('/vision', authMiddleware, VisionRoutes);
router.use('/chat', authMiddleware, ChatRoutes);
router.use('/prescription', authMiddleware, PrescriptionRoutes);
router.use('/health', authMiddleware, HealthRoutes);
router.use('/medications', authMiddleware, MedicationRoutes);

export default router;
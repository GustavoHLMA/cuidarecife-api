import { Router } from 'express';
import { MedicationController } from '../controllers/MedicationController';
import { authMiddleware } from '../middlewares/authMiddleware';

const router = Router();

// Extração de medicamentos via OCR (requer autenticação)
router.post('/extract-from-image', authMiddleware, MedicationController.extractFromImage);

// Medicamentos do dia com status de doses
router.get('/today', authMiddleware, MedicationController.getTodayMedications);

// Registrar dose tomada
router.post('/:medicationId/dose', authMiddleware, MedicationController.recordDose);

// Marcar dose como esquecida
router.post('/:medicationId/forgotten', authMiddleware, MedicationController.markForgotten);

// Remover registro de dose
router.delete('/:medicationId/dose/:doseId', authMiddleware, MedicationController.deleteDose);

export default router;

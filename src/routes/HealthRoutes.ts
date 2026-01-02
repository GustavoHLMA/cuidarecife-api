import { Router } from 'express';
import { HealthController } from '../controllers/HealthController';

const router = Router();
const healthController = new HealthController();

// Glucose endpoints
router.post('/glucose', (req, res) => healthController.saveGlucoseReading(req, res));
router.get('/glucose', (req, res) => healthController.getGlucoseHistory(req, res));

// Blood pressure endpoints
router.post('/pressure', (req, res) => healthController.savePressureReading(req, res));
router.get('/pressure', (req, res) => healthController.getPressureHistory(req, res));

// Prescription endpoints
router.post('/prescription', (req, res) => healthController.savePrescription(req, res));
router.get('/prescription', (req, res) => healthController.getPrescription(req, res));

export default router;

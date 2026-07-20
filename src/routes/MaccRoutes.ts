import { Router } from 'express';
import maccController from '../controllers/MaccController';

const router = Router();

// POST /macc/classify — Classificar paciente (recalcula nível no backend)
router.post('/classify', (req, res) => maccController.classify(req, res));

// GET /macc/patient/:pacienteId — Última classificação do paciente
router.get('/patient/:pacienteId', (req, res) => maccController.getLatest(req, res));

// GET /macc/patient/:pacienteId/history — Histórico de classificações
router.get('/patient/:pacienteId/history', (req, res) => maccController.getHistory(req, res));

// GET /macc/stats — Estatísticas agregadas
router.get('/stats', (req, res) => maccController.getStats(req, res));

export default router;

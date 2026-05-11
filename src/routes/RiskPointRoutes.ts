import { Router } from 'express';
import riskPointController from '../controllers/RiskPointController';

const router = Router();

// GET  /risk-points?microarea=01   → lista pontos de risco
router.get('/', riskPointController.list);

// POST /risk-points                → cria ponto de risco
router.post('/', riskPointController.create);

// PUT  /risk-points/:id            → atualiza ponto de risco
router.put('/:id', riskPointController.update);

// DELETE /risk-points/:id          → remove ponto de risco
router.delete('/:id', riskPointController.remove);

export default router;

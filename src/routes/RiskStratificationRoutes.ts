import { Router } from 'express';
import riskController from '../controllers/RiskStratificationController';

const router = Router();

// Endpoint Principal - Análise do Risco (Vermelho/Amarelo/Verde)
router.get('/', riskController.getStratified);

// Listas de pacientes específicas por microárea
router.get('/diabetics', riskController.getDiabetics);
router.get('/hypertensives', riskController.getHypertensives);

// Listas de dados cruzados e de busca ativa
router.get('/assisted-last-trimester', riskController.getAssistedLastTrimester);
router.get('/needing-active-search', riskController.getNeedingActiveSearch);

// Busca genérica de pacientes por CIDs
router.get('/by-cids', riskController.getByCids);

export default router;

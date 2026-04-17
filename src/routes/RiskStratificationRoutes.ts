import { Router } from 'express';
import riskController from '../controllers/RiskStratificationController';

const router = Router();

// Endpoint Principal - Análise do Risco com Paginação e Filtros
router.get('/', riskController.getStratifiedPaginated);

// Listas de pacientes específicas por microárea
router.get('/diabetics', riskController.getDiabetics);
router.get('/hypertensives', riskController.getHypertensives);

// Listas de dados cruzados e de busca ativa
router.get('/assisted-last-trimester', riskController.getAssistedLastTrimester);
router.get('/needing-active-search', riskController.getNeedingActiveSearch);

router.get('/by-cids', riskController.getByCids);
router.get('/microareas', riskController.getMicroareas);
router.get('/territory-stats', riskController.getTerritoryStats);

export default router;

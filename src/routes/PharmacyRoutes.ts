import { Router } from 'express';
import { pharmacyController } from '../controllers/PharmacyController';

const router = Router();

// Listar todas as farmácias (público, sem autenticação)
router.get('/', (req, res) => pharmacyController.listPharmacies(req, res));

// Listar bairros disponíveis para filtro
router.get('/neighborhoods', (req, res) => pharmacyController.listNeighborhoods(req, res));

export default router;

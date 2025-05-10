import { Router } from 'express';
import { VisionController } from '../controllers/VisionController';

const visionRoutes = Router();
const visionController = new VisionController();

visionRoutes.post('/analyze-image', visionController.analyzeImage);
visionRoutes.get('/', (req, res) => {
  res.status(200).json({ message: 'Rota de teste para análise de imagem' });
});

export default visionRoutes;

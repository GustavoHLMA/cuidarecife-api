import { Router } from 'express';
import { VisionController } from '../controllers/VisionController';

const visionRoutes = Router();
const visionController = new VisionController();

visionRoutes.post('/analyze-image', visionController.analyzeImage);

export default visionRoutes;

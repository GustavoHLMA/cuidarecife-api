import { Router } from 'express';
import authRoutes from './AuthRoutes';
import userTestRoutes from './UserTestRoutes';
import visionRoutes from './VisionRoutes'; // Nova importação

const router = Router();

router.use('/auth', authRoutes);
router.use('/user-test', userTestRoutes);
router.use('/vision', visionRoutes); // Nova rota
router.route('/').get((_, res) => {
  res.status(200).send('The server is running');
});

export default router;
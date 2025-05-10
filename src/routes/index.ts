import { Router } from 'express';
import userTestRoutes from './UserTestRoutes';
import visionRoutes from './VisionRoutes';
import chatRoutes from './ChatRoutes';

const router = Router();

router.use('/user-test', userTestRoutes);
router.use('/vision', visionRoutes);
router.use('/chat', chatRoutes);
router.route('/').get((_, res) => {
  res.status(200).send('The server is running');
});

export default router;
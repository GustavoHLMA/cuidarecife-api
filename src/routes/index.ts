import { Router } from 'express';
import UserTestRoutes from './UserTestRoutes';
import VisionRoutes from './VisionRoutes';
import ChatRoutes from './ChatRoutes';
import PrescriptionRoutes from './PrescriptionRoutes'; // NOVO

const router = Router();

router.use('/user-test', UserTestRoutes);
router.use('/vision', VisionRoutes);
router.use('/chat', ChatRoutes);
router.use('/prescription', PrescriptionRoutes); // NOVO
router.route('/').get((_, res) => {
  res.status(200).send('The server is running');
});

export default router;
import { Router } from 'express';
import { LoginController } from '../controllers';

const authRouter = Router();

authRouter.post('/login', LoginController.login);
authRouter.get('/', (req, res) => {
  res.status(200).send('<p style="color:purple">The server is running 🐶🐱</p>');
});
authRouter.patch('/refresh', LoginController.refresh);
authRouter.delete('/logout', LoginController.logout);

export default authRouter;
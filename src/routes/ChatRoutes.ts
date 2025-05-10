import { Router } from 'express';
import { ChatController } from '../controllers/ChatController';

const chatRoutes = Router();
const chatController = new ChatController();
chatRoutes.post('/', chatController.handleChatMessage);

export default chatRoutes;

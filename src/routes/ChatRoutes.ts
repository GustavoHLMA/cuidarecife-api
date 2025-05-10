import { Router } from 'express';
import { ChatController } from '../controllers/ChatController';

const chatRoutes = Router();
const chatController = new ChatController();

// POST /api/chat - Handles a new chat message
// Protected by Auth middleware, adjust if not needed
chatRoutes.post('/', chatController.handleChatMessage);

export default chatRoutes;

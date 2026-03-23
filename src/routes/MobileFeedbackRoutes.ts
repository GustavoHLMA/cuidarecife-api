import { Router } from "express";
import { MobileFeedbackController } from "../controllers/MobileFeedbackController";

const router = Router();
const mobileFeedbackController = new MobileFeedbackController();

router.post("/", (req, res) => mobileFeedbackController.create(req, res));
router.get("/", (req, res) => mobileFeedbackController.list(req, res));

export default router;

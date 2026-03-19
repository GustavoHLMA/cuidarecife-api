import { Router } from "express";
import { FeedbackController } from "../controllers/FeedbackController";

const router = Router();
const feedbackController = new FeedbackController();

router.post("/", (req, res) => feedbackController.create(req, res));
router.get("/", (req, res) => feedbackController.list(req, res));

export default router;

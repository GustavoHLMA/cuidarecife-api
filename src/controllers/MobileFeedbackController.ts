import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export class MobileFeedbackController {
  async create(req: Request, res: Response) {
    try {
      const { rating, feature, details } = req.body;

      if (typeof rating !== "number" || rating < 0 || rating > 5) {
        return res.status(400).json({ error: "Rating must be a number between 0 and 5" });
      }

      if (!["OCR", "CHATBOT", "CHATBOT_MSG"].includes(feature)) {
        return res.status(400).json({ error: "Feature must be either 'OCR', 'CHATBOT' or 'CHATBOT_MSG'" });
      }

      const feedback = await prisma.mobileFeedback.create({
        data: {
          rating,
          feature,
          details
        },
      });

      return res.status(201).json(feedback);
    } catch (error) {
      console.error("[MobileFeedbackController.create]", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  async list(req: Request, res: Response) {
    try {
      const feedbacks = await prisma.mobileFeedback.findMany({
        orderBy: {
          createdAt: "desc",
        },
      });

      return res.status(200).json(feedbacks);
    } catch (error) {
      console.error("[MobileFeedbackController.list]", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
}

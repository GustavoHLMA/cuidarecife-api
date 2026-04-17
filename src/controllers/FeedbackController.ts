import { Request, Response } from "express";
import prisma from "../db";

export class FeedbackController {
  async create(req: Request, res: Response) {
    try {
      const { rating, comment } = req.body;

      if (typeof rating !== "number" || rating < 0 || rating > 10) {
        return res.status(400).json({ error: "Rating must be a number between 0 and 10" });
      }

      const feedback = await prisma.feedback.create({
        data: {
          rating,
          comment: comment || null,
        },
      });

      return res.status(201).json(feedback);
    } catch (error) {
      console.error("[FeedbackController.create]", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  async list(req: Request, res: Response) {
    try {
      const feedbacks = await prisma.feedback.findMany({
        orderBy: {
          createdAt: "desc",
        },
      });

      return res.status(200).json(feedbacks);
    } catch (error) {
      console.error("[FeedbackController.list]", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
}

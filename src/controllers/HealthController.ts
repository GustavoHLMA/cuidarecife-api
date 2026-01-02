import { Request, Response } from 'express';
import prisma from '../db';
import { AuthRequest } from '../middlewares/authMiddleware';
import { z } from 'zod';

// Validation schemas
const glucoseSchema = z.object({
  value: z.number().min(1).max(1000),
  measuredAt: z.string().transform((val) => new Date(val)),
  mealContext: z.enum(['before', 'after']).nullable().optional(),
});

const pressureSchema = z.object({
  systolic: z.number().min(50).max(300),
  diastolic: z.number().min(30).max(200),
  measuredAt: z.string().transform((val) => new Date(val)),
});

const prescriptionSchema = z.object({
  patientName: z.string().optional(),
  returnInDays: z.number().optional(),
  medications: z.array(z.object({
    name: z.string(),
    dosage: z.string().optional(),
    instructions: z.string(),
    timesPerDay: z.number().optional(),
    times: z.array(z.string()).optional(),
    isFree: z.boolean().optional(),
  })),
});

export class HealthController {
  // ===== GLUCOSE =====
  async saveGlucoseReading(req: AuthRequest, res: Response): Promise<Response> {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        return res.status(401).json({ error: 'User not authenticated' });
      }

      const data = glucoseSchema.parse(req.body);

      const reading = await prisma.glucoseReading.create({
        data: {
          value: data.value,
          measuredAt: data.measuredAt,
          mealContext: data.mealContext ?? null,
          userId,
        },
      });

      return res.status(201).json({ message: 'Glucose reading saved', reading });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors[0].message });
      }
      console.error('Error saving glucose reading:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  async getGlucoseHistory(req: AuthRequest, res: Response): Promise<Response> {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        return res.status(401).json({ error: 'User not authenticated' });
      }

      const limit = parseInt(req.query.limit as string) || 10;

      const readings = await prisma.glucoseReading.findMany({
        where: { userId },
        orderBy: { measuredAt: 'desc' },
        take: limit,
      });

      return res.json({ readings });
    } catch (error) {
      console.error('Error fetching glucose history:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  // ===== BLOOD PRESSURE =====
  async savePressureReading(req: AuthRequest, res: Response): Promise<Response> {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        return res.status(401).json({ error: 'User not authenticated' });
      }

      const data = pressureSchema.parse(req.body);

      const reading = await prisma.bloodPressureReading.create({
        data: {
          systolic: data.systolic,
          diastolic: data.diastolic,
          measuredAt: data.measuredAt,
          userId,
        },
      });

      return res.status(201).json({ message: 'Blood pressure reading saved', reading });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors[0].message });
      }
      console.error('Error saving blood pressure reading:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  async getPressureHistory(req: AuthRequest, res: Response): Promise<Response> {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        return res.status(401).json({ error: 'User not authenticated' });
      }

      const limit = parseInt(req.query.limit as string) || 10;

      const readings = await prisma.bloodPressureReading.findMany({
        where: { userId },
        orderBy: { measuredAt: 'desc' },
        take: limit,
      });

      return res.json({ readings });
    } catch (error) {
      console.error('Error fetching blood pressure history:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  // ===== PRESCRIPTION =====
  async savePrescription(req: AuthRequest, res: Response): Promise<Response> {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        return res.status(401).json({ error: 'User not authenticated' });
      }

      const data = prescriptionSchema.parse(req.body);

      // Delete existing prescription if any
      await prisma.prescription.deleteMany({
        where: { userId },
      });

      // Create new prescription with medications
      const prescription = await prisma.prescription.create({
        data: {
          patientName: data.patientName,
          returnInDays: data.returnInDays,
          userId,
          medications: {
            create: data.medications.map((med) => ({
              name: med.name,
              dosage: med.dosage,
              instructions: med.instructions,
              timesPerDay: med.timesPerDay ?? 1,
              times: med.times ? JSON.stringify(med.times) : null,
              isFree: med.isFree ?? true,
            })),
          },
        },
        include: { medications: true },
      });

      return res.status(201).json({ message: 'Prescription saved', prescription });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors[0].message });
      }
      console.error('Error saving prescription:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  async getPrescription(req: AuthRequest, res: Response): Promise<Response> {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        return res.status(401).json({ error: 'User not authenticated' });
      }

      const prescription = await prisma.prescription.findFirst({
        where: { userId },
        include: { medications: true },
        orderBy: { createdAt: 'desc' },
      });

      if (!prescription) {
        return res.json({ prescription: null });
      }

      return res.json({ prescription });
    } catch (error) {
      console.error('Error fetching prescription:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
}

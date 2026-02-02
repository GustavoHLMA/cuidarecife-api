import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { geminiService } from '../services/GeminiService';
import { visionService } from '../services/VisionService';
import { AuthRequest } from '../middlewares/authMiddleware';

const prisma = new PrismaClient();

// Prompt para extrair medicamentos de texto OCR
const MEDICATION_EXTRACTION_PROMPT = `Você é um especialista em análise de prescrições médicas brasileiras.
Analise o texto extraído de uma prescrição médica e extraia os medicamentos.

Para cada medicamento encontrado, retorne um objeto JSON com:
- name: nome do medicamento (ex: "Losartana")
- dosage: dosagem (ex: "50mg")
- instructions: instruções de uso (ex: "Tomar 1 comprimido às 8h da manhã")
- timesPerDay: número de vezes ao dia (número inteiro)
- times: array de horários no formato ["08:00", "20:00"]
- isFree: true se parece ser um medicamento genérico/programa farmácia popular

IMPORTANTE: Retorne APENAS um array JSON válido, sem texto adicional. Exemplo:
[
  {"name": "Losartana", "dosage": "50mg", "instructions": "1 comprimido às 8h e 20h", "timesPerDay": 2, "times": ["08:00", "20:00"], "isFree": true}
]

Se não encontrar medicamentos ou o texto for ilegível, retorne: []`;

export const MedicationController = {
  /**
   * Extrai medicamentos de uma imagem de prescrição via OCR + AI
   */
  async extractFromImage(req: Request, res: Response) {
    try {
      const { image } = req.body;

      if (!image) {
        return res.status(400).json({ error: 'Imagem é obrigatória' });
      }

      // 1. Extrair texto da imagem via Vision API
      const ocrResult = await visionService.extractText(image);

      if (!ocrResult.success || !ocrResult.text) {
        return res.status(400).json({
          error: 'Não foi possível extrair texto da imagem',
          details: ocrResult.error
        });
      }

      console.log('[MedicationController] Texto extraído:', ocrResult.text.substring(0, 200));

      // 2. Usar Gemini para estruturar os medicamentos
      const aiResult = await geminiService.generateContent({
        userMessage: `Texto da prescrição:\n${ocrResult.text}`,
        systemPrompt: MEDICATION_EXTRACTION_PROMPT,
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 1000,
        },
      });

      if (!aiResult.success || !aiResult.text) {
        return res.status(500).json({
          error: 'Erro ao processar medicamentos com IA',
          extractedText: ocrResult.text
        });
      }

      // 3. Parsear o JSON retornado
      let medications = [];
      try {
        // Remove possíveis markdown code blocks
        let jsonText = aiResult.text.trim();
        if (jsonText.startsWith('```')) {
          jsonText = jsonText.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
        }
        medications = JSON.parse(jsonText);
      } catch (parseError) {
        console.error('[MedicationController] Erro ao parsear JSON:', parseError);
        return res.status(500).json({
          error: 'Formato inválido retornado pela IA',
          rawResponse: aiResult.text,
          extractedText: ocrResult.text
        });
      }

      return res.json({
        medications,
        extractedText: ocrResult.text,
      });

    } catch (error: any) {
      console.error('[MedicationController] Erro em extractFromImage:', error);
      return res.status(500).json({ error: error.message || 'Erro interno' });
    }
  },

  /**
   * Retorna medicamentos do usuário com status de doses de hoje
   */
  async getTodayMedications(req: AuthRequest, res: Response) {
    try {
      const userId = req.user?.userId;

      // Data de 7 dias atrás
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
      sevenDaysAgo.setHours(0, 0, 0, 0);

      // Buscar prescrição do usuário com medicamentos e doseLogs dos últimos 7 dias
      const prescription = await prisma.prescription.findFirst({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        include: {
          medications: {
            include: {
              doseLogs: {
                where: {
                  takenAt: {
                    gte: sevenDaysAgo, // Últimos 7 dias
                  },
                },
                orderBy: { takenAt: 'asc' },
              },
            },
          },
        },
      });

      if (!prescription) {
        return res.json({ medications: [], prescriptionCreatedAt: null, weekHistory: [] });
      }

      // Calcular histórico da semana baseado na data de criação da prescrição
      const prescriptionDate = new Date(prescription.createdAt);
      prescriptionDate.setHours(0, 0, 0, 0);

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // Quantos dias se passaram desde a prescrição (máximo 7)
      const daysSincePrescription = Math.floor((today.getTime() - prescriptionDate.getTime()) / (1000 * 60 * 60 * 24));
      const daysToShow = Math.min(daysSincePrescription + 1, 7); // +1 para incluir hoje

      // Formatar medicamentos com status de doses
      const medicationsWithStatus = prescription.medications.map((med) => {
        const times = med.times ? JSON.parse(med.times) : [];
        const dosesRequired = med.timesPerDay || times.length || 1;

        // Filtrar logs de hoje para saber doses de hoje
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const todayEnd = new Date();
        todayEnd.setHours(23, 59, 59, 999);

        const todayLogs = med.doseLogs.filter(log => {
          const logDate = new Date(log.takenAt);
          return logDate >= todayStart && logDate <= todayEnd;
        });

        const dosesTakenToday = todayLogs.filter(log => log.status === 'taken').length;

        // Calcular histórico semanal CÍCLICO com dados proporcionais
        const weekHistory: Array<{
          day: number;
          taken: number;
          required: number;
          percentage: number;
          status: 'complete' | 'partial' | 'missed' | 'pending' | 'future';
        }> = [];

        // Quantos dias desde a prescrição
        const daysSincePrescription = Math.floor((today.getTime() - prescriptionDate.getTime()) / (1000 * 60 * 60 * 24));

        // Qual semana atual (0 = primeira semana, 1 = segunda, etc)
        const currentWeek = Math.floor(daysSincePrescription / 7);

        // Data de início da semana atual
        const weekStartDate = new Date(prescriptionDate);
        weekStartDate.setDate(prescriptionDate.getDate() + (currentWeek * 7));
        weekStartDate.setHours(0, 0, 0, 0);

        for (let i = 0; i < 7; i++) {
          const dayDate = new Date(weekStartDate);
          dayDate.setDate(weekStartDate.getDate() + i);
          dayDate.setHours(0, 0, 0, 0);

          const dayEnd = new Date(dayDate);
          dayEnd.setHours(23, 59, 59, 999);

          // Se o dia está no futuro
          if (dayDate > today) {
            weekHistory.push({
              day: i + 1,
              taken: 0,
              required: dosesRequired,
              percentage: 0,
              status: 'future'
            });
            continue;
          }

          // Buscar logs desse dia específico
          const dayLogs = med.doseLogs.filter(log => {
            const logDate = new Date(log.takenAt);
            return logDate >= dayDate && logDate <= dayEnd;
          });

          // Contar doses tomadas e esquecidas
          const takenCount = dayLogs.filter(log => log.status === 'taken').length;
          const percentage = Math.min(takenCount / dosesRequired, 1); // Max 100%

          // Determinar status
          let dayStatus: 'complete' | 'partial' | 'missed' | 'pending';
          if (takenCount >= dosesRequired) {
            dayStatus = 'complete';
          } else if (takenCount > 0) {
            dayStatus = 'partial';
          } else if (dayDate < today) {
            dayStatus = 'missed';
          } else {
            dayStatus = 'pending';
          }

          weekHistory.push({
            day: i + 1,
            taken: takenCount,
            required: dosesRequired,
            percentage,
            status: dayStatus
          });
        }

        return {
          id: med.id,
          name: med.name,
          dosage: med.dosage,
          instructions: med.instructions,
          timesPerDay: dosesRequired,
          times,
          isFree: med.isFree,
          dosesTakenToday,
          dosesRequired,
          isComplete: dosesTakenToday >= dosesRequired,
          weekHistory, // Histórico da semana para os comprimidos
          doseLogs: todayLogs.map(log => ({
            id: log.id,
            scheduledTime: log.scheduledTime,
            status: log.status, // 'taken' ou 'forgotten'
            takenAt: log.takenAt,
          })),
        };
      });

      return res.json({
        medications: medicationsWithStatus,
        prescriptionCreatedAt: prescription.createdAt,
        daysToShow,
      });

    } catch (error: any) {
      console.error('[MedicationController] Erro em getTodayMedications:', error);
      return res.status(500).json({ error: error.message || 'Erro interno' });
    }
  },

  /**
   * Registra uma dose tomada
   */
  async recordDose(req: AuthRequest, res: Response) {
    try {
      const { medicationId } = req.params;
      const { scheduledTime, takenAt } = req.body;
      const userId = req.user?.userId;

      // Verificar se o medicamento pertence ao usuário
      const medication = await prisma.medication.findFirst({
        where: {
          id: medicationId,
          prescription: { userId },
        },
      });

      if (!medication) {
        return res.status(404).json({ error: 'Medicamento não encontrado' });
      }

      // Criar registro de dose
      const doseLog = await prisma.doseLog.create({
        data: {
          medicationId,
          scheduledTime: scheduledTime || null,
          status: 'taken',
          takenAt: takenAt ? new Date(takenAt) : new Date(),
        },
      });

      return res.json({
        message: 'Dose registrada com sucesso',
        doseLog,
      });

    } catch (error: any) {
      console.error('[MedicationController] Erro em recordDose:', error);
      return res.status(500).json({ error: error.message || 'Erro interno' });
    }
  },

  /**
   * Remove um registro de dose (caso erro)
   */
  async deleteDose(req: AuthRequest, res: Response) {
    try {
      const { medicationId, doseId } = req.params;
      const userId = req.user?.userId;

      // Verificar se a dose pertence a um medicamento do usuário
      const doseLog = await prisma.doseLog.findFirst({
        where: {
          id: doseId,
          medicationId,
          medication: {
            prescription: { userId },
          },
        },
      });

      if (!doseLog) {
        return res.status(404).json({ error: 'Registro de dose não encontrado' });
      }

      await prisma.doseLog.delete({
        where: { id: doseId },
      });

      return res.json({ message: 'Registro de dose removido' });

    } catch (error: any) {
      console.error('[MedicationController] Erro em deleteDose:', error);
      return res.status(500).json({ error: error.message || 'Erro interno' });
    }
  },

  /**
   * Marca uma dose como esquecida
   */
  async markForgotten(req: AuthRequest, res: Response) {
    try {
      const { medicationId } = req.params;
      const { scheduledTime } = req.body;
      const userId = req.user?.userId;

      // Verificar se o medicamento pertence ao usuário
      const medication = await prisma.medication.findFirst({
        where: {
          id: medicationId,
          prescription: { userId },
        },
      });

      if (!medication) {
        return res.status(404).json({ error: 'Medicamento não encontrado' });
      }

      // Criar registro de dose como esquecida
      const doseLog = await prisma.doseLog.create({
        data: {
          medicationId,
          scheduledTime: scheduledTime || null,
          status: 'forgotten',
          takenAt: new Date(),
        },
      });

      return res.json({
        message: 'Dose marcada como esquecida',
        doseLog,
      });

    } catch (error: any) {
      console.error('[MedicationController] Erro em markForgotten:', error);
      return res.status(500).json({ error: error.message || 'Erro interno' });
    }
  },
};

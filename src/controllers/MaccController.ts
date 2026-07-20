import { Request, Response } from 'express';
import maccService from '../services/MaccService';
import { z } from 'zod';

// Validação do formulário MACC com Zod
const maccFormSchema = z.object({
  patientName: z.string().min(1, 'Nome do paciente é obrigatório'),
  age: z.number().int().min(1).max(130),
  hasChronicCondition: z.boolean(),
  chronicConditions: z.array(z.string()).default([]),
  conditionComplexity: z.enum(['none', 'low', 'medium', 'high', 'very_high']).default('low'),
  riskFactors: z.array(z.string()).default([]),
  frequentHospitalizations: z.boolean().default(false),
  frequentEmergencyUse: z.boolean().default(false),
  socialVulnerability: z.boolean().default(false),
  socialVulnerabilities: z.array(z.string()).default([]),
  multipleComorbidities: z.boolean().default(false),
  controlledCondition: z.boolean().default(true),
  selfCareStatus: z.enum(['sufficient', 'insufficient', 'not_assessed']).default('not_assessed'),
  selfCareScore: z.number().optional(),
});

const classifySchema = z.object({
  pacienteId: z.string().min(1, 'ID do paciente é obrigatório'),
  formData: maccFormSchema,
});

class MaccController {
  /**
   * POST /macc/classify
   * Recebe dados do formulário, recalcula o nível MACC no backend e salva.
   */
  async classify(req: Request, res: Response): Promise<void> {
    try {
      const parsed = classifySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: 'Dados inválidos',
          details: parsed.error.flatten().fieldErrors,
        });
        return;
      }

      const { pacienteId, formData } = parsed.data;
      const user = (req as any).user;

      const result = await maccService.classify({
        pacienteId,
        formData,
        classifiedBy: user?.id || null,
      });

      res.status(201).json(result);
    } catch (error: any) {
      console.error('[MaccController] classify error:', error.message);
      res.status(500).json({ error: 'Erro ao classificar paciente' });
    }
  }

  /**
   * GET /macc/patient/:pacienteId
   * Retorna a última classificação MACC do paciente.
   */
  async getLatest(req: Request, res: Response): Promise<void> {
    try {
      const { pacienteId } = req.params;
      const classification = await maccService.getLatest(pacienteId);

      if (!classification) {
        res.status(404).json({ error: 'Nenhuma classificação encontrada para este paciente' });
        return;
      }

      res.json(classification);
    } catch (error: any) {
      console.error('[MaccController] getLatest error:', error.message);
      res.status(500).json({ error: 'Erro ao buscar classificação' });
    }
  }

  /**
   * GET /macc/patient/:pacienteId/history
   * Retorna o histórico de classificações MACC do paciente.
   */
  async getHistory(req: Request, res: Response): Promise<void> {
    try {
      const { pacienteId } = req.params;
      const history = await maccService.getHistory(pacienteId);
      res.json(history);
    } catch (error: any) {
      console.error('[MaccController] getHistory error:', error.message);
      res.status(500).json({ error: 'Erro ao buscar histórico' });
    }
  }

  /**
   * GET /macc/stats
   * Retorna estatísticas agregadas da classificação MACC.
   */
  async getStats(req: Request, res: Response): Promise<void> {
    try {
      const stats = await maccService.getStats();
      res.json(stats);
    } catch (error: any) {
      console.error('[MaccController] getStats error:', error.message);
      res.status(500).json({ error: 'Erro ao buscar estatísticas' });
    }
  }
}

export default new MaccController();

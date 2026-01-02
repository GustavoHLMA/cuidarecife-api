import { Request, Response, NextFunction } from 'express';
import { geminiService } from '../services';
import { PrescriptionVerificationRequestSchema, PrescriptionVerificationRequest } from '../DTOs';

const PRESCRIPTION_ANALYSIS_PROMPT = `Você é um assistente farmacêutico virtual útil e EXTREMAMENTE conciso. 
Analise prescrições médicas de forma objetiva e direta.
Suas respostas devem ter NO MÁXIMO 150 palavras.
Não forneça conselhos médicos definitivos, apenas uma análise preliminar.
Se não tiver certeza, indique isso.
Responda apenas em português brasileiro.`;

// Export como objeto para evitar problemas de binding
export const PrescriptionController = {
  async verifyPrescription(req: Request, res: Response, next: NextFunction) {
    try {
      console.log('[Prescription] Recebida requisição de verificação:', req.body);

      const prescriptionData = PrescriptionVerificationRequestSchema.parse(req.body) as PrescriptionVerificationRequest;

      if (!geminiService.isConfigured()) {
        console.error('[Prescription] Gemini API key is not configured.');
        return res.status(500).json({ error: 'Serviço de IA não configurado corretamente.' });
      }

      let userPrompt = "Analise esta prescrição de forma BREVE:\n";
      if (prescriptionData.patientName) {
        userPrompt += `Paciente: ${prescriptionData.patientName}\n`;
      }
      if (prescriptionData.returnInDays) {
        userPrompt += `Retorno: ${prescriptionData.returnInDays} dias\n`;
      }
      userPrompt += "Medicamentos:\n";
      prescriptionData.medications.forEach(med => {
        userPrompt += `- ${med.name}: ${med.instructions}\n`;
      });

      userPrompt += "\nAnálise solicitada:";
      userPrompt += "\n1. Os medicamentos parecem estar em doses geralmente aceitáveis para um adulto?";
      userPrompt += "\n2. Existem interações medicamentosas óbvias e perigosas entre eles?";
      userPrompt += "\n3. Os horários e instruções de como tomar parecem corretos e seguros?";
      userPrompt += "\n4. Há alguma recomendação crítica ou alerta óbvio sobre esta prescrição?";
      userPrompt += "\n5. No geral, a prescrição parece estar em ordem ou levanta alguma preocupação significativa?";
      userPrompt += "\nResponda apenas com um resumo final conciso da sua análise em uma frase.";

      console.log('[Prescription] Enviando para Gemini...');

      const result = await geminiService.generateContent({
        userMessage: userPrompt,
        systemPrompt: PRESCRIPTION_ANALYSIS_PROMPT,
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 350,
        },
      });

      if (!result.success) {
        console.error('[Prescription] Gemini error:', result.error);
        return res.status(400).json({ error: result.error || 'Falha ao obter resposta do assistente de IA.' });
      }

      console.log('[Prescription] Resposta do Gemini:', result.text);
      return res.status(200).json({ analysisResult: result.text });

    } catch (error: any) {
      if (error.name === 'ZodError') {
        console.error('[Prescription] Zod validation error:', error.errors);
        return res.status(400).json({ error: 'Dados de entrada inválidos', details: error.errors });
      }
      console.error('[Prescription] Erro na verificação:', error);
      return res.status(500).json({ error: 'Erro interno do servidor ao processar a verificação.' });
    }
  }
};

// Para manter compatibilidade com import default
export default PrescriptionController;
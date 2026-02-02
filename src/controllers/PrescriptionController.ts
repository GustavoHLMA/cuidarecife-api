import { Request, Response, NextFunction } from 'express';
import { geminiService, ragService } from '../services';
import { PrescriptionVerificationRequestSchema, PrescriptionVerificationRequest } from '../DTOs';

const PRESCRIPTION_ANALYSIS_PROMPT = `Você é um assistente farmacêutico que ajuda pacientes a entender suas receitas médicas.

SEU PÚBLICO: Pessoas idosas e com baixa escolaridade.

COMO ANALISAR:
1. Verifique se há INTERAÇÕES PERIGOSAS entre os medicamentos
2. Verifique se os HORÁRIOS fazem sentido
3. Dê ALERTAS importantes sobre cada medicamento
4. Fale de forma SIMPLES e DIRETA

INTERAÇÕES IMPORTANTES A VERIFICAR:
- Metformina + Álcool = Problema grave
- Anti-hipertensivos + Anti-inflamatórios = Reduz efeito
- Insulina + Sulfonilureias = Risco de hipoglicemia
- AAS + Anticoagulantes = Risco de sangramento

FORMATO DA RESPOSTA:
1. Uma frase resumindo se a receita parece OK ou tem problemas
2. Se houver interação perigosa, AVISE CLARAMENTE
3. Dica prática sobre como tomar os remédios

Seja BREVE - máximo 100 palavras.`;

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

      // Monta a lista de medicamentos
      let medicationList = prescriptionData.medications
        .map(med => `- ${med.name}: ${med.instructions}`)
        .join('\n');

      let userPrompt = `RECEITA PARA ANÁLISE:
${prescriptionData.patientName ? `Paciente: ${prescriptionData.patientName}` : ''}
${prescriptionData.returnInDays ? `Retorno: ${prescriptionData.returnInDays} dias` : ''}

Medicamentos:
${medicationList}

Analise esta receita de forma SIMPLES e verifique interações.`;

      // Busca contexto do RAG se disponível
      let systemPrompt = PRESCRIPTION_ANALYSIS_PROMPT;
      const ragStatus = ragService.getStatus();
      if (ragStatus.documentCount > 0) {
        const context = await ragService.getContext(
          prescriptionData.medications.map(m => m.name).join(' ') + ' interação',
          2
        );
        if (context) {
          systemPrompt += `\n\nINFORMAÇÕES DOS PROTOCOLOS:\n${context}`;
        }
      }

      console.log('[Prescription] Enviando para Gemini...');

      const result = await geminiService.generateContent({
        userMessage: userPrompt,
        systemPrompt,
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 300,
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
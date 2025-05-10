import { Request, Response, NextFunction } from 'express';
import fetch from 'node-fetch'; // Usar node-fetch
import { PrescriptionVerificationRequestSchema, PrescriptionVerificationRequest } from '../DTOs';

const OPENAI_API_KEY = process.env.OPEN_AI_API_KEY; // CORRIGIDO para OPEN_AI_API_KEY (com underscore)
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions'; // URL da API OpenAI

class PrescriptionController {
  async verifyPrescription(req: Request, res: Response, next: NextFunction) {
    try {
      const prescriptionData = PrescriptionVerificationRequestSchema.parse(req.body) as PrescriptionVerificationRequest;

      if (!OPENAI_API_KEY) {
        console.error('OpenAI API key is not configured.');
        return res.status(500).json({ error: 'Serviço de IA não configurado corretamente.' });
      }

      let userPrompt = "Por favor, analise a seguinte prescrição médica:\n";
      if (prescriptionData.patientName) {
        userPrompt += `Paciente: ${prescriptionData.patientName}\n`;
      }
      if (prescriptionData.returnInDays) {
        userPrompt += `Retorno em: ${prescriptionData.returnInDays} dias\n`;
      }
      userPrompt += "Medicamentos:\n";
      prescriptionData.medications.forEach(med => {
        userPrompt += `- ${med.name}: ${med.instructions}\n`;
      });

      userPrompt += "\nAnálise solicitada:";
      userPrompt += "\n1. Os medicamentos parecem estar em doses geralmente aceitáveis para um adulto? (responda apenas sim/não/incerto)";
      userPrompt += "\n2. Existem interações medicamentosas óbvias e perigosas entre eles? (responda apenas sim/não/incerto)";
      userPrompt += "\n3. Os horários e instruções de como tomar parecem corretos e seguros? (responda apenas sim/não/incerto)";
      userPrompt += "\n4. Há alguma recomendação crítica ou alerta óbvio sobre esta prescrição? (descreva brevemente se sim, caso contrário 'Nenhum alerta óbvio')";
      userPrompt += "\n5. No geral, a prescrição parece estar em ordem ou levanta alguma preocupação significativa? (responda apenas em ordem/preocupante/incerto)";
      userPrompt += "\nForneça um resumo final conciso da sua análise em uma frase.";

      const systemMessage = 'Você é um assistente farmacêutico virtual útil e conciso. Responda apenas com base nas informações fornecidas e no seu conhecimento geral sobre medicamentos. Não forneça conselhos médicos definitivos, apenas uma análise preliminar da prescrição. Se não tiver certeza, indique isso. Seja direto nas respostas para cada ponto solicitado e no resumo final.';

      const apiRequestBody = {
        model: 'gpt-4.1-mini', // CORRIGIDO: model name
        messages: [
          { role: 'system', content: systemMessage },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.2, // Baixa temperatura para respostas mais factuais e menos criativas
        max_tokens: 350, // Ajuste conforme necessário
      };

      const response = await fetch(OPENAI_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify(apiRequestBody),
      });

      if (!response.ok) {
        const responseText = await response.text();
        console.error('OpenAI API raw error response text:', responseText);
        let errorDetails;
        try {
          errorDetails = JSON.parse(responseText);
        } catch (e) {
          errorDetails = { message: 'OpenAI API returned non-JSON error.', details: responseText.substring(0, 500) };
        }
        console.error('OpenAI API error details:', errorDetails);
        return res.status(response.status).json({ error: 'Falha ao obter resposta do assistente de IA.', details: errorDetails });
      }

      const data = await response.json() as any;

      if (data.choices && data.choices.length > 0 && data.choices[0].message && data.choices[0].message.content) {
        const analysisResult = data.choices[0].message.content.trim();
        return res.status(200).json({ analysisResult });
      } else {
        console.error('Unexpected response structure from OpenAI:', data);
        return res.status(500).json({ error: 'Received an unexpected response structure from AI assistant.' });
      }

    } catch (error: any) {
      if (error.name === 'ZodError') {
        return res.status(400).json({ message: 'Dados de entrada inválidos', errors: error.errors });
      }
      console.error('Erro na verificação de prescrição com OpenAI:', error);
      return res.status(500).json({ message: 'Erro interno do servidor ao processar a verificação.' });
    }
  }
}

export default new PrescriptionController();

import { Request, Response } from 'express';
import { geminiService, ragService, GeminiMessage } from '../services';

// System prompt MELHORADO para público idoso/baixa escolaridade
const HEALTH_ASSISTANT_PROMPT = `Você é "Doc", um assistente de saúde amigável do app CuidaRecife.

SEU PÚBLICO:
- Pessoas idosas (60+ anos)
- Pessoas com baixa escolaridade
- Diabéticos e hipertensos do Recife

COMO VOCÊ DEVE RESPONDER:
1. Use linguagem SIMPLES - evite termos técnicos
2. Seja DIRETO e OBJETIVO - respostas curtas
3. Use EXEMPLOS práticos do dia a dia
4. Quando mencionar números, explique o que significam
5. Sempre pergunte se a pessoa entendeu

EXEMPLOS DE COMO FALAR:
- Em vez de "glicemia de jejum", diga "açúcar no sangue em jejum"
- Em vez de "hiperglicemia", diga "açúcar alto demais"
- Em vez de "120/80 mmHg", diga "12 por 8"

TEMAS QUE VOCÊ PODE AJUDAR:
- Diabetes (açúcar no sangue)
- Pressão alta
- Medicamentos para essas doenças
- Alimentação saudável
- Exercícios físicos
- Farmácia Popular

REGRAS:
1. Se a pergunta NÃO for sobre saúde, diga: "Desculpe, só posso ajudar com dúvidas sobre diabetes, pressão alta e medicamentos. O que você quer saber sobre isso?"
2. SEMPRE diga que o médico é quem decide o tratamento
3. Não faça diagnósticos, apenas explique
4. Se tiver informação dos protocolos de saúde (contexto abaixo), USE-A como base

IMPORTANTE: Você tem acesso a protocolos oficiais de saúde. Quando o contexto for fornecido, baseie sua resposta nele.`;

// Prompt para quando há contexto do RAG
const RAG_CONTEXT_TEMPLATE = (context: string) => `
INFORMAÇÃO DOS PROTOCOLOS DE SAÚDE (use como referência):
${context}

Baseie sua resposta nessas informações oficiais, mas explique de forma simples.`;

// Limite de mensagens no histórico
const MAX_HISTORY_MESSAGES = 10;

export class ChatController {
  async handleChatMessage(req: Request, res: Response): Promise<Response> {
    const { message, history } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    if (!geminiService.isConfigured()) {
      console.error('[Chat] Gemini API key is not configured.');
      return res.status(500).json({ error: 'Chat service is not configured correctly.' });
    }

    try {
      // Busca contexto relevante nos protocolos (RAG)
      let systemPrompt = HEALTH_ASSISTANT_PROMPT;

      const ragStatus = ragService.getStatus();
      if (ragStatus.documentCount > 0) {
        const context = await ragService.getContext(message, 2);
        if (context) {
          systemPrompt += RAG_CONTEXT_TEMPLATE(context);
          console.log('[Chat] RAG context added:', context.substring(0, 100) + '...');
        }
      }

      // Monta o histórico de mensagens se fornecido
      let messages: GeminiMessage[] = [];

      // Primeiro, adiciona o system prompt como mensagem do usuário
      messages.push({
        role: 'user',
        parts: [{ text: systemPrompt + '\n\nAgora responda às perguntas do usuário:' }],
      });
      messages.push({
        role: 'model',
        parts: [{ text: 'Entendido! Sou o Doc, assistente de saúde do CuidaRecife. Estou pronto para ajudar com dúvidas sobre diabetes, pressão alta e medicamentos. Como posso ajudar?' }],
      });

      // Adiciona histórico se fornecido (limita para não estourar tokens)
      if (history && Array.isArray(history)) {
        const limitedHistory = history.slice(-MAX_HISTORY_MESSAGES);
        for (const msg of limitedHistory) {
          if (msg.role === 'user' || msg.role === 'model') {
            messages.push({
              role: msg.role,
              parts: [{ text: msg.content }],
            });
          }
        }
      }

      // Adiciona a mensagem atual
      messages.push({
        role: 'user',
        parts: [{ text: message }],
      });

      const result = await geminiService.generateContent({
        messages,
        generationConfig: {
          temperature: 0.6,
          maxOutputTokens: 800,
          topP: 0.9,
          topK: 30,
        },
      });

      if (!result.success) {
        console.error('[Chat] Gemini error:', result.error);
        return res.status(400).json({ error: result.error || 'Failed to get response from AI assistant.' });
      }

      return res.json({
        reply: result.text,
        ragUsed: ragStatus.documentCount > 0,
      });

    } catch (error) {
      console.error('[Chat] Error processing chat message:', error);
      return res.status(500).json({ error: 'Internal server error while processing chat message.' });
    }
  }
}

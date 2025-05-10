import { max } from 'date-fns';
import { Request, Response } from 'express';
import fetch from 'node-fetch';

const OPENAI_API_KEY = process.env.OPEN_AI_API_KEY;
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

export class ChatController {
  async handleChatMessage(req: Request, res: Response): Promise<Response> {
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    if (!OPENAI_API_KEY) {
      console.error('OpenAI API key is not configured.');
      return res.status(500).json({ error: 'Chat service is not configured correctly.' });
    }

    try {
      const response = await fetch(OPENAI_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'gpt-4.1-mini',
          messages: [
            {
              role: 'system',
              content: 'Você é um assistente virtual focado em saúde. Suas respostas devem ser informativas e úteis para questões gerais de saúde. Lembre ao usuário que suas respostas não substituem o aconselhamento, diagnóstico ou tratamento médico profissional. Sempre recomende que o usuário consulte um profissional de saúde qualificado para quaisquer dúvidas médicas ou condições de saúde. Não responda perguntas não ligadas à saúde.',
            },
            {
              role: 'user',
              content: message,
            },
          ],
          temperature: 0.7,
          max_tokens: 300,
        }),
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
        return res.status(response.status).json({ error: 'Failed to get response from AI assistant.', details: errorDetails });
      }

      const data = await response.json() as any;
      
      if (data.choices && data.choices.length > 0 && data.choices[0].message) {
        return res.json({ reply: data.choices[0].message.content.trim() });
      } else {
        console.error('Unexpected response structure from OpenAI:', data);
        return res.status(500).json({ error: 'Received an unexpected response structure from AI assistant.' });
      }

    } catch (error) {
      console.error('Error processing chat message:', error);
      return res.status(500).json({ error: 'Internal server error while processing chat message.' });
    }
  }
}

import fetch from 'node-fetch';

// ===== CONFIGURAÇÃO CENTRALIZADA DO GEMINI =====
const GEMINI_CONFIG = {
  apiKey: process.env.GEMINI_API_KEY || '',
  model: 'gemini-2.5-flash-lite', // Modelo mais econômico
  baseUrl: 'https://generativelanguage.googleapis.com/v1beta/models',
};

// ===== TIPOS =====
interface GeminiMessage {
  role: 'user' | 'model';
  parts: { text: string }[];
}

interface GeminiGenerationConfig {
  temperature?: number;
  maxOutputTokens?: number;
  topP?: number;
  topK?: number;
}

interface GeminiSafetySettings {
  category: string;
  threshold: string;
}

interface GeminiRequestOptions {
  systemPrompt?: string;
  messages?: GeminiMessage[];
  userMessage?: string;
  generationConfig?: GeminiGenerationConfig;
  safetySettings?: GeminiSafetySettings[];
}

interface GeminiResponse {
  success: boolean;
  text?: string;
  error?: string;
  rawResponse?: any;
}

// ===== CONFIGURAÇÕES PADRÃO =====
const DEFAULT_GENERATION_CONFIG: GeminiGenerationConfig = {
  temperature: 0.7,
  maxOutputTokens: 500,
  topP: 0.95,
  topK: 40,
};

const DEFAULT_SAFETY_SETTINGS: GeminiSafetySettings[] = [
  { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
  { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
  { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
  { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
];

// ===== SERVIÇO DO GEMINI =====
class GeminiService {
  private apiKey: string;
  private model: string;
  private baseUrl: string;

  constructor() {
    this.apiKey = GEMINI_CONFIG.apiKey;
    this.model = GEMINI_CONFIG.model;
    this.baseUrl = GEMINI_CONFIG.baseUrl;
  }

  /**
   * Verifica se a API key está configurada
   */
  isConfigured(): boolean {
    return !!this.apiKey;
  }

  /**
   * Retorna o modelo atual
   */
  getModel(): string {
    return this.model;
  }

  /**
   * Altera o modelo em runtime (útil para testes)
   */
  setModel(model: string): void {
    this.model = model;
  }

  /**
   * Gera uma resposta baseada na mensagem do usuário
   */
  async generateContent(options: GeminiRequestOptions): Promise<GeminiResponse> {
    if (!this.isConfigured()) {
      return {
        success: false,
        error: 'Gemini API key is not configured',
      };
    }

    const {
      systemPrompt,
      userMessage,
      messages,
      generationConfig = DEFAULT_GENERATION_CONFIG,
      safetySettings = DEFAULT_SAFETY_SETTINGS,
    } = options;

    // Monta o conteúdo da requisição
    let contents: GeminiMessage[] = [];

    if (messages) {
      contents = messages;
    } else if (userMessage) {
      const fullMessage = systemPrompt
        ? `${systemPrompt}\n\nUsuário: ${userMessage}`
        : userMessage;

      contents = [{
        role: 'user',
        parts: [{ text: fullMessage }],
      }];
    }

    const url = `${this.baseUrl}/${this.model}:generateContent?key=${this.apiKey}`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents,
          generationConfig,
          safetySettings,
        }),
      });

      const data = await response.json() as any;

      if (!response.ok) {
        console.error('[GeminiService] API error:', data);
        return {
          success: false,
          error: data.error?.message || 'Gemini API request failed',
          rawResponse: data,
        };
      }

      // Extrai o texto da resposta
      if (data.candidates?.[0]?.content?.parts?.[0]?.text) {
        return {
          success: true,
          text: data.candidates[0].content.parts[0].text.trim(),
          rawResponse: data,
        };
      }

      // Verifica se foi bloqueado por segurança
      if (data.promptFeedback?.blockReason) {
        console.error('[GeminiService] Prompt blocked:', data.promptFeedback);
        return {
          success: false,
          error: `Mensagem bloqueada: ${data.promptFeedback.blockReason}`,
          rawResponse: data,
        };
      }

      // Resposta inesperada
      console.error('[GeminiService] Unexpected response structure:', data);
      return {
        success: false,
        error: 'Unexpected response from Gemini API',
        rawResponse: data,
      };

    } catch (error: any) {
      console.error('[GeminiService] Error:', error);
      return {
        success: false,
        error: error.message || 'Failed to connect to Gemini API',
      };
    }
  }

  /**
   * Método simplificado para chat
   */
  async chat(userMessage: string, systemPrompt?: string): Promise<GeminiResponse> {
    return this.generateContent({
      userMessage,
      systemPrompt,
    });
  }
}

// Exporta instância singleton
export const geminiService = new GeminiService();

// Exporta tipos para uso externo
export type { GeminiMessage, GeminiGenerationConfig, GeminiRequestOptions, GeminiResponse };

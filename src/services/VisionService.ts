import fetch from 'node-fetch';

// ===== CONFIGURAÇÃO CENTRALIZADA DO GOOGLE VISION =====
const VISION_CONFIG = {
  apiKey: process.env.GOOGLE_VISION_API_KEY || '',
  baseUrl: 'https://vision.googleapis.com/v1/images:annotate',
};

// ===== TIPOS =====
interface VisionApiResponse {
  responses: Array<{
    fullTextAnnotation?: {
      text: string;
    };
    error?: {
      message: string;
      details?: any;
    };
  }>;
  error?: {
    message: string;
    details?: any;
  };
}

interface VisionResult {
  success: boolean;
  text?: string;
  error?: string;
  details?: any;
}

// ===== SERVIÇO DO GOOGLE VISION =====
class VisionService {
  private apiKey: string;
  private baseUrl: string;

  constructor() {
    this.apiKey = VISION_CONFIG.apiKey;
    this.baseUrl = VISION_CONFIG.baseUrl;
  }

  /**
   * Verifica se a API key está configurada
   */
  isConfigured(): boolean {
    return !!this.apiKey;
  }

  /**
   * Extrai texto de uma imagem em base64
   */
  async extractText(base64Image: string): Promise<VisionResult> {
    if (!this.isConfigured()) {
      return {
        success: false,
        error: 'Google Vision API key is not configured',
      };
    }

    const url = `${this.baseUrl}?key=${this.apiKey}`;

    const requestPayload = {
      requests: [
        {
          image: {
            content: base64Image,
          },
          features: [{ type: 'TEXT_DETECTION', maxResults: 10 }],
          imageContext: {
            languageHints: ['pt-BR', 'pt'],
          },
        },
      ],
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        body: JSON.stringify(requestPayload),
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const result = await response.json() as VisionApiResponse;

      if (!response.ok) {
        console.error('[VisionService] Google Vision API error:', result);
        const errorMessage = result.error?.message ||
          (result.responses?.[0]?.error?.message) ||
          'Erro ao comunicar com a API Google Vision.';
        return {
          success: false,
          error: errorMessage,
          details: result.error?.details || result.responses?.[0]?.error?.details,
        };
      }

      // Sucesso - texto extraído
      if (result.responses?.[0]?.fullTextAnnotation?.text) {
        return {
          success: true,
          text: result.responses[0].fullTextAnnotation.text,
        };
      }

      // Erro na resposta
      if (result.responses?.[0]?.error) {
        console.error('[VisionService] Response error:', result.responses[0].error);
        return {
          success: false,
          error: result.responses[0].error.message,
          details: result.responses[0].error.details,
        };
      }

      // Nenhum texto detectado
      return {
        success: false,
        error: 'Nenhum texto detectado na imagem.',
      };

    } catch (error: any) {
      console.error('[VisionService] Error:', error);
      return {
        success: false,
        error: error.message || 'Falha ao conectar com Google Vision API',
      };
    }
  }
}

// Exporta instância singleton
export const visionService = new VisionService();

// Exporta tipos para uso externo
export type { VisionResult };

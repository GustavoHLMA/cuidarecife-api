import fetch from 'node-fetch';
import sharp from 'sharp';

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
   * Redimensiona e comprime a imagem para garantir que fique abaixo do limite do Google (10MB)
   * e otimiza para OCR (max 1600px costuma ser o ideal).
   */
  private async optimizeImage(base64Image: string): Promise<string> {
    try {
      // Remove prefixo de data URI se existir
      const base64Data = base64Image.replace(/^data:image\/\w+;base64,/, '');
      const buffer = Buffer.from(base64Data, 'base64');

      // Comprime a imagem para JPEG com qualidade 80 e redimensiona para max 1600px
      // Isso reduz imagens de 20mb para ~500kb mantendo a leitura perfeita
      const optimizedBuffer = await sharp(buffer)
        .resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toBuffer();

      return optimizedBuffer.toString('base64');
    } catch (error) {
      console.warn('[VisionService] Falha ao otimizar imagem, tentando enviar original:', error);
      return base64Image.replace(/^data:image\/\w+;base64,/, '');
    }
  }

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

    // Otimização automática: reduz o tamanho e garante compatibilidade com o limite de 10MB do Google
    const optimizedBase64 = await this.optimizeImage(base64Image);

    const url = `${this.baseUrl}?key=${this.apiKey}`;

    const requestPayload = {
      requests: [
        {
          image: {
            content: optimizedBase64,
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

export const visionService = new VisionService();
export type { VisionResult };

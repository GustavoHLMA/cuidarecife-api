import { Request, Response } from 'express';

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

interface VisionRequest extends Request {
  body: {
    image: string;
  };
}

export class VisionController {
  async analyzeImage(req: VisionRequest, res: Response): Promise<void> {
    try {
      const { image: base64ImageData } = req.body;
      const apiKey = process.env.GOOGLE_VISION_API_KEY;

      if (!base64ImageData) {
        res.status(400).json({ message: 'Nenhuma imagem fornecida.' });
        return;
      }

      if (!apiKey) {
        console.error('Erro: A variável de ambiente GOOGLE_VISION_API_KEY não está definida.');
        res.status(500).json({ message: 'Configuração do servidor incompleta: chave da API não encontrada.' });
        return;
      }

      const apiUrl = `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`;

      const requestPayload = {
        requests: [
          {
            image: {
              content: base64ImageData,
            },
            features: [{ type: 'TEXT_DETECTION', maxResults: 10 }],
            imageContext: {
              languageHints: ['pt-BR', 'pt'],
            },
          },
        ],
      };

      const visionApiResponse = await fetch(apiUrl, {
        method: 'POST',
        body: JSON.stringify(requestPayload),
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const result = await visionApiResponse.json() as VisionApiResponse;
      if (!visionApiResponse.ok) {
        console.error('Erro da API Google Vision:', result);
        const errorMessage = result.error?.message || (result.responses && result.responses[0]?.error?.message) || 'Erro ao comunicar com a API Google Vision.';
        const errorDetails = result.error?.details || (result.responses && result.responses[0]?.error?.details);
        res.status(visionApiResponse.status).json({ message: errorMessage, details: errorDetails });
        return;
      }

      if (result.responses && result.responses[0] && result.responses[0].fullTextAnnotation) {
        const extractedText = result.responses[0].fullTextAnnotation.text;
        res.status(200).json({ extractedText });
      } else if (result.responses && result.responses[0] && result.responses[0].error) {
        console.error('Erro na resposta da API Google Vision:', result.responses[0].error.message);
        res.status(400).json({ message: result.responses[0].error.message, details: result.responses[0].error.details });
      } else {
        res.status(404).json({ message: 'Nenhum texto detectado ou resposta inesperada da API.' });
      }
    } catch (error: any) {
      console.error('Erro interno ao processar imagem:', error);
      res.status(500).json({
        message: 'Erro interno do servidor ao analisar imagem.',
        error: error.message,
      });
    }
  }
}

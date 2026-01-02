import { Request, Response } from 'express';
import { visionService } from '../services';

interface VisionRequest extends Request {
  body: {
    image: string;
  };
}

export class VisionController {
  async analyzeImage(req: VisionRequest, res: Response): Promise<void> {
    try {
      const { image: base64ImageData } = req.body;

      if (!base64ImageData) {
        res.status(400).json({ message: 'Nenhuma imagem fornecida.' });
        return;
      }

      if (!visionService.isConfigured()) {
        console.error('[Vision] Google Vision API key is not configured.');
        res.status(500).json({ message: 'Configuração do servidor incompleta: chave da API não encontrada.' });
        return;
      }

      const result = await visionService.extractText(base64ImageData);

      if (!result.success) {
        res.status(400).json({ message: result.error, details: result.details });
        return;
      }

      res.status(200).json({ extractedText: result.text });
    } catch (error: any) {
      console.error('[Vision] Erro interno ao processar imagem:', error);
      res.status(500).json({
        message: 'Erro interno do servidor ao analisar imagem.',
        error: error.message,
      });
    }
  }
}


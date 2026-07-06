import { Request, Response } from 'express';
import prisma from '../db';

class RiskPointController {

  /**
   * Lista pontos de risco de acesso — filtrados por microárea.
   * GET /risk-points?microarea=01
   */
  public async list(req: Request, res: Response): Promise<void> {
    try {
      const microarea = req.query.microarea as string | undefined;

      const where: any = {};
      if (microarea && microarea !== 'all') {
        where.microarea = { in: microarea.split(',') };
      }

      const points = await prisma.riskPoint.findMany({
        where,
        orderBy: { createdAt: 'desc' },
      });

      // Buscar os nomes dos profissionais que criaram os pontos
      const creatorIds = Array.from(new Set(points.map(p => p.createdBy).filter(Boolean))) as string[];
      let professionals: Record<string, string> = {};
      
      if (creatorIds.length > 0) {
        const profs = await prisma.professional.findMany({
          where: { id: { in: creatorIds } },
          select: { id: true, name: true },
        });
        professionals = profs.reduce((acc, p) => ({ ...acc, [p.id]: p.name }), {} as Record<string, string>);
      }

      const pointsWithCreator = points.map(p => ({
        ...p,
        creatorName: p.createdBy ? (professionals[p.createdBy] || 'Profissional') : null
      }));

      res.json(pointsWithCreator);
    } catch (error) {
      console.error('[RiskPoints] Error listing:', error);
      res.status(500).json({ error: 'Failed to fetch risk points' });
    }
  }


  /**
   * Cria um novo ponto de risco no mapa.
   * POST /risk-points  { type, lat, lng, microarea?, label? }
   */
  public async create(req: Request, res: Response): Promise<void> {
    try {
      const { type, lat, lng, microarea, label } = req.body;

      if (!type || lat === undefined || lng === undefined) {
        res.status(400).json({ error: 'type, lat e lng são obrigatórios' });
        return;
      }

      const validTypes = ['STAIRS', 'SLOPE', 'UNPAVED', 'FLOODING', 'RUBBLE', 'OTHER'];
      if (!validTypes.includes(type)) {
        res.status(400).json({ error: `type inválido. Use: ${validTypes.join(', ')}` });
        return;
      }

      const user = (req as any).user;
      const createdBy = user?.userId || user?.id || null;

      const point = await prisma.riskPoint.create({
        data: {
          type,
          lat: parseFloat(lat),
          lng: parseFloat(lng),
          microarea: microarea || null,
          label: label || null,
          createdBy,
        },
      });

      res.status(201).json(point);
    } catch (error) {
      console.error('[RiskPoints] Error creating:', error);
      res.status(500).json({ error: 'Failed to create risk point' });
    }
  }

  /**
   * Atualiza um ponto de risco (posição, label, tipo).
   * PUT /risk-points/:id  { type?, lat?, lng?, label? }
   */
  public async update(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const { type, lat, lng, label } = req.body;

      const existing = await prisma.riskPoint.findUnique({ where: { id } });
      if (!existing) {
        res.status(404).json({ error: 'Ponto de risco não encontrado' });
        return;
      }

      const data: any = {};
      if (type) data.type = type;
      if (lat !== undefined) data.lat = parseFloat(lat);
      if (lng !== undefined) data.lng = parseFloat(lng);
      if (label !== undefined) data.label = label;

      const updated = await prisma.riskPoint.update({ where: { id }, data });
      res.json(updated);
    } catch (error) {
      console.error('[RiskPoints] Error updating:', error);
      res.status(500).json({ error: 'Failed to update risk point' });
    }
  }

  /**
   * Remove um ponto de risco do mapa.
   * DELETE /risk-points/:id
   */
  public async remove(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;

      const existing = await prisma.riskPoint.findUnique({ where: { id } });
      if (!existing) {
        res.status(404).json({ error: 'Ponto de risco não encontrado' });
        return;
      }

      await prisma.riskPoint.delete({ where: { id } });
      res.json({ message: 'Ponto de risco removido com sucesso' });
    } catch (error) {
      console.error('[RiskPoints] Error removing:', error);
      res.status(500).json({ error: 'Failed to remove risk point' });
    }
  }

}

export default new RiskPointController();

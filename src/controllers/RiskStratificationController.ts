import { Request, Response } from 'express';
import riskStratificationService from '../services/RiskStratificationService';

class RiskStratificationController {

  public getStratified(req: Request, res: Response): void {
    const { microarea } = req.query;
    const data = riskStratificationService.stratifyPatients(microarea as string | undefined);
    res.json(data);
  }

  public async getStratifiedPaginated(req: Request, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string, 10) || 1;
      const pageSize = parseInt(req.query.pageSize as string, 10) || 25;
      let microarea = req.query.microarea as string | undefined;
      let unidade = req.query.unidade as string | undefined;
      let ine = req.query.ine as string | undefined;

      const user = (req as any).user;
      
      // Enforce unidade restrictions
      if (user && user.unidades_saude && user.unidades_saude.length > 0) {
        if (!unidade || unidade === 'all') {
          unidade = user.unidades_saude.join(',');
        } else {
          const requested = unidade.split(',');
          const allowed = requested.filter(u => user.unidades_saude.includes(u));
          unidade = allowed.length > 0 ? allowed.join(',') : user.unidades_saude.join(',');
        }
      }

      // Enforce INE restrictions
      if (user && user.ine) {
        if (!ine || ine === 'all') {
          ine = user.ine;
        } else {
          const requested = ine.split(',');
          const allowed = requested.filter((i: string) => i === user.ine);
          ine = allowed.length > 0 ? allowed.join(',') : user.ine;
        }
      }

      // Enforce microarea restrictions
      if (user && user.microareas && user.microareas.length > 0) {
        if (!microarea || microarea === 'all') {
          microarea = user.microareas.join(',');
        } else {
          const requested = microarea.split(',');
          const allowed = requested.filter(m => user.microareas.includes(m));
          microarea = allowed.length > 0 ? allowed.join(',') : user.microareas.join(',');
        }
      }

      const search = req.query.search as string | undefined;
      const riskLevel = req.query.riskLevel as string | undefined;
      const ageMin = req.query.ageMin ? parseInt(req.query.ageMin as string, 10) : undefined;
      const ageMax = req.query.ageMax ? parseInt(req.query.ageMax as string, 10) : undefined;
      const consultMonths = req.query.consultMonths ? parseInt(req.query.consultMonths as string, 10) : undefined;
      
      let cids: string[] | undefined;
      if (req.query.cids) {
        cids = Array.isArray(req.query.cids)
          ? (req.query.cids as string[])
          : (req.query.cids as string).split(',');
      }

      const sex = req.query.sex as string | undefined;
      const smoking = req.query.smoking as string | undefined;

      const filters: any = {
        microarea,
        unidade,
        ine,
        search,
        riskLevel,
        ageRange: ageMin !== undefined && ageMax !== undefined ? [ageMin, ageMax] as [number, number] : undefined,
        cids,
        consultMonths,
        sex,
        smoking,
      };

      const result = await riskStratificationService.getStratifiedPaginated(page, pageSize, filters);
      res.json(result);
    } catch (error) {
      console.error('Error fetching paginated stratified patients:', error);
      res.status(500).json({ error: 'Failed to fetch patients' });
    }
  }

  public getDiabetics(req: Request, res: Response): void {
    const { microarea } = req.query;
    const data = riskStratificationService.getDiabeticPatients(microarea as string | undefined);
    res.json(data);
  }

  public getHypertensives(req: Request, res: Response): void {
    const { microarea } = req.query;
    const data = riskStratificationService.getHypertensivePatients(microarea as string | undefined);
    res.json(data);
  }

  public getAssistedLastTrimester(req: Request, res: Response): void {
    const data = riskStratificationService.getAssistedLastTrimester();
    res.json(data);
  }

  public getNeedingActiveSearch(req: Request, res: Response): void {
    const { microarea } = req.query;
    const data = riskStratificationService.getNeedingActiveSearch(microarea as string | undefined);
    res.json(data);
  }

  public getByCids(req: Request, res: Response): void {
    const { cids, microarea } = req.query;
    if (!cids || typeof cids !== 'string') {
      res.status(400).json({ error: 'Provide a comma-separated list of cids. Ex: ?cids=I10,E11.9' });
      return;
    }
    const cidsArray = cids.split(',').map(c => c.trim());
    const data = riskStratificationService.getByCids(cidsArray, microarea as string | undefined);
    res.json(data);
  }

  public async getMicroareas(req: Request, res: Response): Promise<void> {
    try {
      const data = await riskStratificationService.getMicroareas();
      res.json(data);
    } catch (e) {
      res.status(500).json([]);
    }
  }

  public async getEquipes(req: Request, res: Response): Promise<void> {
    try {
      const data = await riskStratificationService.getEquipes();
      res.json(data);
    } catch (e) {
      res.status(500).json([]);
    }
  }

  public async getTerritoryStats(req: Request, res: Response): Promise<void> {
    try {
      let microarea = req.query.microarea as string | undefined;
      let unidade = req.query.unidade as string | undefined;
      let ine = req.query.ine as string | undefined;

      const user = (req as any).user;
      
      // Enforce unidade restrictions
      if (user && user.unidades_saude && user.unidades_saude.length > 0) {
        if (!unidade || unidade === 'all') {
          unidade = user.unidades_saude.join(',');
        } else {
          const requested = unidade.split(',');
          const allowed = requested.filter(u => user.unidades_saude.includes(u));
          unidade = allowed.length > 0 ? allowed.join(',') : user.unidades_saude.join(',');
        }
      }

      // Enforce INE restrictions
      if (user && user.ine) {
        if (!ine || ine === 'all') {
          ine = user.ine;
        } else {
          const requested = ine.split(',');
          const allowed = requested.filter((i: string) => i === user.ine);
          ine = allowed.length > 0 ? allowed.join(',') : user.ine;
        }
      }

      // Enforce microarea restrictions
      if (user && user.microareas && user.microareas.length > 0) {
        if (!microarea || microarea === 'all') {
          microarea = user.microareas.join(',');
        } else {
          const requested = microarea.split(',');
          const allowed = requested.filter(m => user.microareas.includes(m));
          microarea = allowed.length > 0 ? allowed.join(',') : user.microareas.join(',');
        }
      }
      const stats = await riskStratificationService.getTerritoryStats(microarea, unidade, ine);
      res.json(stats);
    } catch (error) {
      console.error('Error fetching territory stats:', error);
      res.status(500).json({ error: 'Failed to fetch territory statistics' });
    }
  }

  public async getMapPatients(req: Request, res: Response): Promise<void> {
    try {
      let microarea = req.query.microarea as string | undefined;
      let unidade = req.query.unidade as string | undefined;
      let ine = req.query.ine as string | undefined;
      const condition = req.query.condition as string | undefined;

      const user = (req as any).user;

      // Enforce unidade restrictions
      if (user && user.unidades_saude && user.unidades_saude.length > 0) {
        if (!unidade || unidade === 'all') {
          unidade = user.unidades_saude.join(',');
        } else {
          const requested = unidade.split(',');
          const allowed = requested.filter((u: string) => user.unidades_saude.includes(u));
          unidade = allowed.length > 0 ? allowed.join(',') : user.unidades_saude.join(',');
        }
      }

      // Enforce INE restrictions
      if (user && user.ine) {
        if (!ine || ine === 'all') {
          ine = user.ine;
        } else {
          const requested = ine.split(',');
          const allowed = requested.filter((i: string) => i === user.ine);
          ine = allowed.length > 0 ? allowed.join(',') : user.ine;
        }
      }

      // Enforce microarea restrictions
      if (user && user.microareas && user.microareas.length > 0) {
        if (!microarea || microarea === 'all') {
          microarea = user.microareas[0]; // Default to first microarea
        } else {
          const requested = microarea.split(',');
          const allowed = requested.filter((m: string) => user.microareas.includes(m));
          microarea = allowed.length > 0 ? allowed.join(',') : user.microareas[0];
        }
      }

      const patients = await riskStratificationService.getMapPatients({
        microarea, ine, unidade, condition,
      });
      res.json(patients);
    } catch (error) {
      console.error('Error fetching map patients:', error);
      res.status(500).json({ error: 'Failed to fetch map patients' });
    }
  }

}

export default new RiskStratificationController();

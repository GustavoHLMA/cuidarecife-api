import { Request, Response } from 'express';
import riskStratificationService from '../services/RiskStratificationService';

class RiskStratificationController {

  public getStratified(req: Request, res: Response): void {
    const { microarea } = req.query;
    const data = riskStratificationService.stratifyPatients(microarea as string | undefined);
    res.json(data);
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

}

export default new RiskStratificationController();

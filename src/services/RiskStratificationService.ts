import { mockPatients, PatientMock } from '../mocks/patientsMock';

export enum RiskLevel {
  HIGH = 'HIGH', // Vermelho
  MEDIUM = 'MEDIUM', // Amarelo
  LOW = 'LOW', // Verde
}

export interface StratifiedPatient extends PatientMock {
  risk_level: RiskLevel;
  reason: string;
  recommended_action: string;
  return_deadline: string; // "7 dias", "1 mês", "6 meses"
}

export class RiskStratificationService {

  // Condições Alvo
  private hasCids = ["I10", "I11", "I11.0", "I12.9"];
  private dmCids = ["E10.9", "E11.9", "E13.9"];

  // Comorbidades agravantes
  private cardiovascularCids = ["I21", "I22", "I50", "I63", "I63.9"];
  private renalCids = ["N18", "N18.9", "N19"];
  private retinopatiaCids = ["H36.0"];
  private neuropatiaCids = ["G63.2"];
  private peDiabeticoCids = ["E10.5", "E11.5"];
  private obesidadeCids = ["E66.9"];

  private isHAS(patient: PatientMock): boolean {
    return patient.cids.some(cid => this.hasCids.some(h => cid.startsWith(h)));
  }

  private isDM(patient: PatientMock): boolean {
    return patient.cids.some(cid => this.dmCids.some(d => cid.startsWith(d)));
  }

  private hasHighRiskComorbidity(patient: PatientMock): boolean {
    const highRiskCids = [
      ...this.cardiovascularCids,
      ...this.renalCids,
      ...this.retinopatiaCids,
      ...this.neuropatiaCids,
      ...this.peDiabeticoCids
    ];
    return patient.cids.some(cid => highRiskCids.some(h => cid.startsWith(h)));
  }

  // --- O ALGORITMO DE ESTRATIFICAÇÃO ---
  public stratifyPatients(microarea?: string): StratifiedPatient[] {
    let patients = mockPatients;
    if (microarea) {
      patients = patients.filter(p => p.microarea === microarea);
    }

    return patients.map(patient => {
      let riskLevel = RiskLevel.LOW;
      let reason = "Dentro das metas terapêuticas. Manter acompanhamento.";
      let action = "Manter acompanhamento conforme protocolo.";
      let deadline = "6 meses";

      const paSistolica = patient.ultima_pa_sistolica ?? 0;
      const paDiastolica = patient.ultima_pa_diastolica ?? 0;
      const hba1c = patient.ultimo_hba1c ?? 0;
      const imc = patient.imc ?? 0;

      // 1. CHECAGENS DE ALTO RISCO (VERMELHO)
      if (
        paSistolica >= 180 ||
        paDiastolica >= 110 ||
        hba1c > 9 ||
        this.hasHighRiskComorbidity(patient)
      ) {
        riskLevel = RiskLevel.HIGH;
        deadline = "7 dias";
        action = "Agendar consulta médica ou visita domiciliar urgente.";

        const reasons = [];
        if (paSistolica >= 180 || paDiastolica >= 110) reasons.push("PA >= 180/110");
        if (hba1c > 9) reasons.push("HbA1c > 9%");
        if (this.hasHighRiskComorbidity(patient)) reasons.push("Comorbidade de Alto Risco presente");

        reason = reasons.join(" + ");
      }
      // 2. CHECAGENS DE MÉDIO RISCO (AMARELO)
      else if (
        (paSistolica >= 160 && paSistolica <= 179) ||
        (paDiastolica >= 100 && paDiastolica <= 109) ||
        (hba1c > 7 && hba1c <= 9) ||
        (patient.idade > (patient.sexo === 'M' ? 55 : 65)) ||
        imc >= 30 ||
        (this.isHAS(patient) && this.isDM(patient)) // Sinergia perigosa HAS + DM
      ) {
        riskLevel = RiskLevel.MEDIUM;
        deadline = "1 mês";
        action = "Agendar retorno com médico/enfermeiro para ajuste terapêutico.";

        const reasons = [];
        if ((paSistolica >= 160 && paSistolica <= 179) || (paDiastolica >= 100 && paDiastolica <= 109)) reasons.push("PA 160-179/100-109");
        if (hba1c > 7 && hba1c <= 9) reasons.push("HbA1c 7.1 a 9%");
        if (imc >= 30) reasons.push("Obesidade (IMC > 30)");
        if (this.isHAS(patient) && this.isDM(patient)) reasons.push("HAS + DM");
        if (patient.idade > (patient.sexo === 'M' ? 55 : 65)) reasons.push("Idade de risco associada");

        reason = reasons.length > 0 ? reasons.join(" + ") : "Múltiplos fatores de risco (Idade/Condição)";
      }

      return {
        ...patient,
        risk_level: riskLevel,
        reason,
        recommended_action: action,
        return_deadline: deadline,
      };
    });
  }

  // --- FILTROS ESPECÍFICOS SOLICITADOS ---

  public getDiabeticPatients(microarea?: string) {
    let list = mockPatients.filter(p => this.isDM(p));
    if (microarea) list = list.filter(p => p.microarea === microarea);
    return list;
  }

  public getHypertensivePatients(microarea?: string) {
    let list = mockPatients.filter(p => this.isHAS(p));
    if (microarea) list = list.filter(p => p.microarea === microarea);
    return list;
  }

  public getAssistedLastTrimester() {
    const trimestresAtrasDate = new Date();
    trimestresAtrasDate.setMonth(trimestresAtrasDate.getMonth() - 3);

    return mockPatients.filter(p => {
      if (!p.data_ultima_consulta) return false;
      const dataConsulta = new Date(p.data_ultima_consulta);
      return dataConsulta >= trimestresAtrasDate && (this.isHAS(p) || this.isDM(p));
    });
  }

  public getNeedingActiveSearch(microarea?: string) {
    const seisMesesAtrasDate = new Date();
    seisMesesAtrasDate.setMonth(seisMesesAtrasDate.getMonth() - 6);

    let list = mockPatients;
    if (microarea) {
      list = list.filter(p => p.microarea === microarea);
    }

    return list.filter(p => {
      const condition = this.isHAS(p) || this.isDM(p);
      if (!condition) return false;

      if (!p.data_ultima_consulta) return true; // Nunca consultou
      const dataConsulta = new Date(p.data_ultima_consulta);
      return dataConsulta < seisMesesAtrasDate;
    });
  }

  public getByCids(cids: string[], microarea?: string) {
    let list = mockPatients.filter(p => {
      return p.cids.some(pc => cids.some(targetCid => pc.startsWith(targetCid)));
    });
    if (microarea) list = list.filter(p => p.microarea === microarea);
    return list;
  }
}

export default new RiskStratificationService();

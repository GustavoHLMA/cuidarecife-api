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

  // =====================================================================
  // CIDs das Condições-Alvo (identificam quem entra no programa)
  // =====================================================================
  private hasCids = ["I10"]; // HAS essencial (primária)
  private dmCids = ["E10.9", "E11.9", "E13.9"];

  // =====================================================================
  // CIDs que AUTO-ELEVAM para Alto Risco
  // Baseado no Protocolo Municipal do Recife e Cadernos de Atenção Primária MS
  // =====================================================================

  // CIDs de HAS com complicação já estabelecida (auto Alto Risco)
  private hasComplicadaCids = ["I11.0", "I12.9"]; // HAS com ICC, Doença Renal Hipertensiva

  // Comorbidades cardiovasculares graves
  private cardiovascularCids = ["I21", "I22", "I50", "I63"]; // IAM, IAM recorrente, ICC, AVC

  // Doença Renal Crônica
  private renalCids = ["N18", "N19"]; // DRC, Insuficiência renal

  // Complicações específicas do DM
  private retinopatiaCids = ["H36.0"]; // Retinopatia diabética
  private neuropatiaCids = ["G63.2"]; // Polineuropatia diabética
  private peDiabeticoCids = ["E10.5", "E11.5"]; // Pé diabético

  // Obesidade (fator de risco que agrava)
  private obesidadeCids = ["E66.9"];

  // =====================================================================
  // CHECAGENS
  // =====================================================================

  private isHAS(patient: PatientMock): boolean {
    return patient.cids.some(cid =>
      this.hasCids.some(h => cid.startsWith(h)) ||
      this.hasComplicadaCids.some(h => cid.startsWith(h))
    );
  }

  private isDM(patient: PatientMock): boolean {
    return patient.cids.some(cid => this.dmCids.some(d => cid.startsWith(d)));
  }

  /** CIDs que automaticamente = ALTO RISCO (complicações/comorbidades graves) */
  private hasHighRiskComorbidity(patient: PatientMock): boolean {
    const highRiskCids = [
      ...this.hasComplicadaCids,  // I11.0, I12.9 — HAS com complicação
      ...this.cardiovascularCids, // I21, I22, I50, I63
      ...this.renalCids,          // N18, N19
      ...this.retinopatiaCids,    // H36.0
      ...this.neuropatiaCids,     // G63.2
      ...this.peDiabeticoCids     // E10.5, E11.5
    ];
    return patient.cids.some(cid => highRiskCids.some(h => cid.startsWith(h)));
  }

  /** PA não controlada = PA >= 140/90  */
  private isPANaoControlada(patient: PatientMock): boolean {
    const pa_s = patient.ultima_pa_sistolica ?? 0;
    const pa_d = patient.ultima_pa_diastolica ?? 0;
    return pa_s >= 140 || pa_d >= 90;
  }

  /** DM há mais de 10 anos */
  private isDMMoreThan10Years(patient: PatientMock): boolean {
    if (!patient.data_diagnostico_dm) return false;
    const diagDate = new Date(patient.data_diagnostico_dm);
    const dezAnosAtras = new Date();
    dezAnosAtras.setFullYear(dezAnosAtras.getFullYear() - 10);
    return diagDate < dezAnosAtras;
  }

  // =====================================================================
  // O ALGORITMO DE ESTRATIFICAÇÃO
  // Baseado integralmente no Protocolo Municipal do Recife,
  // Diretrizes da SBD e Cadernos de Atenção Primária nº 36 e 37 do MS.
  // =====================================================================
  public stratifyPatients(microarea?: string): StratifiedPatient[] {
    let patients = mockPatients;
    if (microarea) {
      patients = patients.filter(p => p.microarea === microarea);
    }

    return patients.map(patient => {
      let riskLevel = RiskLevel.LOW;
      let reason = "Dentro das metas terapêuticas. Manter acompanhamento.";
      let action = "Manter acompanhamento conforme protocolo (retorno a cada 4 a 6 meses). Incentivar manutenção do estilo de vida.";
      let deadline = "6 meses";

      const paSistolica = patient.ultima_pa_sistolica ?? 0;
      const paDiastolica = patient.ultima_pa_diastolica ?? 0;
      const hba1c = patient.ultimo_hba1c ?? 0;
      const glicemiaJejum = patient.glicemia_jejum ?? 0;
      const imc = patient.imc ?? 0;

      // ============================================
      // 1. CHECAGENS DE ALTO RISCO (VERMELHO)
      // ============================================
      const highRiskReasons: string[] = [];

      // --- HAS: PA >= 180/110 (HAS Estágio 3) ---
      if (paSistolica >= 180 || paDiastolica >= 110) {
        highRiskReasons.push("PA ≥ 180/110 mmHg (HAS Estágio 3)");
      }

      // --- HAS: PA não controlada + DCV estabelecida (ICC, DAC, AVC) ---
      if (this.isPANaoControlada(patient) &&
        patient.cids.some(cid => this.cardiovascularCids.some(cv => cid.startsWith(cv)))) {
        highRiskReasons.push("PA não controlada + doença cardiovascular estabelecida");
      }

      // --- HAS: PA não controlada + DM ---
      if (this.isPANaoControlada(patient) && this.isDM(patient)) {
        highRiskReasons.push("PA não controlada + Diabetes Mellitus");
      }

      // --- DM: HbA1c > 9% ---
      if (hba1c > 9) {
        highRiskReasons.push("HbA1c > 9%");
      }

      // --- DM: Glicemia de jejum > 250 mg/dL ---
      if (glicemiaJejum > 250) {
        highRiskReasons.push("Glicemia de jejum > 250 mg/dL");
      }

      // --- DM: Hipoglicemias graves ou frequentes ---
      if (patient.hipoglicemias_graves) {
        highRiskReasons.push("Histórico de hipoglicemias graves/frequentes");
      }

      // --- Comorbidade de Alto Risco (CIDs elevadores) ---
      if (this.hasHighRiskComorbidity(patient)) {
        const comorbNames: string[] = [];
        if (patient.cids.some(c => this.hasComplicadaCids.some(h => c.startsWith(h)))) comorbNames.push("HAS com complicação (IC/Renal)");
        if (patient.cids.some(c => this.cardiovascularCids.some(h => c.startsWith(h)))) comorbNames.push("Doença cardiovascular (ICC/AVC/IAM)");
        if (patient.cids.some(c => this.renalCids.some(h => c.startsWith(h)))) comorbNames.push("Doença Renal Crônica");
        if (patient.cids.some(c => this.retinopatiaCids.some(h => c.startsWith(h)))) comorbNames.push("Retinopatia diabética");
        if (patient.cids.some(c => this.neuropatiaCids.some(h => c.startsWith(h)))) comorbNames.push("Neuropatia diabética");
        if (patient.cids.some(c => this.peDiabeticoCids.some(h => c.startsWith(h)))) comorbNames.push("Pé diabético");
        highRiskReasons.push(comorbNames.join(", "));
      }

      // --- DRC isolada ---
      if (patient.cids.some(c => this.renalCids.some(r => c.startsWith(r)))) {
        if (!highRiskReasons.some(r => r.includes("Renal"))) {
          highRiskReasons.push("Doença Renal Crônica");
        }
      }

      if (highRiskReasons.length > 0) {
        riskLevel = RiskLevel.HIGH;
        deadline = "7 dias";
        reason = highRiskReasons.join(" + ");

        if (this.isDM(patient)) {
          action = "Agendar consulta médica em até 7 dias. Paciente requer reavaliação urgente do esquema terapêutico.";
        } else {
          action = "Agendar consulta médica ou visita domiciliar em até 7 dias.";
        }
      }

      // ============================================
      // 2. CHECAGENS DE MÉDIO RISCO (AMARELO)
      // (Só se NÃO for Alto Risco)
      // ============================================
      else {
        const mediumRiskReasons: string[] = [];

        // --- HAS: PA 160-179/100-109 (HAS Estágio 2) ---
        if ((paSistolica >= 160 && paSistolica <= 179) || (paDiastolica >= 100 && paDiastolica <= 109)) {
          mediumRiskReasons.push("PA 160-179/100-109 mmHg (HAS Estágio 2)");
        }

        // --- HAS: PA controlada + fatores de risco ---
        if (!this.isPANaoControlada(patient) || (paSistolica < 160 && paDiastolica < 100)) {
          if (patient.tabagismo) mediumRiskReasons.push("Tabagismo");
          if (patient.dislipidemia) mediumRiskReasons.push("Dislipidemia");
          if (patient.historico_familiar_precoce) mediumRiskReasons.push("Histórico familiar de DCV precoce");
        }

        // --- DM: HbA1c entre 7.1% e 9% ---
        if (hba1c > 7 && hba1c <= 9) {
          mediumRiskReasons.push("HbA1c entre 7,1% e 9%");
        }

        // --- DM: Glicemia de jejum entre 126-250 mg/dL ---
        if (glicemiaJejum >= 126 && glicemiaJejum <= 250) {
          mediumRiskReasons.push("Glicemia de jejum 126-250 mg/dL");
        }

        // --- Obesidade (IMC >= 30) ---
        if (imc >= 30) {
          mediumRiskReasons.push("Obesidade (IMC ≥ 30)");
        }

        // --- Idade de risco: > 55 (H) / > 65 (M) ---
        if (patient.idade > (patient.sexo === 'M' ? 55 : 65)) {
          mediumRiskReasons.push(`Idade de risco (${patient.idade} anos)`);
        }

        // --- Sinergia HAS + DM (mínimo Médio Risco) ---
        if (this.isHAS(patient) && this.isDM(patient)) {
          mediumRiskReasons.push("Sinergia HAS + DM");
        }

        // --- DM há mais de 10 anos (sem complicações) ---
        if (this.isDMMoreThan10Years(patient)) {
          mediumRiskReasons.push("Diabetes há mais de 10 anos");
        }

        if (mediumRiskReasons.length > 0) {
          riskLevel = RiskLevel.MEDIUM;
          deadline = "1 mês";
          reason = mediumRiskReasons.join(" + ");

          if (this.isDM(patient)) {
            action = "Agendar retorno com equipe multiprofissional (médico/enfermeiro/nutricionista) em até 1 mês.";
          } else {
            action = "Agendar retorno com médico ou enfermeiro em até 1 mês.";
          }
        }
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

  // --- FILTROS ESPECÍFICOS ---

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

      if (!p.data_ultima_consulta) return true;
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

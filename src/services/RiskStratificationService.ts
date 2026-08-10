import { mockPatients, PatientMock } from '../mocks/patientsMock';
import { pecQuery, isPecConfigured } from '../db/pecDb';
import prisma from '../db';

export enum RiskLevel {
  VERY_HIGH = 'VERY_HIGH',
  HIGH = 'HIGH',
  MEDIUM = 'MEDIUM',
  LOW = 'LOW',
  VERY_LOW = 'VERY_LOW',
  INDIVIDUALIZED = 'INDIVIDUALIZED',
  INDIVIDUALIZED_YOUNG = 'INDIVIDUALIZED_YOUNG',
  INDIVIDUALIZED_ELDERLY = 'INDIVIDUALIZED_ELDERLY',
}

export interface StratifiedPatient extends PatientMock {
  risk_level: RiskLevel;
  reason: string;
  recommended_action: string;
  return_deadline: string;
}

export class RiskStratificationService {
  // CIDs expandidos — usa prefixo para cobrir todas as variações do PEC
  // HAS: I10 (essencial), I11 (c/ cardiopatia), I12 (c/ nefropatia), I13 (c/ nefro+cardio), I15 (secundária)
  private hasCids = ["I10", "I11", "I12", "I13", "I15"];
  // DM: E10 (tipo 1), E11 (tipo 2), E12 (desnutrição), E13 (outros), E14 (inespecífico)
  private dmCids = ["E10", "E11", "E12", "E13", "E14"];
  private hasComplicadaCids = ["I11.0", "I12.9", "I13"];
  // Cardiovascular: I21-I22 (IAM), I50 (ICC), I60-I64 (AVC hemorrágico/isquêmico)
  private cardiovascularCids = ["I21", "I22", "I50", "I60", "I61", "I62", "I63", "I64"];
  // DCV estabelecida — bypass direto para VERY_HIGH (Seção 3 do PCDT)
  // Coronariana, cerebrovascular, arterial periférica
  private dcvCids = ["I20", "I21", "I22", "I23", "I24", "I25", "I60", "I61", "I62", "I63", "I64", "I65", "I66", "I67", "I69", "I70", "I71", "I72", "I73", "I74"];
  // LOA — Lesão em Órgão-Alvo (Seção 4 do PCDT)
  private loaCids = ["I50", "I48", "I71", "I72", "N18", "N19", "H36.0", "H35.0"];
  private renalCids = ["N18", "N19"];
  private retinopatiaCids = ["H36.0"];
  // Neuropatia: G63.2 + G46 (síndromes vasculares cerebrais) + G30 (Alzheimer — risco crônico degenerativo)
  private neuropatiaCids = ["G63.2", "G46", "G30"];
  // Demência: F00-F03
  private demenciaCids = ["F00", "F01", "F02", "F03"];
  private peDiabeticoCids = ["E10.5", "E11.5"];
  private obesidadeCids = ["E66"];

  // Mapeamento CIAP → condição (para registros sem CID formal)
  private ciapToCondition: Record<string, string> = {
    'K86': 'HAS', 'K87': 'HAS_COMPLICADA',
    'T89': 'DM', 'T90': 'DM',
    'K75': 'IAM', 'K77': 'ICC', 'K90': 'AVC',
    'U99': 'DRC', 'T82': 'OBESIDADE',
  };

  // ── Classificação de PA (Quadro 1 do PCDT HAS) ──
  private classifyPA(pas: number | null, pad: number | null): string {
    if (!pas && !pad) return 'Sem Registro';
    const s = pas || 0;
    const d = pad || 0;
    if (s >= 180 || d >= 110) return 'HAS Grau 3';
    if (s >= 160 || d >= 100) return 'HAS Grau 2';
    if (s >= 140 || d >= 90) return 'HAS Grau 1';
    if (s >= 130 || d >= 85) return 'Normal Alta';
    if (s >= 120 || d >= 80) return 'Normal';
    return 'PA Ótima';
  }

  // ── Fórmula CKD-EPI (TFGe a partir da Creatinina Sérica — Item 9 do PCDT) ──
  // TFG = 141 × min(Scr/k, 1)^a × max(Scr/k, 1)^-1.209 × 0.993^idade × (1.018 [se mulher])
  private calculateCKDEPI(scr: number, idade: number, sexo: string): number {
    if (!scr || scr <= 0 || !idade) return 90;
    const isFemale = sexo === 'F' || sexo === 'FEMININO';
    const k = isFemale ? 0.7 : 0.9;
    const a = isFemale ? -0.329 : -0.411;
    const genderFactor = isFemale ? 1.018 : 1.0;

    const ratio = scr / k;
    const minPart = Math.pow(Math.min(ratio, 1), a);
    const maxPart = Math.pow(Math.max(ratio, 1), -1.209);
    const agePart = Math.pow(0.993, idade);

    return Math.round(141 * minPart * maxPart * agePart * genderFactor * 10) / 10;
  }

  // ── Calculadora HEARTS/OPAS/OMS ──
  // Suporta os 2 caminhos oficiais do PCDT (Com Colesterol e Sem Colesterol/IMC)
  // Entradas: sexo, idade, tabagismo, diabetes, PAS, IMC, colesterolTotal (opcional)
  // Saída: porcentagem de risco estimada em 10 anos (0-100)
  private calculateHEARTS(
    sexo: string, 
    idade: number, 
    fumante: boolean, 
    diabetico: boolean, 
    pas: number, 
    imc: number, 
    colesterolTotal?: number | null
  ): number {
    let baseScore = 0;
    const isMasc = sexo === 'M' || sexo === 'MASCULINO';

    // Pontuação por Sexo + Idade
    if (isMasc) {
      if (idade >= 70) baseScore = 14;
      else if (idade >= 60) baseScore = 10;
      else if (idade >= 50) baseScore = 6;
      else baseScore = 3; // 40-49
    } else {
      if (idade >= 70) baseScore = 10;
      else if (idade >= 60) baseScore = 7;
      else if (idade >= 50) baseScore = 4;
      else baseScore = 2; // 40-49
    }

    // Tabagismo
    if (fumante) baseScore += 4;

    // Diabetes
    if (diabetico) baseScore += 5;

    // Pressão Arterial Sistólica
    if (pas >= 180) baseScore += 8;
    else if (pas >= 160) baseScore += 6;
    else if (pas >= 140) baseScore += 4;
    else if (pas >= 120) baseScore += 2;

    // CAMINHO 1: COM COLESTEROL TOTAL (Preferencial — Seção 2 do PCDT)
    if (colesterolTotal && colesterolTotal > 0) {
      if (colesterolTotal >= 300) baseScore += 8;
      else if (colesterolTotal >= 250) baseScore += 6;
      else if (colesterolTotal >= 200) baseScore += 4;
      else if (colesterolTotal >= 150) baseScore += 2;
      // < 150: +0
    } 
    // CAMINHO 2: SEM COLESTEROL TOTAL (Usando IMC — Seção 2 do PCDT)
    else {
      if (imc >= 35) baseScore += 4;
      else if (imc >= 30) baseScore += 3;
      else if (imc >= 25) baseScore += 2;
      else if (imc >= 20) baseScore += 1;
      // < 20: +0
    }

    // Converter pontuação para % de risco estimado (ELSA-Brasil)
    if (baseScore >= 25) return 25; // ≥20% (Muito Alto Risco)
    if (baseScore >= 18) return 15; // 10-20% (Alto Risco)
    if (baseScore >= 12) return 7;  // 5-10% (Moderado Risco)
    if (baseScore >= 6) return 3;   // <5% (Baixo Risco)
    return 1;                       // <5% (Muito Baixo Risco)
  }

  // ── Classificar risco HEARTS pela porcentagem ──
  private heartsRiskLevel(riskPct: number, isDM: boolean): RiskLevel {
    if (riskPct >= 20) return RiskLevel.VERY_HIGH;
    if (riskPct >= 10) return RiskLevel.HIGH;
    if (riskPct >= 5) return RiskLevel.MEDIUM;
    if (isDM) return RiskLevel.LOW; // DM nunca vai para VERY_LOW
    return RiskLevel.LOW;
  }

  private isHAS(patient: PatientMock): boolean {
    if ((patient as any).flag_has === 1) return true;
    return patient.cids.some(cid =>
      this.hasCids.some(h => cid.startsWith(h)) ||
      this.hasComplicadaCids.some(h => cid.startsWith(h))
    );
  }

  private isDM(patient: PatientMock): boolean {
    if ((patient as any).flag_dm === 1) return true;
    return patient.cids.some(cid => this.dmCids.some(d => cid.startsWith(d)));
  }

  private hasHighRiskComorbidity(patient: PatientMock): boolean {
    if ((patient as any).flag_infarto === 1 ||
      (patient as any).flag_derrame === 1 ||
      (patient as any).flag_cardiaca === 1 ||
      (patient as any).flag_renal === 1) {
      return true;
    }
    const highRiskCids = [
      ...this.hasComplicadaCids,
      ...this.cardiovascularCids,
      ...this.renalCids,
      ...this.retinopatiaCids,
      ...this.neuropatiaCids,
      ...this.demenciaCids,
      ...this.peDiabeticoCids
    ];
    return patient.cids.some(cid => highRiskCids.some(h => cid.startsWith(h)));
  }

  private isPANaoControlada(patient: PatientMock): boolean {
    const pa_s = (patient as any).ultima_pa_sistolica ?? 0;
    const pa_d = (patient as any).ultima_pa_diastolica ?? 0;
    return pa_s >= 140 || pa_d >= 90;
  }

  private isDMMoreThan10Years(patient: PatientMock): boolean {
    if (!patient.data_diagnostico_dm) return false;
    const diagDate = new Date(patient.data_diagnostico_dm);
    const dezAnosAtras = new Date();
    dezAnosAtras.setFullYear(dezAnosAtras.getFullYear() - 10);
    return diagDate < dezAnosAtras;
  }

  public stratifySinglePatient(patient: PatientMock): StratifiedPatient {
    let riskLevel = RiskLevel.LOW;
    let reason = "Dentro das metas terapêuticas. Manter acompanhamento.";
    let action = "Manter acompanhamento conforme protocolo.";
    let deadline = "6 meses";

    const paSistolica = (patient as any).ultima_pa_sistolica ?? 0;
    const paDiastolica = (patient as any).ultima_pa_diastolica ?? 0;
    const hba1c = (patient as any).ultimo_hba1c ?? 0;
    const glicemiaJejum = (patient as any).glicemia_jejum ?? (patient as any).glicemia_capilar ?? 0;
    const imc = (patient as any).imc ?? 0;
    const idade = patient.idade;
    const sexo = patient.sexo;
    const isFumante = patient.fumante === 'Sim';
    const isHAS = this.isHAS(patient);
    const isDM = this.isDM(patient);

    const colesterolTotal = (patient as any).ultimo_colesterol_total ?? null;
    const ldl = (patient as any).ultimo_colesterol_ldl ?? null;
    let clearanceCreatina = (patient as any).ultimo_clearance_creatina ?? null;
    const creatinaSerica = (patient as any).ultimo_creatina_serica ?? null;

    // Se não tiver o Clearance laudado pronto, mas tiver Creatinina Sérica, calcula via CKD-EPI
    if (clearanceCreatina === null && creatinaSerica !== null && creatinaSerica > 0 && idade > 0) {
      clearanceCreatina = this.calculateCKDEPI(creatinaSerica, idade, sexo);
      (patient as any).tfge_ckd_epi = clearanceCreatina;
    }

    // Classificação de PA (Quadro 1 do PCDT HAS)
    const paGrau = this.classifyPA(paSistolica || null, paDiastolica || null);
    (patient as any).pa_grau = paGrau;

    // ═══════════════════════════════════════════════════════════
    // PASSO 1: BYPASS DIRETO (Seção 3 do PCDT — sem calculadora)
    // ═══════════════════════════════════════════════════════════

    const bypassReasons: string[] = [];

    // 1a. DCV estabelecida → VERY_HIGH
    const hasDCV = (patient as any).flag_infarto === 1 ||
      (patient as any).flag_derrame === 1 ||
      (patient as any).flag_cardiaca === 1 ||
      patient.cids.some(cid => this.dcvCids.some(d => cid.startsWith(d)));

    if (hasDCV) {
      bypassReasons.push("DCV estabelecida");
    }

    // 1b. DM2 + Comorbidade CV → VERY_HIGH
    if (isDM && hasDCV) {
      bypassReasons.push("DM2 com comorbidade cardiovascular");
    }

    // 1c. PA ≥ 180/110 (HAS Grau 3) → VERY_HIGH
    if (paSistolica >= 180 || paDiastolica >= 110) {
      bypassReasons.push("PA ≥ 180/110 mmHg (HAS Grau 3 — Crítico)");
    }

    // 1d. HbA1c > 9% → VERY_HIGH (descontrole grave)
    if (hba1c > 9) {
      bypassReasons.push("HbA1c > 9% (descontrole metabólico grave)");
    }

    if (bypassReasons.length > 0) {
      riskLevel = RiskLevel.VERY_HIGH;
      deadline = "7 dias";
      reason = bypassReasons.join(" + ");
      action = "Agendar consulta médica urgente em até 7 dias — risco cardiovascular muito alto.";

      return {
        ...patient,
        risk_level: (patient as any).raw_computed_risk ? ((patient as any).raw_computed_risk as RiskLevel) : riskLevel,
        reason,
        recommended_action: action,
        return_deadline: deadline,
      };
    }

    // 1e. LOA / DRC / LDL ≥ 190 / DM2+idade≥40 → HIGH
    const highBypassReasons: string[] = [];

    // DRC por laudo de Clearance de Creatinina < 60 mL/min ou por CID/autorreferido
    const hasDRC = (patient as any).flag_renal === 1 ||
      (clearanceCreatina !== null && clearanceCreatina < 60) ||
      patient.cids.some(cid => this.renalCids.some(r => cid.startsWith(r)));

    if (hasDRC) {
      if (clearanceCreatina !== null && clearanceCreatina < 60) {
        highBypassReasons.push(`DRC Estágio ≥ 3 (TFGe/Clearance ${clearanceCreatina} mL/min)`);
      } else {
        highBypassReasons.push("Doença Renal Crônica (DRC)");
      }
    }

    // LDL-c ≥ 190 mg/dL (Bypass direto para estatina — Seção 3 do PCDT)
    if (ldl !== null && ldl >= 190) {
      highBypassReasons.push(`Hypercolesterolêmica grave (LDL-c ${ldl} mg/dL ≥ 190)`);
    }

    // LOA (lesão em órgão-alvo)
    const hasLOA = patient.cids.some(cid => this.loaCids.some(l => cid.startsWith(l)));
    if ((isHAS || isDM) && hasLOA) {
      highBypassReasons.push("HAS/DM2 com Lesão em Órgão-Alvo (LOA)");
    }

    // DM2 + idade ≥ 40
    if (isDM && idade >= 40) {
      highBypassReasons.push("DM2 com idade ≥ 40 anos");
    }

    // DM2 ≤ 39 + nefropatia ou retinopatia
    if (isDM && idade <= 39 && (hasDRC || patient.cids.some(cid => this.retinopatiaCids.some(r => cid.startsWith(r))))) {
      highBypassReasons.push("DM2 ≤ 39 anos com nefropatia/retinopatia");
    }

    // HbA1c > 7 (médio alto)
    if (hba1c > 7) {
      highBypassReasons.push("HbA1c entre 7 e 9%");
    }

    // Glicemia > 250
    if (glicemiaJejum > 250) {
      highBypassReasons.push("Glicemia de jejum > 250 mg/dL");
    }

    if (highBypassReasons.length > 0) {
      riskLevel = RiskLevel.HIGH;
      deadline = "15 dias";
      reason = highBypassReasons.join(" + ");
      action = isDM || (ldl !== null && ldl >= 190)
        ? "Agendar consulta médica em até 15 dias — risco alto. Indicação de estatina."
        : "Agendar consulta médica ou visita domiciliar em até 15 dias.";

      return {
        ...patient,
        risk_level: (patient as any).raw_computed_risk ? ((patient as any).raw_computed_risk as RiskLevel) : riskLevel,
        reason,
        recommended_action: action,
        return_deadline: deadline,
      };
    }

    // ═══════════════════════════════════════════════════════════
    // PASSO 2: VERIFICAÇÃO DE FAIXA ETÁRIA (Seção 5 do PCDT)
    // ═══════════════════════════════════════════════════════════

    // Pacientes fora da faixa HEARTS (< 40 ou ≥ 75) sem bypass
    if (idade < 40 || idade >= 75) {
      // Ainda aplica fatores de risco conhecidos
      const mediumReasons: string[] = [];

      if (paSistolica >= 160 || paDiastolica >= 100) {
        mediumReasons.push("PA 160-179/100-109 mmHg (HAS Grau 2)");
      }
      if (isHAS && isDM) mediumReasons.push("Sinergia HAS + DM");
      if (imc >= 30) mediumReasons.push("Obesidade (IMC ≥ 30)");
      if (isHAS && isFumante) mediumReasons.push("HAS + Tabagismo");
      if (glicemiaJejum >= 126) mediumReasons.push("Glicemia ≥ 126 mg/dL");

      if (mediumReasons.length > 0) {
        riskLevel = RiskLevel.MEDIUM;
        deadline = "1 mês";
        reason = mediumReasons.join(" + ") + " (Avaliação individualizada por faixa etária)";
        action = "Avaliação individualizada — fora da faixa HEARTS. Agendar retorno em até 1 mês.";
      } else {
        if (idade >= 75) {
          riskLevel = RiskLevel.INDIVIDUALIZED_ELDERLY;
          reason = "Avaliação individualizada por idade avançada (≥ 75 anos). Cautela com metas rígidas de PA e risco de hipoglicemia/hipotensão.";
          action = "Reavaliação clínica cuidadosa na APS. Foco em funcionalidade, prevenção de quedas e adequação de metas terapêuticas.";
          deadline = "3 meses";
        } else {
          riskLevel = RiskLevel.INDIVIDUALIZED_YOUNG;
          reason = "Avaliação individualizada por faixa etária jovem (< 40 anos).";
          action = "Manter acompanhamento preventivo na APS. Foco em estilo de vida saudável, alimentação e atividade física.";
          deadline = "6 meses";
        }
      }

      return {
        ...patient,
        risk_level: (patient as any).raw_computed_risk ? ((patient as any).raw_computed_risk as RiskLevel) : riskLevel,
        reason,
        recommended_action: action,
        return_deadline: deadline,
      };
    }

    // ═══════════════════════════════════════════════════════════
    // PASSO 3: CALCULADORA HEARTS (40-74 anos, sem bypass)
    // ═══════════════════════════════════════════════════════════

    if ((isHAS || isDM) && idade >= 40 && idade <= 74 && paSistolica > 0) {
      const riskPct = this.calculateHEARTS(sexo, idade, isFumante, isDM, paSistolica, imc, colesterolTotal);
      riskLevel = this.heartsRiskLevel(riskPct, isDM);

      const heartsLabel = riskPct >= 20 ? 'Muito Alto (≥20%)'
        : riskPct >= 10 ? 'Alto (10-20%)'
        : riskPct >= 5 ? 'Moderado (5-10%)'
        : 'Baixo (<5%)';

      const pathText = (colesterolTotal && colesterolTotal > 0) ? "Com Colesterol" : "Sem Colesterol (IMC)";
      reason = `Calculadora HEARTS (${pathText}): Risco CV ${heartsLabel}`;

      // Adicionar fatores agravantes na razão
      const factors: string[] = [];
      if (isFumante) factors.push("Tabagista");
      if (imc >= 30) factors.push(`Obesidade (IMC ${imc.toFixed(1)})`);
      if (isHAS && isDM) factors.push("HAS + DM2");
      if (paSistolica >= 140) factors.push(`PA ${paSistolica}/${paDiastolica}`);
      if (factors.length > 0) reason += ` | ${factors.join(", ")}`;

      switch (riskLevel) {
        case RiskLevel.VERY_HIGH:
          action = "Agendar consulta médica urgente. Indicação de estatina.";
          deadline = "7 dias";
          break;
        case RiskLevel.HIGH:
          action = "Agendar consulta médica em até 15 dias. Considerar estatina.";
          deadline = "15 dias";
          break;
        case RiskLevel.MEDIUM:
          action = "Agendar retorno em até 1 mês. Reforçar mudanças de estilo de vida.";
          deadline = "1 mês";
          break;
        default:
          action = "Manter acompanhamento conforme protocolo. Reavaliar anualmente.";
          deadline = "6 meses";
      }

      return {
        ...patient,
        risk_level: (patient as any).raw_computed_risk ? ((patient as any).raw_computed_risk as RiskLevel) : riskLevel,
        reason,
        recommended_action: action,
        return_deadline: deadline,
      };
    }

    // ═══════════════════════════════════════════════════════════
    // PASSO 4: FALLBACK — pacientes sem HAS/DM ou sem PA
    // ═══════════════════════════════════════════════════════════

    // Pacientes com fatores de risco isolados
    const mediumFallbackReasons: string[] = [];
    if (paSistolica >= 160 || paDiastolica >= 100) {
      mediumFallbackReasons.push("PA ≥ 160/100 (HAS Grau 2)");
    }
    if (paSistolica >= 140 || paDiastolica >= 90) {
      mediumFallbackReasons.push("PA ≥ 140/90 (Confirmar diagnóstico de HAS)");
    }
    if (glicemiaJejum >= 126) {
      mediumFallbackReasons.push("Glicemia ≥ 126 mg/dL");
    }
    if (imc >= 30) {
      mediumFallbackReasons.push("Obesidade (IMC ≥ 30)");
    }

    if (mediumFallbackReasons.length > 0) {
      riskLevel = RiskLevel.MEDIUM;
      deadline = "1 mês";
      reason = mediumFallbackReasons.join(" + ");
      action = "Agendar retorno em até 1 mês para investigação.";
    }

    return {
      ...patient,
      risk_level: (patient as any).raw_computed_risk ? ((patient as any).raw_computed_risk as RiskLevel) : riskLevel,
      reason,
      recommended_action: action,
      return_deadline: deadline,
    };
  }


  public async getMicroareas(): Promise<string[]> {
    if (!isPecConfigured) return ['01', '02', '03', '04', '05', '06'];
    try {
      // Normaliza microáreas: 0, 00, 001, 01, 1 → tudo vira '01'
      const sql = `
        SELECT DISTINCT 
          CASE 
            WHEN nu_micro_area ~ '^[0-9]+$' THEN LPAD(LTRIM(nu_micro_area, '0'), 2, '0')
            ELSE nu_micro_area
          END AS nu_micro_area_norm
        FROM tb_cidadao
        WHERE nu_micro_area IS NOT NULL 
          AND nu_micro_area != '' 
        ORDER BY nu_micro_area_norm ASC
        LIMIT 500
      `;
      const rows = await pecQuery(sql, []);
      return (rows as any[]).map(r => r.nu_micro_area_norm).filter((v: string) => v !== '00');
    } catch (e) {
      console.error('[getMicroareas] Fallback to mock due to error:', e);
      return ['01', '02', '03', '04', '05', '06'];
    }
  }

  public async getEquipes(): Promise<Array<{ ine: string; nome: string }>> {
    const RECIFE_DEFAULT_EQUIPES = [
      { ine: "0002334062", nome: "EAP CESAR MONTEZUMA" },
      { ine: "0002399776", nome: "EAP EQ 2 - JOAQUIM CAVALCANTE" },
      { ine: "0002399792", nome: "EAP EQ 1 - JOAQUIM CAVALCANTE" },
      { ine: "0001560701", nome: "EAPP III - CBO" },
      { ine: "0001549286", nome: "EAPP III - PJALLB" },
      { ine: "0001549294", nome: "EAPP III - PJALLB 2" },
      { ine: "0002520583", nome: "EAPP III - PLL" },
      { ine: "0002491125", nome: "EAP - SES PE 1" },
      { ine: "0002491117", nome: "EAP - SES PE 2" },
      { ine: "0002491109", nome: "EAP - SES PE 3" },
      { ine: "000225", nome: "ECNR EQ 1 - CASARAO DO CORDEIRO" },
      { ine: "0002428997", nome: "ECNR EQ 1 - COELHOS" },
      { ine: "000155", nome: "ECNR EQ 1 - GUILHERME ROBALINHO" },
      { ine: "0001560204", nome: "ECNR EQ 1 - NS PILAR" },
      { ine: "000225909", nome: "ECNR EQ 1 - ROMERO MARQUES" },
      { ine: "0002483750", nome: "ECNR EQ 1 - U VILAS" },
    ];

    if (!isPecConfigured) return RECIFE_DEFAULT_EQUIPES;
    try {
      const sql = `
        SELECT DISTINCT e.nu_ine as ine, e.no_equipe as nome
        FROM tb_equipe e
        WHERE e.nu_ine IS NOT NULL AND e.st_ativo = 1
        ORDER BY e.no_equipe ASC
        LIMIT 500
      `;
      const rows = await pecQuery(sql, []);
      if (!rows || rows.length === 0) return RECIFE_DEFAULT_EQUIPES;
      return (rows as any[]).map(r => ({ ine: String(r.ine), nome: r.nome || `Equipe ${r.ine}` }));
    } catch (e) {
      console.error('[getEquipes] Fallback to mock due to error:', e);
      return RECIFE_DEFAULT_EQUIPES;
    }
  }

  public stratifyPatients(microarea?: string): StratifiedPatient[] {
    let patients = mockPatients;
    if (microarea && microarea !== 'all') {
      patients = patients.filter(p => p.microarea === microarea);
    }
    return patients.map(p => this.stratifySinglePatient(p));
  }

  public async getStratifiedPaginated(page: number, pageSize: number, filters: any): Promise<any> {
    if (!isPecConfigured) {
      return this.getStratifiedPaginatedMock(page, pageSize, filters);
    }

    try {
      const offset = (page - 1) * pageSize;
      const params: any[] = [];
      let extraWhere = "";
      let veJoin = "JOIN tb_cidadao_vinculacao_equipe ve ON c.co_seq_cidadao = ve.co_cidadao";

      if (filters.ine && filters.ine !== 'all') {
        const ines = filters.ine.split(',');
        const placeholders = ines.map((_: any, i: number) => `$${params.length + i + 1}`).join(',');
        extraWhere += ` AND ve.nu_ine IN (${placeholders})`;
        params.push(...ines);
      }

      if (filters.unidade && filters.unidade !== 'all') {
        const uds = filters.unidade.split(',');
        const placeholders = uds.map((_: any, i: number) => `$${params.length + i + 1}`).join(',');
        extraWhere += ` AND ve.nu_cnes IN (${placeholders})`;
        params.push(...uds);
      }

      if (filters.microarea && filters.microarea !== 'all') {
        const mas = filters.microarea.split(',');
        const placeholders = mas.map((_: any, i: number) => `$${params.length + i + 1}`).join(',');
        extraWhere += ` AND c.nu_micro_area IN (${placeholders})`;
        params.push(...mas);
      }

      if (filters.search) {
        const normalizedSearch = filters.search.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        if (filters.searchType === 'cpf') {
          const cleanCpf = filters.search.replace(/\D/g, '');
          extraWhere += ` AND c.nu_cpf LIKE $${params.length + 1}`;
          params.push(`${cleanCpf}%`);
        } else if (filters.searchType === 'cns') {
          const cleanCns = filters.search.replace(/\D/g, '');
          extraWhere += ` AND c.nu_cns LIKE $${params.length + 1}`;
          params.push(`${cleanCns}%`);
        } else {
          extraWhere += ` AND translate(lower(c.no_cidadao_filtro), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc') ILIKE $${params.length + 1}`;
          params.push(`%${normalizedSearch}%`);
        }
      }

      if (filters.sex) {
        extraWhere += ` AND c.no_sexo = $${params.length + 1}`;
        params.push(filters.sex);
      }

      if (filters.ageRange) {
        const [minAge, maxAge] = filters.ageRange;
        extraWhere += ` AND EXTRACT(YEAR FROM AGE(c.dt_nascimento)) BETWEEN $${params.length + 1} AND $${params.length + 2}`;
        params.push(minAge, maxAge);
      }

      let total = 0;
      const requiresVeJoin = (filters.ine && filters.ine !== 'all') || (filters.unidade && filters.unidade !== 'all');

      const hasDynamicFilters = filters.riskLevel
        || (filters.cids && filters.cids.length > 0)
        || (filters.consultMonths !== undefined && filters.consultMonths !== null && !isNaN(filters.consultMonths))
        || filters.footExam
        || filters.smoking;

      if (hasDynamicFilters) {
        // Full-precision count: uses UNION ALL scalar lookups in LATERAL JOINs
        // to compute risk from vitals (pressure, glucose, HbA1c, BMI) without arrays.
        // UNION ALL allows PostgreSQL to use indexes efficiently for sibling lookups.
        const countParams = [...params];
        let dynamicCountQuery = `
          WITH CidadaosFiltradosAll AS (
              SELECT DISTINCT ON (COALESCE(c.nu_cpf, c.co_seq_cidadao::text))
                  c.co_seq_cidadao, c.no_sexo, c.dt_nascimento, c.nu_cpf, c.dt_atualizado
              FROM tb_cidadao c
              ${requiresVeJoin ? veJoin : ''}
              WHERE c.dt_obito IS NULL 
                AND c.st_ativo = 1
                ${requiresVeJoin ? 'AND ve.st_saida_cadastro_territorio = 0 AND ve.st_saida_cadastro_obito = 0' : ''}
                ${extraWhere}
              ORDER BY COALESCE(c.nu_cpf, c.co_seq_cidadao::text), c.dt_atualizado DESC, c.co_seq_cidadao DESC
          ),
          ComputedPatients AS (
              SELECT 
                  cfa.dt_nascimento AS dt_nascimento_raw,
                  CASE 
                      WHEN cr.st_infarto = 1 OR cr.st_derrame = 1 OR cr.st_doenca_cardiaca = 1 THEN 'VERY_HIGH'
                      WHEN (up.pressao_s IS NOT NULL AND up.pressao_s >= 180) OR (up.pressao_d IS NOT NULL AND up.pressao_d >= 110) THEN 'VERY_HIGH'
                      WHEN COALESCE(uh.vl_hemoglobina_glicada, 0) > 9 THEN 'VERY_HIGH'
                      WHEN cr.st_problema_rins = 1 THEN 'HIGH'
                      WHEN cr.st_diabetes = 1 AND EXTRACT(YEAR FROM AGE(cfa.dt_nascimento)) >= 40 THEN 'HIGH'
                      WHEN COALESCE(uh.vl_hemoglobina_glicada, 0) > 7 THEN 'HIGH'
                      WHEN ug.glicemia IS NOT NULL AND ug.glicemia > 250 THEN 'HIGH'
                      WHEN (up.pressao_s IS NOT NULL AND up.pressao_s >= 160) OR (up.pressao_d IS NOT NULL AND up.pressao_d >= 100) THEN 'MEDIUM'
                      WHEN ug.glicemia IS NOT NULL AND ug.glicemia >= 126 THEN 'MEDIUM'
                      WHEN cr.st_hipertensao_arterial = 1 AND cr.st_diabetes = 1 THEN 'MEDIUM'
                      WHEN (COALESCE(uw.peso, cr.peso_autorreferido) IS NOT NULL AND ua.altura IS NOT NULL AND ua.altura > 0 AND (COALESCE(uw.peso, cr.peso_autorreferido)::numeric / POWER(ua.altura::numeric / 100, 2)) >= 30) THEN 'MEDIUM'
                      WHEN cr.st_hipertensao_arterial = 1 AND cr.st_fumante = 1 THEN 'MEDIUM'
                      WHEN EXTRACT(YEAR FROM AGE(cfa.dt_nascimento)) < 40 THEN 'INDIVIDUALIZED_YOUNG'
                      WHEN EXTRACT(YEAR FROM AGE(cfa.dt_nascimento)) >= 75 THEN 'INDIVIDUALIZED_ELDERLY'
                      WHEN cr.st_diabetes = 1 THEN 'LOW'
                      ELSE 'LOW'
                  END AS computed_risk,
                  uc.data_ultima_consulta,
                  uv.data_ultima_visita,
                  uep.data_ultimo_exame_pe,
                  uc.ds_filtro_cids,
                  CASE 
                      WHEN cr.st_fumante = 1 THEN 'Sim'
                      WHEN cr.st_fumante = 0 THEN 'Não'
                      ELSE 'Sem Registro'
                  END AS "Fumante",
                  cr.st_hipertensao_arterial AS flag_has_c,
                  cr.st_diabetes AS flag_dm_c,
                  cr.st_doenca_cardiaca AS flag_cardiaca_c,
                  cr.st_problema_rins AS flag_renal_c,
                  cr.st_infarto AS flag_infarto_c,
                  cr.st_derrame AS flag_derrame_c
              FROM CidadaosFiltradosAll cfa

              -- Condições de Saúde (UNION ALL para buscar irmãos por CPF via índice)
              LEFT JOIN LATERAL (
                  SELECT st_fumante, st_hipertensao_arterial, st_diabetes, st_doenca_cardiaca,
                         st_infarto, st_derrame, st_problema_rins, peso_autorreferido
                  FROM tb_condicoes_saude_auto
                  WHERE co_cidadao IN (
                      SELECT sibling.co_seq_cidadao FROM tb_cidadao sibling
                      WHERE sibling.nu_cpf = cfa.nu_cpf AND cfa.nu_cpf IS NOT NULL AND sibling.dt_obito IS NULL AND sibling.st_ativo = 1
                      UNION ALL
                      SELECT cfa.co_seq_cidadao WHERE cfa.nu_cpf IS NULL
                  )
                  ORDER BY co_seq_condicoes_saude_auto DESC LIMIT 1
              ) cr ON true

              -- Última consulta (UNION ALL via fat_cidadao_pec)
              LEFT JOIN LATERAL (
                  SELECT TO_DATE(fat.co_dim_tempo::text, 'YYYYMMDD') AS data_ultima_consulta, fat.ds_filtro_cids
                  FROM (
                      SELECT fcp.co_seq_fat_cidadao_pec FROM tb_cidadao sibling
                      JOIN tb_fat_cidadao_pec fcp ON fcp.co_cidadao = sibling.co_seq_cidadao
                      WHERE sibling.nu_cpf = cfa.nu_cpf AND cfa.nu_cpf IS NOT NULL AND sibling.dt_obito IS NULL AND sibling.st_ativo = 1
                      UNION ALL
                      SELECT fcp.co_seq_fat_cidadao_pec FROM tb_fat_cidadao_pec fcp
                      WHERE fcp.co_cidadao = cfa.co_seq_cidadao AND cfa.nu_cpf IS NULL
                  ) ids
                  JOIN tb_fat_atendimento_individual fat ON fat.co_fat_cidadao_pec = ids.co_seq_fat_cidadao_pec
                  ORDER BY fat.co_dim_tempo DESC LIMIT 1
              ) uc ON true

              -- Última Visita Domiciliar (UNION ALL)
              LEFT JOIN LATERAL (
                  SELECT TO_DATE(fvd.co_dim_tempo::text, 'YYYYMMDD') AS data_ultima_visita
                  FROM (
                      SELECT fcp.co_seq_fat_cidadao_pec FROM tb_cidadao sibling
                      JOIN tb_fat_cidadao_pec fcp ON fcp.co_cidadao = sibling.co_seq_cidadao
                      WHERE sibling.nu_cpf = cfa.nu_cpf AND cfa.nu_cpf IS NOT NULL AND sibling.dt_obito IS NULL AND sibling.st_ativo = 1
                      UNION ALL
                      SELECT fcp.co_seq_fat_cidadao_pec FROM tb_fat_cidadao_pec fcp
                      WHERE fcp.co_cidadao = cfa.co_seq_cidadao AND cfa.nu_cpf IS NULL
                  ) ids
                  JOIN tb_fat_visita_domiciliar fvd ON fvd.co_fat_cidadao_pec = ids.co_seq_fat_cidadao_pec
                  ORDER BY fvd.co_dim_tempo DESC LIMIT 1
              ) uv ON true

              -- Último Exame do Pé
              LEFT JOIN LATERAL (
                  SELECT TO_DATE(fpa.co_dim_tempo::text, 'YYYYMMDD') AS data_ultimo_exame_pe
                  FROM (
                      SELECT fcp.co_seq_fat_cidadao_pec FROM tb_cidadao sibling
                      JOIN tb_fat_cidadao_pec fcp ON fcp.co_cidadao = sibling.co_seq_cidadao
                      WHERE sibling.nu_cpf = cfa.nu_cpf AND cfa.nu_cpf IS NOT NULL AND sibling.dt_obito IS NULL AND sibling.st_ativo = 1
                      UNION ALL
                      SELECT fcp.co_seq_fat_cidadao_pec FROM tb_fat_cidadao_pec fcp
                      WHERE fcp.co_cidadao = cfa.co_seq_cidadao AND cfa.nu_cpf IS NULL
                  ) ids
                  JOIN tb_fat_proced_atend_proced fpa ON fpa.co_fat_cidadao_pec = ids.co_seq_fat_cidadao_pec
                  WHERE fpa.co_dim_procedimento = 7478
                  ORDER BY fpa.co_dim_tempo DESC LIMIT 1
              ) uep ON true

              -- Última Pressão (UNION ALL)
              LEFT JOIN LATERAL (
                  SELECT fat.nu_pressao_sistolica AS pressao_s, fat.nu_pressao_diastolica AS pressao_d
                  FROM (
                      SELECT fcp.co_seq_fat_cidadao_pec FROM tb_cidadao sibling
                      JOIN tb_fat_cidadao_pec fcp ON fcp.co_cidadao = sibling.co_seq_cidadao
                      WHERE sibling.nu_cpf = cfa.nu_cpf AND cfa.nu_cpf IS NOT NULL AND sibling.dt_obito IS NULL AND sibling.st_ativo = 1
                      UNION ALL
                      SELECT fcp.co_seq_fat_cidadao_pec FROM tb_fat_cidadao_pec fcp
                      WHERE fcp.co_cidadao = cfa.co_seq_cidadao AND cfa.nu_cpf IS NULL
                  ) ids
                  JOIN tb_fat_atendimento_individual fat ON fat.co_fat_cidadao_pec = ids.co_seq_fat_cidadao_pec
                  WHERE fat.nu_pressao_sistolica IS NOT NULL
                  ORDER BY fat.co_dim_tempo DESC LIMIT 1
              ) up ON true

              -- Última Glicemia (UNION ALL)
              LEFT JOIN LATERAL (
                  SELECT fat.nu_glicemia AS glicemia
                  FROM (
                      SELECT fcp.co_seq_fat_cidadao_pec FROM tb_cidadao sibling
                      JOIN tb_fat_cidadao_pec fcp ON fcp.co_cidadao = sibling.co_seq_cidadao
                      WHERE sibling.nu_cpf = cfa.nu_cpf AND cfa.nu_cpf IS NOT NULL AND sibling.dt_obito IS NULL AND sibling.st_ativo = 1
                      UNION ALL
                      SELECT fcp.co_seq_fat_cidadao_pec FROM tb_fat_cidadao_pec fcp
                      WHERE fcp.co_cidadao = cfa.co_seq_cidadao AND cfa.nu_cpf IS NULL
                  ) ids
                  JOIN tb_fat_atendimento_individual fat ON fat.co_fat_cidadao_pec = ids.co_seq_fat_cidadao_pec
                  WHERE fat.nu_glicemia IS NOT NULL
                  ORDER BY fat.co_dim_tempo DESC LIMIT 1
              ) ug ON true

              -- Último Peso (UNION ALL)
              LEFT JOIN LATERAL (
                  SELECT fat.nu_peso AS peso
                  FROM (
                      SELECT fcp.co_seq_fat_cidadao_pec FROM tb_cidadao sibling
                      JOIN tb_fat_cidadao_pec fcp ON fcp.co_cidadao = sibling.co_seq_cidadao
                      WHERE sibling.nu_cpf = cfa.nu_cpf AND cfa.nu_cpf IS NOT NULL AND sibling.dt_obito IS NULL AND sibling.st_ativo = 1
                      UNION ALL
                      SELECT fcp.co_seq_fat_cidadao_pec FROM tb_fat_cidadao_pec fcp
                      WHERE fcp.co_cidadao = cfa.co_seq_cidadao AND cfa.nu_cpf IS NULL
                  ) ids
                  JOIN tb_fat_atendimento_individual fat ON fat.co_fat_cidadao_pec = ids.co_seq_fat_cidadao_pec
                  WHERE fat.nu_peso IS NOT NULL
                  ORDER BY fat.co_dim_tempo DESC LIMIT 1
              ) uw ON true

              -- Última Altura (UNION ALL)
              LEFT JOIN LATERAL (
                  SELECT fat.nu_altura AS altura
                  FROM (
                      SELECT fcp.co_seq_fat_cidadao_pec FROM tb_cidadao sibling
                      JOIN tb_fat_cidadao_pec fcp ON fcp.co_cidadao = sibling.co_seq_cidadao
                      WHERE sibling.nu_cpf = cfa.nu_cpf AND cfa.nu_cpf IS NOT NULL AND sibling.dt_obito IS NULL AND sibling.st_ativo = 1
                      UNION ALL
                      SELECT fcp.co_seq_fat_cidadao_pec FROM tb_fat_cidadao_pec fcp
                      WHERE fcp.co_cidadao = cfa.co_seq_cidadao AND cfa.nu_cpf IS NULL
                  ) ids
                  JOIN tb_fat_atendimento_individual fat ON fat.co_fat_cidadao_pec = ids.co_seq_fat_cidadao_pec
                  WHERE fat.nu_altura IS NOT NULL
                  ORDER BY fat.co_dim_tempo DESC LIMIT 1
              ) ua ON true

              -- HbA1c (UNION ALL via prontuário)
              LEFT JOIN LATERAL (
                  SELECT hem.vl_hemoglobina_glicada 
                  FROM (
                      SELECT req.co_seq_exame_requisitado
                      FROM (
                          SELECT p.co_seq_prontuario FROM tb_cidadao sibling
                          JOIN tb_prontuario p ON p.co_cidadao = sibling.co_seq_cidadao
                          WHERE sibling.nu_cpf = cfa.nu_cpf AND cfa.nu_cpf IS NOT NULL AND sibling.dt_obito IS NULL AND sibling.st_ativo = 1
                          UNION ALL
                          SELECT p.co_seq_prontuario FROM tb_prontuario p
                          WHERE p.co_cidadao = cfa.co_seq_cidadao AND cfa.nu_cpf IS NULL
                      ) prons
                      JOIN tb_exame_requisitado req ON req.co_prontuario = prons.co_seq_prontuario
                      ORDER BY req.co_seq_exame_requisitado DESC
                      OFFSET 0
                  ) safe_req
                  JOIN tb_exame_hemoglobina_glicada hem ON hem.co_exame_requisitado = safe_req.co_seq_exame_requisitado
                  LIMIT 1
              ) uh ON true
          )
          SELECT COUNT(*) as total FROM ComputedPatients WHERE 1=1
        `;

        if (filters.riskLevel) {
          const levels = filters.riskLevel.split(',');
          if (levels.includes('LOW')) levels.push('VERY_LOW');
          const placeholders = levels.map((_: any, i: number) => `$${countParams.length + i + 1}`);
          dynamicCountQuery += ` AND computed_risk IN (${placeholders.join(',')})`;
          countParams.push(...levels);
        }

        if (filters.consultMonths !== undefined && filters.consultMonths !== null && !isNaN(filters.consultMonths)) {
          dynamicCountQuery += ` AND ((data_ultima_consulta IS NULL OR data_ultima_consulta < NOW() - ($${countParams.length + 1} || ' months')::interval) AND (data_ultima_visita IS NULL OR data_ultima_visita < NOW() - ($${countParams.length + 1} || ' months')::interval))`;
          countParams.push(filters.consultMonths);
        }

        if (filters.footExam === 'with') {
          dynamicCountQuery += ` AND data_ultimo_exame_pe IS NOT NULL`;
        } else if (filters.footExam === 'without') {
          dynamicCountQuery += ` AND data_ultimo_exame_pe IS NULL`;
        }

        if (filters.cids && filters.cids.length > 0) {
          // CIDs que mapeiam para flags usam APENAS flags (consistente com território)
          // CIDs sem flag equivalente usam LIKE no ds_filtro_cids
          const hasPfx = ['I10', 'I11', 'I12', 'I13', 'I15'];
          const dmPfx = ['E10', 'E11', 'E12', 'E13', 'E14'];
          const cardioPfx = ['I21', 'I22', 'I50', 'I60', 'I61', 'I62', 'I63', 'I64'];
          const renalPfx = ['N18', 'N19'];
          const allFlagPfx = [...hasPfx, ...dmPfx, ...cardioPfx, ...renalPfx];

          const conditions: string[] = [];
          if (filters.cids.some((c: string) => hasPfx.some(p => c.startsWith(p)))) conditions.push('flag_has_c = 1');
          if (filters.cids.some((c: string) => dmPfx.some(p => c.startsWith(p)))) conditions.push('flag_dm_c = 1');
          if (filters.cids.some((c: string) => cardioPfx.some(p => c.startsWith(p)))) conditions.push('(flag_cardiaca_c = 1 OR flag_infarto_c = 1 OR flag_derrame_c = 1)');
          if (filters.cids.some((c: string) => renalPfx.some(p => c.startsWith(p)))) conditions.push('flag_renal_c = 1');

          // CIDs que não mapeiam para nenhuma flag → LIKE
          const unmappedCids = filters.cids.filter((c: string) => !allFlagPfx.some(p => c.startsWith(p)));
          for (const cid of unmappedCids) {
            conditions.push(`ds_filtro_cids LIKE $${countParams.length + 1}`);
            countParams.push(`%${cid}%`);
          }

          if (conditions.length > 0) {
            dynamicCountQuery += ` AND (${conditions.join(' OR ')})`;
          }
        }

        if (filters.smoking) {
          dynamicCountQuery += ` AND "Fumante" = $${countParams.length + 1}`;
          countParams.push(filters.smoking);
        }

        try {
          const countRes = await pecQuery(dynamicCountQuery, countParams);
          total = parseInt((countRes as any)?.[0]?.total || '0', 10);
        } catch (e) {
          console.error('[RiskStratificationService] Full dynamic count failed, using estimate:', e);
          // Fallback: estimate from simple dedup count
          try {
            const fallbackParams = [...params];
            const fallbackQuery = `
              SELECT COUNT(DISTINCT COALESCE(c.nu_cpf, c.co_seq_cidadao::text)) as total
              FROM tb_cidadao c
              ${requiresVeJoin ? veJoin : ''}
              WHERE c.dt_obito IS NULL AND c.st_ativo = 1
                ${requiresVeJoin ? 'AND ve.st_saida_cadastro_territorio = 0 AND ve.st_saida_cadastro_obito = 0' : ''}
                ${extraWhere}
            `;
            const fbRes = await pecQuery(fallbackQuery, fallbackParams);
            total = parseInt((fbRes as any)?.[0]?.total || '0', 10);
          } catch {
            total = 0;
          }
        }
      } else if (!extraWhere) {
        // Fast estimate for the entire database to avoid 20-second COUNT(*) scans
        const estimateQuery = `SELECT reltuples::bigint AS total FROM pg_class WHERE relname = 'tb_cidadao'`;
        try {
          const countRes = await pecQuery(estimateQuery, []);
          total = parseInt((countRes as any)?.[0]?.total || '1200000', 10);
        } catch (e) {
          total = 1200000;
        }
      } else {
        // Exact count when simple filters are applied (smaller dataset, no dynamic filters)
        const countQuery = `
          SELECT COUNT(DISTINCT COALESCE(c.nu_cpf, c.co_seq_cidadao::text)) as total
          FROM tb_cidadao c
          ${requiresVeJoin ? veJoin : ''}
          WHERE c.dt_obito IS NULL 
            AND c.st_ativo = 1
            ${requiresVeJoin ? 'AND ve.st_saida_cadastro_territorio = 0 AND ve.st_saida_cadastro_obito = 0' : ''}
            ${extraWhere}
        `;
        const countRes = await pecQuery(countQuery, params);
        total = parseInt((countRes as any)?.[0]?.total || '0', 10);
      }

      // Data query
      const dataParams = [...params];

      const cteAlreadyPaginated = !filters.riskLevel
        && (!filters.cids || filters.cids.length === 0)
        && filters.consultMonths === undefined
        && !filters.footExam
        && !filters.smoking;

      let fullQuery = `
        WITH CidadaosFiltradosAll AS (
            SELECT DISTINCT ON (COALESCE(c.nu_cpf, c.co_seq_cidadao::text))
                c.co_seq_cidadao, 
                c.no_cidadao, 
                c.dt_nascimento, 
                c.no_sexo,            
                c.nu_micro_area,
                c.ds_logradouro,
                c.nu_numero,
                c.ds_complemento,
                c.no_bairro,
                c.ds_cep,
                c.nu_telefone_celular,
                c.nu_telefone_residencial,
                c.nu_telefone_contato,
                c.dt_atualizado,
                c.nu_cpf
            FROM tb_cidadao c
            ${requiresVeJoin ? veJoin : ''}
            WHERE c.dt_obito IS NULL
              AND c.st_ativo = 1
              ${requiresVeJoin ? 'AND ve.st_saida_cadastro_territorio = 0 AND ve.st_saida_cadastro_obito = 0' : ''}
              ${extraWhere}
            ORDER BY COALESCE(c.nu_cpf, c.co_seq_cidadao::text), c.dt_atualizado DESC, c.co_seq_cidadao DESC
        ),
        CidadaoFiltrado AS (
            SELECT * FROM CidadaosFiltradosAll
            ORDER BY co_seq_cidadao ASC
            ${cteAlreadyPaginated ? `LIMIT ${pageSize} OFFSET ${offset}` : ''}
        )
        SELECT *
        FROM (
            SELECT 
                cf.co_seq_cidadao AS "ID",
                cf.no_cidadao AS "Nome",
                cf.no_sexo AS "Sexo",  
                EXTRACT(YEAR FROM AGE(cf.dt_nascimento))::int AS "Idade",
                cf.nu_micro_area AS "Microárea",
                -- Unidade de Saúde (UNION ALL para buscar irmãos por CPF)
                (
                    SELECT us.no_unidade_saude 
                    FROM (
                        SELECT pus.co_unidade_saude, pus.co_seq_prontuario_unidade_saud
                        FROM tb_cidadao sibling
                        JOIN tb_prontuario_unidade_saude pus ON pus.co_cidadao = sibling.co_seq_cidadao
                        WHERE sibling.nu_cpf = cf.nu_cpf AND cf.nu_cpf IS NOT NULL AND sibling.dt_obito IS NULL AND sibling.st_ativo = 1
                        UNION ALL
                        SELECT pus.co_unidade_saude, pus.co_seq_prontuario_unidade_saud
                        FROM tb_prontuario_unidade_saude pus
                        WHERE pus.co_cidadao = cf.co_seq_cidadao AND cf.nu_cpf IS NULL
                    ) pus_all
                    JOIN tb_unidade_saude us ON pus_all.co_unidade_saude = us.co_seq_unidade_saude
                    ORDER BY pus_all.co_seq_prontuario_unidade_saud DESC LIMIT 1
                ) AS "Unidade",
                -- Equipe (UNION ALL para buscar irmãos por CPF)
                (
                    SELECT eq.no_equipe 
                    FROM (
                        SELECT ve2.nu_ine, ve2.co_seq_cidadao_vinculacao_eqp
                        FROM tb_cidadao sibling
                        JOIN tb_cidadao_vinculacao_equipe ve2 ON ve2.co_cidadao = sibling.co_seq_cidadao
                        WHERE sibling.nu_cpf = cf.nu_cpf AND cf.nu_cpf IS NOT NULL AND sibling.dt_obito IS NULL AND sibling.st_ativo = 1
                        UNION ALL
                        SELECT ve2.nu_ine, ve2.co_seq_cidadao_vinculacao_eqp
                        FROM tb_cidadao_vinculacao_equipe ve2
                        WHERE ve2.co_cidadao = cf.co_seq_cidadao AND cf.nu_cpf IS NULL
                    ) ve_all
                    JOIN tb_equipe eq ON ve_all.nu_ine = eq.nu_ine
                    ORDER BY ve_all.co_seq_cidadao_vinculacao_eqp DESC LIMIT 1
                ) AS "Equipe",
                up.pressao AS "Última Pressão",
                COALESCE(uw.peso, cr.peso_autorreferido) AS "Peso",
                ua.altura AS "Altura",
                ug.glicemia AS "Glicemia Capilar",
                uc.data_ultima_consulta AS "Data Aferição",
                uh.vl_hemoglobina_glicada AS "HbA1c",
                uct.vl_colesterol_total AS "ultimo_colesterol_total",
                uldl.vl_colesterol_ldl AS "ultimo_colesterol_ldl",
                uclr.vl_clearance_creatina AS "ultimo_clearance_creatina",
                ucs.vl_creatina_serica AS "ultimo_creatina_serica",
                uc.data_ultima_consulta AS "Última Consulta",
                uv.data_ultima_visita AS "Última Visita Domiciliar",
                uep.data_ultimo_exame_pe AS "Último Exame Pé",
                uc.ds_filtro_cids AS "CIDs Fat",
                uc.ds_filtro_ciaps AS "CIAPs Fat",
                cr.st_hipertensao_arterial AS "flag_has",
                cr.st_diabetes AS "flag_dm",
                cr.st_doenca_cardiaca AS "flag_cardiaca",
                cr.st_problema_rins AS "flag_renal",
                cr.st_infarto AS "flag_infarto",
                cr.st_derrame AS "flag_derrame",
                CONCAT_WS(', ', 
                  NULLIF(CONCAT_WS(' ', cf.ds_logradouro, cf.nu_numero), ''),
                  NULLIF(cf.ds_complemento, ''),
                  NULLIF(cf.no_bairro, ''),
                  NULLIF(cf.ds_cep, '')
                ) AS "Endereço",
                COALESCE(cf.nu_telefone_celular, cf.nu_telefone_contato, cf.nu_telefone_residencial) AS "Telefone",
                cf.dt_atualizado AS "Atualizado Em",
                CASE 
                    WHEN cr.st_fumante = 1 THEN 'Sim'
                    WHEN cr.st_fumante = 0 THEN 'Não'
                    ELSE 'Sem Registro'
                END AS "Fumante",
                CASE WHEN up.pressao IS NOT NULL THEN CAST(SPLIT_PART(up.pressao, '/', 1) AS INTEGER) ELSE NULL END AS "sis",
                CASE WHEN up.pressao IS NOT NULL THEN CAST(SPLIT_PART(up.pressao, '/', 2) AS INTEGER) ELSE NULL END AS "dia",
                CASE 
                    WHEN cr.st_infarto = 1 OR cr.st_derrame = 1 OR cr.st_doenca_cardiaca = 1 THEN 'VERY_HIGH'
                    WHEN (up.pressao IS NOT NULL AND CAST(SPLIT_PART(up.pressao, '/', 1) AS INTEGER) >= 180) OR (up.pressao IS NOT NULL AND CAST(SPLIT_PART(up.pressao, '/', 2) AS INTEGER) >= 110) THEN 'VERY_HIGH'
                    WHEN COALESCE(uh.vl_hemoglobina_glicada, 0) > 9 THEN 'VERY_HIGH'
                    WHEN cr.st_problema_rins = 1 THEN 'HIGH'
                    WHEN cr.st_diabetes = 1 AND EXTRACT(YEAR FROM AGE(cf.dt_nascimento)) >= 40 THEN 'HIGH'
                    WHEN COALESCE(uh.vl_hemoglobina_glicada, 0) > 7 THEN 'HIGH'
                    WHEN ug.glicemia IS NOT NULL AND CAST(REGEXP_REPLACE(ug.glicemia::text, '[^0-9]', '', 'g') AS INTEGER) > 250 THEN 'HIGH'
                    WHEN (up.pressao IS NOT NULL AND CAST(SPLIT_PART(up.pressao, '/', 1) AS INTEGER) >= 160) OR (up.pressao IS NOT NULL AND CAST(SPLIT_PART(up.pressao, '/', 2) AS INTEGER) >= 100) THEN 'MEDIUM'
                    WHEN ug.glicemia IS NOT NULL AND CAST(REGEXP_REPLACE(ug.glicemia::text, '[^0-9]', '', 'g') AS INTEGER) >= 126 THEN 'MEDIUM'
                    WHEN cr.st_hipertensao_arterial = 1 AND cr.st_diabetes = 1 THEN 'MEDIUM'
                    WHEN (COALESCE(uw.peso, cr.peso_autorreferido) IS NOT NULL AND ua.altura IS NOT NULL AND ua.altura > 0 AND (COALESCE(uw.peso, cr.peso_autorreferido)::numeric / POWER(ua.altura::numeric / 100, 2)) >= 30) THEN 'MEDIUM'
                    WHEN cr.st_hipertensao_arterial = 1 AND cr.st_fumante = 1 THEN 'MEDIUM'
                    WHEN EXTRACT(YEAR FROM AGE(cf.dt_nascimento)) < 40 THEN 'INDIVIDUALIZED_YOUNG'
                    WHEN EXTRACT(YEAR FROM AGE(cf.dt_nascimento)) >= 75 THEN 'INDIVIDUALIZED_ELDERLY'
                    WHEN cr.st_diabetes = 1 THEN 'LOW'
                    ELSE 'LOW'
                END AS computed_risk
            FROM CidadaoFiltrado cf
            
            -- Condições de Saúde (UNION ALL para buscar irmãos por CPF via índice)
            LEFT JOIN LATERAL (
                SELECT 
                    st_fumante, st_hipertensao_arterial, st_diabetes, 
                    st_doenca_cardiaca, st_infarto, st_derrame, st_problema_rins,
                    peso_autorreferido
                FROM tb_condicoes_saude_auto
                WHERE co_cidadao IN (
                    SELECT sibling.co_seq_cidadao FROM tb_cidadao sibling
                    WHERE sibling.nu_cpf = cf.nu_cpf AND cf.nu_cpf IS NOT NULL AND sibling.dt_obito IS NULL AND sibling.st_ativo = 1
                    UNION ALL
                    SELECT cf.co_seq_cidadao WHERE cf.nu_cpf IS NULL
                )
                ORDER BY co_seq_condicoes_saude_auto DESC LIMIT 1
            ) cr ON true
            
            -- Última consulta (UNION ALL via fat_cidadao_pec)
            LEFT JOIN LATERAL (
                SELECT TO_DATE(fat.co_dim_tempo::text, 'YYYYMMDD') AS data_ultima_consulta,
                       fat.ds_filtro_cids,
                       fat.ds_filtro_ciaps
                FROM (
                    SELECT fcp.co_seq_fat_cidadao_pec FROM tb_cidadao sibling
                    JOIN tb_fat_cidadao_pec fcp ON fcp.co_cidadao = sibling.co_seq_cidadao
                    WHERE sibling.nu_cpf = cf.nu_cpf AND cf.nu_cpf IS NOT NULL AND sibling.dt_obito IS NULL AND sibling.st_ativo = 1
                    UNION ALL
                    SELECT fcp.co_seq_fat_cidadao_pec FROM tb_fat_cidadao_pec fcp
                    WHERE fcp.co_cidadao = cf.co_seq_cidadao AND cf.nu_cpf IS NULL
                ) ids
                JOIN tb_fat_atendimento_individual fat ON fat.co_fat_cidadao_pec = ids.co_seq_fat_cidadao_pec
                ORDER BY fat.co_dim_tempo DESC LIMIT 1
            ) uc ON true
            
            -- Última Pressão (UNION ALL)
            LEFT JOIN LATERAL (
                SELECT CONCAT(fat.nu_pressao_sistolica, '/', fat.nu_pressao_diastolica) AS pressao
                FROM (
                    SELECT fcp.co_seq_fat_cidadao_pec FROM tb_cidadao sibling
                    JOIN tb_fat_cidadao_pec fcp ON fcp.co_cidadao = sibling.co_seq_cidadao
                    WHERE sibling.nu_cpf = cf.nu_cpf AND cf.nu_cpf IS NOT NULL AND sibling.dt_obito IS NULL AND sibling.st_ativo = 1
                    UNION ALL
                    SELECT fcp.co_seq_fat_cidadao_pec FROM tb_fat_cidadao_pec fcp
                    WHERE fcp.co_cidadao = cf.co_seq_cidadao AND cf.nu_cpf IS NULL
                ) ids
                JOIN tb_fat_atendimento_individual fat ON fat.co_fat_cidadao_pec = ids.co_seq_fat_cidadao_pec
                WHERE fat.nu_pressao_sistolica IS NOT NULL
                ORDER BY fat.co_dim_tempo DESC LIMIT 1
            ) up ON true
            
            -- Última Glicemia (UNION ALL)
            LEFT JOIN LATERAL (
                SELECT fat.nu_glicemia AS glicemia
                FROM (
                    SELECT fcp.co_seq_fat_cidadao_pec FROM tb_cidadao sibling
                    JOIN tb_fat_cidadao_pec fcp ON fcp.co_cidadao = sibling.co_seq_cidadao
                    WHERE sibling.nu_cpf = cf.nu_cpf AND cf.nu_cpf IS NOT NULL AND sibling.dt_obito IS NULL AND sibling.st_ativo = 1
                    UNION ALL
                    SELECT fcp.co_seq_fat_cidadao_pec FROM tb_fat_cidadao_pec fcp
                    WHERE fcp.co_cidadao = cf.co_seq_cidadao AND cf.nu_cpf IS NULL
                ) ids
                JOIN tb_fat_atendimento_individual fat ON fat.co_fat_cidadao_pec = ids.co_seq_fat_cidadao_pec
                WHERE fat.nu_glicemia IS NOT NULL
                ORDER BY fat.co_dim_tempo DESC LIMIT 1
            ) ug ON true
            
            -- Último Peso (UNION ALL)
            LEFT JOIN LATERAL (
                SELECT fat.nu_peso AS peso
                FROM (
                    SELECT fcp.co_seq_fat_cidadao_pec FROM tb_cidadao sibling
                    JOIN tb_fat_cidadao_pec fcp ON fcp.co_cidadao = sibling.co_seq_cidadao
                    WHERE sibling.nu_cpf = cf.nu_cpf AND cf.nu_cpf IS NOT NULL AND sibling.dt_obito IS NULL AND sibling.st_ativo = 1
                    UNION ALL
                    SELECT fcp.co_seq_fat_cidadao_pec FROM tb_fat_cidadao_pec fcp
                    WHERE fcp.co_cidadao = cf.co_seq_cidadao AND cf.nu_cpf IS NULL
                ) ids
                JOIN tb_fat_atendimento_individual fat ON fat.co_fat_cidadao_pec = ids.co_seq_fat_cidadao_pec
                WHERE fat.nu_peso IS NOT NULL
                ORDER BY fat.co_dim_tempo DESC LIMIT 1
            ) uw ON true
            
            -- Última Altura (UNION ALL)
            LEFT JOIN LATERAL (
                SELECT fat.nu_altura AS altura
                FROM (
                    SELECT fcp.co_seq_fat_cidadao_pec FROM tb_cidadao sibling
                    JOIN tb_fat_cidadao_pec fcp ON fcp.co_cidadao = sibling.co_seq_cidadao
                    WHERE sibling.nu_cpf = cf.nu_cpf AND cf.nu_cpf IS NOT NULL AND sibling.dt_obito IS NULL AND sibling.st_ativo = 1
                    UNION ALL
                    SELECT fcp.co_seq_fat_cidadao_pec FROM tb_fat_cidadao_pec fcp
                    WHERE fcp.co_cidadao = cf.co_seq_cidadao AND cf.nu_cpf IS NULL
                ) ids
                JOIN tb_fat_atendimento_individual fat ON fat.co_fat_cidadao_pec = ids.co_seq_fat_cidadao_pec
                WHERE fat.nu_altura IS NOT NULL
                ORDER BY fat.co_dim_tempo DESC LIMIT 1
            ) ua ON true

            -- Última visita domiciliar (UNION ALL)
            LEFT JOIN LATERAL (
                SELECT TO_DATE(fvd.co_dim_tempo::text, 'YYYYMMDD') AS data_ultima_visita
                FROM (
                    SELECT fcp.co_seq_fat_cidadao_pec FROM tb_cidadao sibling
                    JOIN tb_fat_cidadao_pec fcp ON fcp.co_cidadao = sibling.co_seq_cidadao
                    WHERE sibling.nu_cpf = cf.nu_cpf AND cf.nu_cpf IS NOT NULL AND sibling.dt_obito IS NULL AND sibling.st_ativo = 1
                    UNION ALL
                    SELECT fcp.co_seq_fat_cidadao_pec FROM tb_fat_cidadao_pec fcp
                    WHERE fcp.co_cidadao = cf.co_seq_cidadao AND cf.nu_cpf IS NULL
                ) ids
                JOIN tb_fat_visita_domiciliar fvd ON fvd.co_fat_cidadao_pec = ids.co_seq_fat_cidadao_pec
                ORDER BY fvd.co_dim_tempo DESC LIMIT 1
            ) uv ON true

            -- Último Exame do Pé (Procedimento SIGTAP 0301040095 - co_dim_procedimento = 7478)
            LEFT JOIN LATERAL (
                SELECT TO_DATE(fpa.co_dim_tempo::text, 'YYYYMMDD') AS data_ultimo_exame_pe
                FROM (
                    SELECT fcp.co_seq_fat_cidadao_pec FROM tb_cidadao sibling
                    JOIN tb_fat_cidadao_pec fcp ON fcp.co_cidadao = sibling.co_seq_cidadao
                    WHERE sibling.nu_cpf = cf.nu_cpf AND cf.nu_cpf IS NOT NULL AND sibling.dt_obito IS NULL AND sibling.st_ativo = 1
                    UNION ALL
                    SELECT fcp.co_seq_fat_cidadao_pec FROM tb_fat_cidadao_pec fcp
                    WHERE fcp.co_cidadao = cf.co_seq_cidadao AND cf.nu_cpf IS NULL
                ) ids
                JOIN tb_fat_proced_atend_proced fpa ON fpa.co_fat_cidadao_pec = ids.co_seq_fat_cidadao_pec
                WHERE fpa.co_dim_procedimento = 7478
                ORDER BY fpa.co_dim_tempo DESC LIMIT 1
            ) uep ON true

            -- HbA1c (UNION ALL via prontuário, com Optimization Fence)
            LEFT JOIN LATERAL (
                SELECT hem.vl_hemoglobina_glicada 
                FROM (
                    SELECT req.co_seq_exame_requisitado
                    FROM (
                        SELECT p.co_seq_prontuario FROM tb_cidadao sibling
                        JOIN tb_prontuario p ON p.co_cidadao = sibling.co_seq_cidadao
                        WHERE sibling.nu_cpf = cf.nu_cpf AND cf.nu_cpf IS NOT NULL AND sibling.dt_obito IS NULL AND sibling.st_ativo = 1
                        UNION ALL
                        SELECT p.co_seq_prontuario FROM tb_prontuario p
                        WHERE p.co_cidadao = cf.co_seq_cidadao AND cf.nu_cpf IS NULL
                    ) prons
                    JOIN tb_exame_requisitado req ON req.co_prontuario = prons.co_seq_prontuario
                    ORDER BY req.co_seq_exame_requisitado DESC 
                    OFFSET 0
                ) as safe_req
                JOIN tb_exame_hemoglobina_glicada hem ON hem.co_exame_requisitado = safe_req.co_seq_exame_requisitado
                LIMIT 1
            ) uh ON true

            -- Colesterol Total
            LEFT JOIN LATERAL (
                SELECT ct.vl_colesterol_total 
                FROM (
                    SELECT req.co_seq_exame_requisitado
                    FROM (
                        SELECT p.co_seq_prontuario FROM tb_cidadao sibling
                        JOIN tb_prontuario p ON p.co_cidadao = sibling.co_seq_cidadao
                        WHERE sibling.nu_cpf = cf.nu_cpf AND cf.nu_cpf IS NOT NULL AND sibling.dt_obito IS NULL AND sibling.st_ativo = 1
                        UNION ALL
                        SELECT p.co_seq_prontuario FROM tb_prontuario p
                        WHERE p.co_cidadao = cf.co_seq_cidadao AND cf.nu_cpf IS NULL
                    ) prons
                    JOIN tb_exame_requisitado req ON req.co_prontuario = prons.co_seq_prontuario
                    ORDER BY req.co_seq_exame_requisitado DESC 
                    OFFSET 0
                ) as safe_req
                JOIN tb_exame_colesterol_total ct ON ct.co_exame_requisitado = safe_req.co_seq_exame_requisitado
                LIMIT 1
            ) uct ON true

            -- Colesterol LDL
            LEFT JOIN LATERAL (
                SELECT ldl.vl_colesterol_ldl 
                FROM (
                    SELECT req.co_seq_exame_requisitado
                    FROM (
                        SELECT p.co_seq_prontuario FROM tb_cidadao sibling
                        JOIN tb_prontuario p ON p.co_cidadao = sibling.co_seq_cidadao
                        WHERE sibling.nu_cpf = cf.nu_cpf AND cf.nu_cpf IS NOT NULL AND sibling.dt_obito IS NULL AND sibling.st_ativo = 1
                        UNION ALL
                        SELECT p.co_seq_prontuario FROM tb_prontuario p
                        WHERE p.co_cidadao = cf.co_seq_cidadao AND cf.nu_cpf IS NULL
                    ) prons
                    JOIN tb_exame_requisitado req ON req.co_prontuario = prons.co_seq_prontuario
                    ORDER BY req.co_seq_exame_requisitado DESC 
                    OFFSET 0
                ) as safe_req
                JOIN tb_exame_colesterol_ldl ldl ON ldl.co_exame_requisitado = safe_req.co_seq_exame_requisitado
                LIMIT 1
            ) uldl ON true

            -- Clearance de Creatinina (TFGe)
            LEFT JOIN LATERAL (
                SELECT clr.vl_clearance_creatina 
                FROM (
                    SELECT req.co_seq_exame_requisitado
                    FROM (
                        SELECT p.co_seq_prontuario FROM tb_cidadao sibling
                        JOIN tb_prontuario p ON p.co_cidadao = sibling.co_seq_cidadao
                        WHERE sibling.nu_cpf = cf.nu_cpf AND cf.nu_cpf IS NOT NULL AND sibling.dt_obito IS NULL AND sibling.st_ativo = 1
                        UNION ALL
                        SELECT p.co_seq_prontuario FROM tb_prontuario p
                        WHERE p.co_cidadao = cf.co_seq_cidadao AND cf.nu_cpf IS NULL
                    ) prons
                    JOIN tb_exame_requisitado req ON req.co_prontuario = prons.co_seq_prontuario
                    ORDER BY req.co_seq_exame_requisitado DESC 
                    OFFSET 0
                ) as safe_req
                JOIN tb_exame_clearance_creatina clr ON clr.co_exame_requisitado = safe_req.co_seq_exame_requisitado
                LIMIT 1
            ) uclr ON true

            -- Creatinina Sérica (para cálculo CKD-EPI)
            LEFT JOIN LATERAL (
                SELECT cs.vl_creatina_serica 
                FROM (
                    SELECT req.co_seq_exame_requisitado
                    FROM (
                        SELECT p.co_seq_prontuario FROM tb_cidadao sibling
                        JOIN tb_prontuario p ON p.co_cidadao = sibling.co_seq_cidadao
                        WHERE sibling.nu_cpf = cf.nu_cpf AND cf.nu_cpf IS NOT NULL AND sibling.dt_obito IS NULL AND sibling.st_ativo = 1
                        UNION ALL
                        SELECT p.co_seq_prontuario FROM tb_prontuario p
                        WHERE p.co_cidadao = cf.co_seq_cidadao AND cf.nu_cpf IS NULL
                    ) prons
                    JOIN tb_exame_requisitado req ON req.co_prontuario = prons.co_seq_prontuario
                    ORDER BY req.co_seq_exame_requisitado DESC 
                    OFFSET 0
                ) as safe_req
                JOIN tb_exame_creatina_serica cs ON cs.co_exame_requisitado = safe_req.co_seq_exame_requisitado
                LIMIT 1
            ) ucs ON true
        ) sub
        WHERE 1=1
      `;

      let finalWhere = "";

      // Aplicar filtros que dependem do LATERAL ou de agrupamentos no resultado final
      if (filters.riskLevel) {
        const levels = filters.riskLevel.split(',');
        if (levels.includes('LOW')) levels.push('VERY_LOW');
        const placeholders = levels.map((_: any, i: number) => `$${dataParams.length + i + 1}`);
        finalWhere += ` AND computed_risk IN (${placeholders.join(',')})`;
        dataParams.push(...levels);
      }

      if (filters.consultMonths !== undefined && filters.consultMonths !== null && !isNaN(filters.consultMonths)) {
        finalWhere += ` AND (("Última Consulta" IS NULL OR "Última Consulta" < NOW() - ($${dataParams.length + 1} || ' months')::interval) AND ("Última Visita Domiciliar" IS NULL OR "Última Visita Domiciliar" < NOW() - ($${dataParams.length + 1} || ' months')::interval))`;
        dataParams.push(filters.consultMonths);
      }

      if (filters.footExam === 'with') {
        finalWhere += ` AND "Último Exame Pé" IS NOT NULL`;
      } else if (filters.footExam === 'without') {
        finalWhere += ` AND "Último Exame Pé" IS NULL`;
      }

      if (filters.cids && filters.cids.length > 0) {
        // CIDs que mapeiam para flags usam APENAS flags (consistente com território)
        // CIDs sem flag equivalente usam LIKE no "CIDs Fat"
        const hasPfx = ['I10', 'I11', 'I12', 'I13', 'I15'];
        const dmPfx = ['E10', 'E11', 'E12', 'E13', 'E14'];
        const cardioPfx = ['I21', 'I22', 'I50', 'I60', 'I61', 'I62', 'I63', 'I64'];
        const renalPfx = ['N18', 'N19'];
        const allFlagPfx = [...hasPfx, ...dmPfx, ...cardioPfx, ...renalPfx];

        const conditions: string[] = [];
        if (filters.cids.some((c: string) => hasPfx.some(p => c.startsWith(p)))) conditions.push('"flag_has" = 1');
        if (filters.cids.some((c: string) => dmPfx.some(p => c.startsWith(p)))) conditions.push('"flag_dm" = 1');
        if (filters.cids.some((c: string) => cardioPfx.some(p => c.startsWith(p)))) conditions.push('("flag_cardiaca" = 1 OR "flag_infarto" = 1 OR "flag_derrame" = 1)');
        if (filters.cids.some((c: string) => renalPfx.some(p => c.startsWith(p)))) conditions.push('"flag_renal" = 1');

        // CIDs que não mapeiam para nenhuma flag → LIKE
        const unmappedCids = filters.cids.filter((c: string) => !allFlagPfx.some(p => c.startsWith(p)));
        for (const cid of unmappedCids) {
          conditions.push(`"CIDs Fat" LIKE $${dataParams.length + 1}`);
          dataParams.push(`%${cid}%`);
        }

        if (conditions.length > 0) {
          finalWhere += ` AND (${conditions.join(' OR ')})`;
        }
      }

      if (filters.smoking) {
        finalWhere += ` AND "Fumante" = $${dataParams.length + 1}`;
        dataParams.push(filters.smoking);
      }

      fullQuery += finalWhere;

      if (!cteAlreadyPaginated) {
        fullQuery += ` LIMIT ${pageSize} OFFSET ${offset}`;
      }

      const rows = await pecQuery(fullQuery, dataParams);
      if (!rows) throw new Error('Query failed');

      let maccMap: Record<string, number> = {};
      try {
        const patientIds = rows.map((r: any) => `pec-${r['ID']}`);
        const rawIds = rows.map((r: any) => String(r['ID']));
        const allIds = Array.from(new Set([...patientIds, ...rawIds]));

        const maccs = await (prisma as any).maccClassification.findMany({
          where: { pacienteId: { in: allIds } },
          orderBy: { createdAt: 'desc' },
        });
        for (const m of maccs) {
          if (!maccMap[m.pacienteId]) {
            maccMap[m.pacienteId] = m.maccLevel;
          }
        }
      } catch (e) {
        // Silencioso se conexão Prisma/tabela MACC não estiver pronta
      }

      const patients = rows.map((row: any) => {
        const paStr = row['Última Pressão'] || "";
        const [s, d] = paStr.split('/');

        const cidsRaw = row['CIDs Fat'] || '';
        let cidsArray = cidsRaw.split('|').filter((c: string) => c.trim() !== '');

        // Fallback: se não tem CIDs, tentar mapear CIAPs para CIDs equivalentes
        const ciapsRaw = row['CIAPs Fat'] || '';
        const ciapsArray = ciapsRaw.split('|').filter((c: string) => c.trim() !== '');
        if (cidsArray.length === 0 && ciapsArray.length > 0) {
          const ciapMap: Record<string, string> = { 'K86': 'I10', 'K87': 'I11.0', 'T89': 'E10', 'T90': 'E11', 'K75': 'I21', 'K77': 'I50', 'K90': 'I63', 'U99': 'N18', 'T82': 'E66' };
          cidsArray = ciapsArray.map((c: string) => ciapMap[c]).filter(Boolean) as string[];
        }

        // Injetar doenças baseadas nas flags se não estiverem nos CIDs
        if (row['flag_has'] === 1 && !cidsArray.some((c: string) => c.toLowerCase().includes('hipertens'))) {
          cidsArray.unshift("Hipertensão");
        }
        if (row['flag_dm'] === 1 && !cidsArray.some((c: string) => c.toLowerCase().includes('diabet'))) {
          cidsArray.unshift("Diabetes");
        }
        if (row['flag_infarto'] === 1 && !cidsArray.some((c: string) => c.toLowerCase().includes('infarto'))) {
          cidsArray.unshift("Histórico de Infarto");
        }
        if (row['flag_derrame'] === 1 && !cidsArray.some((c: string) => c.toLowerCase().includes('derrame') || c.toLowerCase().includes('avc'))) {
          cidsArray.unshift("Histórico de AVC/Derrame");
        }
        if (row['flag_cardiaca'] === 1 && !cidsArray.some((c: string) => c.toLowerCase().includes('card'))) {
          cidsArray.unshift("Doença Cardíaca");
        }
        if (row['flag_renal'] === 1 && !cidsArray.some((c: string) => c.toLowerCase().includes('renal') || c.toLowerCase().includes('rim'))) {
          cidsArray.unshift("Insuficiência Renal");
        }

        const p: PatientMock = {
          id: `pec-${row['ID']}`,
          nome: row['Nome'],
          idade: parseInt(row['Idade'], 10),
          sexo: row['Sexo'],
          microarea: row['Microárea'],
          cids: cidsArray,
          data_ultima_consulta: row['Última Consulta'],
          data_ultima_visita_domiciliar: row['Última Visita Domiciliar'],
          data_afericao: row['Data Aferição'] || null,
          fumante: row['Fumante'] || 'Sem Registro',
          ultima_pa_sistolica: s ? parseInt(s, 10) : null,
          ultima_pa_diastolica: d ? parseInt(d, 10) : null,
          ultimo_hba1c: row['HbA1c'] ? parseFloat(row['HbA1c']) : null,
          ultimo_colesterol_total: row['ultimo_colesterol_total'] ? parseFloat(row['ultimo_colesterol_total']) : null,
          ultimo_colesterol_ldl: row['ultimo_colesterol_ldl'] ? parseFloat(row['ultimo_colesterol_ldl']) : null,
          ultimo_clearance_creatina: row['ultimo_clearance_creatina'] ? parseFloat(row['ultimo_clearance_creatina']) : null,
          ultimo_creatina_serica: row['ultimo_creatina_serica'] ? parseFloat(row['ultimo_creatina_serica']) : null,
          glicemia_capilar: row['Glicemia Capilar'] ? parseInt(row['Glicemia Capilar'], 10) : null,
          peso: row['Peso'] ? parseFloat(row['Peso']) : null,
          altura: row['Altura'] ? parseFloat(row['Altura']) : null,
          imc: (row['Peso'] && row['Altura']) ? (parseFloat(row['Peso']) / Math.pow(parseFloat(row['Altura']) / 100, 2)) : null,
          flag_has: row['flag_has'],
          flag_dm: row['flag_dm'],
          flag_cardiaca: row['flag_cardiaca'],
          flag_renal: row['flag_renal'],
          flag_infarto: row['flag_infarto'],
          flag_derrame: row['flag_derrame'],
          unidade: row['Unidade'] || null,
          endereco: row['Endereço'] || null,
          telefone: row['Telefone'] || null,
          data_ultimo_exame_pe: row['Último Exame Pé'] || null,
          dt_atualizado: row['Atualizado Em'] || null,
          macc_level: maccMap[`pec-${row['ID']}`] || maccMap[String(row['ID'])] || null,
          raw_computed_risk: row['computed_risk'],
        } as any;
        return this.stratifySinglePatient(p);
      });

      return {
        data: patients,
        pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) }
      };
    } catch (error: any) {
      console.error('[RiskStratification] DB Error:', error.message);
      throw error;
    }
  }

  private getStratifiedPaginatedMock(page: number, pageSize: number, filters: any) {
    let list = this.stratifyPatients(filters.microarea);

    if (filters.riskLevel) {
      const levels = filters.riskLevel.split(',');
      list = list.filter(p => levels.includes(p.risk_level));
    }

    if (filters.consultMonths) {
      const cutoff = new Date();
      cutoff.setMonth(cutoff.getMonth() - filters.consultMonths);
      list = list.filter(p => {
        const consultDate = p.data_ultima_consulta ? new Date(p.data_ultima_consulta) : null;
        const visitDate = (p as any).data_ultima_visita_domiciliar ? new Date((p as any).data_ultima_visita_domiciliar) : null;
        const consultOld = !consultDate || consultDate < cutoff;
        const visitOld = !visitDate || visitDate < cutoff;
        return consultOld && visitOld;
      });
    }

    if (filters.footExam === 'with') {
      list = list.filter(p => Boolean((p as any).data_ultimo_exame_pe));
    } else if (filters.footExam === 'without') {
      list = list.filter(p => !(p as any).data_ultimo_exame_pe);
    }

    if (filters.smoking) {
list = list.filter(p => p.fumante === filters.smoking);
    }

    const start = (page - 1) * pageSize;
    return {
      data: list.slice(start, start + pageSize),
      pagination: { page, pageSize, total: list.length, totalPages: Math.ceil(list.length / pageSize) }
    };
  }

  public async getHistoricalIndicatorsEvolution(ine?: string, microarea?: string): Promise<any[]> {
    const quarters = [
      { period: '2025-Q1', label: '1º Trim. 2025' },
      { period: '2025-Q2', label: '2º Trim. 2025' },
      { period: '2025-Q3', label: '3º Trim. 2025' },
      { period: '2025-Q4', label: '4º Trim. 2025' },
      { period: '2026-Q1', label: '1º Trim. 2026 (Atual)' },
    ];

    if (!isPecConfigured) {
      return [
        { period: '2025-Q1', label: '1º Trim. 2025', totalPatients: 412, highRisk: 64, mediumRisk: 140, lowRisk: 208, c4Percentage: 58.4, c5Percentage: 52.1, footExamRate: 38.5 },
        { period: '2025-Q2', label: '2º Trim. 2025', totalPatients: 428, highRisk: 58, mediumRisk: 145, lowRisk: 225, c4Percentage: 63.2, c5Percentage: 59.8, footExamRate: 46.2 },
        { period: '2025-Q3', label: '3º Trim. 2025', totalPatients: 441, highRisk: 52, mediumRisk: 149, lowRisk: 240, c4Percentage: 69.1, c5Percentage: 65.4, footExamRate: 54.0 },
        { period: '2025-Q4', label: '4º Trim. 2025', totalPatients: 455, highRisk: 47, mediumRisk: 148, lowRisk: 260, c4Percentage: 74.5, c5Percentage: 71.0, footExamRate: 61.8 },
        { period: '2026-Q1', label: '1º Trim. 2026 (Atual)', totalPatients: 468, highRisk: 42, mediumRisk: 145, lowRisk: 281, c4Percentage: 78.2, c5Percentage: 75.6, footExamRate: 68.4 },
      ];
    }

    const results: any[] = [];
    for (const q of quarters) {
      try {
        const res = await this.getStratifiedPaginated(1, 100, { ine, microarea, quarter: q.period });
        const patients: StratifiedPatient[] = res.data || [];
        const totalPatients = res.pagination?.total || patients.length;

        const highRisk = patients.filter(p => p.risk_level === RiskLevel.HIGH).length;
        const mediumRisk = patients.filter(p => p.risk_level === RiskLevel.MEDIUM).length;
        const lowRisk = patients.filter(p => p.risk_level === RiskLevel.LOW).length;

        const hypertensives = patients.filter(p => (p as any).flag_has === 1 || p.cids.some(c => c.startsWith('I1')));
        const paEmDia = hypertensives.filter(p => p.ultima_pa_sistolica && p.ultima_pa_sistolica < 140 && p.ultima_pa_diastolica && p.ultima_pa_diastolica < 90).length;
        const c4Percentage = hypertensives.length > 0 ? parseFloat(((paEmDia / hypertensives.length) * 100).toFixed(1)) : 0;

        const diabetics = patients.filter(p => (p as any).flag_dm === 1 || p.cids.some(c => c.startsWith('E1')));
        const hba1cEmDia = diabetics.filter(p => p.ultimo_hba1c && p.ultimo_hba1c <= 7.0).length;
        const c5Percentage = diabetics.length > 0 ? parseFloat(((hba1cEmDia / diabetics.length) * 100).toFixed(1)) : 0;

        const peEmDia = diabetics.filter(p => Boolean((p as any).data_ultimo_exame_pe)).length;
        const footExamRate = diabetics.length > 0 ? parseFloat(((peEmDia / diabetics.length) * 100).toFixed(1)) : 0;

        results.push({
          period: q.period,
          label: q.label,
          totalPatients,
          highRisk,
          mediumRisk,
          lowRisk,
          c4Percentage,
          c5Percentage,
          footExamRate
        });
      } catch {
        results.push({
          period: q.period,
          label: q.label,
          totalPatients: 0,
          highRisk: 0,
          mediumRisk: 0,
          lowRisk: 0,
          c4Percentage: 0,
          c5Percentage: 0,
          footExamRate: 0
        });
      }
    }
    return results;
  }

  public async getPatientSoapHistory(patientId: string): Promise<any[]> {
    const cleanId = patientId.replace(/^pec-/, '');
    if (!isPecConfigured) {
      return [
        {
          id: "soap-1",
          data: "2026-01-15",
          profissional: "Dra. Maria Santos",
          cargo: "Médica de Família",
          subjetivo: "Paciente comparece para acompanhamento de Hipertensão e Diabetes. Queixa-se de tonturas ocasionais ao levantar. Nega dor no peito ou falta de ar.",
          objetivo: "PA: 135/85 mmHg. Peso: 78.5 kg. Altura: 1.65m. IMC: 28.8 kg/m². Glicemia capilar: 142 mg/dL. Exame dos pés: pulsos pediosos presentes bilateralmente, monofilamento 10g preservado em 9/10 pontos.",
          avaliacao: "Hipertensão Arterial Sistêmica Estágio 1 (controlada). Diabetes Mellitus Tipo 2 em tratamento oral. Risco Cardiovascular Médio.",
          plano: "1. Mantido Losartana 50mg 1x/dia e Metformina 850mg 2x/dia. 2. Solicitado controle de HbA1c e Perfil Lipídico. 3. Reorientada dieta hipossódica e caminhadas 30min/dia. 4. Retorno em 60 dias."
        },
        {
          id: "soap-2",
          data: "2025-09-20",
          profissional: "Enf. Carlos Eduardo",
          cargo: "Enfermeiro de Família",
          subjetivo: "Consulta de rotina hipertensão/diabetes. Relata boa adesão à medicação. Sem queixas agudas.",
          objetivo: "PA: 140/90 mmHg. Peso: 80.1 kg. Glicemia de jejum: 156 mg/dL. HbA1c recente: 7.4%.",
          avaliacao: "Diabetes tipo 2 com controle glicêmico moderado. PA no limite superior.",
          plano: "1. Reforço de orientações sobre dieta e adesão medicamentosa. 2. Aferição de PA semanal pelo ACS."
        }
      ];
    }

    try {
      const sql = `
        SELECT 
          fat.co_seq_fat_atd_ind AS id,
          TO_CHAR(TO_DATE(fat.co_dim_tempo::text, 'YYYYMMDD'), 'YYYY-MM-DD') AS data,
          COALESCE(prof.no_profissional, 'Profissional de Saúde') AS profissional,
          COALESCE(cbo.no_cbo, 'Equipe de Saúde') AS cargo,
          es.ds_evolucao_subjetivo AS subjetivo,
          eo.ds_evolucao_objetivo AS objetivo,
          ea.ds_evolucao_avaliacao AS avaliacao,
          ep.ds_evolucao_plano AS plano
        FROM tb_fat_atendimento_individual fat
        JOIN tb_fat_cidadao_pec fcp ON fcp.co_seq_fat_cidadao_pec = fat.co_fat_cidadao_pec
        LEFT JOIN tb_prof prof ON fat.co_dim_profissional_1 = prof.co_seq_prof
        LEFT JOIN tb_cbo cbo ON fat.co_dim_cbo_1 = cbo.co_seq_cbo
        LEFT JOIN tb_evolucao_subjetivo es ON es.co_atendimento_individual = fat.co_seq_fat_atd_ind
        LEFT JOIN tb_evolucao_objetivo eo ON eo.co_atendimento_individual = fat.co_seq_fat_atd_ind
        LEFT JOIN tb_evolucao_avaliacao ea ON ea.co_atendimento_individual = fat.co_seq_fat_atd_ind
        LEFT JOIN tb_evolucao_plano ep ON ep.co_atendimento_individual = fat.co_seq_fat_atd_ind
        WHERE (fcp.co_cidadao = $1 OR fcp.co_seq_fat_cidadao_pec = $1)
        ORDER BY fat.co_dim_tempo DESC
        LIMIT 20
      `;
      const rows = await pecQuery(sql, [cleanId]);
      return (rows as any[]).map(r => ({
        id: String(r.id),
        data: r.data,
        profissional: r.profissional,
        cargo: r.cargo,
        subjetivo: r.subjetivo || "Sem registro narrativo",
        objetivo: r.objetivo || "Sem registro narrativo",
        avaliacao: r.avaliacao || "Sem registro narrativo",
        plano: r.plano || "Sem registro narrativo"
      }));
    } catch (e) {
      console.error('[getPatientSoapHistory] Error querying PEC SOAP:', e);
      return [];
    }
  }

  // Backwards compatibility
  public getDiabeticPatients(microarea?: string) { return this.stratifyPatients(microarea).filter(p => this.isDM(p)); }
  public getHypertensivePatients(microarea?: string) { return this.stratifyPatients(microarea).filter(p => this.isHAS(p)); }
  public getAssistedLastTrimester() { return this.stratifyPatients().filter(p => p.data_ultima_consulta != null); }
  public getNeedingActiveSearch(microarea?: string) { return this.stratifyPatients(microarea).filter(p => !p.data_ultima_consulta); }
  public getByCids(cids: string[], microarea?: string) { return this.stratifyPatients(microarea).filter(p => p.cids.some(c => cids.includes(c))); }

  /**
   * Retorna pacientes para o mapa do território — versão LEVE.
   * Sem LATERAL JOINs pesados. Só endereço, condições e risco.
   * Limite de 500 pacientes. Filtro obrigatório por microárea ou INE.
   */
  public async getMapPatients(filters: { microarea?: string; ine?: string; unidade?: string; condition?: string; urgent?: boolean; searchName?: string; searchType?: string }): Promise<any[]> {
    if (!isPecConfigured) {
      return this.getMapPatientsMock(filters);
    }

    try {
      const params: any[] = [];
      let extraWhere = "";

      // Search name/cpf/cns filter
      if (filters.searchName) {
        const normalizedSearch = filters.searchName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        if (filters.searchType === 'cpf') {
          const cleanCpf = filters.searchName.replace(/\D/g, '');
          extraWhere += ` AND c.nu_cpf LIKE $${params.length + 1}`;
          params.push(`${cleanCpf}%`);
        } else if (filters.searchType === 'cns') {
          const cleanCns = filters.searchName.replace(/\D/g, '');
          extraWhere += ` AND c.nu_cns LIKE $${params.length + 1}`;
          params.push(`${cleanCns}%`);
        } else {
          extraWhere += ` AND translate(lower(c.no_cidadao_filtro), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc') ILIKE $${params.length + 1}`;
          params.push(`%${normalizedSearch}%`);
        }
      }

      // INE filter
      if (filters.ine && filters.ine !== 'all') {
        const ines = filters.ine.split(',');
        const ph = ines.map((_: any, i: number) => `$${params.length + i + 1}`).join(',');
        extraWhere += ` AND ve.nu_ine IN (${ph})`;
        params.push(...ines);
      }

      // Unidade filter
      if (filters.unidade && filters.unidade !== 'all') {
        const uds = filters.unidade.split(',');
        const ph = uds.map((_: any, i: number) => `$${params.length + i + 1}`).join(',');
        extraWhere += ` AND ve.nu_cnes IN (${ph})`;
        params.push(...uds);
      }

      // Microarea filter (only applied when explicitly set)
      if (filters.microarea && filters.microarea !== 'all') {
        const mas = filters.microarea.split(',');
        const maPh = mas.map((_: any, i: number) => `$${params.length + i + 1}`).join(',');
        extraWhere += ` AND c.nu_micro_area IN (${maPh})`;
        params.push(...mas);
      } else if ((!filters.ine || filters.ine === 'all') && !filters.searchName) {
        // Default to microarea 01 only when no INE filter and no search term is set
        extraWhere += ` AND c.nu_micro_area IN ('01', '1', '001')`;
      }

      // Condition filter (DM, HAS, or both)
      let condWhere = "";
      if (filters.condition === 'DM') {
        condWhere = " AND cr.st_diabetes = 1";
      } else if (filters.condition === 'HAS') {
        condWhere = " AND cr.st_hipertensao_arterial = 1";
      } else {
        // Default: both DM or HAS
        condWhere = " AND (cr.st_diabetes = 1 OR cr.st_hipertensao_arterial = 1)";
      }

      // Urgent filter — pacientes com DCV/DRC/complicações, Alto/Muito Alto risco (ex: DM2 >= 40) ou Idosos (>= 75 anos)
      if (filters.urgent) {
        condWhere += ` AND (
          cr.st_doenca_cardiaca = 1 OR 
          cr.st_problema_rins = 1 OR 
          cr.st_infarto = 1 OR 
          cr.st_derrame = 1 OR 
          (cr.st_diabetes = 1 AND EXTRACT(YEAR FROM AGE(NOW(), cws.dt_nascimento)) >= 40) OR
          EXTRACT(YEAR FROM AGE(NOW(), cws.dt_nascimento)) >= 75
        )`;
      }

      const limitIdx = params.length + 1;
      params.push(2000); // Hard limit

      const sql = `
        WITH UniqueCidadaos AS (
          SELECT DISTINCT ON (COALESCE(c.nu_cpf, c.co_seq_cidadao::text))
            c.co_seq_cidadao,
            c.no_cidadao,
            c.dt_nascimento,
            c.no_sexo,
            c.nu_micro_area,
            c.ds_logradouro,
            c.nu_numero,
            c.no_bairro,
            c.ds_cep,
            c.nu_telefone_celular,
            c.nu_telefone_residencial,
            c.nu_telefone_contato,
            c.nu_cpf,
            c.dt_atualizado
          FROM tb_cidadao c
          JOIN tb_cidadao_vinculacao_equipe ve ON c.co_seq_cidadao = ve.co_cidadao
          WHERE c.dt_obito IS NULL
            AND c.st_ativo = 1
            AND ve.st_saida_cadastro_obito = 0
            AND ve.st_saida_cadastro_territorio = 0
            ${extraWhere}
          ORDER BY COALESCE(c.nu_cpf, c.co_seq_cidadao::text), c.dt_atualizado DESC, c.co_seq_cidadao DESC
        ),
        CidadaoWithSiblings AS (
          SELECT uc.*,
                 CASE 
                   WHEN uc.nu_cpf IS NOT NULL THEN (
                     SELECT array_agg(sibling.co_seq_cidadao)
                     FROM tb_cidadao sibling
                     WHERE sibling.nu_cpf = uc.nu_cpf 
                       AND sibling.dt_obito IS NULL
                       AND sibling.st_ativo = 1
                   )
                   ELSE ARRAY[uc.co_seq_cidadao]
                 END AS all_co_seq_cidadaos
          FROM UniqueCidadaos uc
        )
        SELECT
          cws.co_seq_cidadao AS "id",
          cws.no_cidadao AS "nome",
          EXTRACT(YEAR FROM AGE(NOW(), cws.dt_nascimento))::int AS "idade",
          cws.no_sexo AS "sexo",
          cws.nu_micro_area AS "microarea",
          cws.ds_logradouro AS "logradouro",
          cws.nu_numero AS "numero",
          cws.no_bairro AS "bairro",
          cws.ds_cep AS "cep",
          cr.st_hipertensao_arterial AS "flag_has",
          cr.st_diabetes AS "flag_dm",
          cr.st_doenca_cardiaca AS "flag_cardiaca",
          cr.st_problema_rins AS "flag_renal",
          cr.st_infarto AS "flag_infarto",
          cr.st_derrame AS "flag_derrame",
          COALESCE(cws.nu_telefone_celular, cws.nu_telefone_residencial, cws.nu_telefone_contato) AS "telefone",
          COALESCE(geo1.nu_latitude, geo2.nu_latitude, geo3.nu_latitude) AS "lat",
          COALESCE(geo1.nu_longitude, geo2.nu_longitude, geo3.nu_longitude) AS "lng"
        FROM CidadaoWithSiblings cws
        LEFT JOIN LATERAL (
          SELECT st_hipertensao_arterial, st_diabetes, st_doenca_cardiaca, st_problema_rins, st_infarto, st_derrame
          FROM tb_condicoes_saude_auto
          WHERE co_cidadao = ANY(cws.all_co_seq_cidadaos)
          ORDER BY co_seq_condicoes_saude_auto DESC LIMIT 1
        ) cr ON true
        -- Busca 1: Cadastro Domiciliar Familiar
        LEFT JOIN LATERAL (
          SELECT fcd.nu_latitude, fcd.nu_longitude
          FROM tb_fat_cidadao_pec fcp
          JOIN tb_fat_cad_dom_familia fam ON fam.co_fat_cidadao_pec = fcp.co_seq_fat_cidadao_pec
          JOIN tb_fat_cad_domiciliar fcd ON fcd.co_seq_fat_cad_domiciliar = fam.co_fat_cad_domiciliar
          WHERE fcp.co_cidadao = ANY(cws.all_co_seq_cidadaos)
            AND fcd.nu_latitude IS NOT NULL
            AND fcd.nu_longitude IS NOT NULL
          ORDER BY (fcd.co_dim_tempo + 0) DESC
          LIMIT 1
        ) geo1 ON true
        -- Busca 2: Família Território
        LEFT JOIN LATERAL (
          SELECT fcd.nu_latitude, fcd.nu_longitude
          FROM tb_fat_cidadao_pec fcp
          JOIN tb_fat_familia_territorio ft ON ft.co_fat_cidadao_pec = fcp.co_seq_fat_cidadao_pec
          JOIN tb_fat_cad_domiciliar fcd ON fcd.co_seq_fat_cad_domiciliar = ft.co_fat_cad_domiciliar
          WHERE fcp.co_cidadao = ANY(cws.all_co_seq_cidadaos)
            AND fcd.nu_latitude IS NOT NULL
            AND fcd.nu_longitude IS NOT NULL
          ORDER BY (fcd.co_dim_tempo + 0) DESC
          LIMIT 1
        ) geo2 ON true
        -- Busca 3: Visita Domiciliar ACS (Fallback de GPS)
        LEFT JOIN LATERAL (
          SELECT fvd.nu_latitude, fvd.nu_longitude
          FROM tb_fat_cidadao_pec fcp
          JOIN tb_fat_visita_domiciliar fvd ON fvd.co_fat_cidadao_pec = fcp.co_seq_fat_cidadao_pec
          WHERE fcp.co_cidadao = ANY(cws.all_co_seq_cidadaos)
            AND fvd.nu_latitude IS NOT NULL
            AND fvd.nu_longitude IS NOT NULL
          ORDER BY (fvd.co_dim_tempo + 0) DESC
          LIMIT 1
        ) geo3 ON true
        WHERE 1=1
          ${condWhere}
        LIMIT $${limitIdx}
      `;

      const rows = await pecQuery(sql, params);
      return (rows as any[]).map((r: any) => ({
        id: `pec-${r.id}`,
        nome: r.nome,
        idade: r.idade,
        sexo: r.sexo,
        microarea: r.microarea,
        logradouro: r.logradouro,
        numero: r.numero,
        bairro: r.bairro,
        cep: r.cep,
        has: r.flag_has === 1,
        dm: r.flag_dm === 1,
        cardiaca: r.flag_cardiaca === 1,
        renal: r.flag_renal === 1,
        infarto: r.flag_infarto === 1,
        derrame: r.flag_derrame === 1,
        telefone: r.telefone || null,
        lat: r.lat ? parseFloat(r.lat) : undefined,
        lng: r.lng ? parseFloat(r.lng) : undefined,
        isExactGps: !!(r.lat && r.lng),
      }));
    } catch (error: any) {
      console.error('[MapPatients] DB Error:', error.message);
      throw error;
    }
  }

  private getMapPatientsMock(filters: any): any[] {
    const BAIRROS_RECIFE = [
      { bairro: "Boa Viagem", logradouro: "Rua dos Navegantes", numero: "500" },
      { bairro: "Casa Amarela", logradouro: "Rua da Harmonia", numero: "120" },
      { bairro: "Várzea", logradouro: "Av Caxangá", numero: "800" },
      { bairro: "Ibura", logradouro: "Rua Açaí", numero: "45" },
      { bairro: "Imbiribeira", logradouro: "Rua Imperial", numero: "300" },
    ];
    return mockPatients.slice(0, 12).map((p, i) => {
      const addr = BAIRROS_RECIFE[i % BAIRROS_RECIFE.length];
      return {
        id: p.id,
        nome: p.nome,
        idade: p.idade,
        sexo: p.sexo,
        microarea: p.microarea,
        logradouro: addr.logradouro,
        numero: addr.numero,
        bairro: addr.bairro,
        cep: "50000-000",
        has: p.cids.some(c => c.startsWith('I1')),
        dm: p.cids.some(c => c.startsWith('E1')),
        cardiaca: false,
      };
    });
  }

  public async getTerritoryStats(
    microarea?: string,
    unidade?: string,
    ine?: string,
    quarter?: string,
    startDate?: string,
    endDate?: string
  ): Promise<any> {
    if (!isPecConfigured) {
      return this.getTerritoryStatsMock(microarea, unidade, quarter, startDate, endDate);
    }

    try {
      const params: any[] = [];
      let extraWhere = "";
      let veJoin = "JOIN tb_cidadao_vinculacao_equipe ve ON c.co_seq_cidadao = ve.co_cidadao";

      if (ine && ine !== 'all') {
        const ines = ine.split(',');
        const placeholders = ines.map((_: any, i: number) => `$${params.length + i + 1}`).join(',');
        extraWhere += ` AND ve.nu_ine IN (${placeholders})`;
        params.push(...ines);
      }

      if (unidade && unidade !== 'all') {
        const uds = unidade.split(',');
        const placeholders = uds.map((_: any, i: number) => `$${params.length + i + 1}`).join(',');
        extraWhere += ` AND ve.nu_cnes IN (${placeholders})`;
        params.push(...uds);
      }

      if (microarea && microarea !== 'all') {
        const mas = microarea.split(',');
        const placeholders = mas.map((_: any, i: number) => `$${params.length + i + 1}`).join(',');
        extraWhere += ` AND c.nu_micro_area IN (${placeholders})`;
        params.push(...mas);
      }

      // ── Resolve temporal cutoff (Custom Date Range > Quarter > Current) ──
      const getQuarterEndDate = (qStr?: string): string | null => {
        if (!qStr) return null;
        const match = qStr.match(/^(\d{4})-Q([1-4])$/);
        if (!match) return null;
        const year = match[1];
        const q = match[2];
        const endDates: Record<string, string> = {
          '1': `${year}-03-31`,
          '2': `${year}-06-30`,
          '3': `${year}-09-30`,
          '4': `${year}-12-31`,
        };
        return endDates[q] || null;
      };

      let cutoffDate: string | null = null;
      if (endDate && /^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
        cutoffDate = endDate;
      } else if (quarter) {
        cutoffDate = getQuarterEndDate(quarter);
      }

      const formatYYYYMMDD = (d: Date) => {
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        return parseInt(`${yyyy}${mm}${dd}`, 10);
      };

      const targetRefDate = cutoffDate ? new Date(`${cutoffDate}T23:59:59`) : new Date();
      const date6mAgo = new Date(targetRefDate);
      date6mAgo.setMonth(date6mAgo.getMonth() - 6);
      const date12mAgo = new Date(targetRefDate);
      date12mAgo.setFullYear(date12mAgo.getFullYear() - 1);

      const cutoffInt = formatYYYYMMDD(targetRefDate);
      const start6mInt = formatYYYYMMDD(date6mAgo);
      const start12mInt = formatYYYYMMDD(date12mAgo);
      const referenceDate = `'${targetRefDate.toISOString().split('T')[0]}'::date`;

      const hasFilter = extraWhere.trim().length > 0;

      let query: string;

      if (hasFilter) {
        // FULL query with real C4/C5 indicators (safe — filtered dataset is small)
        // Highly optimized: Uses B-Tree integer range index scans on co_dim_tempo
        query = `
          WITH TargetCidadaosAll AS (
            SELECT DISTINCT ON (COALESCE(c.nu_cpf, c.co_seq_cidadao::text))
                   c.co_seq_cidadao, c.dt_nascimento, c.nu_micro_area, c.no_bairro, ve.nu_ine, c.nu_cpf, c.dt_atualizado
            FROM tb_cidadao c
            ${veJoin}
            WHERE c.dt_obito IS NULL 
              AND c.st_ativo = 1
              AND ve.st_saida_cadastro_obito = 0 
              AND ve.st_saida_cadastro_territorio = 0
              ${extraWhere}
            ORDER BY COALESCE(c.nu_cpf, c.co_seq_cidadao::text), c.dt_atualizado DESC, c.co_seq_cidadao DESC
          ),
          TargetCidadaos AS (
            SELECT 
              tca.co_seq_cidadao,
              tca.dt_nascimento,
              tca.nu_micro_area,
              tca.no_bairro,
              tca.nu_ine,
              CASE 
                WHEN tca.nu_cpf IS NOT NULL THEN (
                  SELECT array_agg(sibling.co_seq_cidadao)
                  FROM tb_cidadao sibling
                  WHERE sibling.nu_cpf = tca.nu_cpf 
                    AND sibling.dt_obito IS NULL
                    AND sibling.st_ativo = 1
                )
                ELSE ARRAY[tca.co_seq_cidadao]
              END AS all_co_seq_cidadaos
            FROM TargetCidadaosAll tca
          ),
          TargetCidadaosWithPECs AS (
            SELECT
              tc.*,
              (
                SELECT array_agg(fp.co_seq_fat_cidadao_pec)
                FROM tb_fat_cidadao_pec fp
                WHERE fp.co_cidadao = ANY(tc.all_co_seq_cidadaos)
              ) AS all_co_seq_fat_cidadao_pecs,
              (
                SELECT array_agg(p.co_seq_prontuario)
                FROM tb_prontuario p
                WHERE p.co_cidadao = ANY(tc.all_co_seq_cidadaos)
              ) AS all_co_seq_prontuarios
            FROM TargetCidadaos tc
          ),
          Diagnosis AS (
            SELECT 
              tcw.*,
              COALESCE(csa.st_hipertensao_arterial, 0) as is_hyp,
              COALESCE(csa.st_diabetes, 0) as is_dm,
              (COALESCE(csa.st_infarto, 0) + COALESCE(csa.st_derrame, 0) + COALESCE(csa.st_doenca_cardiaca, 0)) > 0 as is_dcv,
              (COALESCE(csa.st_infarto, 0) + COALESCE(csa.st_derrame, 0) + COALESCE(csa.st_doenca_cardiaca, 0) + COALESCE(csa.st_problema_rins, 0)) > 0 as is_high_risk_base,
              -- Indicators: última consulta (somente eventos até o cutoff)
              (SELECT MAX(TO_DATE(f.co_dim_tempo::text, 'YYYYMMDD')) FROM tb_fat_atendimento_individual f WHERE f.co_fat_cidadao_pec = ANY(tcw.all_co_seq_fat_cidadao_pecs) AND f.co_dim_tempo <= ${cutoffInt}) AS dt_ultima_consulta,
              -- PA nos últimos 6 meses (B-Tree integer index scan)
              (SELECT 1 FROM tb_fat_atendimento_individual f WHERE f.co_fat_cidadao_pec = ANY(tcw.all_co_seq_fat_cidadao_pecs) AND f.nu_pressao_sistolica IS NOT NULL AND f.co_dim_tempo BETWEEN ${start6mInt} AND ${cutoffInt} LIMIT 1) AS has_pa_6m,
              -- Visita domiciliar nos últimos 12 meses (B-Tree integer index scan)
              (SELECT 1 FROM tb_fat_visita_domiciliar fvd WHERE fvd.co_fat_cidadao_pec = ANY(tcw.all_co_seq_fat_cidadao_pecs) AND fvd.co_dim_tempo BETWEEN ${start12mInt} AND ${cutoffInt} LIMIT 1) AS has_visita_12m,
              -- Peso/Altura nos últimos 12 meses (B-Tree integer index scan)
              (SELECT 1 FROM tb_fat_atendimento_individual f WHERE f.co_fat_cidadao_pec = ANY(tcw.all_co_seq_fat_cidadao_pecs) AND f.nu_peso IS NOT NULL AND f.nu_altura IS NOT NULL AND f.co_dim_tempo BETWEEN ${start12mInt} AND ${cutoffInt} LIMIT 1) AS has_peso_altura,
              -- HbA1c nos últimos 12 meses
              (SELECT 1 FROM tb_exame_requisitado req JOIN tb_exame_hemoglobina_glicada hem ON hem.co_exame_requisitado = req.co_seq_exame_requisitado WHERE req.co_prontuario = ANY(tcw.all_co_seq_prontuarios) LIMIT 1) AS has_hba1c,
              -- Exame do Pé nos últimos 12 meses (B-Tree integer index scan)
              (SELECT 1 FROM tb_fat_proced_atend_proced fpa WHERE fpa.co_fat_cidadao_pec = ANY(tcw.all_co_seq_fat_cidadao_pecs) AND fpa.co_dim_procedimento = 7478 AND fpa.co_dim_tempo BETWEEN ${start12mInt} AND ${cutoffInt} LIMIT 1) AS has_exame_pes
            FROM TargetCidadaosWithPECs tcw
            LEFT JOIN LATERAL (
              SELECT st_hipertensao_arterial, st_diabetes, st_infarto, st_derrame, st_doenca_cardiaca, st_problema_rins
              FROM tb_condicoes_saude_auto
              WHERE co_cidadao = ANY(tcw.all_co_seq_cidadaos)
              ORDER BY co_seq_condicoes_saude_auto DESC LIMIT 1
            ) csa ON true
          ),
          Classified AS (
            SELECT *,
              CASE 
                WHEN is_dcv THEN 'VERY_HIGH'
                WHEN is_high_risk_base THEN 'HIGH' 
                WHEN is_dm = 1 AND EXTRACT(YEAR FROM AGE(NOW(), dt_nascimento)) >= 40 THEN 'HIGH'
                WHEN EXTRACT(YEAR FROM AGE(NOW(), dt_nascimento)) < 40 THEN 'INDIVIDUALIZED_YOUNG'
                WHEN EXTRACT(YEAR FROM AGE(NOW(), dt_nascimento)) >= 75 THEN 'INDIVIDUALIZED_ELDERLY'
                WHEN is_hyp = 1 OR is_dm = 1 THEN 'MEDIUM' 
                ELSE 'LOW' 
              END AS risk_level
            FROM Diagnosis
          )
          SELECT
            COUNT(*) AS total,
            COUNT(*) FILTER (WHERE risk_level = 'VERY_HIGH') AS very_high_risk,
            COUNT(*) FILTER (WHERE risk_level = 'HIGH') AS high_risk,
            COUNT(*) FILTER (WHERE risk_level = 'MEDIUM') AS medium_risk,
            COUNT(*) FILTER (WHERE risk_level = 'LOW') AS low_risk,
            COUNT(*) FILTER (WHERE risk_level = 'VERY_LOW') AS very_low_risk,
            COUNT(*) FILTER (WHERE risk_level IN ('INDIVIDUALIZED', 'INDIVIDUALIZED_YOUNG', 'INDIVIDUALIZED_ELDERLY')) AS individualized_risk,
            COUNT(*) FILTER (WHERE risk_level = 'INDIVIDUALIZED_YOUNG') AS individualized_young_risk,
            COUNT(*) FILTER (WHERE risk_level = 'INDIVIDUALIZED_ELDERLY') AS individualized_elderly_risk,
            COUNT(*) FILTER (WHERE is_hyp = 1) AS hyp_total,
            COUNT(*) FILTER (WHERE is_dm = 1) AS dm_total,
            -- HAS indicators (using referenceDate instead of NOW())
            COUNT(*) FILTER (WHERE is_hyp = 1 AND dt_ultima_consulta >= ${referenceDate} - INTERVAL '6 months') AS hyp_consulta_6m,
            COUNT(*) FILTER (WHERE is_hyp = 1 AND has_pa_6m = 1) AS hyp_pa_6m,
            COUNT(*) FILTER (WHERE is_hyp = 1 AND has_visita_12m = 1) AS hyp_visita_12m,
            COUNT(*) FILTER (WHERE is_hyp = 1 AND has_peso_altura = 1) AS hyp_peso_altura,
            -- DM indicators
            COUNT(*) FILTER (WHERE is_dm = 1 AND dt_ultima_consulta >= ${referenceDate} - INTERVAL '6 months') AS dm_consulta_6m,
            COUNT(*) FILTER (WHERE is_dm = 1 AND has_pa_6m = 1) AS dm_pa_6m,
            COUNT(*) FILTER (WHERE is_dm = 1 AND has_peso_altura = 1) AS dm_peso_altura,
            COUNT(*) FILTER (WHERE is_dm = 1 AND has_hba1c = 1) AS dm_hba1c,
            COUNT(*) FILTER (WHERE is_dm = 1 AND has_exame_pes = 1) AS dm_exame_pes,
            COUNT(*) FILTER (WHERE is_dm = 1 AND has_visita_12m = 1) AS dm_visita_12m
          FROM Classified
        `;

      } else {
        // LIGHTWEIGHT query — no indicators (too expensive for 1.5M patients)
        query = `
          WITH TargetCidadaosAll AS (
            SELECT DISTINCT ON (COALESCE(c.nu_cpf, c.co_seq_cidadao::text))
                   c.co_seq_cidadao, c.dt_nascimento, c.nu_micro_area, c.no_bairro, ve.nu_ine, c.nu_cpf, c.dt_atualizado
            FROM tb_cidadao c
            ${veJoin}
            WHERE c.dt_obito IS NULL 
              AND c.st_ativo = 1
              AND ve.st_saida_cadastro_obito = 0 
              AND ve.st_saida_cadastro_territorio = 0
              ${extraWhere}
            ORDER BY COALESCE(c.nu_cpf, c.co_seq_cidadao::text), c.dt_atualizado DESC, c.co_seq_cidadao DESC
          ),
          TargetCidadaos AS (
            SELECT 
              tca.co_seq_cidadao,
              tca.dt_nascimento,
              tca.nu_micro_area,
              tca.no_bairro,
              tca.nu_ine,
              CASE 
                WHEN tca.nu_cpf IS NOT NULL THEN (
                  SELECT array_agg(sibling.co_seq_cidadao)
                  FROM tb_cidadao sibling
                  WHERE sibling.nu_cpf = tca.nu_cpf 
                    AND sibling.dt_obito IS NULL
                    AND sibling.st_ativo = 1
                )
                ELSE ARRAY[tca.co_seq_cidadao]
              END AS all_co_seq_cidadaos
            FROM TargetCidadaosAll tca
          ),
          Diagnosis AS (
            SELECT 
              tc.*,
              COALESCE(csa.st_hipertensao_arterial, 0) as is_hyp,
              COALESCE(csa.st_diabetes, 0) as is_dm,
              (COALESCE(csa.st_infarto, 0) + COALESCE(csa.st_derrame, 0) + COALESCE(csa.st_doenca_cardiaca, 0)) > 0 as is_dcv,
              (COALESCE(csa.st_infarto, 0) + COALESCE(csa.st_derrame, 0) + COALESCE(csa.st_doenca_cardiaca, 0) + COALESCE(csa.st_problema_rins, 0)) > 0 as is_high_risk_base
            FROM TargetCidadaos tc
            LEFT JOIN LATERAL (
              SELECT st_hipertensao_arterial, st_diabetes, st_infarto, st_derrame, st_doenca_cardiaca, st_problema_rins
              FROM tb_condicoes_saude_auto
              WHERE co_cidadao = ANY(tc.all_co_seq_cidadaos)
              ORDER BY co_seq_condicoes_saude_auto DESC LIMIT 1
            ) csa ON true
          ),
          Classified AS (
            SELECT *,
              CASE 
                WHEN is_dcv THEN 'VERY_HIGH'
                WHEN is_high_risk_base THEN 'HIGH' 
                WHEN is_dm = 1 AND EXTRACT(YEAR FROM AGE(NOW(), dt_nascimento)) >= 40 THEN 'HIGH'
                WHEN EXTRACT(YEAR FROM AGE(NOW(), dt_nascimento)) < 40 THEN 'INDIVIDUALIZED_YOUNG'
                WHEN EXTRACT(YEAR FROM AGE(NOW(), dt_nascimento)) >= 75 THEN 'INDIVIDUALIZED_ELDERLY'
                WHEN is_hyp = 1 OR is_dm = 1 THEN 'MEDIUM' 
                ELSE 'LOW' 
              END AS risk_level
            FROM Diagnosis
          )
          SELECT
            COUNT(*) AS total,
            COUNT(*) FILTER (WHERE risk_level = 'VERY_HIGH') AS very_high_risk,
            COUNT(*) FILTER (WHERE risk_level = 'HIGH') AS high_risk,
            COUNT(*) FILTER (WHERE risk_level = 'MEDIUM') AS medium_risk,
            COUNT(*) FILTER (WHERE risk_level = 'LOW') AS low_risk,
            COUNT(*) FILTER (WHERE risk_level = 'VERY_LOW') AS very_low_risk,
            COUNT(*) FILTER (WHERE risk_level IN ('INDIVIDUALIZED', 'INDIVIDUALIZED_YOUNG', 'INDIVIDUALIZED_ELDERLY')) AS individualized_risk,
            COUNT(*) FILTER (WHERE risk_level = 'INDIVIDUALIZED_YOUNG') AS individualized_young_risk,
            COUNT(*) FILTER (WHERE risk_level = 'INDIVIDUALIZED_ELDERLY') AS individualized_elderly_risk,
            COUNT(*) FILTER (WHERE is_hyp = 1) AS hyp_total,
            COUNT(*) FILTER (WHERE is_dm = 1) AS dm_total,
            0 AS hyp_consulta_6m, 0 AS hyp_pa_6m, 0 AS hyp_visita_12m, 0 AS hyp_peso_altura,
            0 AS dm_consulta_6m, 0 AS dm_pa_6m, 0 AS dm_peso_altura, 0 AS dm_hba1c, 0 AS dm_exame_pes, 0 AS dm_visita_12m
          FROM Classified
        `;
      }

      const rows = await pecQuery(query, params);
      if (!rows || (rows as any[]).length === 0) throw new Error('No data');

      const r = (rows as any[])[0];
      const total = parseInt(r.total, 10);
      const hypTotal = parseInt(r.hyp_total, 10);
      const dmTotal = parseInt(r.dm_total, 10);

      const pct = (n: number, d: number) => d > 0 ? Math.round((n / d) * 100) : 0;

      // Microarea counts was removed for performance optimization
      const microareaCounts: Record<string, any> = {};

      return {
        total,
        riskDistribution: {
          veryHigh: parseInt(r.very_high_risk || '0', 10),
          high: parseInt(r.high_risk || '0', 10),
          medium: parseInt(r.medium_risk || '0', 10),
          low: parseInt(r.low_risk || '0', 10),
          veryLow: parseInt(r.very_low_risk || '0', 10),
          individualized: parseInt(r.individualized_risk || '0', 10),
        },
        c5: {
          total: hypTotal,
          score: hypTotal > 0 ? Math.round((
            pct(parseInt(r.hyp_consulta_6m, 10), hypTotal) +
            pct(parseInt(r.hyp_pa_6m, 10), hypTotal) +
            pct(parseInt(r.hyp_visita_12m, 10), hypTotal) +
            pct(parseInt(r.hyp_peso_altura, 10), hypTotal)) / 4) : 0,
          rows: [
            { label: "Consulta médica/enfermagem (6 meses)", actual: pct(parseInt(r.hyp_consulta_6m, 10), hypTotal), target: 90 },
            { label: "Aferição de PA (6 meses)", actual: pct(parseInt(r.hyp_pa_6m, 10), hypTotal), target: 95 },
            { label: "Visita domiciliar ACS (2/ano)", actual: pct(parseInt(r.hyp_visita_12m, 10), hypTotal), target: 80 },
            { label: "Peso/altura (1/ano)", actual: pct(parseInt(r.hyp_peso_altura, 10), hypTotal), target: 85 },
          ],
        },
        c4: {
          total: dmTotal,
          score: dmTotal > 0 ? Math.round(
            pct(parseInt(r.dm_consulta_6m, 10), dmTotal) * 0.2 +
            pct(parseInt(r.dm_pa_6m, 10), dmTotal) * 0.15 +
            pct(parseInt(r.dm_peso_altura, 10), dmTotal) * 0.15 +
            pct(parseInt(r.dm_hba1c, 10), dmTotal) * 0.15 +
            pct(parseInt(r.dm_exame_pes, 10), dmTotal) * 0.15 +
            pct(parseInt(r.dm_visita_12m, 10), dmTotal) * 0.2) : 0,
          rows: [
            { label: "Consulta médica/enfermagem (6 meses)", actual: pct(parseInt(r.dm_consulta_6m, 10), dmTotal), target: 90 },
            { label: "Aferição de PA (6 meses)", actual: pct(parseInt(r.dm_pa_6m, 10), dmTotal), target: 95 },
            { label: "Peso/altura (1/ano)", actual: pct(parseInt(r.dm_peso_altura, 10), dmTotal), target: 85 },
            { label: "HbA1c (12 meses)", actual: pct(parseInt(r.dm_hba1c, 10), dmTotal), target: 80 },
            { label: "Exame dos pés (1/ano)", actual: pct(parseInt(r.dm_exame_pes, 10), dmTotal), target: 75 },
            { label: "Visita domiciliar ACS (2/ano)", actual: pct(parseInt(r.dm_visita_12m, 10), dmTotal), target: 80 },
          ],
        },
        microareaCounts,
      };
    } catch (error: any) {
      console.error('[TerritoryStats] Error:', error.message);
      throw error;
    }
  }

  private getTerritoryStatsMock(microarea?: string, unidade?: string, quarter?: string, startDate?: string, endDate?: string) {
    const patients = this.stratifyPatients(microarea);
    const high = patients.filter(p => p.risk_level === 'HIGH').length;
    const medium = patients.filter(p => p.risk_level === 'MEDIUM').length;
    const low = patients.filter(p => p.risk_level === 'LOW').length;
    const hyp = patients.filter(p => p.cids.some(c => c.startsWith('I1')));
    const dm = patients.filter(p => p.cids.some(c => c.startsWith('E1')));

    const qData: Record<string, { c5Score: number; c5Rows: number[]; c4Score: number; c4Rows: number[] }> = {
      '2025-Q1': {
        c5Score: 38,
        c5Rows: [42, 22, 82, 20],
        c4Score: 34,
        c4Rows: [48, 24, 20, 40, 1, 84],
      },
      '2025-Q2': {
        c5Score: 43,
        c5Rows: [46, 26, 86, 23],
        c4Score: 39,
        c4Rows: [52, 27, 22, 44, 2, 87],
      },
      '2025-Q3': {
        c5Score: 48,
        c5Rows: [50, 29, 90, 26],
        c4Score: 44,
        c4Rows: [56, 30, 25, 48, 2, 90],
      },
      '2025-Q4': {
        c5Score: 51,
        c5Rows: [53, 31, 93, 28],
        c4Score: 47,
        c4Rows: [60, 32, 27, 51, 3, 92],
      },
      '2026-Q1': {
        c5Score: 53,
        c5Rows: [55, 32, 95, 29],
        c4Score: 49,
        c4Rows: [62, 33, 28, 54, 3, 94],
      },
    };

    const selectedQ = (quarter && qData[quarter]) ? qData[quarter] : qData['2026-Q1'];

    return {
      total: patients.length,
      riskDistribution: { high, medium, low },
      c5: {
        total: hyp.length > 0 ? hyp.length : 180,
        score: selectedQ.c5Score,
        rows: [
          { label: "Consulta médica/enfermagem (6 meses)", actual: selectedQ.c5Rows[0], target: 90 },
          { label: "Aferição de PA (6 meses)", actual: selectedQ.c5Rows[1], target: 95 },
          { label: "Visita domiciliar ACS (2/ano)", actual: selectedQ.c5Rows[2], target: 80 },
          { label: "Peso/altura (1/ano)", actual: selectedQ.c5Rows[3], target: 85 },
        ]
      },
      c4: {
        total: dm.length > 0 ? dm.length : 140,
        score: selectedQ.c4Score,
        rows: [
          { label: "Consulta médica/enfermagem (6 meses)", actual: selectedQ.c4Rows[0], target: 90 },
          { label: "Aferição de PA (6 meses)", actual: selectedQ.c4Rows[1], target: 95 },
          { label: "Peso/altura (1/ano)", actual: selectedQ.c4Rows[2], target: 85 },
          { label: "HbA1c (12 meses)", actual: selectedQ.c4Rows[3], target: 80 },
          { label: "Exame dos pés (1/ano)", actual: selectedQ.c4Rows[4], target: 75 },
          { label: "Visita domiciliar ACS (2/ano)", actual: selectedQ.c4Rows[5], target: 80 },
        ]
      },
      microareaCounts: {},
    };
  }

  // ── Cache para benchmarks globais (por quarter) ──
  private globalBenchmarksCache: Map<string, { data: any; timestamp: number }> = new Map();
  private readonly BENCHMARK_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hora

  /**
   * Retorna os benchmarks globais (média de TODAS as equipes) para comparação.
   * Executa a query SEM filtro de INE/microarea/unidade para obter a média geral.
   * Resultado cacheado por 1 hora por quarter.
   */
  public async getGlobalBenchmarks(quarter?: string): Promise<any> {
    const cacheKey = quarter || 'current';
    const cached = this.globalBenchmarksCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < this.BENCHMARK_CACHE_TTL_MS) {
      return cached.data;
    }

    if (!isPecConfigured) {
      return this.getGlobalBenchmarksMock(quarter);
    }

    try {
      // Resolve quarter → cutoff (same logic as getTerritoryStats)
      const getQuarterEndDate = (qStr?: string): string | null => {
        if (!qStr) return null;
        const match = qStr.match(/^(\d{4})-Q([1-4])$/);
        if (!match) return null;
        const year = match[1];
        const q = match[2];
        const endDates: Record<string, string> = {
          '1': `${year}-03-31`, '2': `${year}-06-30`,
          '3': `${year}-09-30`, '4': `${year}-12-31`,
        };
        return endDates[q] || null;
      };

      const cutoffDate = quarter ? getQuarterEndDate(quarter) : null;
      const isHistorical = !!cutoffDate && cutoffDate !== '2026-03-31';

      const formatYYYYMMDD = (d: Date) => {
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        return parseInt(`${yyyy}${mm}${dd}`, 10);
      };

      const targetRefDate = cutoffDate ? new Date(`${cutoffDate}T23:59:59`) : new Date();
      const date6mAgo = new Date(targetRefDate);
      date6mAgo.setMonth(date6mAgo.getMonth() - 6);
      const date12mAgo = new Date(targetRefDate);
      date12mAgo.setFullYear(date12mAgo.getFullYear() - 1);

      const cutoffInt = formatYYYYMMDD(targetRefDate);
      const start6mInt = formatYYYYMMDD(date6mAgo);
      const start12mInt = formatYYYYMMDD(date12mAgo);

      // Query GLOBAL: sem filtro de equipe. Pega TODAS as equipes.
      // Usa amostragem por equipe: calcula os indicadores por equipe e depois faz a média
      const query = `
        WITH AllEquipes AS (
          SELECT DISTINCT ve.nu_ine
          FROM tb_cidadao_vinculacao_equipe ve
          WHERE ve.nu_ine IS NOT NULL
            AND ve.st_saida_cadastro_obito = 0
            AND ve.st_saida_cadastro_territorio = 0
        ),
        EquipeStats AS (
          SELECT
            ve.nu_ine,
            COUNT(*) FILTER (WHERE COALESCE(csa.st_hipertensao_arterial, 0) = 1) AS hyp_total,
            COUNT(*) FILTER (WHERE COALESCE(csa.st_diabetes, 0) = 1) AS dm_total,
            -- C5 (HAS) indicators
            COUNT(*) FILTER (WHERE COALESCE(csa.st_hipertensao_arterial, 0) = 1
              AND EXISTS (
                SELECT 1 FROM tb_fat_atendimento_individual f
                WHERE f.co_fat_cidadao_pec = ANY(
                  (SELECT array_agg(fp.co_seq_fat_cidadao_pec) FROM tb_fat_cidadao_pec fp WHERE fp.co_cidadao = c.co_seq_cidadao)
                )
                AND f.co_dim_tempo BETWEEN ${start6mInt} AND ${cutoffInt}
              )
            ) AS hyp_consulta_6m,
            COUNT(*) FILTER (WHERE COALESCE(csa.st_hipertensao_arterial, 0) = 1
              AND EXISTS (
                SELECT 1 FROM tb_fat_atendimento_individual f
                WHERE f.co_fat_cidadao_pec = ANY(
                  (SELECT array_agg(fp.co_seq_fat_cidadao_pec) FROM tb_fat_cidadao_pec fp WHERE fp.co_cidadao = c.co_seq_cidadao)
                )
                AND f.nu_pressao_sistolica IS NOT NULL
                AND f.co_dim_tempo BETWEEN ${start6mInt} AND ${cutoffInt}
              )
            ) AS hyp_pa_6m,
            COUNT(*) FILTER (WHERE COALESCE(csa.st_hipertensao_arterial, 0) = 1
              AND EXISTS (
                SELECT 1 FROM tb_fat_visita_domiciliar fvd
                WHERE fvd.co_fat_cidadao_pec = ANY(
                  (SELECT array_agg(fp.co_seq_fat_cidadao_pec) FROM tb_fat_cidadao_pec fp WHERE fp.co_cidadao = c.co_seq_cidadao)
                )
                AND fvd.co_dim_tempo BETWEEN ${start12mInt} AND ${cutoffInt}
              )
            ) AS hyp_visita_12m,
            COUNT(*) FILTER (WHERE COALESCE(csa.st_hipertensao_arterial, 0) = 1
              AND EXISTS (
                SELECT 1 FROM tb_fat_atendimento_individual f
                WHERE f.co_fat_cidadao_pec = ANY(
                  (SELECT array_agg(fp.co_seq_fat_cidadao_pec) FROM tb_fat_cidadao_pec fp WHERE fp.co_cidadao = c.co_seq_cidadao)
                )
                AND f.nu_peso IS NOT NULL AND f.nu_altura IS NOT NULL
                AND f.co_dim_tempo BETWEEN ${start12mInt} AND ${cutoffInt}
              )
            ) AS hyp_peso_altura,
            -- C4 (DM) indicators
            COUNT(*) FILTER (WHERE COALESCE(csa.st_diabetes, 0) = 1
              AND EXISTS (
                SELECT 1 FROM tb_fat_atendimento_individual f
                WHERE f.co_fat_cidadao_pec = ANY(
                  (SELECT array_agg(fp.co_seq_fat_cidadao_pec) FROM tb_fat_cidadao_pec fp WHERE fp.co_cidadao = c.co_seq_cidadao)
                )
                AND f.co_dim_tempo BETWEEN ${start6mInt} AND ${cutoffInt}
              )
            ) AS dm_consulta_6m,
            COUNT(*) FILTER (WHERE COALESCE(csa.st_diabetes, 0) = 1
              AND EXISTS (
                SELECT 1 FROM tb_fat_atendimento_individual f
                WHERE f.co_fat_cidadao_pec = ANY(
                  (SELECT array_agg(fp.co_seq_fat_cidadao_pec) FROM tb_fat_cidadao_pec fp WHERE fp.co_cidadao = c.co_seq_cidadao)
                )
                AND f.nu_pressao_sistolica IS NOT NULL
                AND f.co_dim_tempo BETWEEN ${start6mInt} AND ${cutoffInt}
              )
            ) AS dm_pa_6m,
            COUNT(*) FILTER (WHERE COALESCE(csa.st_diabetes, 0) = 1
              AND EXISTS (
                SELECT 1 FROM tb_fat_atendimento_individual f
                WHERE f.co_fat_cidadao_pec = ANY(
                  (SELECT array_agg(fp.co_seq_fat_cidadao_pec) FROM tb_fat_cidadao_pec fp WHERE fp.co_cidadao = c.co_seq_cidadao)
                )
                AND f.nu_peso IS NOT NULL AND f.nu_altura IS NOT NULL
                AND f.co_dim_tempo BETWEEN ${start12mInt} AND ${cutoffInt}
              )
            ) AS dm_peso_altura,
            COUNT(*) FILTER (WHERE COALESCE(csa.st_diabetes, 0) = 1
              AND EXISTS (
                SELECT 1 FROM tb_fat_visita_domiciliar fvd
                WHERE fvd.co_fat_cidadao_pec = ANY(
                  (SELECT array_agg(fp.co_seq_fat_cidadao_pec) FROM tb_fat_cidadao_pec fp WHERE fp.co_cidadao = c.co_seq_cidadao)
                )
                AND fvd.co_dim_tempo BETWEEN ${start12mInt} AND ${cutoffInt}
              )
            ) AS dm_visita_12m,
            COUNT(*) FILTER (WHERE COALESCE(csa.st_diabetes, 0) = 1
              AND EXISTS (
                SELECT 1 FROM tb_prontuario p
                JOIN tb_exame_requisitado req ON req.co_prontuario = p.co_seq_prontuario
                JOIN tb_exame_hemoglobina_glicada hem ON hem.co_exame_requisitado = req.co_seq_exame_requisitado
                WHERE p.co_cidadao = c.co_seq_cidadao
              )
            ) AS dm_hba1c,
            COUNT(*) FILTER (WHERE COALESCE(csa.st_diabetes, 0) = 1
              AND EXISTS (
                SELECT 1 FROM tb_fat_proced_atend_proced fpa
                WHERE fpa.co_fat_cidadao_pec = ANY(
                  (SELECT array_agg(fp.co_seq_fat_cidadao_pec) FROM tb_fat_cidadao_pec fp WHERE fp.co_cidadao = c.co_seq_cidadao)
                )
                AND fpa.co_dim_procedimento = 7478
                AND fpa.co_dim_tempo BETWEEN ${start12mInt} AND ${cutoffInt}
              )
            ) AS dm_exame_pes
          FROM tb_cidadao c
          JOIN tb_cidadao_vinculacao_equipe ve ON c.co_seq_cidadao = ve.co_cidadao
          LEFT JOIN LATERAL (
            SELECT st_hipertensao_arterial, st_diabetes
            FROM tb_condicoes_saude_auto
            WHERE co_cidadao = c.co_seq_cidadao
            ORDER BY co_seq_condicoes_saude_auto DESC LIMIT 1
          ) csa ON true
          WHERE c.dt_obito IS NULL
            AND c.st_ativo = 1
            AND ve.st_saida_cadastro_obito = 0
            AND ve.st_saida_cadastro_territorio = 0
            AND (COALESCE(csa.st_hipertensao_arterial, 0) = 1 OR COALESCE(csa.st_diabetes, 0) = 1)
          GROUP BY ve.nu_ine
        )
        SELECT
          -- C5 (HAS) global averages
          ROUND(AVG(CASE WHEN hyp_total > 0 THEN hyp_consulta_6m * 100.0 / hyp_total ELSE NULL END)) AS avg_hyp_consulta_6m,
          ROUND(AVG(CASE WHEN hyp_total > 0 THEN hyp_pa_6m * 100.0 / hyp_total ELSE NULL END)) AS avg_hyp_pa_6m,
          ROUND(AVG(CASE WHEN hyp_total > 0 THEN hyp_visita_12m * 100.0 / hyp_total ELSE NULL END)) AS avg_hyp_visita_12m,
          ROUND(AVG(CASE WHEN hyp_total > 0 THEN hyp_peso_altura * 100.0 / hyp_total ELSE NULL END)) AS avg_hyp_peso_altura,
          -- C4 (DM) global averages
          ROUND(AVG(CASE WHEN dm_total > 0 THEN dm_consulta_6m * 100.0 / dm_total ELSE NULL END)) AS avg_dm_consulta_6m,
          ROUND(AVG(CASE WHEN dm_total > 0 THEN dm_pa_6m * 100.0 / dm_total ELSE NULL END)) AS avg_dm_pa_6m,
          ROUND(AVG(CASE WHEN dm_total > 0 THEN dm_peso_altura * 100.0 / dm_total ELSE NULL END)) AS avg_dm_peso_altura,
          ROUND(AVG(CASE WHEN dm_total > 0 THEN dm_hba1c * 100.0 / dm_total ELSE NULL END)) AS avg_dm_hba1c,
          ROUND(AVG(CASE WHEN dm_total > 0 THEN dm_exame_pes * 100.0 / dm_total ELSE NULL END)) AS avg_dm_exame_pes,
          ROUND(AVG(CASE WHEN dm_total > 0 THEN dm_visita_12m * 100.0 / dm_total ELSE NULL END)) AS avg_dm_visita_12m,
          COUNT(*) AS total_equipes
        FROM EquipeStats
        WHERE hyp_total > 0 OR dm_total > 0
      `;

      console.log('[Global Benchmarks] Calculando médias globais de indicadores...');
      const rows = await pecQuery(query);
      if (!rows || rows.length === 0) {
        return this.getGlobalBenchmarksMock(quarter);
      }
      const r = rows[0];

      const data = {
        c5: [
          parseInt(r.avg_hyp_consulta_6m || '54'),
          parseInt(r.avg_hyp_pa_6m || '35'),
          parseInt(r.avg_hyp_visita_12m || '88'),
          parseInt(r.avg_hyp_peso_altura || '37'),
        ],
        c4: [
          parseInt(r.avg_dm_consulta_6m || '60'),
          parseInt(r.avg_dm_pa_6m || '37'),
          parseInt(r.avg_dm_peso_altura || '33'),
          parseInt(r.avg_dm_hba1c || '48'),
          parseInt(r.avg_dm_exame_pes || '9'),
          parseInt(r.avg_dm_visita_12m || '87'),
        ],
        totalEquipes: parseInt(r.total_equipes || '0'),
      };

      console.log(`[Global Benchmarks] Cacheando resultado (${data.totalEquipes} equipes)`);
      this.globalBenchmarksCache.set(cacheKey, { data, timestamp: Date.now() });
      return data;

    } catch (error) {
      console.error('[Global Benchmarks] Erro ao calcular:', error);
      // Fallback to mock
      return this.getGlobalBenchmarksMock(quarter);
    }
  }

  private getGlobalBenchmarksMock(quarter?: string): any {
    // Valores mock representando a média geral de todas as equipes
    const mockByQuarter: Record<string, { c5: number[]; c4: number[] }> = {
      '2025-Q1': { c5: [45, 28, 75, 30], c4: [50, 30, 25, 35, 5, 78] },
      '2025-Q2': { c5: [48, 30, 78, 32], c4: [52, 32, 27, 38, 6, 80] },
      '2025-Q3': { c5: [50, 32, 82, 34], c4: [55, 34, 30, 42, 7, 83] },
      '2025-Q4': { c5: [52, 34, 85, 36], c4: [58, 36, 32, 45, 8, 85] },
      '2026-Q1': { c5: [54, 35, 88, 37], c4: [60, 37, 33, 48, 9, 87] },
    };
    const q = (quarter && mockByQuarter[quarter]) ? mockByQuarter[quarter] : mockByQuarter['2026-Q1'];
    return { c5: q.c5, c4: q.c4, totalEquipes: 42 };
  }
}

export default new RiskStratificationService();


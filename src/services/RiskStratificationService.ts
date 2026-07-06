import { mockPatients, PatientMock } from '../mocks/patientsMock';
import { pecQuery, isPecConfigured } from '../db/pecDb';

export enum RiskLevel {
  HIGH = 'HIGH',
  MEDIUM = 'MEDIUM',
  LOW = 'LOW',
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

    const highRiskReasons: string[] = [];

    if (paSistolica >= 180 || paDiastolica >= 110) {
      highRiskReasons.push("PA ≥ 180/110 mmHg (HAS Estágio 3)");
    }

    if (this.isPANaoControlada(patient) &&
      patient.cids.some(cid => this.cardiovascularCids.some(cv => cid.startsWith(cv)))) {
      highRiskReasons.push("PA não controlada + DCV estabelecida");
    }

    if (this.isPANaoControlada(patient) && this.isDM(patient)) {
      highRiskReasons.push("PA não controlada + DM");
    }

    if (hba1c > 9) {
      highRiskReasons.push("HbA1c > 9%");
    }

    if (glicemiaJejum > 250) {
      highRiskReasons.push("Glicemia de jejum > 250 mg/dL");
    }

    if ((patient as any).flag_infarto === 1) highRiskReasons.push("Histórico de Infarto");
    if ((patient as any).flag_derrame === 1) highRiskReasons.push("Histórico de AVC/Derrame");
    if ((patient as any).flag_cardiaca === 1) highRiskReasons.push("Cardiopatia Detectada");
    if ((patient as any).flag_renal === 1) highRiskReasons.push("Insuficiência Renal");

    const highRiskCids = [
      ...this.hasComplicadaCids,
      ...this.cardiovascularCids,
      ...this.renalCids,
      ...this.retinopatiaCids,
      ...this.neuropatiaCids,
      ...this.demenciaCids,
      ...this.peDiabeticoCids
    ];

    if (patient.cids.some(cid => highRiskCids.some(h => cid.startsWith(h)))) {
      highRiskReasons.push("Comorbidade Clínica (CID)");
    }

    if (highRiskReasons.length > 0) {
      riskLevel = RiskLevel.HIGH;
      deadline = "7 dias";
      reason = highRiskReasons.join(" + ");
      action = this.isDM(patient)
        ? "Agendar consulta médica em até 7 dias (reavaliação urgente)."
        : "Agendar consulta médica ou visita domiciliar em até 7 dias.";
    } else {
      const mediumRiskReasons: string[] = [];

      if ((paSistolica >= 160 && paSistolica <= 179) || (paDiastolica >= 100 && paDiastolica <= 109)) {
        mediumRiskReasons.push("PA 160-179/100-109 mmHg (HAS Estágio 2)");
      }

      // Fatores de risco para HAS Controlada
      if (this.isHAS(patient) && !this.isPANaoControlada(patient)) {
        const idade = patient.idade;
        const isMasc = patient.sexo === 'M';

        if ((isMasc && idade > 55) || (!isMasc && idade > 65)) {
          mediumRiskReasons.push("HAS Controlada + Idade de risco");
        }
        if (patient.fumante === 'Sim') {
          mediumRiskReasons.push("HAS Controlada + Tabagismo");
        }
      }

      if (hba1c > 7 && hba1c <= 9) {
        mediumRiskReasons.push("HbA1c entre 7,1% e 9%");
      }

      if (glicemiaJejum >= 126 && glicemiaJejum <= 250) {
        mediumRiskReasons.push("Glicemia de jejum 126-250 mg/dL");
      }

      // DM há mais de 10 anos
      if (this.isDM(patient) && this.isDMMoreThan10Years(patient)) {
        mediumRiskReasons.push("Diabetes há mais de 10 anos");
      }

      if (imc >= 30) {
        mediumRiskReasons.push("Obesidade (IMC ≥ 30)");
      }

      if (this.isHAS(patient) && this.isDM(patient)) {
        mediumRiskReasons.push("Sinergia HAS + DM");
      }

      if (mediumRiskReasons.length > 0) {
        riskLevel = RiskLevel.MEDIUM;
        deadline = "1 mês";
        reason = mediumRiskReasons.join(" + ");
        action = "Agendar retorno em até 1 mês.";
      }
    }

    return {
      ...patient,
      risk_level: riskLevel,
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
    if (!isPecConfigured) return [{ ine: "12345", nome: "Equipe Alpha" }];
    try {
      const sql = `
        SELECT DISTINCT e.nu_ine as ine, e.no_equipe as nome
        FROM tb_equipe e
        WHERE e.nu_ine IS NOT NULL AND e.st_ativo = 1
        ORDER BY e.no_equipe ASC
        LIMIT 500
      `;
      const rows = await pecQuery(sql, []);
      return (rows as any[]).map(r => ({ ine: r.ine, nome: r.nome }));
    } catch (e) {
      console.error('[getEquipes] Fallback to mock due to error:', e);
      return [{ ine: "12345", nome: "Equipe Alpha" }];
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
        if (filters.searchType === 'cpf') {
          const cleanCpf = filters.search.replace(/\D/g, '');
          extraWhere += ` AND c.nu_cpf LIKE $${params.length + 1}`;
          params.push(`${cleanCpf}%`);
        } else if (filters.searchType === 'cns') {
          const cleanCns = filters.search.replace(/\D/g, '');
          extraWhere += ` AND c.nu_cns LIKE $${params.length + 1}`;
          params.push(`${cleanCns}%`);
        } else {
          extraWhere += ` AND c.no_cidadao_filtro ILIKE $${params.length + 1}`;
          params.push(`%${filters.search}%`);
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
        || filters.smoking;

      if (hasDynamicFilters && extraWhere) {
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
                  CASE 
                      WHEN (up.pressao_s IS NOT NULL AND up.pressao_s >= 180) OR (up.pressao_d IS NOT NULL AND up.pressao_d >= 110) THEN 'HIGH'
                      WHEN COALESCE(uh.vl_hemoglobina_glicada, 0) > 9 THEN 'HIGH'
                      WHEN ug.glicemia IS NOT NULL AND ug.glicemia > 250 THEN 'HIGH'
                      WHEN cr.st_infarto = 1 OR cr.st_derrame = 1 OR cr.st_doenca_cardiaca = 1 OR cr.st_problema_rins = 1 THEN 'HIGH'
                      WHEN (up.pressao_s IS NOT NULL AND up.pressao_s >= 160) OR (up.pressao_d IS NOT NULL AND up.pressao_d >= 100) THEN 'MEDIUM'
                      WHEN COALESCE(uh.vl_hemoglobina_glicada, 0) > 7 THEN 'MEDIUM'
                      WHEN ug.glicemia IS NOT NULL AND ug.glicemia >= 126 THEN 'MEDIUM'
                      WHEN cr.st_hipertensao_arterial = 1 AND cr.st_diabetes = 1 THEN 'MEDIUM'
                      WHEN (COALESCE(uw.peso, cr.peso_autorreferido) IS NOT NULL AND ua.altura IS NOT NULL AND ua.altura > 0 AND (COALESCE(uw.peso, cr.peso_autorreferido)::numeric / POWER(ua.altura::numeric / 100, 2)) >= 30) THEN 'MEDIUM'
                      WHEN cr.st_hipertensao_arterial = 1 AND cr.st_fumante = 1 THEN 'MEDIUM'
                      WHEN cr.st_hipertensao_arterial = 1 AND cfa.no_sexo = 'MASCULINO' AND EXTRACT(YEAR FROM AGE(cfa.dt_nascimento)) > 55 THEN 'MEDIUM'
                      WHEN cr.st_hipertensao_arterial = 1 AND cfa.no_sexo = 'FEMININO' AND EXTRACT(YEAR FROM AGE(cfa.dt_nascimento)) > 65 THEN 'MEDIUM'
                      ELSE 'LOW'
                  END AS computed_risk,
                  uc.data_ultima_consulta,
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
                  ORDER BY (fat.co_dim_tempo + 0) DESC LIMIT 1
              ) uc ON true

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
                  ORDER BY (fat.co_dim_tempo + 0) DESC LIMIT 1
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
                  ORDER BY (fat.co_dim_tempo + 0) DESC LIMIT 1
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
                  ORDER BY (fat.co_dim_tempo + 0) DESC LIMIT 1
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
                  ORDER BY (fat.co_dim_tempo + 0) DESC LIMIT 1
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
          const placeholders = levels.map((_: any, i: number) => `$${countParams.length + i + 1}`);
          dynamicCountQuery += ` AND computed_risk IN (${placeholders.join(',')})`;
          countParams.push(...levels);
        }

        if (filters.consultMonths !== undefined && filters.consultMonths !== null && !isNaN(filters.consultMonths)) {
          dynamicCountQuery += ` AND (data_ultima_consulta IS NULL OR data_ultima_consulta < NOW() - ($${countParams.length + 1} || ' months')::interval)`;
          countParams.push(filters.consultMonths);
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
                uc.data_ultima_consulta AS "Última Consulta",
                uv.data_ultima_visita AS "Última Visita Domiciliar",
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
                    WHEN (up.pressao IS NOT NULL AND CAST(SPLIT_PART(up.pressao, '/', 1) AS INTEGER) >= 180) OR (up.pressao IS NOT NULL AND CAST(SPLIT_PART(up.pressao, '/', 2) AS INTEGER) >= 110) THEN 'HIGH'
                    WHEN COALESCE(uh.vl_hemoglobina_glicada, 0) > 9 THEN 'HIGH'
                    WHEN ug.glicemia IS NOT NULL AND CAST(REGEXP_REPLACE(ug.glicemia::text, '[^0-9]', '', 'g') AS INTEGER) > 250 THEN 'HIGH'
                    WHEN cr.st_infarto = 1 OR cr.st_derrame = 1 OR cr.st_doenca_cardiaca = 1 OR cr.st_problema_rins = 1 THEN 'HIGH'
                    WHEN (up.pressao IS NOT NULL AND CAST(SPLIT_PART(up.pressao, '/', 1) AS INTEGER) >= 160) OR (up.pressao IS NOT NULL AND CAST(SPLIT_PART(up.pressao, '/', 2) AS INTEGER) >= 100) THEN 'MEDIUM'
                    WHEN COALESCE(uh.vl_hemoglobina_glicada, 0) > 7 THEN 'MEDIUM'
                    WHEN ug.glicemia IS NOT NULL AND CAST(REGEXP_REPLACE(ug.glicemia::text, '[^0-9]', '', 'g') AS INTEGER) >= 126 THEN 'MEDIUM'
                    WHEN cr.st_hipertensao_arterial = 1 AND cr.st_diabetes = 1 THEN 'MEDIUM'
                    WHEN (COALESCE(uw.peso, cr.peso_autorreferido) IS NOT NULL AND ua.altura IS NOT NULL AND ua.altura > 0 AND (COALESCE(uw.peso, cr.peso_autorreferido)::numeric / POWER(ua.altura::numeric / 100, 2)) >= 30) THEN 'MEDIUM'
                    WHEN cr.st_hipertensao_arterial = 1 AND cr.st_fumante = 1 THEN 'MEDIUM'
                    WHEN cr.st_hipertensao_arterial = 1 AND cf.no_sexo = 'MASCULINO' AND EXTRACT(YEAR FROM AGE(cf.dt_nascimento)) > 55 THEN 'MEDIUM'
                    WHEN cr.st_hipertensao_arterial = 1 AND cf.no_sexo = 'FEMININO' AND EXTRACT(YEAR FROM AGE(cf.dt_nascimento)) > 65 THEN 'MEDIUM'
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
                ORDER BY (fat.co_dim_tempo + 0) DESC LIMIT 1
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
                ORDER BY (fat.co_dim_tempo + 0) DESC LIMIT 1
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
                ORDER BY (fat.co_dim_tempo + 0) DESC LIMIT 1
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
                ORDER BY (fat.co_dim_tempo + 0) DESC LIMIT 1
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
                ORDER BY (fat.co_dim_tempo + 0) DESC LIMIT 1
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
                ORDER BY (fvd.co_dim_tempo + 0) DESC LIMIT 1
            ) uv ON true

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
        ) sub
        WHERE 1=1
      `;

      let finalWhere = "";

      // Aplicar filtros que dependem do LATERAL ou de agrupamentos no resultado final
      if (filters.riskLevel) {
        const levels = filters.riskLevel.split(',');
        const placeholders = levels.map((_: any, i: number) => `$${dataParams.length + i + 1}`);
        finalWhere += ` AND computed_risk IN (${placeholders.join(',')})`;
        dataParams.push(...levels);
      }

      if (filters.consultMonths !== undefined && filters.consultMonths !== null && !isNaN(filters.consultMonths)) {
        finalWhere += ` AND ("Última Consulta" IS NULL OR "Última Consulta" < NOW() - ($${dataParams.length + 1} || ' months')::interval)`;
        dataParams.push(filters.consultMonths);
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
          glicemia_capilar: row['Glicemia Capilar'] ? parseInt(row['Glicemia Capilar'], 10) : null,
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
    const list = this.stratifyPatients(filters.microarea);
    const start = (page - 1) * pageSize;
    return {
      data: list.slice(start, start + pageSize),
      pagination: { page, pageSize, total: list.length, totalPages: Math.ceil(list.length / pageSize) }
    };
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
  public async getMapPatients(filters: { microarea?: string; ine?: string; unidade?: string; condition?: string; urgent?: boolean }): Promise<any[]> {
    if (!isPecConfigured) {
      return this.getMapPatientsMock(filters);
    }

    try {
      const params: any[] = [];
      let extraWhere = "";

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
      } else if (!filters.ine || filters.ine === 'all') {
        // Default to microarea 01 only when no INE filter is set either
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

      // Urgent filter — only patients with high-risk comorbidities
      if (filters.urgent) {
        condWhere += " AND (cr.st_doenca_cardiaca = 1 OR cr.st_problema_rins = 1 OR cr.st_infarto = 1 OR cr.st_derrame = 1)";
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
          COALESCE(cws.nu_telefone_celular, cws.nu_telefone_residencial, cws.nu_telefone_contato) AS "telefone"
        FROM CidadaoWithSiblings cws
        LEFT JOIN LATERAL (
          SELECT st_hipertensao_arterial, st_diabetes, st_doenca_cardiaca, st_problema_rins, st_infarto, st_derrame
          FROM tb_condicoes_saude_auto
          WHERE co_cidadao = ANY(cws.all_co_seq_cidadaos)
          ORDER BY co_seq_condicoes_saude_auto DESC LIMIT 1
        ) cr ON true
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
        renal: p.cids.some(c => c.startsWith('N1')),
      };
    });
  }

  /**
   * Retorna estatísticas agregadas do território via SQL.
   * NÃO traz dados individuais — apenas contagens e percentuais.
   * Seguro para 1.2M+ registros.
   */
  public async getTerritoryStats(microarea?: string, unidade?: string, ine?: string): Promise<any> {
    if (!isPecConfigured) {
      return this.getTerritoryStatsMock(microarea, unidade);
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

      const hasFilter = extraWhere.trim().length > 0;

      let query: string;

      if (hasFilter) {
        // FULL query with real C4/C5 indicators (safe — filtered dataset is small)
        query = `
          WITH TargetCidadaosAll AS (
            SELECT DISTINCT ON (COALESCE(c.nu_cpf, c.co_seq_cidadao::text))
                   c.co_seq_cidadao, c.nu_micro_area, c.no_bairro, ve.nu_ine, c.nu_cpf, c.dt_atualizado
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
              (COALESCE(csa.st_infarto, 0) + COALESCE(csa.st_derrame, 0) + COALESCE(csa.st_doenca_cardiaca, 0) + COALESCE(csa.st_problema_rins, 0)) > 0 as is_high_risk_base,
              -- Indicators: última consulta
              (SELECT MAX(TO_DATE(f.co_dim_tempo::text, 'YYYYMMDD')) FROM tb_fat_atendimento_individual f WHERE f.co_fat_cidadao_pec = ANY(tcw.all_co_seq_fat_cidadao_pecs)) AS dt_ultima_consulta,
              -- PA nos últimos 6 meses
              (SELECT 1 FROM tb_fat_atendimento_individual f WHERE f.co_fat_cidadao_pec = ANY(tcw.all_co_seq_fat_cidadao_pecs) AND f.nu_pressao_sistolica IS NOT NULL AND TO_DATE(f.co_dim_tempo::text, 'YYYYMMDD') >= NOW() - INTERVAL '6 months' LIMIT 1) AS has_pa_6m,
              -- Visita domiciliar nos últimos 12 meses
              (SELECT 1 FROM tb_fat_visita_domiciliar fvd WHERE fvd.co_fat_cidadao_pec = ANY(tcw.all_co_seq_fat_cidadao_pecs) AND TO_DATE(fvd.co_dim_tempo::text, 'YYYYMMDD') >= NOW() - INTERVAL '12 months' LIMIT 1) AS has_visita_12m,
              -- Peso/Altura nos últimos 12 meses
              (SELECT 1 FROM tb_fat_atendimento_individual f WHERE f.co_fat_cidadao_pec = ANY(tcw.all_co_seq_fat_cidadao_pecs) AND f.nu_peso IS NOT NULL AND f.nu_altura IS NOT NULL AND TO_DATE(f.co_dim_tempo::text, 'YYYYMMDD') >= NOW() - INTERVAL '12 months' LIMIT 1) AS has_peso_altura,
              -- HbA1c nos últimos 12 meses
              (SELECT 1 FROM tb_exame_requisitado req JOIN tb_exame_hemoglobina_glicada hem ON hem.co_exame_requisitado = req.co_seq_exame_requisitado WHERE req.co_prontuario = ANY(tcw.all_co_seq_prontuarios) LIMIT 1) AS has_hba1c
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
              CASE WHEN is_high_risk_base THEN 'HIGH' WHEN is_hyp = 1 OR is_dm = 1 THEN 'MEDIUM' ELSE 'LOW' END AS risk_level
            FROM Diagnosis
          )
          SELECT
            COUNT(*) AS total,
            COUNT(*) FILTER (WHERE risk_level = 'HIGH') AS high_risk,
            COUNT(*) FILTER (WHERE risk_level = 'MEDIUM') AS medium_risk,
            COUNT(*) FILTER (WHERE risk_level = 'LOW') AS low_risk,
            COUNT(*) FILTER (WHERE is_hyp = 1) AS hyp_total,
            COUNT(*) FILTER (WHERE is_dm = 1) AS dm_total,
            -- HAS indicators
            COUNT(*) FILTER (WHERE is_hyp = 1 AND dt_ultima_consulta >= NOW() - INTERVAL '6 months') AS hyp_consulta_6m,
            COUNT(*) FILTER (WHERE is_hyp = 1 AND has_pa_6m = 1) AS hyp_pa_6m,
            COUNT(*) FILTER (WHERE is_hyp = 1 AND has_visita_12m = 1) AS hyp_visita_12m,
            COUNT(*) FILTER (WHERE is_hyp = 1 AND has_peso_altura = 1) AS hyp_peso_altura,
            -- DM indicators
            COUNT(*) FILTER (WHERE is_dm = 1 AND dt_ultima_consulta >= NOW() - INTERVAL '6 months') AS dm_consulta_6m,
            COUNT(*) FILTER (WHERE is_dm = 1 AND has_pa_6m = 1) AS dm_pa_6m,
            COUNT(*) FILTER (WHERE is_dm = 1 AND has_peso_altura = 1) AS dm_peso_altura,
            COUNT(*) FILTER (WHERE is_dm = 1 AND has_hba1c = 1) AS dm_hba1c,
            0 AS dm_exame_pes,
            COUNT(*) FILTER (WHERE is_dm = 1 AND has_visita_12m = 1) AS dm_visita_12m
          FROM Classified
        `;
      } else {
        // LIGHTWEIGHT query — no indicators (too expensive for 1.5M patients)
        query = `
          WITH TargetCidadaosAll AS (
            SELECT DISTINCT ON (COALESCE(c.nu_cpf, c.co_seq_cidadao::text))
                   c.co_seq_cidadao, c.nu_micro_area, c.no_bairro, ve.nu_ine, c.nu_cpf, c.dt_atualizado
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
              CASE WHEN is_high_risk_base THEN 'HIGH' WHEN is_hyp = 1 OR is_dm = 1 THEN 'MEDIUM' ELSE 'LOW' END AS risk_level
            FROM Diagnosis
          )
          SELECT
            COUNT(*) AS total,
            COUNT(*) FILTER (WHERE risk_level = 'HIGH') AS high_risk,
            COUNT(*) FILTER (WHERE risk_level = 'MEDIUM') AS medium_risk,
            COUNT(*) FILTER (WHERE risk_level = 'LOW') AS low_risk,
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
          high: parseInt(r.high_risk, 10),
          medium: parseInt(r.medium_risk, 10),
          low: parseInt(r.low_risk, 10),
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

  private getTerritoryStatsMock(microarea?: string, unidade?: string) {
    const patients = this.stratifyPatients(microarea);
    const high = patients.filter(p => p.risk_level === 'HIGH').length;
    const medium = patients.filter(p => p.risk_level === 'MEDIUM').length;
    const low = patients.filter(p => p.risk_level === 'LOW').length;
    const hyp = patients.filter(p => p.cids.some(c => c.startsWith('I1')));
    const dm = patients.filter(p => p.cids.some(c => c.startsWith('E1')));
    return {
      total: patients.length,
      riskDistribution: { high, medium, low },
      c5: {
        total: hyp.length, score: 0, rows: [
          { label: "Consulta médica/enfermagem (6 meses)", actual: 0, target: 90 },
          { label: "Aferição de PA (6 meses)", actual: 0, target: 95 },
          { label: "Visita domiciliar ACS (2/ano)", actual: 0, target: 80 },
          { label: "Peso/altura (1/ano)", actual: 0, target: 85 },
        ]
      },
      c4: {
        total: dm.length, score: 0, rows: [
          { label: "Consulta médica/enfermagem (6 meses)", actual: 0, target: 90 },
          { label: "Aferição de PA (6 meses)", actual: 0, target: 95 },
          { label: "Peso/altura (1/ano)", actual: 0, target: 85 },
          { label: "HbA1c (12 meses)", actual: 0, target: 80 },
          { label: "Exame dos pés (1/ano)", actual: 0, target: 75 },
          { label: "Visita domiciliar ACS (2/ano)", actual: 0, target: 80 },
        ]
      },
      microareaCounts: {},
    };
  }
}

export default new RiskStratificationService();

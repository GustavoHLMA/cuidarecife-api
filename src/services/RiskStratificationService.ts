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

    if (this.hasHighRiskComorbidity(patient)) {
      highRiskReasons.push("Comorbidade de Alto Risco");
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
      const rows = await pecQuery("SELECT DISTINCT nu_micro_area FROM tb_cidadao WHERE nu_micro_area IS NOT NULL AND nu_micro_area != '' ORDER BY nu_micro_area ASC", []);
      return (rows as any[]).map(r => r.nu_micro_area);
    } catch (e) {
      return ['01', '02', '03', '04', '05', '06'];
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

      if (filters.microarea && filters.microarea !== 'all') {
        const mas = filters.microarea.split(',');
        if (mas.length === 1) {
          extraWhere += ` AND c.nu_micro_area = $${params.length + 1}`;
          params.push(mas[0]);
        } else {
          const placeholders = mas.map((_: any, i: number) => `$${params.length + i + 1}`).join(',');
          extraWhere += ` AND c.nu_micro_area IN (${placeholders})`;
          params.push(...mas);
        }
      }

      if (filters.unidade && filters.unidade !== 'all') {
        const uds = filters.unidade.split(',');
        const placeholders = uds.map((_: any, i: number) => `$${params.length + i + 1}`).join(',');
        extraWhere += ` AND c.co_seq_cidadao IN (
          SELECT pus.co_cidadao FROM tb_prontuario_unidade_saude pus
          WHERE pus.co_unidade_saude IN (${placeholders})
        )`;
        params.push(...uds);
      }

      if (filters.search) {
        // Acelerado pelo índice in_cidadao_nocidadaofiltrogin
        extraWhere += ` AND c.no_cidadao_filtro ILIKE $${params.length + 1}`;
        params.push(`%${filters.search}%`);
      }

      if (filters.ageRange) {
        // Idade é ano atual - ano de nascimento
        extraWhere += ` AND EXTRACT(YEAR FROM AGE(c.dt_nascimento)) >= $${params.length + 1}
                         AND EXTRACT(YEAR FROM AGE(c.dt_nascimento)) <= $${params.length + 2}`;
        params.push(filters.ageRange[0], filters.ageRange[1]);
      }

      if (filters.sex) {
        extraWhere += ` AND c.no_sexo = $${params.length + 1}`;
        params.push(filters.sex.toUpperCase());
      }

      if (filters.smoking) {
        // st_fumante está em tb_fat_cad_individual, ligada via co_fat_cidadao_pec
        if (filters.smoking === 'Sim') {
          extraWhere += ` AND EXISTS (
            SELECT 1 FROM tb_fat_cidadao_pec fcp2
            JOIN tb_fat_cad_individual fci2 ON fci2.co_fat_cidadao_pec = fcp2.co_seq_fat_cidadao_pec
            WHERE fcp2.co_cidadao = c.co_seq_cidadao AND fci2.st_fumante = 1
          )`;
        } else if (filters.smoking === 'Não') {
          extraWhere += ` AND EXISTS (
            SELECT 1 FROM tb_fat_cidadao_pec fcp2
            JOIN tb_fat_cad_individual fci2 ON fci2.co_fat_cidadao_pec = fcp2.co_seq_fat_cidadao_pec
            WHERE fcp2.co_cidadao = c.co_seq_cidadao AND fci2.st_fumante = 0
          )`;
        } else if (filters.smoking === 'Sem Registro') {
          extraWhere += ` AND NOT EXISTS (
            SELECT 1 FROM tb_fat_cidadao_pec fcp2
            JOIN tb_fat_cad_individual fci2 ON fci2.co_fat_cidadao_pec = fcp2.co_seq_fat_cidadao_pec
            WHERE fcp2.co_cidadao = c.co_seq_cidadao AND fci2.st_fumante IS NOT NULL
          )`;
        }
      }

      // Determine if we have any active filters that reduce the result set
      const hasFilters = !!(filters.search || (filters.microarea && filters.microarea !== 'all') || filters.ageRange || filters.sex || filters.smoking || filters.riskLevel);

      let fastTrackJoin = "";
      if (!filters.microarea && filters.riskLevel) {
        fastTrackJoin = "LEFT JOIN tb_condicoes_saude_auto csa_fast ON c.co_seq_cidadao = csa_fast.co_cidadao";
        const levels = filters.riskLevel.split(',');
        let fastTrackConditions = [];
        if (levels.includes('HIGH')) {
          fastTrackConditions.push("(csa_fast.st_infarto = 1 OR csa_fast.st_derrame = 1 OR csa_fast.st_doenca_cardiaca = 1 OR csa_fast.st_problema_rins = 1)");
        }
        if (levels.includes('MEDIUM')) {
          fastTrackConditions.push(`(
              (csa_fast.st_hipertensao_arterial = 1 AND csa_fast.st_diabetes = 1) OR
              (csa_fast.st_hipertensao_arterial = 1 AND csa_fast.st_fumante = 1) OR
              (csa_fast.st_hipertensao_arterial = 1 AND c.no_sexo = 'MASCULINO' AND EXTRACT(YEAR FROM AGE(c.dt_nascimento)) > 55) OR
              (csa_fast.st_hipertensao_arterial = 1 AND c.no_sexo = 'FEMININO' AND EXTRACT(YEAR FROM AGE(c.dt_nascimento)) > 65)
            )`);
        }
        if (fastTrackConditions.length > 0) {
          extraWhere += ` AND (${fastTrackConditions.join(' OR ')})`;
        }
      }

      // Count query - Removido JOIN pesado com tb_prontuario para evitar travamento em 1.2M registros
      const countQuery = `
        SELECT COUNT(*) as total
        FROM tb_cidadao c
        ${fastTrackJoin}
        WHERE c.dt_obito IS NULL
          ${extraWhere}
      `;
      const countRes = await pecQuery(countQuery, params);
      const total = parseInt((countRes as any)?.[0]?.total || '0', 10);

      // Data query (The user's working SQL)
      const dataParams = [...params, pageSize, offset];
      const limitIdx = dataParams.length - 1;
      const offsetIdx = dataParams.length;

      const cteAlreadyPaginated = !filters.riskLevel && (!filters.cids || filters.cids.length === 0) && filters.consultMonths === undefined;

      // O usuário solicitou a remoção da ordenação alfabética em todos os pontos.
      // Usar a Chave Primária (co_seq_cidadao) garante leitura instantânea via índice!
      const orderByClause = "ORDER BY c.co_seq_cidadao ASC";

      let fullQuery = `
        WITH CidadaoFiltrado AS (
            SELECT 
                c.co_seq_cidadao, 
                c.no_cidadao, 
                c.dt_nascimento, 
                c.no_sexo,            
                c.nu_micro_area
            FROM tb_cidadao c
            ${fastTrackJoin}
            WHERE c.dt_obito IS NULL
              ${extraWhere}
            ${orderByClause}
            ${cteAlreadyPaginated ? `LIMIT $${limitIdx} OFFSET $${offsetIdx}` : ''}
        ),
        PacientesBase AS (
            SELECT 
                cf.*,
                p.co_seq_prontuario,
                (
                   SELECT us.no_unidade_saude 
                   FROM tb_prontuario_unidade_saude pus
                   JOIN tb_unidade_saude us ON pus.co_unidade_saude = us.co_seq_unidade_saude
                   WHERE pus.co_cidadao = cf.co_seq_cidadao
                   LIMIT 1
                ) AS no_unidade_saude
            FROM CidadaoFiltrado cf
            LEFT JOIN tb_prontuario p ON cf.co_seq_cidadao = p.co_cidadao
        )
        SELECT *
        FROM (
            SELECT 
                pb.co_seq_cidadao AS "ID",
                pb.no_cidadao AS "Nome",
                pb.no_sexo AS "Sexo",  
                EXTRACT(YEAR FROM AGE(pb.dt_nascimento))::int AS "Idade",
                pb.nu_micro_area AS "Microárea",
                pb.no_unidade_saude AS "Unidade",
                up.pressao AS "Última Pressão",
                up.peso AS "Peso",
                up.altura AS "Altura",
                up.glicemia AS "Glicemia Capilar",
                up.data_medicao AS "Data Aferição",
                uh.vl_hemoglobina_glicada AS "HbA1c",
                uc.data_ultima_consulta AS "Última Consulta",
                uv.data_ultima_visita AS "Última Visita Domiciliar",
                cids_fat.ds_filtro_cids AS "CIDs Fat",
                cids_fat.ds_filtro_ciaps AS "CIAPs Fat",
                cr.st_hipertensao_arterial AS "flag_has",
                cr.st_diabetes AS "flag_dm",
                cr.st_doenca_cardiaca AS "flag_cardiaca",
                cr.st_problema_rins AS "flag_renal",
                cr.st_infarto AS "flag_infarto",
                cr.st_derrame AS "flag_derrame",
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
                    WHEN up.glicemia IS NOT NULL AND CAST(REGEXP_REPLACE(up.glicemia::text, '[^0-9]', '', 'g') AS INTEGER) > 250 THEN 'HIGH'
                    WHEN cr.st_infarto = 1 OR cr.st_derrame = 1 OR cr.st_doenca_cardiaca = 1 OR cr.st_problema_rins = 1 THEN 'HIGH'
                    WHEN (up.pressao IS NOT NULL AND CAST(SPLIT_PART(up.pressao, '/', 1) AS INTEGER) >= 160) OR (up.pressao IS NOT NULL AND CAST(SPLIT_PART(up.pressao, '/', 2) AS INTEGER) >= 100) THEN 'MEDIUM'
                    WHEN COALESCE(uh.vl_hemoglobina_glicada, 0) > 7 THEN 'MEDIUM'
                    WHEN up.glicemia IS NOT NULL AND CAST(REGEXP_REPLACE(up.glicemia::text, '[^0-9]', '', 'g') AS INTEGER) >= 126 THEN 'MEDIUM'
                    WHEN cr.st_hipertensao_arterial = 1 AND cr.st_diabetes = 1 THEN 'MEDIUM'
                    WHEN (up.peso IS NOT NULL AND up.altura IS NOT NULL AND (up.peso::numeric / POWER(up.altura::numeric / 100, 2)) >= 30) THEN 'MEDIUM'
                    WHEN cr.st_hipertensao_arterial = 1 AND cr.st_fumante = 1 THEN 'MEDIUM'
                    WHEN cr.st_hipertensao_arterial = 1 AND pb.no_sexo = 'MASCULINO' AND EXTRACT(YEAR FROM AGE(pb.dt_nascimento)) > 55 THEN 'MEDIUM'
                    WHEN cr.st_hipertensao_arterial = 1 AND pb.no_sexo = 'FEMININO' AND EXTRACT(YEAR FROM AGE(pb.dt_nascimento)) > 65 THEN 'MEDIUM'
                    ELSE 'LOW'
                END AS computed_risk
            FROM PacientesBase pb
            -- Condições (flags diretas, muito mais rápido)
            LEFT JOIN tb_condicoes_saude_auto cr ON pb.co_seq_cidadao = cr.co_cidadao
            -- Medições clínicas (tb_medicao)
            LEFT JOIN LATERAL (
                SELECT m.nu_medicao_pressao_arterial AS pressao, m.nu_medicao_peso AS peso, m.nu_medicao_altura AS altura, m.nu_medicao_glicemia AS glicemia, ap.dt_inicio AS data_medicao 
                FROM tb_atend a JOIN tb_atend_prof ap ON a.co_seq_atend = ap.co_atend JOIN tb_medicao m ON ap.co_seq_atend_prof = m.co_atend_prof
                WHERE a.co_prontuario = pb.co_seq_prontuario ORDER BY ap.dt_inicio DESC LIMIT 1
            ) up ON true
            -- Última consulta
            LEFT JOIN LATERAL (
                SELECT ap.dt_inicio AS data_ultima_consulta FROM tb_atend a JOIN tb_atend_prof ap ON a.co_seq_atend = ap.co_atend
                WHERE a.co_prontuario = pb.co_seq_prontuario AND ap.dt_inicio IS NOT NULL ORDER BY ap.dt_inicio DESC LIMIT 1
            ) uc ON true
            -- CIDs via fat_individual + fat_domiciliar (UNION para capturar acamados/domiciliares)
            LEFT JOIN LATERAL (
                SELECT ds_filtro_cids, ds_filtro_ciaps FROM (
                    SELECT fat.ds_filtro_cids, fat.ds_filtro_ciaps, fat.co_dim_tempo
                    FROM tb_fat_cidadao_pec fcp JOIN tb_fat_atendimento_individual fat ON fat.co_fat_cidadao_pec = fcp.co_seq_fat_cidadao_pec
                    WHERE fcp.co_cidadao = pb.co_seq_cidadao AND ((fat.ds_filtro_cids IS NOT NULL AND fat.ds_filtro_cids != '||') OR (fat.ds_filtro_ciaps IS NOT NULL AND fat.ds_filtro_ciaps != '||'))
                    UNION ALL
                    SELECT fad.ds_filtro_cids, fad.ds_filtro_ciaps, fad.co_dim_tempo
                    FROM tb_fat_cidadao_pec fcp JOIN tb_fat_atendimento_domiciliar fad ON fad.co_fat_cidadao_pec = fcp.co_seq_fat_cidadao_pec
                    WHERE fcp.co_cidadao = pb.co_seq_cidadao AND ((fad.ds_filtro_cids IS NOT NULL AND fad.ds_filtro_cids != '||') OR (fad.ds_filtro_ciaps IS NOT NULL AND fad.ds_filtro_ciaps != '||'))
                ) combined ORDER BY co_dim_tempo DESC LIMIT 1
            ) cids_fat ON true
            -- Última visita
            LEFT JOIN LATERAL (
                SELECT TO_DATE(fvd.co_dim_tempo::text, 'YYYYMMDD') AS data_ultima_visita FROM tb_fat_cidadao_pec fcp JOIN tb_fat_visita_domiciliar fvd ON fvd.co_fat_cidadao_pec = fcp.co_seq_fat_cidadao_pec
                WHERE fcp.co_cidadao = pb.co_seq_cidadao ORDER BY fvd.co_dim_tempo DESC LIMIT 1
            ) uv ON true
            -- HbA1c
            LEFT JOIN LATERAL (
                SELECT hem.vl_hemoglobina_glicada FROM tb_exame_requisitado req JOIN tb_exame_hemoglobina_glicada hem ON req.co_seq_exame_requisitado = hem.co_exame_requisitado
                WHERE req.co_prontuario = pb.co_seq_prontuario AND hem.vl_hemoglobina_glicada IS NOT NULL ORDER BY COALESCE(req.dt_realizacao, req.dt_solicitacao) DESC LIMIT 1
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
        const cidConditions = filters.cids.map((_: any, i: number) => `"CIDs Fat" LIKE $${dataParams.length + i + 1}`).join(' OR ');
        finalWhere += ` AND (${cidConditions})`;
        filters.cids.forEach((cid: string) => dataParams.push(`%${cid}%`));
      }

      fullQuery += finalWhere;

      if (!cteAlreadyPaginated) {
        fullQuery += ` LIMIT $${limitIdx} OFFSET $${offsetIdx}`;
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
   * Retorna estatísticas agregadas do território via SQL.
   * NÃO traz dados individuais — apenas contagens e percentuais.
   * Seguro para 1.2M+ registros.
   */
  public async getTerritoryStats(microarea?: string, unidade?: string): Promise<any> {
    if (!isPecConfigured) {
      return this.getTerritoryStatsMock(microarea, unidade);
    }

    // A visão global agora usa a query Fast Track com índice e JSON agg para evitar congelamento.

    try {
      const params: any[] = [];
      let microWhere = "";

      if (microarea && microarea !== 'all') {
        const mas = microarea.split(',');
        if (mas.length === 1) {
          microWhere = ` AND c.nu_micro_area = $1`;
          params.push(mas[0]);
        } else {
          const placeholders = mas.map((_: any, i: number) => `$${i + 1}`).join(',');
          microWhere = ` AND c.nu_micro_area IN (${placeholders})`;
          params.push(...mas);
        }
      }

      let unidadeJoin = "";
      if (unidade && unidade !== 'all') {
        const uds = unidade.split(',');
        const placeholders = uds.map((_: any, i: number) => `$${params.length + i + 1}`).join(',');
        unidadeJoin = `JOIN tb_prontuario_unidade_saude pus ON c.co_seq_cidadao = pus.co_cidadao AND pus.co_unidade_saude IN (${placeholders})`;
        params.push(...uds);
      }

      let query = `
          WITH TargetCidadaos AS (
            SELECT c.co_seq_cidadao, c.nu_micro_area, c.no_bairro
            FROM tb_cidadao c
            ${unidadeJoin}
            WHERE c.dt_obito IS NULL ${microWhere}
          ),
          Diagnosis AS (
            SELECT 
              tc.*,
              COALESCE(csa.st_hipertensao_arterial, 0) as is_hyp,
              COALESCE(csa.st_diabetes, 0) as is_dm,
              (COALESCE(csa.st_infarto, 0) + COALESCE(csa.st_derrame, 0) + COALESCE(csa.st_doenca_cardiaca, 0) + COALESCE(csa.st_problema_rins, 0)) > 0 as is_high_risk_base
            FROM TargetCidadaos tc
            LEFT JOIN tb_condicoes_saude_auto csa ON tc.co_seq_cidadao = csa.co_cidadao
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
            -- Indicadores simplificados para garantir carregamento instantâneo
            0 AS hyp_consulta_6m,
            0 AS hyp_pa_6m,
            0 AS hyp_visita_12m,
            0 AS hyp_peso_altura,
            0 AS dm_consulta_6m,
            0 AS dm_pa_6m,
            0 AS dm_peso_altura,
            0 AS dm_hba1c,
            0 AS dm_exame_pes,
            0 AS dm_visita_12m,
            -- Agrupamento por Microárea
            (
              SELECT json_agg(jsonb_build_object('ma', ma, 'bairro', bairro, 'h', h, 'm', m, 'l', l, 'hyp', hyp, 'dm', dm))
              FROM (
                SELECT COALESCE(nu_micro_area, 'N/A') as ma, COALESCE(no_bairro, 'N/A') as bairro,
                  COUNT(*) FILTER (WHERE risk_level = 'HIGH') as h,
                  COUNT(*) FILTER (WHERE risk_level = 'MEDIUM') as m,
                  COUNT(*) FILTER (WHERE risk_level = 'LOW') as l,
                  COUNT(*) FILTER (WHERE is_hyp = 1) as hyp,
                  COUNT(*) FILTER (WHERE is_dm = 1) as dm
                FROM Classified GROUP BY 1, 2
              ) sub
            ) AS ma_counts
          FROM Classified
        `;

      const rows = await pecQuery(query, params);
      if (!rows || (rows as any[]).length === 0) throw new Error('No data');

      const r = (rows as any[])[0];
      const total = parseInt(r.total, 10);
      const hypTotal = parseInt(r.hyp_total, 10);
      const dmTotal = parseInt(r.dm_total, 10);

      const pct = (n: number, d: number) => d > 0 ? Math.round((n / d) * 100) : 0;

      // Process microarea aggregates
      const maCountsRaw: any[] = r.ma_counts || [];
      const microareaCounts: Record<string, { HIGH: number; MEDIUM: number; LOW: number; bairro: string; hyp: number; dm: number }> = {};
      for (const item of maCountsRaw) {
        const ma = item.ma || 'unknown';
        microareaCounts[ma] = {
          HIGH: item.h || 0,
          MEDIUM: item.m || 0,
          LOW: item.l || 0,
          bairro: item.bairro || 'N/A',
          hyp: item.hyp || 0,
          dm: item.dm || 0
        };
      }

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

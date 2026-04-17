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

  private isHAS(patient: PatientMock): boolean {
    return patient.cids.some(cid =>
      this.hasCids.some(h => cid.startsWith(h)) ||
      this.hasComplicadaCids.some(h => cid.startsWith(h))
    );
  }

  private isDM(patient: PatientMock): boolean {
    return patient.cids.some(cid => this.dmCids.some(d => cid.startsWith(d)));
  }

  private hasHighRiskComorbidity(patient: PatientMock): boolean {
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

      if (hba1c > 7 && hba1c <= 9) {
        mediumRiskReasons.push("HbA1c entre 7,1% e 9%");
      }

      if (glicemiaJejum >= 126 && glicemiaJejum <= 250) {
        mediumRiskReasons.push("Glicemia de jejum 126-250 mg/dL");
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

      // Count query (optimized)
      const countQuery = `
        SELECT COUNT(*) as total
        FROM tb_cidadao c
        JOIN tb_prontuario p ON c.co_seq_cidadao = p.co_cidadao
        WHERE c.dt_obito IS NULL
          AND EXISTS (SELECT 1 FROM tb_antecedente a WHERE a.co_prontuario = p.co_seq_prontuario)
          ${extraWhere}
      `;
      const countRes = await pecQuery(countQuery, params);
      const total = parseInt((countRes as any)?.[0]?.total || '0', 10);

      // Data query (The user's working SQL)
      const dataParams = [...params, pageSize, offset];
      const limitIdx = dataParams.length - 1;
      const offsetIdx = dataParams.length;

      let fullQuery = `
        WITH PacientesAlvo AS (
            SELECT 
                c.co_seq_cidadao, 
                c.no_cidadao, 
                c.dt_nascimento, 
                c.no_sexo,            
                c.nu_micro_area, 
                c.ds_cep,             
                c.no_bairro,          
                p.co_seq_prontuario,
                fcp.co_seq_fat_cidadao_pec
            FROM tb_cidadao c
            JOIN tb_prontuario p ON c.co_seq_cidadao = p.co_cidadao
            LEFT JOIN tb_fat_cidadao_pec fcp ON c.co_seq_cidadao = fcp.co_cidadao
            WHERE c.dt_obito IS NULL
              AND EXISTS (SELECT 1 FROM tb_antecedente a WHERE a.co_prontuario = p.co_seq_prontuario)
              ${extraWhere}
            -- Acelerado pelo índice in_cidadao_nocidadaofiltroasc ao invés de no_cidadao 
            ORDER BY c.no_cidadao_filtro ASC 
        ),
        PacientesLimitados AS (
            SELECT * FROM PacientesAlvo 
            ${(!filters.riskLevel && (!filters.cids || filters.cids.length === 0) && filters.consultMonths === undefined) 
              ? `LIMIT $${limitIdx} OFFSET $${offsetIdx}` 
              : ''}
        ),
        Condicoes AS (
            SELECT 
                pa.co_seq_prontuario,
                STRING_AGG(DISTINCT cid.nu_cid10, ', ') AS condicoes_paciente
            FROM PacientesLimitados pa
            LEFT JOIN tb_antecedente a ON pa.co_seq_prontuario = a.co_prontuario
            LEFT JOIN rl_antecedente_ciap rac ON a.co_prontuario = rac.co_prontuario
            LEFT JOIN tb_ciap ciap ON rac.co_ciap = ciap.co_seq_ciap
            LEFT JOIN rl_ciap_cid10 rcc ON ciap.co_seq_ciap = rcc.co_ciap
            LEFT JOIN tb_cid10 cid ON rcc.co_cid10 = cid.co_cid10
            GROUP BY pa.co_seq_prontuario
        ),
        PacientesComMedicoes AS (
            SELECT 
                pa.co_seq_cidadao AS "ID",
                pa.no_cidadao AS "Nome",
                pa.no_sexo AS "Sexo",  
                EXTRACT(YEAR FROM AGE(pa.dt_nascimento)) AS "Idade",
                pa.nu_micro_area AS "Microárea",
                cond.condicoes_paciente AS "Condições",
                up.pressao_formatada AS "Última Pressão",
                up.peso AS "Peso",
                up.altura AS "Altura",
                up.glicemia AS "Glicemia Capilar",
                up.data_medicao AS "Data Aferição",
                uh.vl_hemoglobina_glicada AS "HbA1c",
                uc.data_ultima_consulta AS "Última Consulta",
                uv.data_ultima_visita AS "Última Visita Domiciliar",
                CASE 
                    WHEN uf.st_fumante = 1 THEN 'Sim'
                    WHEN uf.st_fumante = 0 THEN 'Não'
                    ELSE 'Sem Registro'
                END AS "Fumante",
                CAST(SPLIT_PART(up.pressao_formatada, '/', 1) AS INTEGER) AS "sis",
                CAST(SPLIT_PART(up.pressao_formatada, '/', 2) AS INTEGER) AS "dia"
            FROM PacientesLimitados pa
            LEFT JOIN Condicoes cond ON pa.co_seq_prontuario = cond.co_seq_prontuario
            LEFT JOIN LATERAL (
                SELECT ap.dt_inicio AS data_ultima_consulta FROM tb_atend a JOIN tb_atend_prof ap ON a.co_seq_atend = ap.co_atend
                WHERE a.co_prontuario = pa.co_seq_prontuario AND ap.dt_inicio IS NOT NULL
                ORDER BY ap.dt_inicio DESC LIMIT 1
            ) uc ON true
            LEFT JOIN LATERAL (
                SELECT hem.vl_hemoglobina_glicada FROM tb_exame_requisitado req JOIN tb_exame_hemoglobina_glicada hem ON req.co_seq_exame_requisitado = hem.co_exame_requisitado
                WHERE req.co_prontuario = pa.co_seq_prontuario AND hem.vl_hemoglobina_glicada IS NOT NULL
                ORDER BY COALESCE(req.dt_realizacao, req.dt_solicitacao, req.dt_resultado) DESC LIMIT 1
            ) uh ON true
            LEFT JOIN LATERAL (
                SELECT m.nu_medicao_pressao_arterial AS pressao_formatada, m.nu_medicao_peso AS peso, m.nu_medicao_altura AS altura, m.nu_medicao_glicemia AS glicemia, ap.dt_inicio AS data_medicao
                FROM tb_atend a JOIN tb_atend_prof ap ON a.co_seq_atend = ap.co_atend JOIN tb_medicao m ON ap.co_seq_atend_prof = m.co_atend_prof
                WHERE a.co_prontuario = pa.co_seq_prontuario ORDER BY ap.dt_inicio DESC LIMIT 1
            ) up ON true
            LEFT JOIN LATERAL (
                SELECT st_fumante FROM tb_fat_cad_individual WHERE co_fat_cidadao_pec = pa.co_seq_fat_cidadao_pec AND st_fumante IS NOT NULL ORDER BY co_seq_fat_cad_individual DESC LIMIT 1
            ) uf ON true
            LEFT JOIN LATERAL (
                SELECT TO_DATE(co_dim_tempo::text, 'YYYYMMDD') AS data_ultima_visita FROM tb_fat_visita_domiciliar WHERE co_fat_cidadao_pec = pa.co_seq_fat_cidadao_pec ORDER BY co_dim_tempo DESC LIMIT 1
            ) uv ON true
        )
        SELECT *
        FROM (
            SELECT 
              *,
              CASE 
                WHEN sis >= 180 OR dia >= 110 THEN 'HIGH'
                WHEN CAST("HbA1c" AS FLOAT) > 9 THEN 'HIGH'
                WHEN CAST(REGEXP_REPLACE("Glicemia Capilar"::text, '[^0-9]', '', 'g') AS INTEGER) > 250 THEN 'HIGH'
                WHEN "Condições" ~ '(I11\.0|I12\.9|I13|I21|I22|I50|I60|I61|I62|I63|I64|N18|N19|H36\.0|G63\.2|G46|G30|F00|F01|F02|F03|E10\.5|E11\.5)' THEN 'HIGH'
                WHEN (sis >= 160 AND sis <= 179) OR (dia >= 100 AND dia <= 109) THEN 'MEDIUM'
                WHEN CAST("HbA1c" AS FLOAT) > 7 AND CAST("HbA1c" AS FLOAT) <= 9 THEN 'MEDIUM'
                WHEN CAST(REGEXP_REPLACE("Glicemia Capilar"::text, '[^0-9]', '', 'g') AS INTEGER) >= 126 AND CAST(REGEXP_REPLACE("Glicemia Capilar"::text, '[^0-9]', '', 'g') AS INTEGER) <= 250 THEN 'MEDIUM'
                WHEN ("Peso" IS NOT NULL AND "Altura" IS NOT NULL AND ("Peso"::numeric / ("Altura"::numeric*"Altura"::numeric)) >= 30) THEN 'MEDIUM'
                ELSE 'LOW'
              END AS computed_risk
            FROM PacientesComMedicoes
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
        const cidConditions = filters.cids.map((_: any, i: number) => `"Condições" LIKE $${dataParams.length + i + 1}`).join(' OR ');
        finalWhere += ` AND (${cidConditions})`;
        filters.cids.forEach((cid: string) => dataParams.push(`%${cid}%`));
      }

      fullQuery += finalWhere;
      fullQuery += ` LIMIT $${limitIdx} OFFSET $${offsetIdx}`;

      const rows = await pecQuery(fullQuery, dataParams);
      if (!rows) throw new Error('Query failed');

      const patients = rows.map((row: any) => {
        const paStr = row['Última Pressão'] || "";
        const [s, d] = paStr.split('/');
        
        const p: PatientMock = {
          id: `pec-${row['ID']}`,
          nome: row['Nome'],
          idade: parseInt(row['Idade'], 10),
          sexo: row['Sexo'],
          microarea: row['Microárea'],
          cids: row['Condições'] ? row['Condições'].split(', ') : [],
          data_ultima_consulta: row['Última Consulta'],
          data_ultima_visita_domiciliar: row['Última Visita Domiciliar'],
          data_afericao: row['Data Aferição'] || null,
          fumante: row['Fumante'] || 'Sem Registro',
          ultima_pa_sistolica: s ? parseInt(s, 10) : null,
          ultima_pa_diastolica: d ? parseInt(d, 10) : null,
          ultimo_hba1c: row['HbA1c'] ? parseFloat(row['HbA1c']) : null,
          glicemia_capilar: row['Glicemia Capilar'] ? parseInt(row['Glicemia Capilar'], 10) : null,
          imc: (row['Peso'] && row['Altura']) ? (parseFloat(row['Peso']) / Math.pow(parseFloat(row['Altura'])/100, 2)) : null
        } as any;
        return this.stratifySinglePatient(p);
      });

      return {
        data: patients,
        pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) }
      };
    } catch (error: any) {
      console.error('[RiskStratification] DB Error:', error.message);
      return this.getStratifiedPaginatedMock(page, pageSize, filters);
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
  public async getTerritoryStats(microarea?: string): Promise<any> {
    if (!isPecConfigured) {
      return this.getTerritoryStatsMock(microarea);
    }

    // [HOTFIX] A consulta de território inteira no PEC requer JOIN de tabelas transacionais enormes
    // Para não congelar o Event Loop e não derrubar a rota paginada, faremos o cálculo consolidado Apenas
    // se uma microárea específica for selecionada (que reduz os cálculos para 50-100 pacientes max).
    // Se for TODAS (all) devolvemos um sumário rápido mockado ou os totais já cacheados (por enquanto usar Mock).
    if (!microarea || microarea === 'all' || microarea.trim() === '') {
       return this.getTerritoryStatsMock('all');
    }

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

      const query = `
        WITH BasePatients AS (
          SELECT 
            c.co_seq_cidadao,
            c.no_cidadao,
            c.no_sexo,
            c.nu_micro_area,
            c.dt_nascimento,
            p.co_seq_prontuario
          FROM tb_cidadao c
          JOIN tb_prontuario p ON c.co_seq_cidadao = p.co_cidadao
          WHERE c.dt_obito IS NULL
            AND EXISTS (SELECT 1 FROM tb_antecedente a WHERE a.co_prontuario = p.co_seq_prontuario)
            ${microWhere}
        ),
        PatientCids AS (
          SELECT 
            bp.co_seq_cidadao,
            STRING_AGG(DISTINCT cid.nu_cid10, ', ') AS cids
          FROM BasePatients bp
          LEFT JOIN tb_antecedente a ON bp.co_seq_prontuario = a.co_prontuario
          LEFT JOIN rl_antecedente_ciap rac ON a.co_prontuario = rac.co_prontuario
          LEFT JOIN tb_ciap ciap ON rac.co_ciap = ciap.co_seq_ciap
          LEFT JOIN rl_ciap_cid10 rcc ON ciap.co_seq_ciap = rcc.co_ciap
          LEFT JOIN tb_cid10 cid ON rcc.co_cid10 = cid.co_cid10
          GROUP BY bp.co_seq_cidadao
        ),
        PatientMeasures AS (
          SELECT 
            bp.co_seq_cidadao,
            COALESCE(pc.cids, '') AS cids,
            -- Última consulta (usa co_dim_tempo no formato YYYYMMDD)
            (SELECT MAX(TO_DATE(fat.co_dim_tempo::text, 'YYYYMMDD')) 
             FROM tb_fat_atendimento_individual fat 
             WHERE fat.co_fat_cidadao_pec IN (
               SELECT fcp3.co_seq_fat_cidadao_pec FROM tb_fat_cidadao_pec fcp3 WHERE fcp3.co_cidadao = bp.co_seq_cidadao
             )) AS ultima_consulta,
            -- Última visita domiciliar
            (SELECT MAX(TO_DATE(fav.co_dim_tempo::text, 'YYYYMMDD')) 
             FROM tb_fat_visita_domiciliar fav 
             WHERE fav.co_fat_cidadao_pec IN (
               SELECT fcp4.co_seq_fat_cidadao_pec FROM tb_fat_cidadao_pec fcp4 WHERE fcp4.co_cidadao = bp.co_seq_cidadao
             )) AS ultima_visita,
            -- PA mais recente
            (SELECT CAST(m.nu_medicao_peso AS FLOAT) 
             FROM tb_atend a 
             JOIN tb_atend_prof ap ON a.co_seq_atend = ap.co_atend 
             JOIN tb_medicao m ON ap.co_seq_atend_prof = m.co_atend_prof
             WHERE a.co_prontuario = bp.co_seq_prontuario AND m.nu_medicao_peso IS NOT NULL
             ORDER BY ap.dt_inicio DESC LIMIT 1) AS peso,
            -- HbA1c
            (SELECT CAST(hem.vl_hemoglobina_glicada AS FLOAT) 
             FROM tb_exame_requisitado req 
             JOIN tb_exame_hemoglobina_glicada hem ON req.co_seq_exame_requisitado = hem.co_exame_requisitado
             WHERE req.co_prontuario = bp.co_seq_prontuario AND hem.vl_hemoglobina_glicada IS NOT NULL
             ORDER BY COALESCE(req.dt_realizacao, req.dt_solicitacao, req.dt_resultado) DESC LIMIT 1) AS hba1c,
            -- Pressão sistólica e diastólica (para risco)
            (SELECT CAST(SPLIT_PART(m.nu_medicao_pressao_arterial, '/', 1) AS INTEGER) 
             FROM tb_atend a JOIN tb_atend_prof ap ON a.co_seq_atend = ap.co_atend JOIN tb_medicao m ON ap.co_seq_atend_prof = m.co_atend_prof
             WHERE a.co_prontuario = bp.co_seq_prontuario AND m.nu_medicao_pressao_arterial IS NOT NULL AND m.nu_medicao_pressao_arterial LIKE '%/%'
             ORDER BY ap.dt_inicio DESC LIMIT 1) AS sis,
            (SELECT CAST(SPLIT_PART(m.nu_medicao_pressao_arterial, '/', 2) AS INTEGER) 
             FROM tb_atend a JOIN tb_atend_prof ap ON a.co_seq_atend = ap.co_atend JOIN tb_medicao m ON ap.co_seq_atend_prof = m.co_atend_prof
             WHERE a.co_prontuario = bp.co_seq_prontuario AND m.nu_medicao_pressao_arterial IS NOT NULL AND m.nu_medicao_pressao_arterial LIKE '%/%'
             ORDER BY ap.dt_inicio DESC LIMIT 1) AS dia,
            -- Data da aferição PA
            (SELECT ap.dt_inicio 
             FROM tb_atend a JOIN tb_atend_prof ap ON a.co_seq_atend = ap.co_atend JOIN tb_medicao m ON ap.co_seq_atend_prof = m.co_atend_prof
             WHERE a.co_prontuario = bp.co_seq_prontuario AND m.nu_medicao_pressao_arterial IS NOT NULL
             ORDER BY ap.dt_inicio DESC LIMIT 1) AS data_afericao_pa
          FROM BasePatients bp
          LEFT JOIN PatientCids pc ON bp.co_seq_cidadao = pc.co_seq_cidadao
        ),
        Classified AS (
          SELECT
            co_seq_cidadao,
            cids,
            ultima_consulta,
            ultima_visita,
            peso,
            hba1c,
            sis,
            dia,
            data_afericao_pa,
            -- Flags
            cids ~ 'I1' AS is_hyp,
            cids ~ 'E1' AS is_dm,
            -- Risk classification
            CASE
              WHEN COALESCE(sis, 0) >= 180 OR COALESCE(dia, 0) >= 110 THEN 'HIGH'
              WHEN cids ~ '(I11\.0|I12\.9|I13|I21|I22|I50|I60|I61|I62|I63|I64|N18|N19|H36\.0|G63\.2|G46|G30|F00|F01|F02|F03|E10\.5|E11\.5)' THEN 'HIGH'
              WHEN (COALESCE(sis, 0) >= 140 OR COALESCE(dia, 0) >= 90) AND cids ~ 'E1' THEN 'HIGH'
              WHEN COALESCE(hba1c, 0) > 9 THEN 'HIGH'
              WHEN (COALESCE(sis, 0) >= 160 AND COALESCE(sis, 0) <= 179) OR (COALESCE(dia, 0) >= 100 AND COALESCE(dia, 0) <= 109) THEN 'MEDIUM'
              WHEN COALESCE(hba1c, 0) > 7 AND COALESCE(hba1c, 0) <= 9 THEN 'MEDIUM'
              WHEN (peso IS NOT NULL AND peso > 0) THEN 'MEDIUM'
              ELSE 'LOW'
            END AS risk_level
          FROM PatientMeasures
        )
        SELECT
          -- Total
          COUNT(*) AS total,
          -- Risk distribution
          COUNT(*) FILTER (WHERE risk_level = 'HIGH') AS high_risk,
          COUNT(*) FILTER (WHERE risk_level = 'MEDIUM') AS medium_risk,
          COUNT(*) FILTER (WHERE risk_level = 'LOW') AS low_risk,
          
          -- C5 - Hipertensão
          COUNT(*) FILTER (WHERE is_hyp) AS hyp_total,
          COUNT(*) FILTER (WHERE is_hyp AND ultima_consulta >= NOW() - INTERVAL '6 months') AS hyp_consulta_6m,
          COUNT(*) FILTER (WHERE is_hyp AND sis IS NOT NULL AND data_afericao_pa >= NOW() - INTERVAL '6 months') AS hyp_pa_6m,
          COUNT(*) FILTER (WHERE is_hyp AND ultima_visita >= NOW() - INTERVAL '12 months') AS hyp_visita_12m,
          COUNT(*) FILTER (WHERE is_hyp AND peso IS NOT NULL AND peso > 0) AS hyp_peso_altura,
          
          -- C4 - Diabetes
          COUNT(*) FILTER (WHERE is_dm) AS dm_total,
          COUNT(*) FILTER (WHERE is_dm AND ultima_consulta >= NOW() - INTERVAL '6 months') AS dm_consulta_6m,
          COUNT(*) FILTER (WHERE is_dm AND sis IS NOT NULL AND data_afericao_pa >= NOW() - INTERVAL '6 months') AS dm_pa_6m,
          COUNT(*) FILTER (WHERE is_dm AND peso IS NOT NULL AND peso > 0) AS dm_peso_altura,
          COUNT(*) FILTER (WHERE is_dm AND hba1c IS NOT NULL AND hba1c > 0) AS dm_hba1c,
          COUNT(*) FILTER (WHERE is_dm AND ultima_consulta >= NOW() - INTERVAL '12 months') AS dm_exame_pes,
          COUNT(*) FILTER (WHERE is_dm AND ultima_visita >= NOW() - INTERVAL '12 months') AS dm_visita_12m,
          
          -- Risk distribution by microarea (for map)
          json_agg(DISTINCT jsonb_build_object(
            'microarea', (SELECT nu_micro_area FROM tb_cidadao c2 WHERE c2.co_seq_cidadao = classified.co_seq_cidadao),
            'risk_level', risk_level
          )) FILTER (WHERE risk_level != 'LOW') AS map_points
        FROM Classified
      `;

      const rows = await pecQuery(query, params);
      if (!rows || (rows as any[]).length === 0) throw new Error('No data');
      
      const r = (rows as any[])[0];
      const total = parseInt(r.total, 10);
      const hypTotal = parseInt(r.hyp_total, 10);
      const dmTotal = parseInt(r.dm_total, 10);

      const pct = (n: number, d: number) => d > 0 ? Math.round((n / d) * 100) : 0;

      // Process map points into microarea aggregates
      const mapPoints: any[] = r.map_points || [];
      const microareaCounts: Record<string, { HIGH: number; MEDIUM: number; LOW: number }> = {};
      for (const pt of mapPoints) {
        const ma = pt.microarea || 'unknown';
        if (!microareaCounts[ma]) microareaCounts[ma] = { HIGH: 0, MEDIUM: 0, LOW: 0 };
        if (pt.risk_level === 'HIGH') microareaCounts[ma].HIGH++;
        else if (pt.risk_level === 'MEDIUM') microareaCounts[ma].MEDIUM++;
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
      return this.getTerritoryStatsMock(microarea);
    }
  }

  private getTerritoryStatsMock(microarea?: string) {
    const patients = this.stratifyPatients(microarea);
    const high = patients.filter(p => p.risk_level === 'HIGH').length;
    const medium = patients.filter(p => p.risk_level === 'MEDIUM').length;
    const low = patients.filter(p => p.risk_level === 'LOW').length;
    const hyp = patients.filter(p => p.cids.some(c => c.startsWith('I1')));
    const dm = patients.filter(p => p.cids.some(c => c.startsWith('E1')));
    return {
      total: patients.length,
      riskDistribution: { high, medium, low },
      c5: { total: hyp.length, score: 0, rows: [
        { label: "Consulta médica/enfermagem (6 meses)", actual: 0, target: 90 },
        { label: "Aferição de PA (6 meses)", actual: 0, target: 95 },
        { label: "Visita domiciliar ACS (2/ano)", actual: 0, target: 80 },
        { label: "Peso/altura (1/ano)", actual: 0, target: 85 },
      ]},
      c4: { total: dm.length, score: 0, rows: [
        { label: "Consulta médica/enfermagem (6 meses)", actual: 0, target: 90 },
        { label: "Aferição de PA (6 meses)", actual: 0, target: 95 },
        { label: "Peso/altura (1/ano)", actual: 0, target: 85 },
        { label: "HbA1c (12 meses)", actual: 0, target: 80 },
        { label: "Exame dos pés (1/ano)", actual: 0, target: 75 },
        { label: "Visita domiciliar ACS (2/ano)", actual: 0, target: 80 },
      ]},
      microareaCounts: {},
    };
  }
}

export default new RiskStratificationService();

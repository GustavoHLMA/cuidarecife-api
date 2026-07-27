import prisma from '../db';

// ============================================================
// Tipos e constantes portados de apoio-ao-macc-cuida-main
// (Mendes EV. O cuidado das condições crônicas na APS. OPAS/OMS; 2012)
// ============================================================

export interface MaccFormData {
  patientName: string;
  age: number;
  hasChronicCondition: boolean;
  chronicConditions: string[];
  conditionComplexity: 'none' | 'low' | 'medium' | 'high' | 'very_high';
  riskFactors: string[];
  frequentHospitalizations: boolean;
  frequentEmergencyUse: boolean;
  socialVulnerability: boolean;
  socialVulnerabilities: string[];
  multipleComorbidities: boolean;
  controlledCondition: boolean;
  selfCareStatus: 'sufficient' | 'insufficient' | 'not_assessed';
  selfCareScore?: number;
}

export const socialVulnerabilityOptions: { label: string; critical: boolean }[] = [
  { label: 'Situação de rua', critical: true },
  { label: 'Dependência química grave (crack, álcool)', critical: true },
  { label: 'Abandono familiar / sem rede de apoio', critical: true },
  { label: 'Vítima de violência doméstica recorrente', critical: true },
  { label: 'Insegurança alimentar grave', critical: true },
  { label: 'Transtorno mental grave sem acompanhamento', critical: true },
  { label: 'Extrema pobreza (beneficiário de programa social)', critical: false },
  { label: 'Baixa escolaridade (analfabetismo funcional)', critical: false },
  { label: 'Moradia precária / sem saneamento básico', critical: false },
  { label: 'Desemprego prolongado', critical: false },
  { label: 'Idoso em situação de negligência', critical: true },
  { label: 'Acesso limitado a serviços de saúde', critical: false },
  { label: 'Migração / refugiado', critical: false },
  { label: 'Cuidador sobrecarregado sem suporte', critical: false },
];

/**
 * Estratifica pacientes em 5 níveis MACC conforme Mendes EV (2012).
 * O backend RECALCULA o nível — nunca confia no frontend.
 */
export function classifyMACC(data: MaccFormData): number {
  const insufficientSelfCare = data.selfCareStatus === 'insufficient';
  const hasCriticalVulnerability = data.socialVulnerabilities?.some(
    (v) => socialVulnerabilityOptions.find((o) => o.label === v)?.critical
  );

  // Nível 5: Condição Crônica Muito Complexa (Mendes EV, 2012, p. 116)
  if (
    data.hasChronicCondition &&
    (data.conditionComplexity === 'very_high' ||
      hasCriticalVulnerability ||
      (data.multipleComorbidities && data.frequentHospitalizations) ||
      (data.frequentHospitalizations && data.frequentEmergencyUse) ||
      (data.conditionComplexity === 'high' && data.socialVulnerability))
  ) {
    return 5;
  }

  // Nível 4: Condição Crônica de Alto Risco (Mendes EV, 2012, p. 115)
  if (
    data.hasChronicCondition &&
    (data.conditionComplexity === 'high' ||
      (data.multipleComorbidities && (data.frequentHospitalizations || data.frequentEmergencyUse)) ||
      (data.conditionComplexity === 'medium' && insufficientSelfCare && data.multipleComorbidities))
  ) {
    return 4;
  }

  // Nível 3: Gestão da Condição de Saúde (Mendes EV, 2012, p. 114)
  if (data.hasChronicCondition) {
    return 3;
  }

  // Nível 2: Prevenção de Condições de Saúde (Mendes EV, 2012, p. 113)
  if (data.riskFactors.length > 0 || insufficientSelfCare) {
    return 2;
  }

  // Nível 1: Promoção da Saúde (Mendes EV, 2012, p. 111)
  return 1;
}

// ============================================================
// CRUD via Prisma
// ============================================================

interface ClassifyInput {
  pacienteId: string;
  formData: MaccFormData;
  classifiedBy?: string;
}

class MaccService {
  /**
   * Classifica um paciente e persiste o resultado.
   * O nível MACC é RECALCULADO pelo backend.
   */
  async classify(input: ClassifyInput) {
    const { pacienteId, formData, classifiedBy } = input;
    const maccLevel = classifyMACC(formData);

    const classification = await prisma.maccClassification.create({
      data: {
        pacienteId,
        pacienteNome: formData.patientName,
        pacienteIdade: formData.age,
        maccLevel,
        formData: formData as any,
        classifiedBy: classifiedBy || null,
      },
    });

    return { ...classification, maccLevel };
  }

  /**
   * Retorna a última classificação MACC de um paciente.
   */
  async getLatest(pacienteId: string) {
    return prisma.maccClassification.findFirst({
      where: { pacienteId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Retorna o histórico de classificações de um paciente.
   */
  async getHistory(pacienteId: string) {
    return prisma.maccClassification.findMany({
      where: { pacienteId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Retorna estatísticas agregadas: distribuição por nível MACC.
   */
  async getStats() {
    const stats = await prisma.maccClassification.groupBy({
      by: ['maccLevel'],
      _count: { maccLevel: true },
    });

    const total = stats.reduce((sum: number, s: any) => sum + s._count.maccLevel, 0);
    const distribution = [1, 2, 3, 4, 5].map((level) => {
      const found = stats.find((s: any) => s.maccLevel === level);
      const count = found ? found._count.maccLevel : 0;
      return {
        level,
        count,
        percentage: total > 0 ? Math.round((count / total) * 100) : 0,
      };
    });

    return { total, distribution };
  }
}

export default new MaccService();

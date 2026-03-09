export interface PatientMock {
  id: string;
  nome: string;
  cpf: string;
  sexo: "M" | "F";
  idade: number;
  data_nascimento: string;
  endereco: string;
  microarea: string;

  // Condições e CIDs
  cids: string[]; // Ex: ["I10", "E11.9"]

  // Vitais e Exames
  peso: number; // em kg
  altura: number; // em metros
  imc: number;
  ultima_pa_sistolica: number | null;
  ultima_pa_diastolica: number | null;
  ultimo_hba1c: number | null;

  // Datas de acompanhamento
  data_ultima_consulta: string | null; // ISO Date String
  data_ultima_visita_domiciliar: string | null;

  // Medicações
  lista_prescricao: string[];
}

export const mockPatients: PatientMock[] = [
  // 1. Alto Risco - Pressão Alta + DRC
  {
    id: "1",
    nome: "Maria Silva Santos",
    cpf: "111.111.111-11",
    sexo: "F",
    idade: 67,
    data_nascimento: "1957-03-15",
    endereco: "Rua das Flores, 123",
    microarea: "01",
    cids: ["I10", "N18.9"],
    peso: 85,
    altura: 1.60,
    imc: 33.2,
    ultima_pa_sistolica: 185,
    ultima_pa_diastolica: 115,
    ultimo_hba1c: null,
    data_ultima_consulta: "2025-05-10T00:00:00.000Z", // Há mais de 6 meses
    data_ultima_visita_domiciliar: "2025-10-01T00:00:00.000Z",
    lista_prescricao: ["Losartana 50mg", "Hidroclorotiazida 25mg"]
  },
  // 2. Médio Risco - HAS + DM controlado
  {
    id: "2",
    nome: "João Carlos Oliveira",
    cpf: "222.222.222-22",
    sexo: "M",
    idade: 58,
    data_nascimento: "1966-08-20",
    endereco: "Av Brasil, 444",
    microarea: "01",
    cids: ["I10", "E11.9"],
    peso: 90,
    altura: 1.75,
    imc: 29.4,
    ultima_pa_sistolica: 165,
    ultima_pa_diastolica: 105,
    ultimo_hba1c: 7.8,
    data_ultima_consulta: new Date().toISOString(), // Hoje (Assistido recentemente)
    data_ultima_visita_domiciliar: null,
    lista_prescricao: ["Metformina 850mg", "Losartana 50mg"]
  },
  // 3. Risco Verde - HAS Controlada
  {
    id: "3",
    nome: "Pedro Albuquerque",
    cpf: "333.333.333-33",
    sexo: "M",
    idade: 45,
    data_nascimento: "1979-05-10",
    endereco: "Rua do Sol, 99",
    microarea: "02",
    cids: ["I10"],
    peso: 75,
    altura: 1.80,
    imc: 23.1,
    ultima_pa_sistolica: 130,
    ultima_pa_diastolica: 85,
    ultimo_hba1c: null,
    data_ultima_consulta: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(), // 1 mês atrás
    data_ultima_visita_domiciliar: null,
    lista_prescricao: ["Enalapril 10mg"]
  },
  // 4. Alto Risco - DM Descontrolado (HbA1c > 9)
  {
    id: "4",
    nome: "Ana Costa",
    cpf: "444.444.444-44",
    sexo: "F",
    idade: 52,
    data_nascimento: "1972-11-05",
    endereco: "Rua da Paz, 77",
    microarea: "02",
    cids: ["E11.9", "E66.9"], // E66.9 = Obesidade
    peso: 105,
    altura: 1.65,
    imc: 38.6,
    ultima_pa_sistolica: 135,
    ultima_pa_diastolica: 80,
    ultimo_hba1c: 10.2, // > 9 = Alto Risco
    data_ultima_consulta: "2025-01-15T00:00:00.000Z", // Antiga (Busca Ativa)
    data_ultima_visita_domiciliar: "2025-06-20T00:00:00.000Z",
    lista_prescricao: ["Insulina NPH", "Metformina 850mg"]
  },
  // 5. Baixo Risco - DM Controlado
  {
    id: "5",
    nome: "José Felipe",
    cpf: "555.555.555-55",
    sexo: "M",
    idade: 60,
    data_nascimento: "1964-01-22",
    endereco: "Travessa Mota, 12",
    microarea: "01",
    cids: ["E11.9"],
    peso: 80,
    altura: 1.70,
    imc: 27.7,
    ultima_pa_sistolica: 125,
    ultima_pa_diastolica: 80,
    ultimo_hba1c: 6.5,
    data_ultima_consulta: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString(), // 1.5 mêses atrás
    data_ultima_visita_domiciliar: null,
    lista_prescricao: ["Metformina 500mg"]
  },
  // 6. Alto Risco - HAS com complicação (AVC prévio)
  {
    id: "6",
    nome: "Clodoaldo Mendes",
    cpf: "666.666.666-66",
    sexo: "M",
    idade: 71,
    data_nascimento: "1953-09-12",
    endereco: "Av Caxangá, 1000",
    microarea: "03",
    cids: ["I10", "I63.9"], // I63 = AVC
    peso: 82,
    altura: 1.68,
    imc: 29.1,
    ultima_pa_sistolica: 155,
    ultima_pa_diastolica: 95,
    ultimo_hba1c: null,
    data_ultima_consulta: "2025-03-10T00:00:00.000Z", // Busca ativa
    data_ultima_visita_domiciliar: "2025-05-15T00:00:00.000Z",
    lista_prescricao: ["AAS 100mg", "Losartana 50mg", "Anlodipino 5mg"]
  }
];

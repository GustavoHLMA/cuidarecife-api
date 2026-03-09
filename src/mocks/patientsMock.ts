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
  glicemia_jejum: number | null; // mg/dL — Protocolo SBD

  // Fatores de risco adicionais (Protocolo Municipal do Recife)
  tabagismo: boolean;
  dislipidemia: boolean;
  historico_familiar_precoce: boolean; // DCV precoce em parentes de 1º grau
  data_diagnostico_dm: string | null; // ISO Date — para calcular "DM > 10 anos"
  hipoglicemias_graves: boolean; // Histórico de hipoglicemias graves ou frequentes

  // Datas de acompanhamento
  data_ultima_consulta: string | null; // ISO Date String
  data_ultima_visita_domiciliar: string | null;

  // Medicações
  lista_prescricao: string[];
}

// Helpers para gerar datas relativas
const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
const yearsAgo = (years: number) => new Date(Date.now() - years * 365 * 24 * 60 * 60 * 1000).toISOString();
const today = () => new Date().toISOString();

export const mockPatients: PatientMock[] = [
  // ==========================================
  // ALTO RISCO (VERMELHO) — Diversos motivos
  // ==========================================

  // 1. Alto Risco - PA >= 180/110 (HAS Estágio 3) + DRC
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
    glicemia_jejum: null,
    tabagismo: false,
    dislipidemia: true,
    historico_familiar_precoce: false,
    data_diagnostico_dm: null,
    hipoglicemias_graves: false,
    data_ultima_consulta: "2025-05-10T00:00:00.000Z",
    data_ultima_visita_domiciliar: "2025-10-01T00:00:00.000Z",
    lista_prescricao: ["Losartana 50mg", "Hidroclorotiazida 25mg"]
  },

  // 2. Alto Risco - HbA1c > 9% + Obesidade
  {
    id: "4",
    nome: "Ana Costa Pereira",
    cpf: "444.444.444-44",
    sexo: "F",
    idade: 52,
    data_nascimento: "1972-11-05",
    endereco: "Rua da Paz, 77",
    microarea: "02",
    cids: ["E11.9", "E66.9"],
    peso: 105,
    altura: 1.65,
    imc: 38.6,
    ultima_pa_sistolica: 135,
    ultima_pa_diastolica: 80,
    ultimo_hba1c: 10.2,
    glicemia_jejum: 280, // > 250 = Alto Risco
    tabagismo: false,
    dislipidemia: true,
    historico_familiar_precoce: true,
    data_diagnostico_dm: yearsAgo(15), // DM há 15 anos
    hipoglicemias_graves: false,
    data_ultima_consulta: "2025-01-15T00:00:00.000Z",
    data_ultima_visita_domiciliar: "2025-06-20T00:00:00.000Z",
    lista_prescricao: ["Insulina NPH", "Metformina 850mg"]
  },

  // 3. Alto Risco - AVC prévio (I63)
  {
    id: "6",
    nome: "Clodoaldo Mendes",
    cpf: "666.666.666-66",
    sexo: "M",
    idade: 71,
    data_nascimento: "1953-09-12",
    endereco: "Av Caxangá, 1000",
    microarea: "03",
    cids: ["I10", "I63.9"],
    peso: 82,
    altura: 1.68,
    imc: 29.1,
    ultima_pa_sistolica: 155,
    ultima_pa_diastolica: 95,
    ultimo_hba1c: null,
    glicemia_jejum: null,
    tabagismo: true, // Tabagista
    dislipidemia: true,
    historico_familiar_precoce: true,
    data_diagnostico_dm: null,
    hipoglicemias_graves: false,
    data_ultima_consulta: "2025-03-10T00:00:00.000Z",
    data_ultima_visita_domiciliar: "2025-05-15T00:00:00.000Z",
    lista_prescricao: ["AAS 100mg", "Losartana 50mg", "Anlodipino 5mg"]
  },

  // 4. Alto Risco - Insuficiência Cardíaca (I50) + HAS
  {
    id: "7",
    nome: "Severina Bezerra",
    cpf: "777.777.777-77",
    sexo: "F",
    idade: 74,
    data_nascimento: "1950-06-22",
    endereco: "Rua do Porto, 45",
    microarea: "01",
    cids: ["I10", "I50.9"],
    peso: 68,
    altura: 1.55,
    imc: 28.3,
    ultima_pa_sistolica: 170,
    ultima_pa_diastolica: 100,
    ultimo_hba1c: null,
    glicemia_jejum: null,
    tabagismo: false,
    dislipidemia: false,
    historico_familiar_precoce: false,
    data_diagnostico_dm: null,
    hipoglicemias_graves: false,
    data_ultima_consulta: daysAgo(20),
    data_ultima_visita_domiciliar: daysAgo(10),
    lista_prescricao: ["Captopril 25mg", "Furosemida 40mg", "Carvedilol 6.25mg"]
  },

  // 5. Alto Risco - Retinopatia Diabética (H36.0)
  {
    id: "8",
    nome: "Roberto Lima Filho",
    cpf: "888.888.888-88",
    sexo: "M",
    idade: 63,
    data_nascimento: "1961-04-18",
    endereco: "Travessa Boa Vista, 200",
    microarea: "02",
    cids: ["E11.9", "H36.0"],
    peso: 78,
    altura: 1.72,
    imc: 26.4,
    ultima_pa_sistolica: 140,
    ultima_pa_diastolica: 88,
    ultimo_hba1c: 8.5,
    glicemia_jejum: 200,
    tabagismo: false,
    dislipidemia: true,
    historico_familiar_precoce: false,
    data_diagnostico_dm: yearsAgo(18),
    hipoglicemias_graves: false,
    data_ultima_consulta: daysAgo(45),
    data_ultima_visita_domiciliar: null,
    lista_prescricao: ["Insulina Glargina", "Metformina 1000mg"]
  },

  // 6. Alto Risco - Nefropatia (N18) + DM + HAS
  {
    id: "9",
    nome: "Antônio Ferreira da Silva",
    cpf: "999.999.999-99",
    sexo: "M",
    idade: 69,
    data_nascimento: "1955-12-01",
    endereco: "Rua da Aurora, 310",
    microarea: "03",
    cids: ["I10", "E11.9", "N18.9"],
    peso: 92,
    altura: 1.70,
    imc: 31.8,
    ultima_pa_sistolica: 160,
    ultima_pa_diastolica: 95,
    ultimo_hba1c: 9.5,
    glicemia_jejum: 270,
    tabagismo: false,
    dislipidemia: true,
    historico_familiar_precoce: false,
    data_diagnostico_dm: yearsAgo(12),
    hipoglicemias_graves: true, // Histórico de hipoglicemias graves
    data_ultima_consulta: "2025-04-20T00:00:00.000Z",
    data_ultima_visita_domiciliar: "2025-08-10T00:00:00.000Z",
    lista_prescricao: ["Losartana 100mg", "Insulina NPH", "Sinvastatina 40mg"]
  },

  // 7. Alto Risco - Pé Diabético (E11.5)
  {
    id: "10",
    nome: "Francisca Souza Barros",
    cpf: "101.010.101-01",
    sexo: "F",
    idade: 66,
    data_nascimento: "1958-07-30",
    endereco: "Rua Imperador, 88",
    microarea: "01",
    cids: ["E11.9", "E11.5"],
    peso: 95,
    altura: 1.58,
    imc: 38.1,
    ultima_pa_sistolica: 130,
    ultima_pa_diastolica: 82,
    ultimo_hba1c: 8.8,
    glicemia_jejum: 210,
    tabagismo: false,
    dislipidemia: false,
    historico_familiar_precoce: false,
    data_diagnostico_dm: yearsAgo(20),
    hipoglicemias_graves: true,
    data_ultima_consulta: daysAgo(15),
    data_ultima_visita_domiciliar: daysAgo(7),
    lista_prescricao: ["Insulina NPH", "Cilostazol 50mg", "Metformina 850mg"]
  },

  // 8. Alto Risco - Neuropatia Diabética (G63.2)
  {
    id: "11",
    nome: "Luiz Carlos Teixeira",
    cpf: "111.222.333-44",
    sexo: "M",
    idade: 72,
    data_nascimento: "1952-10-14",
    endereco: "Av Recife, 500",
    microarea: "02",
    cids: ["E10.9", "G63.2"],
    peso: 70,
    altura: 1.65,
    imc: 25.7,
    ultima_pa_sistolica: 128,
    ultima_pa_diastolica: 78,
    ultimo_hba1c: 7.9,
    glicemia_jejum: 180,
    tabagismo: false,
    dislipidemia: false,
    historico_familiar_precoce: false,
    data_diagnostico_dm: yearsAgo(25),
    hipoglicemias_graves: false,
    data_ultima_consulta: daysAgo(60),
    data_ultima_visita_domiciliar: null,
    lista_prescricao: ["Insulina Glargina", "Pregabalina 75mg"]
  },

  // 9. Alto Risco - IAM prévio (I21) + HAS
  {
    id: "12",
    nome: "Edilson Moura Gomes",
    cpf: "222.333.444-55",
    sexo: "M",
    idade: 59,
    data_nascimento: "1965-02-28",
    endereco: "Rua do Chaco, 12",
    microarea: "03",
    cids: ["I10", "I21"],
    peso: 88,
    altura: 1.78,
    imc: 27.8,
    ultima_pa_sistolica: 150,
    ultima_pa_diastolica: 92,
    ultimo_hba1c: null,
    glicemia_jejum: null,
    tabagismo: true, // Tabagista
    dislipidemia: true,
    historico_familiar_precoce: true,
    data_diagnostico_dm: null,
    hipoglicemias_graves: false,
    data_ultima_consulta: daysAgo(30),
    data_ultima_visita_domiciliar: daysAgo(14),
    lista_prescricao: ["AAS 100mg", "Atenolol 50mg", "Sinvastatina 20mg", "Losartana 50mg"]
  },

  // 10. Alto Risco - PA não controlada + DM (regra do protocolo HAS)
  {
    id: "23",
    nome: "Valdemir Gomes de Souza",
    cpf: "333.444.555-00",
    sexo: "M",
    idade: 61,
    data_nascimento: "1963-07-04",
    endereco: "Rua Barão de Souza Leão, 78",
    microarea: "01",
    cids: ["I10", "E11.9"],
    peso: 84,
    altura: 1.71,
    imc: 28.7,
    ultima_pa_sistolica: 148, // PA não controlada (>= 140/90)
    ultima_pa_diastolica: 94,
    ultimo_hba1c: 7.0,
    glicemia_jejum: 135,
    tabagismo: true,
    dislipidemia: false,
    historico_familiar_precoce: false,
    data_diagnostico_dm: yearsAgo(8),
    hipoglicemias_graves: false,
    data_ultima_consulta: daysAgo(12),
    data_ultima_visita_domiciliar: null,
    lista_prescricao: ["Metformina 850mg", "Losartana 50mg", "Anlodipino 5mg"]
  },

  // 11. Alto Risco - I11.0 Hipertensão com ICC (CID auto-eleva)
  {
    id: "24",
    nome: "Josué Ribeiro Cavalcanti",
    cpf: "444.555.666-00",
    sexo: "M",
    idade: 68,
    data_nascimento: "1956-11-20",
    endereco: "Rua do Futuro, 340",
    microarea: "02",
    cids: ["I11.0"], // Hipertensão com ICC = Auto Alto Risco
    peso: 79,
    altura: 1.69,
    imc: 27.6,
    ultima_pa_sistolica: 142,
    ultima_pa_diastolica: 88,
    ultimo_hba1c: null,
    glicemia_jejum: null,
    tabagismo: false,
    dislipidemia: true,
    historico_familiar_precoce: false,
    data_diagnostico_dm: null,
    hipoglicemias_graves: false,
    data_ultima_consulta: daysAgo(5),
    data_ultima_visita_domiciliar: daysAgo(3),
    lista_prescricao: ["Furosemida 40mg", "Enalapril 20mg", "Carvedilol 12.5mg"]
  },

  // 12. Alto Risco - Glicemia de jejum > 250 mg/dL
  {
    id: "25",
    nome: "Eliana Cristina Monteiro",
    cpf: "555.666.777-00",
    sexo: "F",
    idade: 54,
    data_nascimento: "1970-03-12",
    endereco: "Rua João de Barros, 92",
    microarea: "03",
    cids: ["E11.9"],
    peso: 88,
    altura: 1.60,
    imc: 34.4,
    ultima_pa_sistolica: 132,
    ultima_pa_diastolica: 82,
    ultimo_hba1c: 8.6,
    glicemia_jejum: 265, // > 250 = Alto Risco DM
    tabagismo: false,
    dislipidemia: true,
    historico_familiar_precoce: true,
    data_diagnostico_dm: yearsAgo(6),
    hipoglicemias_graves: false,
    data_ultima_consulta: daysAgo(8),
    data_ultima_visita_domiciliar: null,
    lista_prescricao: ["Insulina NPH", "Metformina 850mg", "Dapagliflozina 10mg"]
  },

  // ==========================================
  // MÉDIO RISCO (AMARELO) — Diversos motivos
  // ==========================================

  // 13. Médio Risco - PA Estágio 2 + HbA1c 7.1-9% + HAS+DM sinergia
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
    glicemia_jejum: 180, // 126-250 = Médio
    tabagismo: false,
    dislipidemia: true,
    historico_familiar_precoce: false,
    data_diagnostico_dm: yearsAgo(5),
    hipoglicemias_graves: false,
    data_ultima_consulta: today(),
    data_ultima_visita_domiciliar: null,
    lista_prescricao: ["Metformina 850mg", "Losartana 50mg"]
  },

  // 14. Médio Risco - Obesidade (IMC >= 30) + Tabagismo
  {
    id: "13",
    nome: "Sandra Maria Rodrigues",
    cpf: "333.444.555-66",
    sexo: "F",
    idade: 48,
    data_nascimento: "1976-09-03",
    endereco: "Rua Tabajara, 77",
    microarea: "01",
    cids: ["I10", "E66.9"],
    peso: 98,
    altura: 1.62,
    imc: 37.3,
    ultima_pa_sistolica: 145,
    ultima_pa_diastolica: 92,
    ultimo_hba1c: null,
    glicemia_jejum: null,
    tabagismo: true, // Tabagista = fator médio risco
    dislipidemia: false,
    historico_familiar_precoce: false,
    data_diagnostico_dm: null,
    hipoglicemias_graves: false,
    data_ultima_consulta: daysAgo(25),
    data_ultima_visita_domiciliar: daysAgo(12),
    lista_prescricao: ["Losartana 50mg", "Hidroclorotiazida 25mg"]
  },

  // 15. Médio Risco - HbA1c entre 7.1-9% + Glicemia 126-250
  {
    id: "14",
    nome: "Carlos Eduardo Nascimento",
    cpf: "444.555.666-77",
    sexo: "M",
    idade: 55,
    data_nascimento: "1969-11-15",
    endereco: "Rua Sete de Setembro, 230",
    microarea: "02",
    cids: ["E11.9"],
    peso: 83,
    altura: 1.73,
    imc: 27.7,
    ultima_pa_sistolica: 132,
    ultima_pa_diastolica: 84,
    ultimo_hba1c: 8.2,
    glicemia_jejum: 195, // 126-250 = Médio
    tabagismo: false,
    dislipidemia: true, // Dislipidemia = fator médio
    historico_familiar_precoce: false,
    data_diagnostico_dm: yearsAgo(7),
    hipoglicemias_graves: false,
    data_ultima_consulta: daysAgo(15),
    data_ultima_visita_domiciliar: null,
    lista_prescricao: ["Metformina 1000mg", "Glimepirida 2mg"]
  },

  // 16. Médio Risco - HAS + DM sinergia + Idade risco
  {
    id: "15",
    nome: "Lúcia Fernandes Cavalcanti",
    cpf: "555.666.777-88",
    sexo: "F",
    idade: 62,
    data_nascimento: "1962-05-20",
    endereco: "Rua Dom Bosco, 45",
    microarea: "02",
    cids: ["I10", "E11.9"],
    peso: 72,
    altura: 1.60,
    imc: 28.1,
    ultima_pa_sistolica: 138, // PA controlada
    ultima_pa_diastolica: 86,
    ultimo_hba1c: 7.5,
    glicemia_jejum: 145,
    tabagismo: false,
    dislipidemia: false,
    historico_familiar_precoce: true,
    data_diagnostico_dm: yearsAgo(11), // DM > 10 anos = Médio
    hipoglicemias_graves: false,
    data_ultima_consulta: daysAgo(40),
    data_ultima_visita_domiciliar: daysAgo(20),
    lista_prescricao: ["Metformina 500mg", "Enalapril 20mg"]
  },

  // 17. Médio Risco - PA Estágio 2 isolada + Dislipidemia
  {
    id: "16",
    nome: "Fernando Augusto Melo",
    cpf: "666.777.888-99",
    sexo: "M",
    idade: 50,
    data_nascimento: "1974-03-10",
    endereco: "Rua da Penha, 150",
    microarea: "03",
    cids: ["I10"],
    peso: 85,
    altura: 1.76,
    imc: 27.4,
    ultima_pa_sistolica: 168,
    ultima_pa_diastolica: 102,
    ultimo_hba1c: null,
    glicemia_jejum: null,
    tabagismo: false,
    dislipidemia: true,
    historico_familiar_precoce: true, // Histórico familiar
    data_diagnostico_dm: null,
    hipoglicemias_graves: false,
    data_ultima_consulta: daysAgo(10),
    data_ultima_visita_domiciliar: null,
    lista_prescricao: ["Anlodipino 5mg", "Losartana 50mg"]
  },

  // 18. Médio Risco - DM > 10 anos + Obesidade
  {
    id: "17",
    nome: "Teresa Cristina de Almeida",
    cpf: "777.888.999-00",
    sexo: "F",
    idade: 57,
    data_nascimento: "1967-08-25",
    endereco: "Rua Hélio Ramos, 33",
    microarea: "01",
    cids: ["E11.9", "E66.9"],
    peso: 102,
    altura: 1.63,
    imc: 38.4,
    ultima_pa_sistolica: 138,
    ultima_pa_diastolica: 86,
    ultimo_hba1c: 7.3,
    glicemia_jejum: 140,
    tabagismo: false,
    dislipidemia: true,
    historico_familiar_precoce: false,
    data_diagnostico_dm: yearsAgo(14), // DM > 10 anos
    hipoglicemias_graves: false,
    data_ultima_consulta: daysAgo(35),
    data_ultima_visita_domiciliar: null,
    lista_prescricao: ["Metformina 850mg", "Dapagliflozina 10mg"]
  },

  // 19. Médio Risco - Idade > 65 (F) + HAS
  {
    id: "18",
    nome: "Josefa Barbosa da Rocha",
    cpf: "888.999.000-11",
    sexo: "F",
    idade: 70,
    data_nascimento: "1954-12-12",
    endereco: "Rua Benfica, 200",
    microarea: "03",
    cids: ["I10"],
    peso: 65,
    altura: 1.56,
    imc: 26.7,
    ultima_pa_sistolica: 138,
    ultima_pa_diastolica: 85,
    ultimo_hba1c: null,
    glicemia_jejum: null,
    tabagismo: false,
    dislipidemia: false,
    historico_familiar_precoce: false,
    data_diagnostico_dm: null,
    hipoglicemias_graves: false,
    data_ultima_consulta: daysAgo(50),
    data_ultima_visita_domiciliar: daysAgo(25),
    lista_prescricao: ["Enalapril 10mg"]
  },

  // ==========================================
  // RISCO CONTROLADO (VERDE)
  // ==========================================

  // 20. Verde - HAS controlada, jovem, sem comorbidades
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
    glicemia_jejum: null,
    tabagismo: false,
    dislipidemia: false,
    historico_familiar_precoce: false,
    data_diagnostico_dm: null,
    hipoglicemias_graves: false,
    data_ultima_consulta: daysAgo(30),
    data_ultima_visita_domiciliar: null,
    lista_prescricao: ["Enalapril 10mg"]
  },

  // 21. Verde - DM controlado (HbA1c <= 7%)
  {
    id: "5",
    nome: "José Felipe Andrade",
    cpf: "555.555.555-55",
    sexo: "M",
    idade: 49,
    data_nascimento: "1975-01-22",
    endereco: "Travessa Mota, 12",
    microarea: "01",
    cids: ["E11.9"],
    peso: 80,
    altura: 1.70,
    imc: 27.7,
    ultima_pa_sistolica: 125,
    ultima_pa_diastolica: 80,
    ultimo_hba1c: 6.5,
    glicemia_jejum: 110,
    tabagismo: false,
    dislipidemia: false,
    historico_familiar_precoce: false,
    data_diagnostico_dm: yearsAgo(3),
    hipoglicemias_graves: false,
    data_ultima_consulta: daysAgo(45),
    data_ultima_visita_domiciliar: null,
    lista_prescricao: ["Metformina 500mg"]
  },

  // 22. Verde - HAS controlada
  {
    id: "19",
    nome: "Renata Oliveira Dias",
    cpf: "999.000.111-22",
    sexo: "F",
    idade: 42,
    data_nascimento: "1982-07-19",
    endereco: "Rua Princesa Isabel, 88",
    microarea: "02",
    cids: ["I10"],
    peso: 62,
    altura: 1.67,
    imc: 22.2,
    ultima_pa_sistolica: 120,
    ultima_pa_diastolica: 78,
    ultimo_hba1c: null,
    glicemia_jejum: null,
    tabagismo: false,
    dislipidemia: false,
    historico_familiar_precoce: false,
    data_diagnostico_dm: null,
    hipoglicemias_graves: false,
    data_ultima_consulta: daysAgo(20),
    data_ultima_visita_domiciliar: null,
    lista_prescricao: ["Losartana 25mg"]
  },

  // 23. Verde - DM controlado, boa adesão
  {
    id: "20",
    nome: "Marcos Vinícius Correia",
    cpf: "000.111.222-33",
    sexo: "M",
    idade: 44,
    data_nascimento: "1980-10-05",
    endereco: "Rua Frei Caneca, 55",
    microarea: "03",
    cids: ["E11.9"],
    peso: 76,
    altura: 1.74,
    imc: 25.1,
    ultima_pa_sistolica: 118,
    ultima_pa_diastolica: 76,
    ultimo_hba1c: 6.1,
    glicemia_jejum: 98,
    tabagismo: false,
    dislipidemia: false,
    historico_familiar_precoce: false,
    data_diagnostico_dm: yearsAgo(2),
    hipoglicemias_graves: false,
    data_ultima_consulta: daysAgo(10),
    data_ultima_visita_domiciliar: null,
    lista_prescricao: ["Metformina 500mg"]
  },

  // 24. Verde - HAS controlada, consulta recente
  {
    id: "21",
    nome: "Patrícia Gomes Fonseca",
    cpf: "111.222.333-45",
    sexo: "F",
    idade: 39,
    data_nascimento: "1985-04-14",
    endereco: "Rua do Apolo, 32",
    microarea: "01",
    cids: ["I10"],
    peso: 58,
    altura: 1.64,
    imc: 21.6,
    ultima_pa_sistolica: 122,
    ultima_pa_diastolica: 75,
    ultimo_hba1c: null,
    glicemia_jejum: null,
    tabagismo: false,
    dislipidemia: false,
    historico_familiar_precoce: false,
    data_diagnostico_dm: null,
    hipoglicemias_graves: false,
    data_ultima_consulta: daysAgo(5),
    data_ultima_visita_domiciliar: null,
    lista_prescricao: ["Enalapril 5mg"]
  },

  // 25. Verde - DM tipo 1 controlado
  {
    id: "22",
    nome: "Gabriel Santos Araújo",
    cpf: "222.333.444-56",
    sexo: "M",
    idade: 35,
    data_nascimento: "1989-09-28",
    endereco: "Rua Real da Torre, 150",
    microarea: "02",
    cids: ["E10.9"],
    peso: 72,
    altura: 1.78,
    imc: 22.7,
    ultima_pa_sistolica: 115,
    ultima_pa_diastolica: 72,
    ultimo_hba1c: 6.8,
    glicemia_jejum: 105,
    tabagismo: false,
    dislipidemia: false,
    historico_familiar_precoce: false,
    data_diagnostico_dm: yearsAgo(10),
    hipoglicemias_graves: false,
    data_ultima_consulta: daysAgo(15),
    data_ultima_visita_domiciliar: null,
    lista_prescricao: ["Insulina Glargina", "Insulina Lispro"]
  },
];

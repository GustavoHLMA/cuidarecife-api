<div align="center">
<img src="https://github.com/user-attachments/assets/8b65dc9e-49e5-4166-a287-0e10b8fb5928" width="300" height="200" />
</div>

# REPOSITÓRIO DO BACKEND

**Cuida Recife** é um aplicativo de **monitoramento contínuo** e **apoio ao autocuidado** para pacientes com **hipertensão** e **diabetes**, focando na **adesão ao tratamento** e fornecendo **funcionalidades de acessibilidade** e **assistência via IA**. O app ajuda pacientes a **gerenciar sua medicação**, acompanhar a **pressão arterial** e **glicemia**, além de oferecer **educação em saúde** e alertas para **interações medicamentosas**

## Desafio 🚀

**Desafio Saúde Pública em Recife**: Como podemos **melhorar o monitoramento contínuo**, **a adesão ao tratamento** e o **autocuidado** de pacientes com **hipertensão** e **diabetes** usando um aplicativo acessível, inteligente e interativo?

## Funcionalidades 📋

1. **Monitoramento de medicação**
   - **Câmera do celular** para verificar se o paciente está tomando a medicação correta através de OCR (reconhecimento de imagem/visão computacional).
   - **Lista interativa** com informações lúdicas sobre como e quando tomar cada medicamento.
   - **Assiduidade do tratamento** com visualização do progresso da medicação e opção de sinalizar se tiver acabado (podendo notificar a agentes comunitários de saúde em caso de pacientes domiciliados)

2. **Registro de pressão e glicemia**
   - **Adição de aferições** de pressão, MRPA e glicemia, com opção de baixar histórico de entradas.
   - **Instruções detalhadas** sobre como realizar os procedimentos de aferição de pressão e medição de glicemia.

3. **Assistente IA**
   - **Chat de IA** para **responder dúvidas** do paciente a qualquer momento.
     
4. **Prescrição**
   - **Lista de prescrição do paciente** com instruções de como tomar e se é gratuita pelo Programa de Farmácia Popular do Brasil.
   - **Geolocalização** para encontrar **farmácias do Programa Farmácia Popular do Brasil** próximas para retirada de medicamentos gratuitos.
   - **IA para análise** sobre erros de prescrição (ex: interações medicamentosas, instruções ou horários incorretos).

5. **Notificações e lembretes**
   - Lembretes sobre **próximas consultas**, **medicação** e **aferições de pressão/glicemia** em formato de widget e notificação.

## Tech Stack ⚙️

![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white) 
![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white) 
![Express](https://img.shields.io/badge/Express-000000?style=for-the-badge&logo=express&logoColor=white) 
![Prisma](https://img.shields.io/badge/Prisma-2D3748?style=for-the-badge&logo=prisma&logoColor=white) 
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-336791?style=for-the-badge&logo=postgresql&logoColor=white)
![Gemini](https://img.shields.io/badge/Gemini-4285F4?style=for-the-badge&logo=google&logoColor=white)
![Cloud Vision API](https://img.shields.io/badge/Cloud%20Vision%20API-4285F4?style=for-the-badge&logo=google-cloud&logoColor=white)

## Equipe 🏆

**Gabriella Graciano de Souza**  
📧 E-mail: [gabifc_graciano@hotmail.com](mailto:gabifc_graciano@hotmail.com)  
🖋️ Behance: [behance.net/gabygraciano](https://www.behance.net/gabygraciano)  
🌐 GitHub: [github.com/gabygraciano](https://github.com/gabygraciano)

**Gustavo Henrique Lima Mendes de Almeida**  
📧 E-mail: gustavohlma8@gmail.com  
🌐 GitHub: [github.com/GustavoHLMA](https://github.com/GustavoHLMA)

**Manuelle Graciano Ferreira**
- 🩺 Médica formada pela ***Universidade de Pernambuco***

## Documentação 📄

- [Figma](https://www.figma.com/design/Ey3L81KZqbQ5rCkeKNERm6/Hacker-cidad%C3%A3o-13?node-id=1-2&t=Txk0XatsX8RCfwUZ-1)
- [Pitch](https://docs.google.com/presentation/d/17AeBh5xvDqSzQEvCWxJrsqBund2Ve4HAdA_-4IjzvaQ/edit?usp=sharing)
- [Vídeo de Demo](https://youtube.com/demo/cuida-recife)

## Instalação ⬇️

### 1. Clone o repositório
```bash
git clone https://github.com/GustavoHLMA/cuidarecife-api.git
cd cuidarecife-api
```

### 2. Instale as dependências
```bash
npm install
```

### 3. Configure as variáveis de ambiente
Copie o arquivo `.env.example` para `.env`:
```bash
cp .env.example .env
```

Preencha as variáveis obrigatórias:
```env
# Banco de dados PostgreSQL (obrigatório)
DATABASE_URL="postgresql://user:password@host:5432/database?connection_limit=10&pool_timeout=20"
DIRECT_URL="postgresql://user:password@host:5432/database"

# JWT Secrets (obrigatório)
JWT_ACCESS_SECRET=your_secret_key_here
JWT_REFRESH_SECRET=your_refresh_secret_key_here

# APIs de IA (obrigatório)
GEMINI_API_KEY=your_gemini_api_key
GOOGLE_VISION_API_KEY=your_google_vision_api_key
```

### 4. Execute as migrações do banco
```bash
npx prisma migrate dev
npx prisma generate
```

## Rodando o projeto 🏃

### Desenvolvimento
```bash
npm run dev
```

### Build para produção
```bash
npm run build
npm start
```
## Deploy 🚀

O projeto está configurado para deploy no [Render](https://render.com):

**Build Command:**
```bash
npm install && npx prisma generate && npm run build
```

**Start Command:**
```bash
npm start
```

## Como contribuir 🤝

### Commits
Commits devem seguir o padrão:
- `feat(nome da branch): descrição da funcionalidade` - Para novas funcionalidades
- `hotfix(nome da branch): descrição do bug` - Para bugfixes em main
- `chore(nome da branch): descroção da tarefa` - Para alterações referentes builds/deploy/serviços externos etc. 

```
feature(medications): adicionar tela de histórico
fix(auth): corrigir validação de email
```

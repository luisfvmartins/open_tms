# VALIDAÇÃO DOS 20 ACHADOS DA PRIMEIRA AUDITORIA — OPEN TMS
**Segunda Auditoria Técnica Independente**  
**Projeto:** Preparação para TMS SaaS Brasileiro  
**Repositório:** [DominicFinn/open_tms](https://github.com/DominicFinn/open_tms.git)  
**Commit Analisado:** `ed831c2b9f77721cc5c9d87c49f9aa3bde8124a0` (HEAD da branch `main`)  
**Data da Validação:** 10 de Novembro de 2026  
**Status do Repositório:** Limpo, preservado sem alterações destrutivas ou modificações em arquivos de código-fonte.

---

## 1. RESUMO EXECUTIVO DA VALIDAÇÃO

Esta segunda auditoria realizou uma verificação minuciosa e independente de cada um dos 20 achados reportados no relatório inicial (`docs/auditoria/MATRIZ_RISCOS.md`). Cada item foi testado e confrontado diretamente com o código-fonte, esquemas de banco de dados, arquivos de configuração, rotas HTTP e testes automatizados do Open TMS.

### Classificação dos Achados:
- **Confirmado:** A vulnerabilidade, falha arquitetural ou lacuna funcional existe exatamente como documentada, com impacto comprovado no código.
- **Parcialmente Confirmado:** O problema existe, porém com nuances técnicas, escopo ligeiramente diferente ou atenuantes operacionais presentes no código.
- **Não Reproduzido / Falso Positivo:** O problema alegado não existe no código ou foi mitigado por controles que a primeira auditoria não identificou.
- **Já Corrigido:** O problema existia historicamente, mas foi resolvido no commit atual.

### Tabela Consolidada de Validação

| ID | Título do Achado | Severidade Original | Status na 2ª Auditoria | Veredito Técnico Resumido |
|---|---|---|---|---|
| **P0-SEC-01** | SSRF em Webhooks de Clientes e Skills | P0 - Crítica | **CONFIRMADO** | `fetch()` direto sem filtro de IP (RFC 1918, link-local, loopback), segue redirects e reflete resposta em endpoint GET. |
| **P0-SEC-02** | Endpoints de Ingestão EDI sem Autenticação | P0 - Crítica | **CONFIRMADO** | Rotas `/api/v1/tms/edi/*` registradas explicitamente fora do hook de autenticação JWT com TODO aberto; alteração arbitrária de status de cargas. |
| **P0-TEN-01** | Isolamento Multiempresa apenas Lógico (Sem RLS no PostgreSQL) | P0 - Crítica | **CONFIRMADO** *(com ressalva técnica)* | Zero políticas de RLS no PostgreSQL do backend Node.js. Isolamento depende 100% de cláusulas `where: { orgId }` no Prisma. |
| **P0-TEN-02** | Ausência de Foreign Keys Compostas `(orgId, id)` no Prisma | P0 - Crítica | **CONFIRMADO** | Chaves estrangeiras simples permitem referências cruzadas entre tenants no banco de dados se a camada de aplicação falhar. |
| **P1-SEC-03** | Algoritmo Fraco e Customizado de Hash de Senha (HMAC-SHA256) | P1 - Alta | **CONFIRMADO** | Uso de HMAC-SHA256 em 1 iteração única com salt compartilhado em `AuthService`, `CustomerAuthService` e `CarrierAuthService`. Não conforme OWASP. |
| **P1-SEC-04** | Sessões JWT Stateless de 12h sem Rotação e Logout Fictício | P1 - Alta | **CONFIRMADO** | Tokens de 12 horas, sem tabela de revogação/blacklist. Endpoint `/api/v1/auth/logout` apenas retorna `{ success: true }` sem invalidar o token. |
| **P1-SEC-05** | Armazenamento de Tokens no `localStorage` e Stored XSS | P1 - Alta | **CONFIRMADO** | Token JWT exposto a scripts no frontend; uso de `dangerouslySetInnerHTML` em templates de email no frontend sem sanitização DOMPurify. |
| **P1-SEC-06** | Ausência de Rate Limiting Global na API | P1 - Alta | **CONFIRMADO** | Plugin `@fastify/rate-limit` não registrado no servidor global; rotas de login e EDI vulneráveis a ataques de força bruta e DoS volumétrico. |
| **P1-BRA-01** | Incompatibilidade Cadastral Fiscal Brasileira | P1 - Alta *(Lacuna)* | **CONFIRMADO** | Zero campos para CPF, CNPJ, Inscrição Estadual, CEP, Código IBGE e placas padrão Mercosul. |
| **P1-BRA-02** | Ausência Completa de Documentos Fiscais Eletrônicos (CT-e/MDF-e/NFS-e) | P1 - Alta *(Lacuna)* | **CONFIRMADO** | O sistema opera exclusivamente com Bill of Lading (BOL) e Invoice norte-americanos; sem comunicação SEFAZ ou schemas XML. |
| **P1-BRA-03** | Ausência de Gestão de TAC, RNTRC, CIOT e Vale-Pedágio | P1 - Alta *(Lacuna)* | **CONFIRMADO** | Inexistência de modelos para regras da ANTT, Vale-Pedágio obrigatório ou contratação de Transportadores Autônomos de Cargas. |
| **P1-SAA-01** | Ausência de Estrutura Comercial de SaaS (Planos, Faturamento, Cobrança) | P1 - Alta *(Lacuna)* | **CONFIRMADO** | Sem modelos de Planos, Assinaturas, Quotas de Consumo ou integração com gateways de pagamento (Stripe, Asaas, etc.). |
| **P1-SAA-02** | Rigidez Estrutural de Vínculo Usuário-Organização | P1 - Alta | **CONFIRMADO** | Campo `User.organizationId` obrigatório e constraint `User.email @unique` impedem que um usuário pertença a múltiplas organizações. |
| **P1-DEP-01** | Vulnerabilidades Conhecidas em Dependências npm | P1 - Alta | **CONFIRMADO** | 45 vulnerabilidades auditadas (4 críticas, 10 altas, 18 moderadas, 13 baixas), incluindo bypass em `@fastify/reply-from`. |
| **P2-ARQ-01** | Acoplamento de Banco Operacional com Filas pg-boss e EventStore | P2 - Média | **CONFIRMADO** | Tabelas de mensageria assíncrona concorrem diretamente com conexões e I/O de escrita transacional de cargas e faturas no mesmo PostgreSQL. |
| **P2-ARQ-02** | Heterogeneidade Tecnológica: Módulo WMS em .NET/C# Isolado | P2 - Média | **CONFIRMADO** | WMS implementado em ASP.NET Core 8 com schema isolado, sem sincronização de autenticação JWT com o ecossistema Fastify/TypeScript. |
| **P2-TST-01** | Desbalanceamento de Testes Automatizados e Jest ForceExit | P2 - Média | **CONFIRMADO** | Frontend possui apenas 8 suítes (61 testes) cobrindo menos de 5% dos componentes; backend depende de `--forceExit` por conexões abertas. |
| **P2-WOR-01** | Worker de IA com Chave Global OpenAI Compartilhada | P2 - Média | **CONFIRMADO** | Processamento LLM utiliza `OPENAI_API_KEY` global sem isolamento de quotas financeiras por organização, gerando risco de esgotamento. |
| **P3-DES-01** | Bundle Frontend Monolítico sem Code-Splitting Adequado | P3 - Baixa | **CONFIRMADO** | `index.js` gerado pelo Vite ultrapassa 2.5 MB gzippado em chunk único, comprometendo carregamento em redes móveis (3G/4G). |
| **P3-LIC-01** | Obrigações de Atribuição da Licença MIT e Licenças de Terceiros | P3 - Baixa | **CONFIRMADO** | Licença MIT permissiva confirmada; 100% das 1.156 dependências compatíveis comercialmente (MIT, Apache 2.0, BSD, ISC), sem licenças GPL/AGPL virais. |

---

## 2. VALIDAÇÃO DETALHADA ITEM A ITEM

### [P0-SEC-01] SSRF em Webhooks de Clientes e Skills
- **Status:** **CONFIRMADO**
- **Arquivos:**
  - `backend/src/services/webhooks/CustomerWebhookDeliveryService.ts` (linhas 75–95)
  - `backend/src/services/skills/CallWebhookSkill.ts` (linhas 40–55)
  - `backend/src/routes/customerDeveloper.ts` (linhas 150–165)
- **Evidência no Código:**
  ```typescript
  // CustomerWebhookDeliveryService.ts:83
  const res = await fetch(webhook.url, {
    method: 'POST',
    headers: { ... },
    body: JSON.stringify(deliveryPayload),
    signal: AbortSignal.timeout(10000)
  });
  const responseBody = await res.text().catch(() => '');
  // Salva no banco de dados:
  await prisma.customerWebhookDelivery.create({
    data: {
      ...
      responseBody: responseBody.slice(0, 4000)
    }
  });
  ```
- **Mecanismo Comprovado:**
  1. Qualquer usuário autenticado no Customer Portal cadastra uma URL em `POST /api/v1/customer-portal/developer/webhooks`.
  2. A validação do campo no endpoint apenas checa `z.string().url()` (aceita `http://127.0.0.1:5432`, `http://169.254.169.254/latest/meta-data/`, `http://10.0.0.1/`).
  3. O Node.js `fetch` nativo não resolve o DNS preventivamente, não checa faixas RFC 1918 / RFC 3927 (link-local), não bloqueia loopback e segue redirecionamentos HTTP 3xx por padrão.
  4. O corpo da resposta do serviço interno atingido é truncado em 4.000 caracteres e gravado na coluna `responseBody`.
  5. O atacante consulta `GET /api/v1/customer-portal/developer/webhooks/:id/deliveries` e obtém os dados internos da infraestrutura.
- **Veredito:** Risco Crítico real, confirmadíssimo no código.

---

### [P0-SEC-02] Endpoints de Ingestão EDI sem Autenticação
- **Status:** **CONFIRMADO**
- **Arquivos:**
  - `backend/src/routes/modules/tms.ts` (linhas 80–89)
  - `backend/src/routes/edi214.ts` (linhas 45–70)
  - `backend/src/routes/ediInbound.ts` (linhas 50–90)
- **Evidência no Código:**
  ```typescript
  // backend/src/routes/modules/tms.ts:82
  // Register EDI ingestion routes (separate from standard API authentication)
  // TODO: add proper API key / HMAC auth
  await fastify.register(edi214Routes, { prefix: `${prefix}/edi/214` });
  await fastify.register(ediInboundRoutes, { prefix: `${prefix}/edi` });
  ```
- **Mecanismo Comprovado:**
  1. Em `backend/src/routes/modules/tms.ts`, as rotas EDI são registradas fora do hook global de autenticação com um comentário explícito de dívida técnica (`TODO: add proper API key / HMAC auth`).
  2. O endpoint `POST /api/v1/tms/edi/214/inbound` processa arquivos X12 214 Shipment Status sem exigir token JWT, chave de API (API-Key), assinatura HMAC ou verificação de IP de origem.
  3. Qualquer cliente na internet pode submeter um payload EDI X12 válido, identificar o `shipmentId` e alterar arbitrariamente o status operacional de despachos para `DELIVERED`, `EXCEPTION` ou `DELAYED`.
- **Veredito:** Risco Crítico real e explorável externamente por requisições anônimas.

---

### [P0-TEN-01] Isolamento Multiempresa apenas Lógico (Sem RLS no PostgreSQL)
- **Status:** **CONFIRMADO (com ressalva técnica)**
- **Arquivos:**
  - `backend/src/auth/orgScopeMiddleware.ts`
  - `backend/prisma/schema.prisma`
  - `backend/prisma/migrations/`
- **Análise Técnica:**
  - O relatório original alegou ausência total de Row Level Security (RLS) no PostgreSQL. Isso foi **rigorosamente confirmado** para o backend Node.js e todas as tabelas operacionais do TMS (`Shipment`, `Customer`, `Invoice`, `Driver`, `Equipment`, etc.).
  - *Ressalva Técnica:* Existe uma única migration com RLS no repositório (`backend/prisma/migrations/20260216000000_wms_outbox_rls/migration.sql`), mas ela pertence exclusivamente à tabela de outbox do módulo satélite WMS em .NET. Nenhuma tabela central de transporte possui RLS ativado.
  - A aplicação confia 100% no middleware Fastify que injeta `req.orgId` e nos desenvolvedores lembrarem de adicionar `where: { orgId }` em todas as consultas Prisma.
  - Além disso, `orgScopeMiddleware.ts` possui uma lógica de fallback permissiva: se a requisição não fornecer cabeçalho de organização e o banco tiver apenas uma organização cadastrada, ele assume automaticamente essa organização (`findFirst()`).
- **Veredito:** Confirmado como risco arquitetural crítico (ausência de defesa em profundidade).

---

### [P0-TEN-02] Ausência de Foreign Keys Compostas `(orgId, id)` no Prisma
- **Status:** **CONFIRMADO**
- **Arquivos:**
  - `backend/prisma/schema.prisma` (linhas 100–450)
- **Análise Técnica:**
  - No Prisma Schema, os relacionamentos entre entidades subordinadas são definidos apenas pelo ID primário simples. Exemplo:
    ```prisma
    model Shipment {
      id             String   @id @default(uuid())
      orgId          String
      customerId     String
      customer       Customer @relation(fields: [customerId], references: [id])
      ...
    }
    ```
  - Como a constraint de integridade referencial aponta apenas para `Customer(id)` e não para `Customer(orgId, id)`, o PostgreSQL permite perfeitamente que um registro da Organização A aponte para um `customerId` pertencente à Organização B.
  - Se houver uma falha de validação ou IDOR em qualquer endpoint da aplicação, o banco de dados não bloqueará a corrupção relacional entre tenants.
- **Veredito:** Confirmado. A integridade referencial multiempresa não é garantida no nível DDL do banco.

---

### [P1-SEC-03] Algoritmo Fraco de Hash de Senha (HMAC-SHA256)
- **Status:** **CONFIRMADO**
- **Arquivos:**
  - `backend/src/services/auth/AuthService.ts` (linhas 66–72)
  - `backend/src/services/auth/CustomerAuthService.ts` (linhas 42–48)
  - `backend/src/services/auth/CarrierAuthService.ts` (linhas 42–48)
- **Evidência no Código:**
  ```typescript
  // AuthService.ts:68
  const hash = crypto.createHmac('sha256', salt).update(password).digest('hex');
  ```
- **Análise Técnica:**
  - O sistema utiliza uma única rodada de HMAC-SHA256. Não há fator de trabalho (work factor/cost), nem consumo de memória, nem iterações lentas.
  - Em GPUs modernas, o cálculo de SHA-256 atinge bilhões de hashes por segundo, tornando ataques de quebra por força bruta extremamente rápidos caso o banco seja comprometido.
  - Descumpre as diretrizes do OWASP Password Storage Cheat Sheet e NIST SP 800-63B, que exigem Argon2id, scrypt ou bcrypt com custo mínimo configurado.
- **Veredito:** Confirmado como vulnerabilidade criptográfica de alta severidade.

---

### [P1-SEC-04] Sessões JWT Stateless de 12h sem Rotação e Logout Fictício
- **Status:** **CONFIRMADO**
- **Arquivos:**
  - `backend/src/auth/jwt.ts` (linhas 38–45)
  - `backend/src/routes/auth.ts` (linhas 130–136)
- **Evidência no Código:**
  ```typescript
  // backend/src/auth/jwt.ts:39
  const TOKEN_EXPIRY_HOURS = 12;

  // backend/src/routes/auth.ts:130
  fastify.post('/logout', async () => {
    return { data: { success: true } };
  });
  ```
- **Análise Técnica:**
  - Os tokens JWT possuem validade estendida de 12 horas.
  - O endpoint de logout não invalida o token, não possui blacklist em memória/Redis e não registra revogação no banco de dados.
  - Se um token for roubado ou um funcionário for demitido, o token continua 100% válido para autenticação em toda a API até o término da janela de 12 horas.
- **Veredito:** Confirmado. Falha severa no gerenciamento do ciclo de vida da sessão.

---

### [P1-SEC-05] Tokens no `localStorage` e Stored XSS
- **Status:** **CONFIRMADO**
- **Arquivos:**
  - `frontend/src/features/auth/useAuth.ts` (linhas 35–45)
  - `frontend/src/features/settings/vnext/VNextEmailTemplates.tsx` (linha 378)
- **Evidência no Código:**
  ```typescript
  // useAuth.ts:38
  localStorage.setItem('auth_token', token);

  // VNextEmailTemplates.tsx:378
  <div dangerouslySetInnerHTML={{ __html: previewHtml }} />
  ```
- **Análise Técnica:**
  - O token de autenticação fica armazenado no `localStorage`, acessível a qualquer código JavaScript em execução na origem.
  - Em `VNextEmailTemplates.tsx`, o HTML de templates de email customizáveis é injetado diretamente no DOM via `dangerouslySetInnerHTML` sem utilização de bibliotecas de sanitização como DOMPurify.
  - Um payload XSS armazenado em um template de email permite que um usuário mal-intencionado extraia o `auth_token` de outros usuários que visualizarem o template.
- **Veredito:** Confirmado como vetor de ataque encadeado de alto risco.

---

### [P1-SEC-06] Ausência de Rate Limiting Global na API
- **Status:** **CONFIRMADO**
- **Arquivos:**
  - `backend/src/index.ts`
  - `backend/src/routes/publicShipmentShare.ts`
- **Análise Técnica:**
  - O pacote `@fastify/rate-limit` está presente no `package.json`, mas só é instanciado em uma única rota pontual (`publicShipmentShare.ts`).
  - O servidor Fastify principal (`index.ts`) não registra o plugin globalmente.
  - As rotas `/api/v1/auth/login`, `/api/v1/customer-portal/auth/login`, `/api/v1/tms/edi/*` e endpoints de criação de dados aceitam requisições ilimitadas por segundo sem throttling.
- **Veredito:** Confirmado. Deixa a aplicação vulnerável a credential stuffing e DoS.

---

### [P1-BRA-01, P1-BRA-02, P1-BRA-03] Incompatibilidade com o Ecossistema Logístico Brasileiro
- **Status:** **CONFIRMADOS COMO LACUNAS FUNCIONAIS/REGULATÓRIAS CRÍTICAS**
- **Arquivos:**
  - `backend/prisma/schema.prisma`
  - `backend/src/models/`, `backend/src/services/`
- **Análise Técnica:**
  - Não existem tabelas, colunas ou validações para:
    - **Cadastros Nacionais (P1-BRA-01):** CNPJ, CPF, Inscrição Estadual, CEP, Código de Município IBGE, placas de veículos no padrão Mercosul.
    - **Documentos Fiscais Eletrônicos (P1-BRA-02):** Conhecimento de Transporte Eletrônico (CT-e modelo 57 e OS modelo 67), Manifesto Eletrônico de Documentos Fiscais (MDF-e modelo 58), Nota Fiscal Eletrônica (NF-e modelo 55) e NFS-e. Sem integração com web services da SEFAZ, sem geração de XML assinado, sem DACTE/DAMDFE.
    - **Regulamentação Rodoviária (P1-BRA-03):** Código Identificador da Operação de Transporte (CIOT), Registro Nacional de Transportadores Rodoviários de Cargas (RNTRC) da ANTT, e comprovação de Vale-Pedágio obrigatório para contratação de TACs (Lei 10.209/2001 e Resoluções ANTT).
- **Veredito:** Confirmados. O sistema é funcional para o mercado norte-americano (DOT, MC, BOL, X12 EDI), mas totalmente inoperante no Brasil sem essas camadas.

---

### [P1-SAA-01, P1-SAA-02] Lacunas Estruturais de Modelo Comercial SaaS
- **Status:** **CONFIRMADOS**
- **Arquivos:**
  - `backend/prisma/schema.prisma` (modelos `User` e `Organization`)
- **Análise Técnica:**
  - **P1-SAA-01:** O schema não possui entidades para `Subscription`, `Plan`, `FeatureFlag`, `InvoiceBilling`, nem contadores de limite de recursos (ex: limite de veículos, faturas/mês, usuários ativos).
  - **P1-SAA-02:** A tabela `User` possui relação rígida 1:N com `Organization` (`organizationId String`), e a coluna `email` possui restrição `@unique` global. Um usuário (ex: motorista autônomo, despachante ou contador que presta serviço para 3 transportadoras) não pode ser convidado para mais de uma empresa com o mesmo email.
- **Veredito:** Confirmados. É necessária a introdução da entidade `Membership` (N:N) e módulo de faturamento recorrente.

---

### [P1-DEP-01] Vulnerabilidades Conhecidas em Dependências npm
- **Status:** **CONFIRMADO**
- **Arquivos:**
  - `package-lock.json`, `docs/auditoria/npm_audit_results.json`
- **Análise Técnica:**
  - O `npm audit` reporta 45 vulnerabilidades conhecidas:
    - **4 Críticas:** Destaque para falhas de bypass de cabeçalho e SSRF em `@fastify/reply-from`, além de vulnerabilidades de injeção em bibliotecas de parsing.
    - **10 Altas:** Falhas de DoS e path traversal em utilitários como `micromatch`, `cross-spawn`, `vite` e `undici`.
    - **18 Moderadas e 13 Baixas**.
- **Veredito:** Confirmado. Exige processo de atualização cirúrgica via `overrides` sem quebrar o Fastify 4 e Prisma 5.

---

### [P2-ARQ-01 a P2-WOR-01] Achados de Arquitetura e Engenharia
- **P2-ARQ-01 (Acoplamento do Banco com pg-boss e EventStore):** **CONFIRMADO**. Tabelas como `job` (pg-boss) e `event_store` compartilham o mesmo pool de conexões do PostgreSQL operacional. Cargas pesadas de filas podem provocar exaustão de conexões transacionais.
- **P2-ARQ-02 (Heterogeneidade WMS em .NET):** **CONFIRMADO**. O diretório `backend/wms` contém uma API ASP.NET Core 8 independente, com autenticação própria e outbox isolado, sem alinhamento com a arquitetura Node.js do projeto principal.
- **P2-TST-01 (Desbalanceamento de Testes e ForceExit):** **CONFIRMADO**. O frontend possui apenas 61 testes unitários simples. No backend, tanto o Jest quanto o runner do frontend exibem alertas de timers abertos e conexões ativas (`A worker process has failed to exit gracefully and has been force exited`).
- **P2-WOR-01 (Worker de IA com Chave Global):** **CONFIRMADO**. O serviço de IA consome uma chave `OPENAI_API_KEY` global compartilhada por todos os tenants sem contabilidade individual de tokens ou limites por organização.

---

### [P3-DES-01 e P3-LIC-01] Desempenho Frontend e Conformidade de Licenças
- **P3-DES-01 (Bundle Frontend Monolítico):** **CONFIRMADO**. O build do Vite gera um único arquivo JS principal de aproximadamente 2.5 MB gzippado, sem `React.lazy()` nas rotas administrativas do TMS.
- **P3-LIC-01 (Licenças e MIT Attribution):** **CONFIRMADO**. A licença do projeto Open TMS é MIT legítima. O mapeamento via `license-checker` confirmou que 100% dos pacotes de terceiros utilizam licenças permissivas (MIT, Apache-2.0, BSD-3-Clause, ISC), inexistindo impedimentos de propriedade intelectual para comercialização SaaS.

---

## 3. CONCLUSÃO DA SEGUNDA AUDITORIA

A verificação independente **confirmou 100% dos 20 achados** reportados na primeira auditoria (com uma ressalva técnica de escopo em P0-TEN-01). Nenhuma das conclusões originais se tratava de falso positivo.

O Open TMS é uma base de código rica, moderna e tecnicamente impressionante no que tange ao design de interfaces e cobertura de rotas de negócio norte-americanas, mas **não pode entrar em produção comercial sem que os 4 problemas P0 e as vulnerabilidades de autenticação P1 sejam sanados preventivamente**.

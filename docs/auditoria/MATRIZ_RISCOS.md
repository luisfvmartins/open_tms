# MATRIZ DE RISCOS E CLASSIFICAÇÃO DE ACHADOS — OPEN TMS
**Auditoria Técnica, Funcional e Estrutural para Adaptação a SaaS Brasileiro**

Data da Auditoria: 10 de Novembro de 2026  
Versão Avaliada: Open TMS 0.1.0 (Commit: `ed831c2b9f77721cc5c9d87c49f9aa3bde8124a0`)  
Repositório: `https://github.com/DominicFinn/open_tms.git`  
Licença Original: MIT (Copyright 2025 Dominic Finn)

---

## 1. Critérios de Classificação e Severidade

A classificação de severidade adotada nesta auditoria segue rigorosamente os seguintes critérios técnicos:

- **P0 — Crítico:** Risco imediato de segurança, vazamento de dados confidenciais entre empresas, adulteração indevida de dados ou comprometimento do sistema em produção.
- **P1 — Alto:** Impede o lançamento comercial no Brasil, inviabiliza a operação SaaS legal/fiscal ou compromete funcionalidades essenciais de negócio.
- **P2 — Médio:** Problema relevante de arquitetura, concorrência, desempenho ou cobertura, com possibilidade de contorno ou mitigação temporária.
- **P3 — Baixo:** Melhoria não essencial, otimização de bundle, limpeza de código legado ou ajuste documental.

---

## 2. Visão Consolidada dos Achados

```
┌────────────────────────────────────────────────────────────────────────┐
│                      QUADRO RESUMO DE RISCOS                           │
├──────────────┬───────────────────────────────────────────┬─────────────┤
│ Criticidade  │ Definição                                 │ Quantidade  │
├──────────────┼───────────────────────────────────────────┼─────────────┤
│ P0 — Crítico │ Risco imediato / Vazamento de dados / Falha│      4      │
│ P1 — Alto    │ Impede operação comercial / Lacuna Brasil │     10      │
│ P2 — Médio   │ Arquitetura / Desempenho / Concorrência   │      4      │
│ P3 — Baixo   │ Otimização / Débito técnico / Documentação│      2      │
├──────────────┴───────────────────────────────────────────┼─────────────┤
│ Total de Achados Auditados                               │     20      │
└──────────────────────────────────────────────────────────┴─────────────┘
```

---

## 3. Matriz Detalhada de Achados

### 3.1. Achados P0 — Críticos

---

#### [P0-SEC-01] Server-Side Request Forgery (SSRF) com Exfiltração de Resposta em Webhooks e Agente
- **Categoria:** Segurança da Aplicação / SSRF
- **Criticidade:** **P0 — Crítico**
- **Descrição:** O serviço de entrega de webhooks para clientes e o skill de invocação de webhooks por agentes de IA realizam requisições HTTP outbound para URLs informadas pelo usuário sem qualquer validação de rede. Não há restrição contra endereços IP privados (RFC 1918: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 127.0.0.0/8) nem serviços de metadados de nuvem (169.254.169.254). Além disso, o sistema captura até 4.000 caracteres do corpo da resposta e grava em banco (`CustomerWebhookDelivery.responseBody`), permitindo que o usuário consulte a resposta via API e exfiltre metadados da nuvem ou dados de portas internas.
- **Evidência no Código:**
  - `backend/src/services/webhooks/CustomerWebhookDeliveryService.ts:83-100`:
    ```typescript
    const res = await fetch(webhook.url, { method: 'POST', ... });
    const text = await res.text();
    responseBody = text.slice(0, 4000); // Salvo em banco e retornado na API
    ```
  - `backend/src/services/skills/CallWebhookSkill.ts:44-53`: Chamada direta sem verificação de IP de destino.
  - `backend/src/routes/customerDeveloper.ts:180-210`: Endpoint que retorna o `responseBody` gravado para o usuário do portal.
- **Impacto:** Comprometimento total da infraestrutura de nuvem (exfiltração de tokens IAM via metadados AWS/GCP, escaneamento de portas internas e acesso não autenticado a Redis/Postgres/MinIO locais).
- **Recomendação:**
  1. Implementar biblioteca de validação estrita de URLs (ex: `ipaddr.js` ou parser com DNS lookup prévio).
  2. Bloquear IPs reservados, loopback, link-local e redes internas.
  3. Não armazenar nem refletir corpos de resposta de requisições falhas ou para destinos externos não homologados.
  4. Executar os workers de webhook em rede DMZ/VPC isolada sem privilégios de acesso aos serviços internos.
- **Dependências:** Nenhuma.
- **Complexidade:** Média.

---

#### [P0-SEC-02] Endpoints de Ingestão EDI Sem Autenticação ou Verificação Criptográfica
- **Categoria:** Segurança da Aplicação / Autenticação
- **Criticidade:** **P0 — Crítico**
- **Descrição:** Todas as rotas de recepção de documentos EDI (X12 204, 210, 214, 820, 940, 997 e 180) estão expostas diretamente no roteador público da API (`registerTmsPublicRoutes`), fora do middleware de autenticação JWT. A rota conta apenas com um comentário `TODO: add proper API key / HMAC auth for EDI endpoints` e valida apenas a existência do `partnerId` enviado no corpo ou cabeçalho. Qualquer chamador externo anônimo que descubra ou adivinhe o identificador de um parceiro pode injetar ordens de frete falsas, alterar status de cargas ou corromper o histórico logístico.
- **Evidência no Código:**
  - `backend/src/routes/modules/tms.ts:82-90`:
    ```typescript
    // EDI inbound - currently rely on trading partner ID validation.
    // TODO: add proper API key / HMAC auth for EDI endpoints
    await server.register(ediInboundRoutes);
    await server.register(ediTenderRoutes);
    await server.register(edi214Routes);
    await server.register(edi210Routes);
    ...
    ```
  - `backend/src/routes/edi214.ts:35-50`: Processa status de embarque diretamente com base nos dados do envelope sem validação de assinatura HMAC.
- **Impacto:** Injeção arbitrária de eventos operacionais, cancelamento não autorizado de fretes e corrupção da base de dados de transportes por terceiros não autorizados.
- **Recomendação:**
  1. Implementar autenticação obrigatória via `x-api-key` específica por parceiro ou assinatura HMAC-SHA256 no cabeçalho (utilizando o secret já previsto em `TradingPartner`).
  2. Rejeitar qualquer requisição cujo secret ou assinatura não corresponda ao parceiro registrado.
- **Dependências:** Atualização de rotas e repositório de parceiros.
- **Complexidade:** Média.

---

#### [P0-TEN-01] Ausência de Row-Level Security (RLS) no PostgreSQL e Dependência Exclusiva de Filtros de Aplicação
- **Categoria:** Multi-tenancy / Isolamento de Dados
- **Criticidade:** **P0 — Crítico**
- **Descrição:** O isolamento de dados entre empresas no Open TMS não é garantido nativamente no banco de dados PostgreSQL. Ele depende 100% de que cada desenvolvedor lembre-se de injetar manualmente a cláusula `where: { orgId }` em todas as consultas Prisma em todas as rotas e repositórios. O histórico do projeto em `docs/MULTI_TENANCY_REMEDIATION_PLAN.md` comprova que esse modelo gerou múltiplos vazamentos de dados críticos em versões anteriores (rotas listavam todos os clientes, embarques ou despesas de outras empresas por omissão do filtro). Se uma nova consulta for criada sem o filtro ou se for executada uma raw query via Dapper/.NET sem passar pelo contexto do tenant, os dados de todos os clientes do SaaS ficam expostos.
- **Evidência no Código:**
  - `docs/MULTI_TENANCY_REMEDIATION_PLAN.md:1-40`: Registra vazamentos críticos anteriores em `shipments.ts:81`, `charges.ts:54`, `customers.ts`, `carriers.ts`.
  - `backend/prisma/migrations/`: Nenhuma migração contém `ENABLE ROW LEVEL SECURITY` ou `CREATE POLICY` para as tabelas principais do Prisma.
  - `backend/src/auth/orgScopeMiddleware.ts:55-65`: O middleware apenas preenche `req.orgId`; a aplicação é que decide se passa esse valor ao Prisma.
- **Impacto:** Risco perene de vazamento de dados confidenciais entre transportadoras e embarcadores concorrentes que utilizam a mesma instância SaaS.
- **Recomendação:**
  1. Habilitar PostgreSQL Row Level Security (RLS) em todas as tabelas operacionais do schema público (`ALTER TABLE "Shipment" ENABLE ROW LEVEL SECURITY`).
  2. Criar políticas de RLS baseadas em variável de sessão: `CREATE POLICY tenant_isolation_policy ON "Shipment" USING ("orgId" = current_setting('app.current_org_id', true))`.
  3. Configurar extensão de middleware do Prisma para emitir `SET LOCAL app.current_org_id = ?` no início de cada transação.
- **Dependências:** Refatoração da camada de conexão do Prisma.
- **Complexidade:** Alta.

---

#### [P0-TEN-02] Risco de Relacionamento Cruzado Entre Empresas por Falta de Composite Foreign Keys
- **Categoria:** Multi-tenancy / Integridade Referencial
- **Criticidade:** **P0 — Crítico**
- **Descrição:** Embora a coluna `orgId` tenha sido adicionada às tabelas principais, as chaves estrangeiras (Foreign Keys) continuam vinculando apenas os IDs das entidades secundárias (ex: `orderId REFERENCES Order(id)`, `customerId REFERENCES Customer(id)`), sem amarrar conjuntamente o `orgId`. Isso significa que o banco de dados permite fisicamente que um Embarque da Empresa A aponte para um Cliente ou Veículo da Empresa B. Se a validação a nível de aplicação falhar ou for contornada, a integridade do isolamento é violada diretamente na camada relacional.
- **Evidência no Código:**
  - `backend/prisma/schema/tms.prisma:4-50`: Modelo `Shipment` possui `customerId String`, `originId String?`, `destinationId String?`, `carrierId String?`. As constraints de chave estrangeira validam apenas `Customer(id)`, `Location(id)` e `Carrier(id)`.
  - Ausência de constraints compostas `FOREIGN KEY (orgId, customerId) REFERENCES Customer(orgId, id)`.
- **Impacto:** Corrupção relacional de dados, permitindo que faturas, notas de débito ou entregas sejam vinculadas a entidades de empresas terceiras.
- **Recomendação:**
  1. Adicionar constraints únicas compostas nas entidades pai: `UNIQUE (orgId, id)`.
  2. Atualizar as foreign keys das tabelas filhas para composite foreign keys: `FOREIGN KEY (orgId, customerId) REFERENCES Customer(orgId, id)`.
- **Dependências:** Migração estrutural de banco de dados.
- **Complexidade:** Média.

---

### 3.2. Achados P1 — Altos

---

#### [P1-SEC-03] Algoritmo Inseguro de Hash de Senhas (HMAC-SHA256 Simples Sem KDF)
- **Categoria:** Autenticação / Criptografia
- **Criticidade:** **P1 — Alto**
- **Descrição:** O sistema utiliza uma função própria para derivação de senhas baseada em uma única rodada de `createHmac('sha256', salt).update(password)`. Essa abordagem não utiliza fatores de custo computacional (memory/time cost) típicos de Key Derivation Functions (KDFs) recomendadas por normas internacionais (OWASP, NIST), como Argon2id, bcrypt ou PBKDF2 com centenas de milhares de iterações. Em caso de vazamento da tabela `User`, hashes HMAC-SHA256 simples podem ser quebrados por força bruta em GPUs modernas a taxas de bilhões de tentativas por segundo.
- **Evidência no Código:**
  - `backend/src/services/AuthService.ts:227-231`:
    ```typescript
    hashPassword(password: string): string {
      const salt = randomBytes(16).toString('hex');
      const hash = createHmac('sha256', salt).update(password).digest('hex');
      return `${salt}:${hash}`;
    }
    ```
  - Repetido de forma idêntica em `CustomerAuthService.ts:226-230` e `CarrierAuthService.ts:239-243`.
- **Impacto:** Facilidade extrema de quebra de senhas em caso de vazamento de banco de dados ou despejos de backup desprotegidos.
- **Recomendação:** Substituir imediatamente por `argon2` (padrão OWASP) ou `bcrypt` com fator de trabalho adequado (mínimo 12 rodadas). Implementar migração progressiva de hash no próximo login do usuário.
- **Dependências:** Adição do pacote `argon2` ou `@node-rs/argon2`.
- **Complexidade:** Baixa.

---

#### [P1-SEC-04] Sessões com JWTs Stateless de 12 Horas, Sem Revogação e Logout Fictício
- **Categoria:** Autenticação / Gerenciamento de Sessão
- **Criticidade:** **P1 — Alto**
- **Descrição:** Os tokens JWT gerados para usuários internos possuem tempo de vida estático de 12 horas (`TOKEN_EXPIRY_HOURS = 12`) e operam em modo puramente stateless, sem tabela de sessões ativas ou lista de revogação (blocklist). Quando um usuário executa o logout na API, o endpoint é um no-op: ele simplesmente retorna `{ success: true }`, transferindo a responsabilidade de exclusão para o cliente. Se um token for roubado ou se um colaborador for desativado/demitido, o token continua 100% válido para acessar todas as rotas operacionais durante 12 horas.
- **Evidência no Código:**
  - `backend/src/services/AuthService.ts:16`: `const TOKEN_EXPIRY_HOURS = 12;`
  - `backend/src/routes/auth.ts:120-126`:
    ```typescript
    server.post('/api/v1/auth/logout', async (_req, _reply) => {
      // JWTs are stateless. Real revocation is on the roadmap (token blocklist / session records).
      return { data: { success: true }, error: null };
    });
    ```
- **Impacto:** Impossibilidade de invalidar acessos comprometidos ou revogar credenciais de ex-colaboradores em tempo hábil.
- **Recomendação:**
  1. Reduzir a validade do Access Token para 15 minutos.
  2. Implementar Refresh Tokens com rotação automática persistidos no banco (reativar o conceito de `Session` já previsto no schema).
  3. Criar verificação de token revogado ou invalidar por `passwordChangedAt` / `tokenVersion`.
- **Dependências:** Ajustes em `AuthService`, middleware e frontend.
- **Complexidade:** Média.

---

#### [P1-SEC-05] Armazenamento de Tokens no localStorage e Vulnerabilidade de Stored XSS
- **Categoria:** Frontend / XSS / Gestão de Credenciais
- **Criticidade:** **P1 — Alto**
- **Descrição:** O frontend armazena os tokens de acesso (`auth_token`, `auth_user`) no `localStorage` do navegador, tornando-os vulneráveis a leitura por qualquer script executado no contexto da página. Paralelamente, a tela de configuração de templates de e-mail renderiza a pré-visualização HTML utilizando `dangerouslySetInnerHTML` sem passar por sanitização via DOMPurify. Uma carga útil maliciosa injetada no corpo do template executará no navegador do operador, capturando o token do `localStorage` e enviando-o a um servidor de ataque.
- **Evidência no Código:**
  - `frontend/src/authFetch.ts:28-29`: `const MAIN_TMS_TOKEN_KEY = 'auth_token';`
  - `frontend/src/pages/Login.tsx:41`: `localStorage.setItem('auth_token', json.data.token);`
  - `frontend/src/vnext-design/VNextEmailTemplates.tsx:378`:
    ```tsx
    <div className="..." dangerouslySetInnerHTML={{ __html: previewHtml }} />
    ```
- **Impacto:** Roubo de sessão administrativa (Account Takeover) através de injeção de HTML malicioso em modelos de e-mail.
- **Recomendação:**
  1. Utilizar `DOMPurify` para sanitizar qualquer HTML exibido via `dangerouslySetInnerHTML`.
  2. Avaliar a migração para cookies HTTP-Only com proteção `SameSite=Lax/Strict` para mitigar o risco de exfiltração via XSS.
- **Dependências:** Adição do pacote `dompurify` no frontend.
- **Complexidade:** Baixa.

---

#### [P1-SEC-06] Ausência de Rate Limiting Global na API Fastify
- **Categoria:** Segurança da Aplicação / DoS & Brute Force
- **Criticidade:** **P1 — Alto**
- **Descrição:** Embora a biblioteca `@fastify/rate-limit` esteja presente nas dependências do projeto, ela só é ativada localmente em uma única rota pública (`publicShipmentShare.ts`). Todos os demais endpoints — incluindo autenticação de usuários internos (`/api/v1/auth/login`), login de portais, rotas de exportação e endpoints de listagem pesada — estão totalmente desprotegidos contra abusos de taxa de requisições.
- **Evidência no Código:**
  - `backend/src/index.ts`: Nenhum registro global de `@fastify/rate-limit`.
  - `backend/src/routes/auth.ts:12`: O login possui bloqueio por tentativas após 5 falhas no banco, mas não impede ataques de negação de serviço (DDoS) ou exaustão de conexões via força bruta distribuída.
- **Impacto:** Degradação de desempenho, indisponibilidade do serviço e suscetibilidade a ataques de força bruta em massa.
- **Recomendação:** Ativar o plugin `@fastify/rate-limit` globalmente em `index.ts` com limites padronizados (ex: 100 req/min por IP) e limites restritivos nos endpoints de login (ex: 10 req/min).
- **Dependências:** Configuração no bootstrap do Fastify.
- **Complexidade:** Baixa.

---

#### [P1-BRA-01] Incompatibilidade Estrutural de Cadastros com o Mercado Brasileiro
- **Categoria:** Adaptação Brasil / Modelagem de Dados
- **Criticidade:** **P1 — Alto**
- **Descrição:** A modelagem atual das entidades `Customer`, `Carrier`, `Location`, `Vehicle` e `Driver` reflete exclusivamente o padrão dos Estados Unidos. Não existem campos para documentos de identificação pessoal e empresarial do Brasil (CPF, CNPJ de 14 dígitos e o futuro CNPJ alfanumérico), Inscrição Estadual (IE), Inscrição Municipal (IM), Código de Município IBGE, CEP de 8 dígitos ou divisão de endereço por Bairro. Além disso, os veículos não possuem campos para RENAVAM, Chassi ou validação de Placa Mercosul.
- **Evidência no Código:**
  - `backend/prisma/schema/core.prisma:39`: `Customer.taxId String? // VAT / EIN`
  - `backend/prisma/schema/core.prisma:91-96`: `Location` utiliza `address1`, `address2`, `city`, `state`, `postalCode`, `country`. Não há campo `neighborhood` (bairro) nem `ibgeCode`.
  - `backend/prisma/schema/tms.prisma:488`: `Vehicle.plate String` (string livre sem validação).
- **Impacto:** Impossibilidade de faturamento comercial, emissão fiscal ou cadastramento correto de clientes e parceiros brasileiros.
- **Recomendação:** Criar migrações para adicionar os campos brasileiros como entidades de primeira classe ou campos estruturados, acompanhados de validadores de algoritmo (módulo 11) para CPF/CNPJ e formatadores de CEP/Mercosul.
- **Dependências:** Migração de banco de dados e ajuste dos formulários frontend.
- **Complexidade:** Média.

---

#### [P1-BRA-02] Inexistência de Módulo Fiscal e Regulatório Brasileiro (CT-e, MDF-e, NF-e, CIOT, Vale-Pedágio)
- **Categoria:** Legislação e Compliance Fiscal Brasil
- **Criticidade:** **P1 — Alto**
- **Descrição:** O sistema utiliza o padrão norte-americano de Bill of Lading (BOL), que não possui validade fiscal no Brasil. No território brasileiro, a prestação de serviços de transporte de carga exige obrigatoriamente a emissão do Conhecimento de Transporte Eletrônico (CT-e - Modelo 57/67), do Manifesto Eletrônico de Documentos Fiscais (MDF-e - Modelo 58), a vinculação com as Notas Fiscais Eletrônicas (NF-e - Modelo 55), o registro do Código Identificador da Operação de Transporte (CIOT) pela ANTT e o comprovante de compra do Vale-Pedágio Obrigatório (Lei 10.209/2001). Nenhuma dessas obrigações fiscais e regulatórias existe no código do Open TMS.
- **Evidência no Código:**
  - `backend/src/services/DocumentGenerationService.ts`: Gera apenas BOL e comprovantes PDF simples com base em Handlebars.
  - Ausência total de bibliotecas de comunicação SOAP/SEFAZ, assinatura digital com certificado A1 (PKCS#12) e esquemas XSD da SEFAZ.
- **Impacto:** Bloqueio comercial absoluto. Nenhuma transportadora ou transportador autônomo pode operar legalmente no Brasil sem emitir CT-e e MDF-e.
- **Recomendação:** Arquitetar um módulo fiscal integrado (ou adaptador para gateways fiscais conceituados como Focus NFe, SpeedGov, Nuvem Fiscal ou PlugNotas) para emissão assíncrona, gestão de certificados digitais A1 e geração de DACTE e DAMDFE em PDF.
- **Dependências:** Gateway de mensageria fiscal ou biblioteca SEFAZ TypeScript.
- **Complexidade:** Alta.

---

#### [P1-BRA-03] Modelo de Frota e Motoristas Inadequado para o Ecossistema Logístico Nacional
- **Categoria:** Operações Logísticas / Gestão de Transportes
- **Criticidade:** **P1 — Alto**
- **Descrição:** O Open TMS trata os motoristas (`Driver`) e veículos (`Vehicle`) como meros atributos subordinados a uma transportadora (`Carrier`), com campos mínimos de contato. Na realidade brasileira, o ecossistema é predominantemente composto por Transportadores Autônomos de Cargas (TACs), frotas agregadas e terceirizadas, além de frota própria. A operação nacional exige a separação física de conjuntos veiculares (cavalo mecânico e carretas/semirreboques com placas e documentos distintos), controle rigoroso de CNH com categoria e data de validade, exames toxicológicos periódicos, RNTRC ativo na ANTT, adiantamentos de frete e fechamentos de acertos de viagem.
- **Evidência no Código:**
  - `backend/prisma/schema/tms.prisma:481-516`: Modelos `Vehicle` e `Driver` possuem apenas 8 campos cada e dependem obrigatoriamente de `carrierId`.
- **Impacto:** Inviabilidade de atender o público-alvo inicial (TACs, pequenos transportadores e agregados), que não se enquadram no modelo de transportadora institucional norte-americana.
- **Recomendação:**
  1. Reformular o modelo de dados para permitir motoristas autônomos diretos (sem intermediário `Carrier`).
  2. Implementar separação entre Unidade Tratora (cavalo) e Unidades Tracionadas (carretas/reboques).
  3. Criar módulos de acerto de viagem, adiantamento, abastecimento e manutenção básica.
- **Dependências:** Migração estrutural no schema do Prisma.
- **Complexidade:** Alta.

---

#### [P1-SAA-01] Inexistência de Camada Comercial SaaS (Planos, Assinaturas e Cobrança)
- **Categoria:** Arquitetura SaaS Comercial
- **Criticidade:** **P1 — Alto**
- **Descrição:** O Open TMS foi estruturado como uma aplicação multi-tenant voltada para auto-hospedagem corporativa ou instâncias dedicadas. Não existe qualquer modelo, rota ou tabela para gestão comercial de SaaS: ausência de planos (Free, Starter, Pro), catálogo de limites de recursos (número de veículos ativos, motoristas, embarques mensais, espaço de armazenamento), cobrança recorrente, integração com gateways de pagamento (Asaas, Iugu, Stripe, Mercado Pago) ou painel de administração global (Super Admin / Control Plane) para provisionar, suspender ou reativar contas de empresas inadimplentes.
- **Evidência no Código:**
  - `backend/prisma/schema/`: Nenhuma tabela de planos, quotas, assinaturas ou faturas de software.
  - `backend/src/routes/organization.ts`: Permite apenas visualizar/atualizar a própria organização ativa. Não há rotas de gestão entre múltiplos tenants.
- **Impacto:** Impossibilidade de comercializar a plataforma no modelo de assinatura recorrente (Software as a Service) com controle automático de limites e cobrança.
- **Recomendação:**
  1. Criar o schema e os serviços de planos e assinaturas (`Plan`, `Subscription`, `PlanLimit`).
  2. Implementar middleware de verificação de limites (metering/quota enforcement) nas rotas de criação de embarques, motoristas e veículos.
  3. Desenvolver o painel Super-Admin desacoplado da operação de transporte.
- **Dependências:** Integração com gateway de pagamentos nacional (ex: Asaas/Iugu para PIX e boleto).
- **Complexidade:** Alta.

---

#### [P1-SAA-02] Modelo Rígido de Usuário: Impossibilidade de Pertencer a Mais de Uma Empresa
- **Categoria:** Arquitetura Multi-tenancy / Gestão de Identidade
- **Criticidade:** **P1 — Alto**
- **Descrição:** Na modelagem atual do Prisma, o modelo `User` possui um vínculo direto `organizationId String` (relação 1:N) e a coluna `email` possui uma restrição de unicidade global (`@unique`). Esse design impede que um mesmo profissional (por exemplo, um motorista autônomo, um despachante aduaneiro ou um gestor logístico terceirizado) utilize seu e-mail para atuar em duas ou mais empresas cadastradas no sistema.
- **Evidência no Código:**
  - `backend/prisma/schema/core.prisma:404`: `email String @unique`
  - `backend/prisma/schema/core.prisma:416`: `organizationId String`
- **Impacto:** Fricção severa de usabilidade no mercado brasileiro, forçando motoristas ou operadores parceiros a criarem e-mails artificiais para trabalhar com transportadoras diferentes.
- **Recomendação:**
  1. Desacoplar a identidade de autenticação global (`Account` ou `UserCredential`) da participação na organização (`OrganizationMember` ou `UserOrganizationMembership`).
  2. Remover a unicidade global do e-mail por organização ou permitir a seleção de tenant ativo durante a sessão.
- **Dependências:** Refatoração substancial na camada de autenticação (`AuthService`, JWTs e middleware).
- **Complexidade:** Média-Alta.

---

#### [P1-DEP-01] Vulnerabilidades Críticas e Altas nas Dependências npm
- **Categoria:** Dependências de Terceiros / CVEs
- **Criticidade:** **P1 — Alto**
- **Descrição:** A auditoria automatizada de pacotes via `npm audit` identificou um total de 45 vulnerabilidades conhecidas, sendo **4 críticas** e **10 altas**. Dentre as vulnerabilidades críticas confirmadas, destaca-se o pacote `@fastify/reply-from` (usado no proxy reverso do WMS), que permite a remoção indevida de cabeçalhos de segurança via abuso do header Connection (GHSA-gwhp-pf74-vj37), vulnerabilidades no parser `@fastify/busboy` de multipart (DoS e injeção CRLF) e brechas de Denial of Service no `undici` e `zod`.
- **Evidência no Código:**
  - `package-lock.json`: Dependências desatualizadas fixadas em versões vulneráveis.
  - Relatório `audit_results.json` gerado durante a auditoria (metadados: 4 críticas, 10 altas, 28 moderadas).
- **Impacto:** Risco de negação de serviço, bypass de filtros de proxy e manipulação de cabeçalhos HTTP em ambiente de produção.
- **Recomendação:** Planejar a atualização cautelosa das dependências vulneráveis com suíte de testes de regressão antes da entrada em ambiente de homologação.
- **Dependências:** Nenhuma funcional; requer rodada de compatibilidade.
- **Complexidade:** Média.

---

### 3.3. Achados P2 — Médios

---

#### [P2-ARQ-01] Concorrência e Bloat no Banco Compartilhado entre Transacional, EventStore e Filas pg-boss
- **Categoria:** Arquitetura / Desempenho / Banco de Dados
- **Criticidade:** **P2 — Médio**
- **Descrição:** O Open TMS utiliza a mesma instância e banco de dados PostgreSQL para três finalidades distintas e concorrentes:
  1. Banco transacional OLTP de negócio;
  2. Event Store imutável da arquitetura CQRS (`DomainEventLog`);
  3. Sistema de filas e agendamento de tarefas assíncronas (`pg-boss`).
  O mecanismo do `pg-boss` realiza alto volume de operações de `INSERT`, `UPDATE` e `DELETE` com `SKIP LOCKED`, gerando grande taxa de churn de tuplas e pressão no autovacuum do PostgreSQL. Com o crescimento do volume de empresas no SaaS, o banco sofrerá bloat e concorrência de I/O de disco entre workers e requisições HTTP da API.
- **Evidência no Código:**
  - `backend/src/queue/PgBossQueueAdapter.ts`: Inicializa o `pg-boss` conectado à mesma `DATABASE_URL`.
  - `backend/src/worker.ts`: O worker consome 12+ filas com dezenas de crons disparando a cada minuto no mesmo banco.
- **Impacto:** Queda progressiva de desempenho em consultas operacionais, lentidão na API e saturação prematura de conexões do PostgreSQL.
- **Recomendação:**
  1. No curto prazo: Configurar parâmetros agressivos de autovacuum para o schema `pgboss`.
  2. No médio prazo: Migrar a camada de mensageria assíncrona do `pg-boss` para Redis (BullMQ) ou RabbitMQ gerenciado, mantendo o PostgreSQL dedicado estritamente ao armazenamento transacional.
- **Dependências:** Infraestrutura de fila desacoplada.
- **Complexidade:** Média.

---

#### [P2-ARQ-02] Desalinhamento Tecnológico do Microsserviço WMS (.NET C#) e auth-service Legado
- **Categoria:** Manutenibilidade e Arquitetura de Software
- **Criticidade:** **P2 — Médio**
- **Descrição:** O projeto principal é um monorepo em TypeScript/Node.js, mas o módulo WMS foi portado para um microsserviço independente em .NET 8 / C# (`services/wms`), exigindo um runtime adicional e competências de engenharia em C# e Dapper. Ao mesmo tempo, o repositório mantém diretórios obsoletos como `auth-service/`, que os próprios registros de decisão arquitetural (ADR 0002 e ADR 0004) indicam que deveriam ter sido deletados. Esse mosaico tecnológico eleva a complexidade de manutenção, de esteiras de CI/CD e de monitoramento operacional.
- **Evidência no Código:**
  - `services/wms/`: Projeto .NET 8 com `FinnWms.slnx`.
  - `docs/adr/0002-modular-monolith-product-composition.md:70`: "- The dormant auth-service/ is deleted...".
  - `backend/src/plugins/wmsServiceProxy.ts`: Proxy reverso que repassa chamadas de `/api/v1/wms/*` para o serviço .NET.
- **Impacto:** Aumento do custo de infraestrutura, dificuldade de contratação de equipe mista (.NET + Node) e confusão arquitetural no repositório.
- **Recomendação:**
  1. Excluir permanentemente o diretório legado `auth-service/`.
  2. Decidir se o módulo WMS permanecerá em .NET ou se suas rotas serão reabsorvidas no backend Fastify (TypeScript), unificando a stack inteira em Node.js.
- **Dependências:** Decisão de produto e engenharia.
- **Complexidade:** Média.

---

#### [P2-TST-01] Desequilíbrio Crítico na Cobertura de Testes: Frontend com Apenas 8 Testes e Vazamento de Handles
- **Categoria:** Qualidade e Confiabilidade de Software
- **Criticidade:** **P2 — Médio**
- **Descrição:** Existe um forte desequilíbrio na confiabilidade automatizada do projeto: enquanto o backend possui uma cobertura exemplar com 251 suítes e 2.595 testes unitários/integrados, o frontend possui meros 8 arquivos de teste cobrindo apenas utilitários pontuais. Telas críticas com formulários complexos (criação de embarques, faturamento, conferência de carga) não possuem qualquer teste de componente ou E2E (Playwright/Cypress). Além disso, tanto no backend quanto no frontend, os testes do Jest exigem a flag `--forceExit` porque conexões ativas ou timers assíncronos não são devidamente encerrados no teardown.
- **Evidência no Código:**
  - `find frontend/src -name "*.test.*"`: Apenas 8 arquivos encontrados.
  - `package.json:22`: `"test": "npm -w backend run test -- --forceExit && npm -w frontend run test -- --forceExit"`
  - Aviso do Jest durante execução: `"A worker process has failed to exit gracefully and has been force exited... Active timers can also cause this"`.
- **Impacto:** Risco elevado de regressões visuais ou de lógica de tela no frontend sem detecção prévia; testes com vazamento de recursos podem falhar em esteiras de integração contínua (CI).
- **Recomendação:**
  1. Corrigir o teardown dos testes assíncronos para eliminar a necessidade de `--forceExit`.
  2. Implementar suíte de testes E2E com Playwright focada nos fluxos críticos do TMS.
- **Dependências:** Configuração de Playwright.
- **Complexidade:** Média.

---

#### [P2-WOR-01] Incompatibilidade Multi-Tenant do Agente de IA nos Workers (Chave Global de LLM)
- **Categoria:** Inteligência Artificial / Multi-tenancy
- **Criticidade:** **P2 — Médio**
- **Descrição:** A arquitetura do worker de eventos possui uma trava documentada no código que desabilita o uso de chaves individuais de LLM cadastradas pelas empresas caso o banco possua mais de uma organização. O worker constrói um provedor único para todo o processo; portanto, em um ambiente multi-tenant, o sistema utiliza exclusivamente a chave global configurada na variável de ambiente do servidor (`process.env.ANTHROPIC_API_KEY`), impossibilitando que cada empresa pague pelo seu próprio consumo de tokens de inteligência artificial.
- **Evidência no Código:**
  - `backend/src/worker.ts:149-165`:
    ```typescript
    // BUSINESS RULE (#303): the worker builds one provider for the whole process, so an org's own
    // LLM key may only drive it when that org is the only tenant...
    const soleOrgId = await resolveSoleOrganizationId(prisma);
    const org = soleOrgId ? await prisma.organization.findUnique(...) : null;
    const llmApiKey = org?.llmApiKey || process.env.ANTHROPIC_API_KEY;
    ```
- **Impacto:** O provedor do SaaS arcará integralmente com o custo de LLM de todos os clientes ou terá que repassar o valor embutido no plano sem medição individualizada precisa.
- **Recomendação:** Modificar a arquitetura do agente de triagem no worker para instanciar ou recuperar o provedor LLM dinamicamente em tempo de execução com base no `event.orgId`.
- **Dependências:** Refatoração de `worker.ts` e `TriageAgentHandler.ts`.
- **Complexidade:** Baixa-Média.

---

### 3.4. Achados P3 — Baixos

---

#### [P3-DES-01] Bundle de Frontend Monolítico de 2.5 MB Sem Code-Splitting Dinâmico
- **Categoria:** Frontend / Performance
- **Criticidade:** **P3 — Baixo**
- **Descrição:** O empacotamento de produção do frontend (`npm -w frontend run build`) gera um único arquivo JavaScript minificado de 2.504 kB (577 kB comprimido em gzip). O aviso emitido pelo Vite indica que a aplicação não utiliza carregamento dinâmico (`React.lazy()` / dynamic `import()`), forçando o usuário a carregar todo o código de 80+ telas (incluindo painéis de WMS e administração avançada) logo no primeiro acesso à tela de login.
- **Evidência no Código:**
  - Saída do Vite Build:
    ```
    dist/assets/index-Clt9qCVv.js 2,504.02 kB │ gzip: 577.23 kB
    (!) Some chunks are larger than 500 kB after minification.
    ```
  - `frontend/src/main.tsx:1-94`: Todos os componentes de rotas são importados estaticamente no topo do arquivo.
- **Impacto:** Tempo de carregamento inicial lento, especialmente em conexões móveis 3G/4G utilizadas por motoristas e operadores em armazéns.
- **Recomendação:** Adotar code-splitting por rota com `React.lazy()` e `React.Suspense` em `main.tsx`, separando o portal do cliente, o portal da transportadora e as telas do TMS em chunks independentes.
- **Dependências:** Refatoração de rotas no React.
- **Complexidade:** Baixa.

---

#### [P3-LIC-01] Preservação Obrigatória de Avisos de Copyright MIT de Dominic Finn
- **Categoria:** Conformidade Jurídica / Licenças
- **Criticidade:** **P3 — Baixo**
- **Descrição:** O código-fonte do Open TMS está licenciado sob a licença MIT em nome de Dominic Finn (2025). A licença MIT permite irrestrita exploração comercial, modificação, distribuição e sublicenciamento do software como produto SaaS fechado. Contudo, impõe a condição jurídica estrita de que o aviso original de copyright e a declaração de licença sejam preservados em todas as cópias ou partes substanciais do software.
- **Evidência no Código:**
  - `LICENCE.md:1-21`:
    ```
    MIT License
    Copyright (c) 2025 Dominic Finn
    The above copyright notice and this permission notice shall be included in all
    copies or substantial portions of the Software.
    ```
- **Impacto:** Risco de infração de propriedade intelectual em caso de remoção dos arquivos de licença ou atribuição original do projeto.
- **Recomendação:** Manter intacto o arquivo `LICENCE.md` no backend e repositório, garantindo na tela "Sobre" da plataforma SaaS a menção de que o produto utiliza componentes baseados em Open TMS sob licença MIT.
- **Dependências:** Documentação jurídica e tela "Sobre" no sistema.
- **Complexidade:** Baixa.

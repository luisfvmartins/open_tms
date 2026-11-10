# CRONOGRAMA E ESPECIFICAÇÃO DE PULL REQUESTS (PLANO DE PRS)
**Segunda Auditoria Técnica Independente — Open TMS**  
**Data:** 10 de Novembro de 2026  
**Commit Base:** `ed831c2b9f77721cc5c9d87c49f9aa3bde8124a0`  
**Estratégia:** Execução sequencial, granular e incremental, minimizando riscos de regressão.

---

## 1. VISÃO GERAL DO ROTEIRO DE PRS

O plano é composto por **8 Pull Requests estruturados**, divididos em 4 fases lógicas:
1. **Fase I: Estabilização Perimetral e Dependências (PRs 01, 02 e 03)**
2. **Fase II: Modernização de Identidade e Segurança de Sessão (PRs 04 e 05)**
3. **Fase III: Blindagem Estrutural do Banco de Dados (PR 06)**
4. **Fase IV: Evolução Comercial SaaS e Localização Brasileira (PRs 07 e 08)**

---

## 2. ESPECIFICAÇÃO DETALHADA DOS PULL REQUESTS

### PR 01: Correção Cirúrgica de Dependências e Lockfile Hardening
- **Identificadores Atendidos:** P1-DEP-01
- **Objetivo:** Eliminar todas as 4 vulnerabilidades críticas e 10 de alta severidade auditadas no `npm audit`, sem quebrar Fastify 4 ou Prisma 5.
- **Arquivos Modificados:**
  - `package.json` (raiz do monorepo)
  - `package-lock.json`
- **Alterações:**
  - Inserção de bloco `overrides` para `@fastify/reply-from`, `@fastify/busboy`, `cross-spawn`, `micromatch`, `path-to-regexp` e `undici`.
  - Recálculo determinístico do lockfile com `npm install --package-lock-only`.
- **Migrations de Banco:** Nenhuma.
- **Estratégia de Testes:**
  - Rodar suíte completa de backend (251 suítes, 2.595 testes).
  - Rodar suíte de frontend (8 suítes, 61 testes).
  - Executar `npm audit` e comprovar 0 vulnerabilidades críticas e altas.
- **Nível de Risco:** **Baixo**.
- **Critérios de Aceite:** Build verde e testes 100% aprovados.

---

### PR 02: Blindagem contra SSRF e Cliente Egress Seguro
- **Identificadores Atendidos:** P0-SEC-01
- **Objetivo:** Impedir ataques de Server-Side Request Forgery em webhooks de clientes e skills do sistema, bloqueando acesso a metadados de nuvem e redes privadas.
- **Arquivos Modificados / Criados:**
  - `backend/src/services/security/SafeHttpClient.ts` (Novo)
  - `backend/src/services/webhooks/CustomerWebhookDeliveryService.ts`
  - `backend/src/services/skills/CallWebhookSkill.ts`
  - `backend/src/routes/customerDeveloper.ts`
- **Alterações:**
  - Implementação de resolução DNS preventiva e validação com `ipaddr.js` contra loopback, RFC 1918 e metadados (`169.254.169.254`).
  - Desativação de redirecionamentos automáticos inseguros.
  - Sanitização e truncamento de logs de resposta em `CustomerWebhookDelivery`.
- **Migrations de Banco:** Nenhuma.
- **Estratégia de Testes:**
  - Testes unitários simulando tentativas de cadastro e disparo contra `127.0.0.1`, `169.254.169.254` e `10.0.0.1` (esperado: rejeição com erro descritivo de segurança).
  - Testes com URLs públicas válidas garantindo sucesso na entrega.
- **Nível de Risco:** **Médio**.
- **Critérios de Aceite:** Tentativas de SSRF bloqueadas antes do handshake TCP.

---

### PR 03: Gateway de Ingestão EDI com Autenticação e Idempotência
- **Identificadores Atendidos:** P0-SEC-02
- **Objetivo:** Fechar os endpoints públicos e anônimos de ingestão EDI X12, exigindo credenciais seguras por parceiro comercial.
- **Arquivos Modificados / Criados:**
  - `backend/src/routes/modules/tms.ts`
  - `backend/src/routes/edi214.ts`
  - `backend/src/routes/ediInbound.ts`
  - `backend/src/services/edi/EdiAuthService.ts` (Novo)
  - `backend/prisma/schema.prisma`
- **Alterações:**
  - Adição de hook de autenticação por API-Key (`X-EDI-API-Key`) ou assinatura HMAC (`X-EDI-Signature`) para todas as rotas `/api/v1/tms/edi/*`.
  - Validação de janela de timestamp (máximo 5 minutos).
  - Deduplicação de número de controle ISA13 por parceiro comercial.
- **Migrations de Banco:**
  - Adição de campos `apiKeyHash` e `hmacSecret` na tabela `TradingPartner`.
  - Tabela `EdiIdempotencyKey` para controle de replay.
- **Estratégia de Testes:**
  - Requisição anônima deve responder `401 Unauthorized`.
  - Requisição com credencial inválida deve responder `403 Forbidden`.
  - Requisição com credencial e payload X12 válido deve responder `200 OK` e atualizar o despacho.
  - Reenvio imediato do mesmo payload deve responder `200 OK` idempotente sem duplicar eventos.
- **Nível de Risco:** **Médio**.
- **Critérios de Aceite:** Nenhuma rota EDI acessível sem credenciais autenticadas.

---

### PR 04: Criptografia de Senhas com Argon2id e Sessões com Refresh Token
- **Identificadores Atendidos:** P1-SEC-03, P1-SEC-04, P1-SEC-05
- **Objetivo:** Substituir o HMAC-SHA256 fraco por Argon2id (com migração transparente) e estruturar ciclo de vida de sessão seguro com refresh token rotativo e cookies httpOnly.
- **Arquivos Modificados / Criados:**
  - `backend/src/services/auth/AuthService.ts`
  - `backend/src/services/auth/CustomerAuthService.ts`
  - `backend/src/services/auth/CarrierAuthService.ts`
  - `backend/src/auth/jwt.ts`
  - `backend/src/routes/auth.ts`
  - `backend/prisma/schema.prisma`
  - `frontend/src/features/auth/useAuth.ts`
- **Alterações:**
  - Implementação de `argon2id` com fallback dinâmico para HMAC legado e re-hash automático no login bem-sucedido.
  - Redução do JWT de acesso para 15 minutos.
  - Criação da tabela `RefreshToken` com suporte a revogação e rotação estrita.
  - Emissão do refresh token via cookie seguro `httpOnly`.
  - Endpoint `/logout` com invalidação real de sessão no banco de dados.
- **Migrations de Banco:**
  - Criação da tabela `RefreshToken`.
- **Estratégia de Testes:**
  - Teste de login de usuário com hash antigo (sucesso e atualização do hash no banco para Argon2id).
  - Teste de renovação de token `/auth/refresh` com rotação.
  - Teste de detecção de reuso de refresh token (invalidação de todas as sessões).
  - Teste de logout e tentativa de uso do refresh token revogado (rejeição).
- **Nível de Risco:** **Alto** (toca o mecanismo central de autenticação).
- **Critérios de Aceite:** Senhas armazenadas com Argon2id e sessões revogáveis no servidor.

---

### PR 05: Rate Limiting Global, Headers de Segurança e Sanitização XSS
- **Identificadores Atendidos:** P1-SEC-05, P1-SEC-06
- **Objetivo:** Proteger a API contra força bruta/DoS e eliminar vulnerabilidades de XSS no frontend.
- **Arquivos Modificados:**
  - `backend/src/index.ts`
  - `frontend/src/features/settings/vnext/VNextEmailTemplates.tsx`
  - `frontend/package.json`
- **Alterações:**
  - Registro global de `@fastify/rate-limit` com limites gerais (300/min) e estritos em rotas de login (5/min).
  - Registro de `@fastify/helmet` com Content-Security-Policy (CSP), HSTS e X-Content-Type-Options.
  - Inclusão de `dompurify` no frontend e higienização em `VNextEmailTemplates.tsx`.
- **Migrations de Banco:** Nenhuma.
- **Estratégia de Testes:**
  - Teste de 6 requisições de login consecutivas (esperado: 429 Too Many Requests na 6ª chamada).
  - Teste de injeção de payload XSS (`<script>`, `<img> onerror`) em template de email (comprovar remoção de tags perigosas).
- **Nível de Risco:** **Baixo**.
- **Critérios de Aceite:** Proteção perimetral ativa e frontend imune a injeções em templates.

---

### PR 06: Blindagem Multi-Tenant: PostgreSQL RLS e Chaves Estrangeiras Compostas
- **Identificadores Atendidos:** P0-TEN-01, P0-TEN-02
- **Objetivo:** Estabelecer defesa em profundidade no banco de dados, ativando Row Level Security (RLS) no PostgreSQL e impedindo referências cruzadas entre empresas via chaves compostas.
- **Arquivos Modificados / Criados:**
  - `backend/prisma/schema.prisma`
  - `backend/prisma/migrations/XXXXXXXX_enable_rls_and_composite_fks/migration.sql` (Nova)
  - `backend/src/lib/prismaClientExtension.ts` (Novo)
  - `backend/src/auth/orgScopeMiddleware.ts`
- **Alterações:**
  - Adição de políticas de RLS no PostgreSQL em todas as tabelas com `orgId`.
  - Extensão do Prisma Client para injetar automaticamente `SET LOCAL app.current_org_id` em transações e consultas.
  - Refatoração do schema Prisma com `@@unique([orgId, id])` e chaves estrangeiras compostas `(orgId, childId)`.
  - Remoção do fallback inseguro em `orgScopeMiddleware.ts`.
- **Migrations de Banco:**
  - **Migration estrutural pesada:** criação de índices compostos, alteração de constraints FK e ativação de RLS.
- **Estratégia de Testes:**
  - Tentar inserir manualmente uma linha no banco associando `Shipment(org-A)` a `Customer(org-B)` (esperado: violação de integridade referencial).
  - Consulta direta via Prisma sem cláusula `where: { orgId }` (comprovar que o RLS filtra apenas as linhas da organização da sessão).
- **Nível de Risco:** **Muito Alto** (modificação estrutural na DDL do banco).
- **Critérios de Aceite:** PostgreSQL bloqueia nativamente vazamentos e corrupção cross-tenant.

---

### PR 07: Modelo SaaS Comercial e Associação Flexível de Usuários (Memberships)
- **Identificadores Atendidos:** P1-SAA-01, P1-SAA-02
- **Objetivo:** Desacoplar o usuário de uma organização fixa, permitindo que motoristas e despachantes atuem em múltiplas empresas com o mesmo email, além de criar o modelo de faturamento por assinatura.
- **Arquivos Modificados / Criados:**
  - `backend/prisma/schema.prisma`
  - `backend/src/routes/membership.ts` (Novo)
  - `backend/src/routes/billing.ts` (Novo)
  - `frontend/src/components/OrgSwitcher.tsx` (Novo)
- **Alterações:**
  - Criação da entidade `Membership` associando `User` N:N com `Organization`.
  - Migração de dados de `User.organizationId` existente para registros na tabela `Membership`.
  - Endpoint `POST /api/v1/auth/switch-org` para troca dinâmica de empresa ativa.
  - Modelos `Plan`, `Subscription` e `UsageQuota`.
- **Migrations de Banco:**
  - Criação de `Membership`, `Plan`, `Subscription`, `UsageQuota`.
  - Script de migração de dados de usuários existentes.
- **Estratégia de Testes:**
  - Cadastrar o mesmo email em duas organizações distintas.
  - Alternar o contexto via `switch-org` e comprovar troca imediata de dados visíveis.
- **Nível de Risco:** **Alto**.
- **Critérios de Aceite:** Suporte a multi-organização flexível por usuário e infraestrutura de planos ativa.

---

### PR 08: Fundação da Localização Logística e Fiscal Brasileira
- **Identificadores Atendidos:** P1-BRA-01, P1-BRA-02, P1-BRA-03
- **Objetivo:** Adicionar os fundamentos do ecossistema fiscal e rodoviário brasileiro (CPF, CNPJ, IE, CEP, IBGE, Placas Mercosul, CT-e, MDF-e, RNTRC, CIOT e Vale-Pedágio).
- **Arquivos Modificados / Criados:**
  - `packages/brazil-logistics/` (Novo pacote no monorepo)
  - `backend/prisma/schema.prisma`
  - `backend/src/routes/brazil/` (Novas rotas fiscais e regulatórias)
- **Alterações:**
  - Validadores e formatadores de CPF, CNPJ, Inscrições Estaduais (27 UFs), CEP, IBGE e placas Mercosul.
  - Schemas Prisma para `ElectronicDocument` (CT-e Mod 57 e MDF-e Mod 58), `CertificateA1`, `CiotRecord`, `ValePedagio`.
  - Módulos de comunicação com Web Services da SEFAZ e emissão de DACTE/DAMDFE.
- **Migrations de Banco:**
  - Tabelas de documentos fiscais e cadastros de regulamentação da ANTT.
- **Estratégia de Testes:**
  - Suíte de testes unitários para todos os algoritmos de validação de documentos fiscais e cálculo de DV.
  - Testes de geração e assinatura digital de XML de CT-e em ambiente de homologação SEFAZ.
- **Nível de Risco:** **Médio**.
- **Critérios de Aceite:** Sistema apto a validar cadastros brasileiros e operar o fluxo documental nacional.

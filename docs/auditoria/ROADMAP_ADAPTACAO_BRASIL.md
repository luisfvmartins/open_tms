# ROADMAP DE ADAPTAÇÃO E EVOLUÇÃO — OPEN TMS PARA SAAS BRASILEIRO
**Plano Estratégico e Técnico de Transformação em 12 Etapas Sequenciais**

Data: 10 de Novembro de 2026  
Base Tecnológica: Open TMS 0.1.0  
Público-Alvo: Transportadores Autônomos de Cargas (TACs), Pequenos e Médios Transportadores e Frotistas Brasileiros.

---

## 1. Visão Geral da Estratégia de Transformação

O projeto Open TMS possui uma fundação sólida de domínio (motor de embarques, consolidação de cargas LTL, controle de armazém WMS e triagem automatizada com IA). No entanto, para ser lançado como uma solução comercial viável no Brasil, o projeto precisa passar por uma transformação arquitetural, de segurança e de localização fiscal/regulatória.

Este roadmap estabelece uma sequência lógica dividida em **12 etapas**, onde cada etapa resolve dependências fundamentais para as etapas seguintes, mitigando os riscos mapeados na auditoria técnica.

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    ROADMAP DE EVOLUÇÃO (12 ETAPAS)                              │
├─────────────────────────────────────────────────────────────────────────────────┤
│  FASE I: ESTABILIZAÇÃO & SEGURANÇA (Etapas 1 a 3)                               │
│  1. Correções Críticas de Segurança (SSRF, Hash de Senhas, EDI Inbound)         │
│  2. Blindagem Multi-tenant com PostgreSQL RLS e Composite Keys                  │
│  3. Gestão Moderna de Usuários (Múltiplas Empresas e Sessões Seguras)           │
├─────────────────────────────────────────────────────────────────────────────────┤
│  FASE II: LOCALIZAÇÃO BRASILEIRA DE DADOS & OPERAÇÃO (Etapas 4 a 7)             │
│  4. Cadastros Brasileiros (CPF, CNPJ, CEP, IBGE, Placa Mercosul, RENAVAM)       │
│  5. Adaptação dos Fluxos Operacionais de Transporte Nacional                    │
│  6. Módulo Avançado de Frota e Motoristas (TAC, Agregados, CNH, Manutenção)     │
│  7. Financeiro Nacional (PIX, Boletos, Adiantamentos e Acertos de Viagem)       │
├─────────────────────────────────────────────────────────────────────────────────┤
│  FASE III: COMPLIANCE FISCAL & SAAS COMERCIAL (Etapas 8 a 10)                   │
│  8. Emissão Fiscal de Transporte (CT-e, MDF-e, NF-e, CIOT, Vale-Pedágio)        │
│  9. Painel Administrativo Global do SaaS (Control Plane Multi-empresa)          │
│  10. Gestão de Planos, Assinaturas, Quotas e Cobrança Recorrente                │
├─────────────────────────────────────────────────────────────────────────────────┤
│  FASE IV: EXPERIÊNCIA DE CAMPO & PRONTIDÃO (Etapas 11 a 12)                     │
│  11. Aplicativo do Motorista (PWA / Comprovante Digital de Entrega)             │
│  12. Testes de Carga, Pentest, Conformidade LGPD e Deploy de Produção           │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Detalhamento das Etapas de Desenvolvimento

---

### ETAPA 1: Correções Críticas de Segurança e Estabilidade
*Objetivo:* Eliminar vulnerabilidades severas que colocam em risco a infraestrutura e os dados antes de qualquer expansão do código.

1. **Remediação de SSRF (P0-SEC-01):**
   - Implementar validador de URL com bloqueio estrito de faixas de IP privadas (RFC 1918), loopback (`127.0.0.1`), link-local (`169.254.169.254`) e resolução DNS prévia em `CustomerWebhookDeliveryService` e `CallWebhookSkill`.
   - Limitar o armazenamento de dados de retorno de webhooks a código HTTP e mensagens de erro higienizadas, sem expor respostas brutas na API.
2. **Autenticação em Rotas EDI Inbound (P0-SEC-02):**
   - Adicionar autenticação obrigatória via cabeçalho `x-api-key` ou assinatura HMAC-SHA256 em todas as rotas de ingestão EDI (`ediInbound`, `ediTender`, `edi214`, etc.).
   - Rejeitar com 401 qualquer requisição que não comprove a posse do segredo do parceiro comercial.
3. **Migração do Algoritmo de Hash de Senha (P1-SEC-03):**
   - Substituir o algoritmo inseguro de 1 iteração HMAC-SHA256 por `Argon2id` (ou `bcrypt` com custo 12) em `AuthService`, `CustomerAuthService` e `CarrierAuthService`.
   - Implementar rotina de re-hash automático no momento do login dos usuários legados.
4. **Proteção Contra Força Bruta e Rate Limiting (P1-SEC-06):**
   - Ativar o `@fastify/rate-limit` globalmente na API, com limites estritos nos endpoints de login, recuperação de senha e webhooks.
5. **Higienização de XSS e Sanitização no Frontend (P1-SEC-05):**
   - Integrar `DOMPurify` no frontend para sanitizar o preview HTML em `VNextEmailTemplates.tsx`.
6. **Atualização de Pacotes Críticos (P1-DEP-01):**
   - Atualizar dependências vulneráveis identificadas no `npm audit` (`@fastify/reply-from`, `@fastify/busboy`, `undici`, `zod`).

---

### ETAPA 2: Preparação da Arquitetura Multiempresa (PostgreSQL RLS)
*Objetivo:* Garantir isolamento físico no banco de dados, eliminando o risco de vazamento cruzado por falha na camada de aplicação.

1. **Implementação de Row-Level Security (RLS) no PostgreSQL (P0-TEN-01):**
   - Criar migração SQL habilitando RLS em todas as tabelas operacionais:
     ```sql
     ALTER TABLE "Shipment" ENABLE ROW LEVEL SECURITY;
     ALTER TABLE "Shipment" FORCE ROW LEVEL SECURITY;
     CREATE POLICY tenant_isolation_policy ON "Shipment"
       USING ("orgId" = current_setting('app.current_org_id', true));
     ```
   - Replicar as políticas para `Order`, `Customer`, `Carrier`, `Location`, `Invoice`, `Charge`, `Vehicle`, `Driver`, `Device`, etc.
2. **Extensão do Prisma Client para Contexto de Sessão:**
   - Implementar middleware/extensão no Prisma Client (`$use` ou `$extends`) para executar `SET LOCAL app.current_org_id = ?` no início de cada conexão ou transação baseada no `req.orgId`.
3. **Integridade Referencial Composta (P0-TEN-02):**
   - Criar constraints compostas nas tabelas principais: `UNIQUE (orgId, id)`.
   - Adicionar composite foreign keys nas tabelas dependentes para garantir que uma entidade da Empresa A nunca possa referenciar uma entidade da Empresa B.
4. **Isolamento de Workers e Filas Assíncronas:**
   - Garantir que cada tarefa consumida pelo `pg-boss` configure a variável de sessão RLS antes de processar eventos ou comandos.

---

### ETAPA 3: Gestão de Usuários, Organizações e Permissões
*Objetivo:* Permitir que colaboradores e motoristas atuem em múltiplas empresas com autenticação unificada e sessões seguras.

1. **Desacoplamento de Usuário e Organização (P1-SAA-02):**
   - Criar a entidade associativa `OrganizationMember`:
     ```prisma
     model OrganizationMember {
       id             String       @id @default(uuid())
       userId         String
       organizationId String
       roleId         String
       active         Boolean      @default(true)
       createdAt      DateTime     @default(now())
       user           User         @relation(fields: [userId], references: [id])
       organization   Organization @relation(fields: [organizationId], references: [id])
       role           Role         @relation(fields: [roleId], references: [id])
       @@unique([userId, organizationId])
     }
     ```
   - Permitir que o usuário escolha a empresa ativa ao efetuar login ou selecione o tenant através de um menu de alternância rápida na interface.
2. **Reformulação do Ciclo de Vida da Sessão JWT (P1-SEC-04):**
   - Reduzir o tempo de expiração do Access Token para 15 minutos.
   - Implementar Refresh Tokens de 7 dias com rotação a cada renovação, persistidos na tabela `Session`.
   - Implementar endpoint real de revogação de tokens no logout (`POST /api/v1/auth/logout`) e logout de todos os dispositivos (`logout-all`).
3. **Fluxo Real de Recuperação de Senha (Autosserviço):**
   - Substituir o endpoint stub de `forgot-password` por um fluxo seguro com envio de e-mail contendo token criptográfico de uso único com validade de 30 minutos.

---

### ETAPA 4: Adaptação dos Cadastros Brasileiros
*Objetivo:* Adequar toda a base cadastral para as normas, documentos e padrões geográficos do Brasil.

1. **Documentos de Identificação (Pessoas e Empresas):**
   - Adicionar campos `cpf` e `cnpj` com validação de dígitos verificadores (Módulo 11) e suporte para a nova especificação de CNPJ alfanumérico da Receita Federal.
   - Adicionar campos `stateRegistration` (Inscrição Estadual com validação por UF) e `municipalRegistration` (Inscrição Municipal).
2. **Localidades e Endereçamento Nacional:**
   - Adicionar campos `neighborhood` (Bairro), `ibgeCode` (Código do Município IBGE de 7 dígitos - obrigatório para CT-e/MDF-e) e validação de `postalCode` no formato CEP (`00000-000`).
   - Implementar serviço de autocompletar endereços via integração com API de CEP (ViaCEP ou BrasilAPI).
   - Normalizar a lista de Unidades Federativas (26 Estados + DF) no padrão oficial de siglas (SP, MG, RJ, etc.).
3. **Veículos no Padrão Nacional:**
   - Adicionar validador de Placa Mercosul (`AAA0A00`) e placa cinza legada (`AAA0000`).
   - Adicionar campos `renavam` (11 dígitos com validação), `chassis`, `rntrc`, `vehicleBrand`, `vehicleModel`, `manufactureYear`, `modelYear`.
   - Tipos de Carroceria ANTT: Aberta, Fechada/Baú, Graneleira, Tanque, Sider, Frigorífica, Porta-Contêiner, Prancha.
   - Tipos de Rodado ANTT: Toco, Truck, Cavalo Mecânico, Cavalo Traçado, Bitrem, Rodotrem.

---

### ETAPA 5: Adequação dos Módulos Operacionais
*Objetivo:* Mapear o ciclo operacional do transporte às etapas reais do mercado brasileiro.

1. **Novo Ciclo de Vida do Embarque:**
   - Adaptar o fluxo de status de embarque para cobrir as etapas formais brasileiras:
     `Rascunho` ➔ `Liberado para Coleta` ➔ `Em Coleta` ➔ `Aguardando Emissão Fiscal` ➔ `Emitido (CT-e/MDF-e)` ➔ `Em Trânsito` ➔ `Entregue com Sucesso` ➔ `Encerrado / Liquidado`.
2. **Gestão de Paradas e Rotas Interestaduais:**
   - Adaptar as paradas (`ShipmentStop`) para diferenciar paradas de coleta, entrega, transbordo, fiscalização em postos fiscais de fronteira e descanso obrigatório.
3. **Comprovante Digital de Entrega (Canhoto Digital):**
   - Implementar módulo de captura de comprovante de entrega através de upload de imagem do canhoto físico da nota fiscal ou assinatura digital na tela com registro de latitude/longitude e carimbo de data/hora (atendendo à Portaria SEFAZ sobre canhoto digital).
4. **Gestão de Ocorrências com Padrão OCOREN:**
   - Mapear os tipos de ocorrência (`Issue`) para a tabela de códigos OCOREN adotada pelas transportadoras no Brasil (ex: destinatário ausente, avaria de carga, recusa de mercadoria, extravio, apreensão fiscal).

---

### ETAPA 6: Gestão Avançada de Frota e Motoristas
*Objetivo:* Atender pequenos e médios transportadores, TACs e empresas com frotas terceirizadas.

1. **Desacoplamento de Cavalo e Carreta (Conjuntos Articulados):**
   - Permitir a vinculação dinâmica de um cavalo mecânico a um ou dois semirreboques/reboques independentes por viagem.
2. **Categorização de Motoristas por Vínculo Trabalhista:**
   - Segmentar motoristas em:
     - `TAC - Autônomo` (Transportador Autônomo de Cargas);
     - `Agregado` (veículo próprio prestando serviço fixo);
     - `CLT / Próprio` (funcionário da empresa);
     - `Terceirizado` (fornecido por transportadora subcontratada).
3. **Controle de Documentação e Conformidade do Motorista:**
   - Cadastro completo de CNH (número, categoria C/D/E, data de primeira habilitação e data de validade com alerta de vencimento).
   - Registro de RNTRC individual na ANTT com consulta de validade.
   - Controle de datas de exames toxicológicos periódicos obrigatórios e cursos especializados (MOPP para cargas perigosas, cargas indivisíveis).
4. **Controle Básico de Manutenção e Custos:**
   - Lançamento de ordens de serviço de manutenção (preventiva/corretiva) por veículo.
   - Lançamento de abastecimentos (posto, litros, valor por litro, odômetro) com cálculo automático de consumo médio (km/l).

---

### ETAPA 7: Módulo Financeiro Nacional
*Objetivo:* Adaptar a cobrança, pagamentos e repasses às práticas bancárias e tributárias brasileiras.

1. **Meios de Pagamento Nacionais:**
   - Integração com provedor de serviços de pagamento brasileiro (ex: Asaas, Iugu ou Gerencianet) para emissão de cobranças via **PIX com QR Code dinâmico** e **Boleto Bancário registrado**.
   - Notificação automática de liquidação bancária via webhooks de retorno.
2. **Controle de Adiantamentos de Frete e Acertos de Viagem:**
   - Módulo para emissão de adiantamento de frete (habitual 70% na saída) para o motorista autônomo/terceiro.
   - Fechamento de Acerto de Viagem: cálculo de saldo devedor/credor considerando adiantamentos, diárias, comprovantes de pedágio, abastecimento na rota e descontos por quebras ou avarias.
3. **Retenções Tributárias na Contratação de TAC:**
   - Cálculo automático de deduções obrigatórias sobre o frete do autônomo: INSS (base reduzida de 20%), SEST/SENAT e retenção de IRRF com base na tabela progressiva.

---

### ETAPA 8: Documentação Fiscal e Integrações Regulatórias
*Objetivo:* Permitir a operação legal e fiscal no Brasil com emissão automatizada de documentos fiscais eletrônicos.

1. **Arquitetura de Integração Fiscal:**
   - Adotar um gateway de mensageria fiscal especializado (ex: Nuvem Fiscal, Focus NFe, SpeedGov ou PlugNotas) via API REST para evitar a sobrecarga de gerenciar diretamente servidores SOAP SEFAZ de 27 estados.
2. **Emissão de Conhecimento de Transporte Eletrônico (CT-e):**
   - Geração de CT-e Rodoviário (Modelo 57) a partir dos dados do Embarque (`Shipment`).
   - Cálculo automático dos tributos do transporte: ICMS (normal, isento, diferido, substituição tributária) e ICMS interestadual com partilha (DIFAL), além de PIS/COFINS.
   - Assinatura digital com Certificado Digital A1 da empresa emitente (armazenado com criptografia segura AES-256 no backend).
   - Emissão e arquivamento do arquivo XML autorizado e geração do DACTE em formato PDF.
3. **Emissão de Manifesto Eletrônico de Documentos Fiscais (MDF-e):**
   - Agrupamento de múltiplos CT-es e NF-es em um MDF-e Rodoviário (Modelo 58).
   - Inclusão de dados do veículo de tração, carretas, motoristas cadastrados e rotas de passagem estadual.
   - Eventos de MDF-e: Encerramento do manifesto ao concluir a viagem, inclusão de novo motorista e cancelamento.
   - Geração do DAMDFE em PDF.
4. **Geração de CIOT e Vale-Pedágio Obrigatório:**
   - Integração com Instituição de Pagamento Eletrônico de Frete (IPEF) homologada pela ANTT para geração de CIOT gratuito ou vinculado a cartão de frete.
   - Registro das informações de compra e repasse do Vale-Pedágio Obrigatório vinculado ao MDF-e.

---

### ETAPA 9: Painel Administrativo SaaS (Control Plane Global)
*Objetivo:* Criar o ambiente de gestão operacional e financeira do provedor do SaaS para gerenciar centenas ou milhares de clientes.

1. **Arquitetura do Super-Admin (Fora do Escopo de Tenant):**
   - Criação de credenciais de plataforma e rotas isoladas em `/api/v1/platform-admin/*` com verificação de papel de sistema (`super_admin`).
2. **Gestão de Tenants (Empresas Clientes):**
   - Cadastro, aprovação e ativação de novas empresas clientes.
   - Painel de status operacional: empresas ativas, em período de teste (trial), suspensas por inadimplência ou canceladas.
   - Bloqueio automático de acesso à API e à interface para tenants suspensos.
3. **Visualização de Métricas Globais (Cockpit de Negócio):**
   - Dashboard com volume total de fretes transacionados, receita mensal recorrente (MRR), total de veículos cadastrados e armazenamento utilizado em S3.
4. **Auditoria de Acesso Administrativo e Suporte (Impersonation):**
   - Funcionalidade auditada de "Acessar como cliente" (impersonation temporário) para suporte técnico, com registro compulsório de justificativa e log imutável de todas as ações executadas pelo suporte.

---

### ETAPA 10: Gestão de Planos, Assinaturas e Quotas
*Objetivo:* Viabilizar a monetização automatizada da plataforma SaaS sem limites fixos gravados no código.

1. **Modelagem de Planos Flexíveis e Catálogo de Preços:**
   - Criar entidades no banco de dados para planos e limites:
     ```prisma
     model Plan {
       id          String      @id @default(uuid())
       name        String      // Ex: "Autônomo", "Pequena Transportadora", "Frota Pro"
       description String?
       priceCents  Int         // Valor mensal em centavos de Real (BRL)
       billingCycle String     @default("monthly") // "monthly" | "annual"
       active      Boolean     @default(true)
       limits      PlanLimit[]
       subscriptions Subscription[]
     }

     model PlanLimit {
       id          String   @id @default(uuid())
       planId      String
       resourceKey String   // "max_vehicles", "max_drivers", "max_shipments_month", "storage_mb"
       limitValue  Int      // -1 para ilimitado
       plan        Plan     @relation(fields: [planId], references: [id])
       @@unique([planId, resourceKey])
     }
     ```
2. **Middleware de Aplicação de Limites (Quota Enforcement):**
   - Interceptar rotas de criação de embarques, cadastro de veículos e usuários para verificar o consumo acumulado da organização frente ao teto contratado no plano vigente.
   - Bloquear com mensagem amigável de upgrade quando a empresa atingir o limite contratado.
3. **Cobrança Recorrente Automatizada:**
   - Integração com régua de cobrança automática (cartão de crédito, PIX recorrente e boleto mensal).
   - Tratamento automático de webhooks de inadimplência com envio de alertas graduais e suspensão automática de conta após prazo de tolerância configurado.

---

### ETAPA 11: Aplicação Mobile do Motorista (Driver PWA)
*Objetivo:* Proporcionar uma ferramenta de trabalho leve e funcional para motoristas autônomos e de frota no campo.

1. **PWA Mobile Responsivo e Offline-First:**
   - Interface voltada para smartphones com botões grandes e suporte a modo de alto contraste para uso na cabine do caminhão.
   - Autenticação simplificada por telefone + código SMS/WhatsApp ou magic link com QR Code gerado no embarque.
2. **Jornada de Viagem Passo a Passo:**
   - Visualização da rota, paradas de coleta e entrega com integração para abrir a rota diretamente no Google Maps ou Waze.
3. **Baixa Digital de Entrega:**
   - Abertura da câmera do celular diretamente pelo navegador para fotografar o canhoto assinado ou mercadoria descarregada.
   - Coleta de assinatura digital do recebedor na tela touch do aparelho.
   - Registro automático das coordenadas GPS e horário da entrega, disparando o encerramento do frete e notificação em tempo real para o embarcador.
4. **Reporte Rápido de Ocorrências:**
   - Botão de ocorrência com opções rápidas ("Pneu furado", "Fila na doca", "Recusa de mercadoria", "Acidente") com envio de foto e relato de áudio/texto.

---

### ETAPA 12: Testes de Carga, Pentest, Conformidade LGPD e Deploy de Produção
*Objetivo:* Garantir confiabilidade técnica, proteção de dados pessoais e estabilidade sob alto volume antes do lançamento.

1. **Testes Automatizados de Ponta a Ponta (E2E):**
   - Implementar suíte de testes com Playwright cobrindo os fluxos críticos:
     - Onboarding de empresa ➔ Contratação de plano ➔ Cadastro de veículo/motorista ➔ Criação de embarque ➔ Simulação de entrega.
2. **Testes de Carga e Estresse de Banco de Dados:**
   - Simulação de concorrência com k6 avaliando a saturação de conexões do PostgreSQL e o desempenho das filas do `pg-boss` sob carga simultânea.
3. **Auditoria de Conformidade com a LGPD (Lei Geral de Proteção de Dados):**
   - Anonimização programada de dados de motoristas e usuários após término do prazo legal de guarda trabalhista/fiscal.
   - Termos de consentimento e política de privacidade claras com registro de aceite no primeiro login.
   - Ferramenta para exportação completa de dados e exclusão a pedido do titular (direito do titular LGPD).
4. **Pipeline de CI/CD e Infraestrutura de Produção:**
   - Configuração de esteira GitHub Actions com linter, verificação de segurança, compilação de TypeScript e execução de suíte de testes.
   - Deploy conteinerizado via Docker Compose gerenciado em nuvem (AWS ECS, Google Cloud Run ou cluster Kubernetes gerenciado) com banco de dados PostgreSQL gerenciado (ex: RDS / Cloud SQL) com backups contínuos automatizados.

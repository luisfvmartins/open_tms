# PLANO ARQUITETURAL DE CORREÇÃO E EVOLUÇÃO TÉCNICA
**Projeto Open TMS — Preparação para TMS SaaS Comercial Brasileiro**  
**Data:** 10 de Novembro de 2026  
**Commit de Referência:** `ed831c2b9f77721cc5c9d87c49f9aa3bde8124a0`

---

## 1. DIRETRIZES ESTRATÉGICAS E PREMISSAS ARQUITETURAIS

O objetivo deste plano é transformar o Open TMS em uma plataforma de transporte comercial segura, robusta e compatível com as exigências fiscais e regulatórias do Brasil.

### Princípios Fundamentais:
1. **Preservação do Stack Tecnológico Original:**
   - Não reescrever o sistema em outros frameworks (manter **Fastify 4**, **Prisma ORM 5**, **PostgreSQL 16**, **pg-boss**, **React 18** e **Vite 5**).
   - O ecossistema atual é altamente moderno, performático e tipado de ponta a ponta em TypeScript.
2. **Defesa em Profundidade (Defense-in-Depth):**
   - A segurança não deve depender exclusivamente de verificações na camada de aplicação.
   - O isolamento multiempresa e a integridade referencial devem ser garantidos nativamente pelo banco de dados (PostgreSQL RLS e Foreign Keys compostas).
3. **Compatibilidade Transparente e Sem Rupturas:**
   - As atualizações de segurança (como migração de hash de senha de HMAC para Argon2id) devem operar de forma transparente, sem forçar reset de senhas.
4. **Arquitetura Modular e Plugável:**
   - Isolar as especificidades brasileiras (SEFAZ, CT-e, MDF-e, ANTT, CIOT) em um módulo especializado (`packages/brazil-logistics`), evitando poluir o núcleo transacional compartilhado do TMS.

---

## 2. CAMADA 1: BLINDAGEM MULTI-TENANT NO BANCO DE DADOS (POSTGRESQL & PRISMA)

Para solucionar em definitivo **P0-TEN-01** e **P0-TEN-02**, implementaremos o padrão de isolamento em profundidade.

### 2.1. Ativação de Row Level Security (RLS) no PostgreSQL
Criar uma migration estrutural que habilita RLS em todas as tabelas operacionais do schema (`Shipment`, `Customer`, `Invoice`, `Driver`, `Equipment`, `Carrier`, `Location`, etc.):

```sql
-- Exemplo de migration para a tabela Shipment
ALTER TABLE "Shipment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Shipment" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_policy ON "Shipment"
  FOR ALL
  USING (
    "orgId" = NULLIF(current_setting('app.current_org_id', true), '')
  )
  WITH CHECK (
    "orgId" = NULLIF(current_setting('app.current_org_id', true), '')
  );
```

### 2.2. Injeção Automática de Contexto via Prisma Client Extension
Para que o desenvolvedor não precise gerenciar comandos SQL manuais, estendemos o cliente Prisma (`prismaClientExtension.ts`):

```typescript
export const extendedPrisma = prisma.$extends({
  query: {
    $allModels: {
      async $allOperations({ args, query, model }) {
        const orgId = getRequestContextOrgId();
        if (orgId) {
          // Garante a injeção da variável de sessão transacional no PostgreSQL
          return prisma.$transaction(async (tx) => {
            await tx.$executeRawUnsafe(
              `SET LOCAL app.current_org_id = '${orgId.replace(/'/g, "''")}';`
            );
            return query(args);
          });
        }
        return query(args);
      },
    },
  },
});
```

### 2.3. Chaves Estrangeiras Compostas `(orgId, id)`
Refatorar o `schema.prisma` para incluir constraints de unicidade compostas e relacionamentos compostos:

```prisma
model Customer {
  id        String     @id @default(uuid())
  orgId     String
  name      String
  shipments Shipment[]

  @@unique([orgId, id])
}

model Shipment {
  id         String   @id @default(uuid())
  orgId      String
  customerId String
  customer   Customer @relation(fields: [orgId, customerId], references: [orgId, id], onDelete: Restrict)

  @@index([orgId, customerId])
}
```

---

## 3. CAMADA 2: EGRESS SEGURO E MITIGAÇÃO DE SSRF (P0-SEC-01)

Substituir o uso de `fetch` indiscriminado pelo serviço corporativo `SafeHttpClient` (`backend/src/services/security/SafeHttpClient.ts`).

### 3.1. Arquitetura do `SafeHttpClient`:
1. **Resolução de DNS Preventiva:** Resolve o hostname via `dns.promises.lookup(host, { all: true })`.
2. **Filtragem Rígida de IP (`ipaddr.js`):**
   - Valida cada IP retornado.
   - Bloqueia: Loopback (`127.0.0.0/8`, `::1`), IPs Privados (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), Link-Local (`169.254.0.0/16`, `fe80::/10`), Multicast e CGNAT (`100.64.0.0/10`).
   - Bloqueio explícito dos IPs e domínios de metadados de nuvem (`169.254.169.254`, `metadata.google.internal`).
3. **Anti-DNS Rebinding (Pinning):** O handshake TCP é disparado diretamente contra o IP validado, preservando o header `Host: original.domain`.
4. **Controle Manual de Redirecionamento:** O cliente define `redirect: 'manual'`. Se receber status 301/302, inspeciona a URL do cabeçalho `Location` e reinicia todo o ciclo de validação de IP antes de prosseguir.
5. **Sanitização de Respostas Salvas:** O campo `responseBody` da tabela `CustomerWebhookDelivery` não armazenará corpos de erro detalhados de hosts desconhecidos, limitando-se a registrar headers sanitizados e status HTTP.

---

## 4. CAMADA 3: GATEWAY DE INGESTÃO EDI SEGURO (P0-SEC-02)

Estruturar um pipeline seguro de recebimento de EDI ANSI X12 em `backend/src/services/edi/EdiInboundGateway.ts`.

### 4.1. Mecanismo de Autenticação Dupla
Toda requisição para `/api/v1/tms/edi/*` deverá obrigatoriamente fornecer:
- **Opção A (API Key):** Cabeçalho `X-EDI-API-Key: <token>`, validado contra hash seguro na tabela `TradingPartner`.
- **Opção B (HMAC-SHA256):** Cabeçalho `X-EDI-Signature: t=<timestamp>,v1=<hash>` calculado com o segredo do parceiro.

### 4.2. Proteção contra Replay e Idempotência
1. Rejeitar requisições cujo `timestamp` difira em mais de 300 segundos do horário do servidor.
2. Extrair o par `(TradingPartnerId, ISA13)` do envelope X12.
3. Se o número de controle de intercâmbio (`ISA13`) já tiver sido processado nas últimas 48 horas, o gateway responde com ACK/200 sem reprocessar o despacho.

---

## 5. CAMADA 4: MODERNIZAÇÃO CRIPTOGRÁFICA E SESSÕES (P1-SEC-03 a P1-SEC-05)

### 5.1. Migração para Argon2id (P1-SEC-03)
- Adicionar o pacote `argon2` ao backend.
- Modificar `AuthService.ts`, `CustomerAuthService.ts` e `CarrierAuthService.ts`:
  - Parâmetros padrão: Argon2id, Memory Cost = 65.536 KB (64 MB), Time Cost = 3 iterações, Paralelismo = 4.
  - Implementar verificação inteligente com fallback para HMAC-SHA256 legado e re-hash automático ao autenticar.

### 5.2. Ciclo de Vida de Sessões (P1-SEC-04 e P1-SEC-05)
1. **Access Token (JWT):** Validade reduzida de 12 horas para **15 minutos**.
2. **Refresh Token Seguro:**
   - Token opaco criptograficamente aleatório (32 bytes).
   - Gravado com hash na nova tabela `RefreshToken`:
     ```prisma
     model RefreshToken {
       id        String   @id @default(uuid())
       userId    String
       tokenHash String   @unique
       expiresAt DateTime
       revokedAt DateTime?
       ipAddress String?
       userAgent String?
       user      User     @relation(fields: [userId], references: [id])
     }
     ```
   - Rotação estrita: cada uso invalida o refresh token atual e gera um novo par.
   - Entregue via cookie `Set-Cookie: refresh_token=...; HttpOnly; Secure; SameSite=Lax; Path=/api/v1/auth/refresh`.
3. **Logout Real:** Revoga imediatamente o refresh token no banco de dados.

### 5.3. Higienização Frontend contra XSS (P1-SEC-05)
- Adicionar `dompurify` e `@types/dompurify` no frontend.
- Substituir qualquer interpolação insegura de HTML em `VNextEmailTemplates.tsx` por wrappers sanitizados.

---

## 6. CAMADA 5: RATE LIMITING E PROTEÇÃO PERIMETRAL (P1-SEC-06)

Registrar `@fastify/rate-limit` globalmente em `backend/src/index.ts`:

```typescript
await fastify.register(rateLimit, {
  global: true,
  max: 300,
  timeWindow: '1 minute',
  keyGenerator: (req) => req.headers['x-forwarded-for'] || req.ip,
  errorResponseBuilder: (req, context) => ({
    statusCode: 429,
    error: 'Too Many Requests',
    message: `Rate limit exceeded. Try again in ${context.after}`,
  }),
});
```

Configurar limites específicos para rotas sensíveis:
- `/api/v1/auth/login`: 5 req/min por IP.
- `/api/v1/tms/edi/*`: 60 req/min por parceiro.

---

## 7. CAMADA 6: MODELO SAAS COMERCIAL E MULTIEMPRESA (P1-SAA-01 e P1-SAA-02)

### 7.1. Desacoplamento de Usuário e Organização (`Membership`)
Refatorar o modelo de identidade para permitir que um profissional (motorista, despachante, contador) pertença a múltiplas transportadoras com o mesmo email:

```prisma
model User {
  id          String       @id @default(uuid())
  email       String       @unique
  name        String
  phone       String?
  memberships Membership[]
}

model Membership {
  id             String       @id @default(uuid())
  userId         String
  organizationId String
  role           String       // OWNER, ADMIN, DISPATCHER, DRIVER, ACCOUNTANT
  status         String       // ACTIVE, SUSPENDED, INVITED
  user           User         @relation(fields: [userId], references: [id])
  organization   Organization @relation(fields: [organizationId], references: [id])

  @@unique([userId, organizationId])
}
```

### 7.2. Faturamento e Quotas de Consumo
Criar as entidades comerciais:
- `Plan`: Nome, valor mensal, limites (veículos ativos, CT-es emitidos, usuários, módulos inclusos).
- `Subscription`: Status (TRIAL, ACTIVE, PAST_DUE, CANCELED), datas de renovação, ID do cliente no gateway.
- Gateway de Pagamentos: Integração com provedor nacional (Asaas ou Pagar.me) suportando **PIX** e Boleto bancário.

---

## 8. CAMADA 7: LOCALIZAÇÃO FISCAL E REGULATÓRIA BRASILEIRA (P1-BRA-01 a P1-BRA-03)

Criar o pacote de domínio `packages/brazil-logistics` encapsulando toda a inteligência nacional:

### 8.1. Validações Cadastrais (`BrazilValidator`)
- Validação e máscara de CPF e CNPJ com conferência algorítmica de dígitos verificadores (módulo 11).
- Validação de Inscrições Estaduais para as 27 UFs do Brasil.
- Consulta de CEP integrada com cache local em PostgreSQL e fallback ViaCEP.
- Base de municípios e códigos de 7 dígitos do IBGE.
- Validação de placas automotivas: padrão clássico (`ABC-1234`) e Mercosul (`ABC1D23`).

### 8.2. Módulo de Documentos Fiscais Eletrônicos (CT-e / MDF-e)
- **Gerenciador de Certificados Digitais:** Armazenamento seguro e encriptado de certificados digitais e-CNPJ A1 (arquivos `.pfx`) por organização.
- **Gerador de XML e Assinatura Digital:** Criação e assinatura digital de XMLs conforme os manuais do MOC da SEFAZ utilizando `xml-crypto`.
- **Transmissor SEFAZ:** Comunicação SOAP com web services da SEFAZ, com tratamento automático de contingência (SVC-AN / SVC-RS).
- **Geração de DACTE e DAMDFE:** Emissão de PDFs com código de barras padrão 128C para acompanhamento das cargas.

### 8.3. Módulo Regulatório ANTT
- Gestão e validação do registro RNTRC da transportadora e do motorista autônomo (TAC).
- Emissão e vinculação do CIOT (Resolução ANTT nº 5.862/2019) integrado com Instituição de Pagamento Eletrônico de Frete (IPEF).
- Controle e comprovação de fornecimento de Vale-Pedágio Obrigatório (Lei nº 10.209/2001).
- Tabela de verificação do Piso Mínimo de Frete da ANTT.

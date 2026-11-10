# ANÁLISE FORENSE APROFUNDADA DOS 4 ACHADOS P0 (CRÍTICOS)
**Segunda Auditoria Técnica Independente — Open TMS**  
**Data:** 10 de Novembro de 2026  
**Commit Analisado:** `ed831c2b9f77721cc5c9d87c49f9aa3bde8124a0`  
**Escopo:** P0-SEC-01, P0-SEC-02, P0-TEN-01 e P0-TEN-02

---

## 1. INTRODUÇÃO

Os quatro achados classificados como **P0** representam vulnerabilidades críticas e riscos estruturais capazes de:
1. Comprometer a infraestrutura de rede e os metadados do provedor de nuvem (SSRF);
2. Permitir alteração fraudulenta de dados operacionais de transporte por agentes anônimos na internet (EDI sem autenticação);
3. Provocar vazamento massivo de dados comerciais e fiscais entre empresas concorrentes (Ausência de RLS);
4. Corromper a integridade referencial relacional entre tenants no banco de dados (Ausência de chaves compostas).

A seguir, apresentamos a investigação forense detalhada de cada um, com rastreamento de código, mecanismos de falha e especificações defensivas.

---

## 2. [P0-SEC-01] SSRF (SERVER-SIDE REQUEST FORGERY) EM WEBHOOKS E SKILLS

### 2.1. Arquivos Envolvidos e Rastreamento de Código
- `backend/src/services/webhooks/CustomerWebhookDeliveryService.ts` (linhas 75–98)
- `backend/src/services/skills/CallWebhookSkill.ts` (linhas 38–54)
- `backend/src/routes/customerDeveloper.ts` (linhas 148–170)

#### Trecho Crítico 1: `CustomerWebhookDeliveryService.ts`
```typescript
// backend/src/services/webhooks/CustomerWebhookDeliveryService.ts
export class CustomerWebhookDeliveryService {
  async deliver(webhook: CustomerWebhook, event: string, payload: any): Promise<void> {
    const deliveryPayload = {
      event,
      timestamp: new Date().toISOString(),
      data: payload,
    };
    const signature = this.generateSignature(webhook.secret, deliveryPayload);
    const start = Date.now();

    try {
      const res = await fetch(webhook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-TMS-Signature': signature,
          'X-TMS-Event': event,
        },
        body: JSON.stringify(deliveryPayload),
        signal: AbortSignal.timeout(10000), // apenas timeout de 10s
      });

      const responseBody = await res.text().catch(() => '');
      const durationMs = Date.now() - start;

      await this.prisma.customerWebhookDelivery.create({
        data: {
          webhookId: webhook.id,
          event,
          payload: deliveryPayload as any,
          statusCode: res.status,
          responseBody: responseBody.slice(0, 4000), // <-- VETOR DE EXFILTRAÇÃO
          durationMs,
          success: res.ok,
        },
      });
    } catch (err: any) { ... }
  }
}
```

#### Trecho Crítico 2: `CallWebhookSkill.ts`
```typescript
// backend/src/services/skills/CallWebhookSkill.ts
export class CallWebhookSkill {
  async execute(params: { url: string; method?: string; body?: any; headers?: any }) {
    const { url, method = 'POST', body, headers = {} } = params;
    const response = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    return { status: response.status, data: text };
  }
}
```

#### Trecho Crítico 3: Exfiltração via API em `customerDeveloper.ts`
```typescript
// backend/src/routes/customerDeveloper.ts:158
fastify.get('/webhooks/:id/deliveries', async (req, reply) => {
  const deliveries = await prisma.customerWebhookDelivery.findMany({
    where: { webhookId: req.params.id },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });
  return { data: deliveries }; // Retorna responseBody (4000 caracteres) ao usuário!
});
```

### 2.2. Avaliação dos 13 Vetores de Investigação Técnica

| Critério de Auditoria | Situação no Código | Avaliação Técnica |
|---|---|---|
| **1. Controle da URL pelo usuário** | Sim, 100% controlada no cadastro de webhook (`POST /developer/webhooks`). | Permite inserção de qualquer string URI. |
| **2. Validação de protocolo** | O schema Zod valida apenas `z.string().url()`. | Aceita `http://` e `https://`. Não há restrição para portas não-padrão (ex: `:5432`, `:6379`, `:8080`). |
| **3. Bloqueio de IPs privados (RFC 1918)** | **Inexistente.** Não há verificação para `10.0.0.0/8`, `172.16.0.0/12` ou `192.168.0.0/16`. | Permite varredura de portas na rede interna da VPC. |
| **4. Bloqueio de Loopback** | **Inexistente.** Não há checagem de `127.0.0.1` ou `localhost`. | Permite conectar aos serviços locais (PostgreSQL, Redis, pg-boss). |
| **5. Bloqueio de Link-Local (RFC 3927)** | **Inexistente.** Permite requisições para `169.254.169.254`. | **Risco Crítico:** Acesso ao endpoint de metadados da AWS/GCP/Azure (extração de credenciais de IAM / Service Account tokens). |
| **6. Tratamento de IPv6** | **Inexistente.** | Não bloqueia `::1` nem representações IPv4-mapped IPv6 (`::ffff:127.0.0.1`). |
| **7. Resolução de DNS preventiva** | **Inexistente.** | O Node `fetch` resolve o DNS em tempo de conexão direta via `undici`. |
| **8. Proteção contra DNS Rebinding** | **Inexistente.** | Atacante pode registrar domínio público com TTL=0 que resolve primeiro para IP público e depois para `127.0.0.1`. |
| **9. Comportamento com Redirecionamentos HTTP** | O `fetch` nativo do Node.js segue redirecionamentos 301/302/307/308 por padrão (`redirect: 'follow'`). | Mesmo que a URL inicial pareça pública, o servidor remoto pode redirecionar para `http://169.254.169.254`. |
| **10. Acesso a redes internas via redirect** | Sim, irrestrito. | Redirecionamento HTTP burla qualquer validação puramente baseada na URL inicial. |
| **11. Armazenamento da resposta** | Sim. O corpo da resposta é capturado em `responseBody.slice(0, 4000)` e gravado no banco. | Transforma o SSRF de "Blind" para "Full In-Band/Reflective SSRF". |
| **12. Recuperação da resposta via API** | Sim. O endpoint `GET /webhooks/:id/deliveries` retorna o histórico completo com `responseBody`. | O atacante lê diretamente na tela do portal as credenciais de IAM ou respostas de APIs internas. |
| **13. Controles de rede existentes** | Nenhum proxy de saída ou agente de rede restritivo configurado no runtime Node.js. | A aplicação executa requisições de egress com privilégios idênticos ao processo da API. |

### 2.3. Cenário Teórico de Exploração e Impacto
1. **Atacante:** Um cliente do portal (`Customer Portal`) com permissão de desenvolvedor (permissão padrão para configurar integrações de webhook).
2. **Ação:** Cadastra o webhook `http://169.254.169.254/computeMetadata/v1/instance/service-accounts/default/token` (no GCP com header `Metadata-Flavor: Google`) ou `http://169.254.169.254/latest/meta-data/iam/security-credentials/` (na AWS).
3. **Disparo:** O atacante dispara um evento de teste de webhook via `POST /webhooks/:id/test`.
4. **Captura:** O worker ou serviço faz o `fetch()`, recebe o token OAuth2 da infraestrutura do servidor, salva na tabela `CustomerWebhookDelivery` e retorna no endpoint de listagem de entregas.
5. **Impacto:** Comprometimento total da conta de nuvem do provedor do SaaS, roubo de dados de todos os clientes e movimentação lateral na VPC.

### 2.4. Especificação de Remediação Defensiva (SSRF Safe Egress Client)
Para sanar completamente a falha sem depender da infraestrutura externa de rede, deve ser implementado um cliente seguro de egress (`SafeHttpClient`):
1. **DNS Resolution Prévia:** Resolver o nome do host usando `dns.promises.lookup()` com `all: true`.
2. **Validação de IP com `ipaddr.js`:**
   - Rejeitar se qualquer IP retornado for privado, link-local, multicast, loopback, ou reservado (`range() !== 'unicast'`).
   - Rejeitar ranges específicos: `0.0.0.0/8`, `10.0.0.0/8`, `100.64.0.0/10`, `127.0.0.0/8`, `169.254.0.0/16`, `172.16.0.0/12`, `192.0.0.0/24`, `192.0.2.0/24`, `192.88.99.0/24`, `192.168.0.0/16`, `198.18.0.0/15`, `198.51.100.0/24`, `203.0.113.0/24`, `224.0.0.0/4`, `240.0.0.0/4`, `255.255.255.255/32`, `::1`, `fe80::/10`, `fc00::/7`.
3. **Pinning de Conexão IP:** Realizar a conexão HTTP diretamente contra o endereço IP validado, mantendo o cabeçalho `Host` original, impedindo DNS Rebinding (TOCTOU).
4. **Desativação de Redirecionamentos Automáticos:** Definir `redirect: 'manual'` ou `redirect: 'error'`. Se redirects forem necessários, cada URL do cabeçalho `Location` deve passar pelo mesmo ciclo rigoroso de validação de IP antes do novo salto.
5. **Sanitização de Log de Resposta:** Nunca salvar o corpo de respostas de erro ou sucesso que contenham headers ou dados confidenciais; registrar apenas status HTTP, tempo de resposta e hash do conteúdo entregue.

---

## 3. [P0-SEC-02] ENDPOINTS EDI SEM AUTENTICAÇÃO

### 3.1. Arquivos Envolvidos e Rastreamento de Código
- `backend/src/routes/modules/tms.ts` (linhas 80–90)
- `backend/src/routes/edi214.ts` (linhas 40–75)
- `backend/src/routes/ediInbound.ts` (linhas 50–95)

#### Trecho Crítico 1: Registro Exposto em `backend/src/routes/modules/tms.ts`
```typescript
// backend/src/routes/modules/tms.ts:82
// Register EDI ingestion routes (separate from standard API authentication)
// TODO: add proper API key / HMAC auth
await fastify.register(edi214Routes, { prefix: `${prefix}/edi/214` });
await fastify.register(ediInboundRoutes, { prefix: `${prefix}/edi` });
```

#### Trecho Crítico 2: Endpoint sem Guarda em `backend/src/routes/edi214.ts`
```typescript
// backend/src/routes/edi214.ts:45
fastify.post('/inbound', async (req, reply) => {
  const { rawEdi, partnerId } = req.body as any;
  if (!rawEdi) {
    return reply.status(400).send({ error: 'Missing rawEdi' });
  }

  // Parse direto do arquivo ANSI X12 sem checagem de identidade do emissor:
  const parsed = await edi214Service.parse(rawEdi);
  
  // Atualização em banco de dados:
  await shipmentService.updateStatus(parsed.shipmentId, parsed.statusCode, {
    location: parsed.location,
    timestamp: parsed.timestamp,
    reason: parsed.statusReason,
  });

  return reply.status(200).send({ success: true, processedShipmentId: parsed.shipmentId });
});
```

### 3.2. Avaliação dos Critérios de Auditoria

| Critério de Auditoria | Situação no Código | Avaliação Técnica |
|---|---|---|
| **1. Herança de autenticação** | **Nenhuma.** O arquivo `tms.ts` registra essas rotas antes do hook de JWT ou em bloco separado. | Rota completamente aberta na internet. |
| **2. Middleware global** | O hook de JWT global é ignorado para rotas que iniciam com `/edi` ou declaradas fora do escopo protegido. | Não há checagem de cabeçalho `Authorization`. |
| **3. Autenticação por parceiro** | Inexistente. O `partnerId` vem no corpo da requisição (JSON) ou no cabeçalho ISA do X12 sem validação de credencial. | Qualquer emissor pode fingir ser qualquer parceiro comercial. |
| **4. Presença de API Key** | Inexistente. | Sem chaves fixas ou rotativas. |
| **5. Assinatura HMAC** | Inexistente (apesar do comentário `TODO: add proper API key / HMAC auth`). | Não há verificação de integridade ou autenticidade do payload. |
| **6. Validação de timestamp** | Inexistente. | O sistema aceita mensagens com datas retroativas ou futuras sem validação de janela temporal. |
| **7. Proteção contra Replay** | Inexistente. | O mesmo payload X12 pode ser reenviado 1.000 vezes, gerando eventos duplicados no histórico da carga. |
| **8. Verificação de idempotência** | Inexistente. Cada POST reprocessa o status da carga. | Risco de sobrescrita e inconsistência de estados operacionais. |
| **9. Manipulação de `partnerId`** | O parâmetro é puramente informativo; se for alterado, o parser ainda assim localiza o `shipmentId` dentro do X12 e altera o despacho. | Permite que uma entidade não autorizada altere cargas de qualquer embarcador. |
| **10. Alteração de dados operacionais** | Confirmada. Altera diretamente o campo `status` da tabela `Shipment` e gera registros de histórico. | Permite fraudes em SLAs, multas contratuais e falsas confirmações de entrega. |

### 3.3. Impacto Operacional
- **Sabotagem Operacional:** Um concorrente ou agente malicioso pode varrer IDs de carga ou utilizar padrões de numeração e enviar mensagens EDI 214 falsas marcando cargas em trânsito como `DELIVERED` ou `EXCEPTION: DAMAGED`.
- **Prejuízo Financeiro:** A confirmação indevida de entrega aciona gatilhos de faturamento e liberação de pagamento a terceiros no TMS.

### 3.4. Especificação de Remediação Defensiva (EDI Inbound Gateway)
1. **Autenticação Obrigatória:** Nenhuma rota EDI deve aceitar dados sem credenciais válidas.
2. **Dupla Modalidade de Autenticação Suportada:**
   - **API Key Segura por Parceiro:** Cabeçalho `X-EDI-API-Key: <hashed-key>`, vinculada especificamente ao `TradingPartner` e à `Organization` dele.
   - **Assinatura HMAC-SHA256:** Cabeçalho `X-EDI-Signature: t=<timestamp>,v1=<hmac>`, calculado sobre o payload bruto da mensagem com a chave secreta compartilhada do parceiro cadastrado.
3. **Janela de Tolerância de Timestamp:** Rejeitar requisições onde o timestamp difira em mais de 300 segundos (5 minutos) do relógio do servidor, prevenindo ataques de replay.
4. **Idempotency Key & Deduplicação de Controle ISA:**
   - Armazenar o número de controle de intercâmbio do X12 (`ISA13`) associado ao parceiro (`ISA06`).
   - Se um par `(partnerId, ISA13)` for reenviado, responder com status 200/ACK idempotente sem reprocessar a carga.

---

## 4. [P0-TEN-01] ISOLAMENTO MULTIEMPRESA E AUSÊNCIA DE RLS NO POSTGRESQL

### 4.1. Arquivos Envolvidos e Rastreamento de Código
- `backend/src/auth/orgScopeMiddleware.ts` (linhas 15–50)
- `backend/prisma/schema.prisma`
- `backend/prisma/migrations/20260216000000_wms_outbox_rls/migration.sql`

#### Trecho Crítico em `orgScopeMiddleware.ts`
```typescript
// backend/src/auth/orgScopeMiddleware.ts:25
export async function attachOrgScopeHook(req: FastifyRequest, reply: FastifyReply) {
  const orgHeader = req.headers['x-organization-id'] as string;
  
  if (orgHeader) {
    // Valida se o usuário autenticado pertence a essa organização:
    if (req.user && req.user.organizationId !== orgHeader) {
      return reply.status(403).send({ error: 'Forbidden: Invalid organization context' });
    }
    req.orgId = orgHeader;
    return;
  }

  // FALLBACK PERIGOSO:
  if (req.user?.organizationId) {
    req.orgId = req.user.organizationId;
    return;
  }

  // FALLBACK CRÍTICO PARA AMBIENTES COM UMA ORGANIZAÇÃO:
  const singleOrg = await prisma.organization.findFirst();
  if (singleOrg) {
    req.orgId = singleOrg.id; // Assume automaticamente a primeira organização existente!
  }
}
```

### 4.2. Avaliação dos Critérios de Auditoria

| Critério de Auditoria | Situação no Código | Avaliação Técnica |
|---|---|---|
| **1. Identificação da organização** | Realizada via cabeçalho HTTP `x-organization-id` ou claim do token JWT. | Adequada no fluxo normal autenticado. |
| **2. Confiabilidade do `orgId`** | O middleware valida se `req.user.organizationId === orgHeader`. | Seguro quando o usuário está autenticado, mas com falha no fallback anônimo/single-org. |
| **3. Manipulação do identificador** | Um usuário comum não consegue forçar o `orgHeader` de outro tenant devido à validação contra `req.user.organizationId`. | Protegido na camada de aplicação para o usuário comum. |
| **4. Filtragem nas rotas operacionais** | O código depende integralmente de `prisma.<entity>.findMany({ where: { orgId: req.orgId } })`. | **Vulnerabilidade Arquitetural:** Ausência de garantia automática. Se um novo endpoint omitir o `where: { orgId }`, ocorre vazamento total. |
| **5. Consultas Prisma sem escopo** | O script `lint:tenancy` verifica a maioria dos repositórios, mas em sub-relações e joins aninhados existem brechas potenciais. | Risco de vazamento em queries complexas. |
| **6. Consultas SQL Raw (`$queryRaw`)** | Existem chamadas `$queryRaw` em relatórios e no EventStore. Nenhuma delas possui RLS ativado. | O PostgreSQL entrega dados de todos os tenants se a query raw não incluir cláusula `WHERE org_id = ...`. |
| **7. Workers e Filas Assíncronas** | O `pg-boss` armazena jobs na tabela `job`. O payload do job precisa carregar explicitamente o `orgId`. Se o worker esquecer de repassar o contexto, ele executa tarefas sem escopo. | Risco de processamento cruzado em background. |
| **8. Isolamento no PostgreSQL (RLS)** | **Inexistente** para as tabelas principais do TMS. Só existe na tabela de outbox do WMS .NET. | Falta de defesa em profundidade. |

### 4.3. Por que o Isolamento Atual é Inadequado para um SaaS Comercial
No modelo atual, a segurança do banco de dados depende **100% da ausência de bugs no código TypeScript**:
- Um único estagiário ou desenvolvedor que escrever `prisma.shipment.findUnique({ where: { id } })` sem incluir `orgId` criará uma vulnerabilidade IDOR (Insecure Direct Object Reference), permitindo que um concorrente visualize ou altere cargas de outra transportadora.
- A aplicação conecta ao PostgreSQL utilizando um usuário de banco superprivilegiado (usuário `postgres` ou `open_tms_owner`), que tem acesso irrestrito a todas as linhas de todas as tabelas.

### 4.4. Especificação de Remediação Defensiva (PostgreSQL RLS com Prisma)
Para transformar o PostgreSQL em um guardião inviolável multi-tenant, deve-se adotar o padrão de **Defesa em Profundidade**:
1. **Ativação de RLS em Todas as Tabelas de Negócio:**
   ```sql
   ALTER TABLE "Shipment" ENABLE ROW LEVEL SECURITY;
   ALTER TABLE "Customer" ENABLE ROW LEVEL SECURITY;
   ALTER TABLE "Invoice" ENABLE ROW LEVEL SECURITY;
   ALTER TABLE "Driver" ENABLE ROW LEVEL SECURITY;
   ALTER TABLE "Equipment" ENABLE ROW LEVEL SECURITY;

   CREATE POLICY tenant_isolation_policy ON "Shipment"
     FOR ALL
     USING ("orgId" = current_setting('app.current_org_id', true)::text);
   ```
2. **Prisma Client Extension para Injeção Automática de Sessão:**
   Criar uma extensão do Prisma (`prisma.$extends`) que, em toda transação ou query interativa, executa automaticamente:
   ```typescript
   await prisma.$executeRawUnsafe(
     `SET LOCAL app.current_org_id = '${currentOrgId}'`
   );
   ```
   Dessa forma, mesmo que um desenvolvedor esqueça o `where: { orgId }`, o próprio motor do PostgreSQL filtrará os dados de forma transparente, tornando vazamentos fisicamente impossíveis no banco de dados.

---

## 5. [P0-TEN-02] AUSÊNCIA DE FOREIGN KEYS COMPOSTAS `(orgId, id)` NO SCHEMA

### 5.1. Arquivos Envolvidos e Análise Estrutural
- `backend/prisma/schema.prisma`

#### Exemplo de Definição Atual no Schema:
```prisma
model Customer {
  id        String     @id @default(uuid())
  orgId     String
  name      String
  shipments Shipment[]
  // Não possui restrição @@unique([orgId, id])
}

model Shipment {
  id         String   @id @default(uuid())
  orgId      String
  customerId String
  customer   Customer @relation(fields: [customerId], references: [id])
  // A chave estrangeira valida apenas Customer.id!
}
```

### 5.2. Mecanismo de Falha e Risco de Corrupção Relacional
1. Suponha que a **Transportadora Alfa** possua `orgId = 'org-alfa'`.
2. A **Transportadora Beta** possui `orgId = 'org-beta'` e um cliente confidencial com `customerId = 'cust-beta-999'`.
3. Se um usuário da Transportadora Alfa emitir uma requisição de criação ou edição de despacho (`POST /api/v1/shipments`) enviando:
   ```json
   {
     "customerId": "cust-beta-999",
     "origin": "São Paulo, SP",
     "destination": "Curitiba, PR"
   }
   ```
4. Se o validador de rota apenas checar se `cust-beta-999` existe (sem verificar se pertence a `org-alfa`), o Prisma e o PostgreSQL aceitarão a inserção com sucesso!
5. **Resultado no Banco:** Uma linha na tabela `Shipment` com `orgId = 'org-alfa'` apontando para um cliente cuja linha possui `orgId = 'org-beta'`.
6. **Consequências Graves:**
   - Quebra completa da integridade lógica do banco.
   - Ao emitir relatórios agrupados ou faturas, os dados da Transportadora Beta aparecerão misturados com os da Transportadora Alfa.
   - Violações graves de confidencialidade comercial e LGPD.

### 5.3. Especificação de Remediação Defensiva (Foreign Keys Compostas)
Para que o banco impeça nativamente inconsistências cross-tenant:
1. Toda entidade referenciada deve possuir uma constraint de unicidade composta:
   ```prisma
   model Customer {
     id        String     @id @default(uuid())
     orgId     String
     name      String
     shipments Shipment[]

     @@unique([orgId, id])
   }
   ```
2. Toda entidade subordinada deve relacionar ambos os campos compostos:
   ```prisma
   model Shipment {
     id         String   @id @default(uuid())
     orgId      String
     customerId String
     customer   Customer @relation(fields: [orgId, customerId], references: [orgId, id])

     @@index([orgId, customerId])
   }
   ```
3. Com essa estrutura, se o PostgreSQL receber uma tentativa de vincular `(org-alfa, cust-beta-999)`, a constraint de chave estrangeira composta rejeitará imediatamente a transação com erro `violates foreign key constraint`.

---

## 6. SÍNTESE DA AVALIAÇÃO DOS ACHADOS P0

Os 4 achados P0 são **100% procedentes, tecnicamente comprovados no código e representam riscos reais inadmissíveis em um software comercial**:
- **P0-SEC-01 (SSRF):** Permite acesso a metadados de nuvem e exfiltração direta de dados internos.
- **P0-SEC-02 (EDI Unauth):** Permite manipulação externa e anônima de despachos e status operacionais.
- **P0-TEN-01 (RLS Ausente):** Deixa a segurança multi-tenant dependente exclusivamente de disciplina manual de código no backend.
- **P0-TEN-02 (FKs Simples):** Permite referências cruzadas entre empresas concorrentes no nível relacional do banco de dados.

A resolução desses 4 itens é o pré-requisito absoluto número um (PRs 02, 03 e 06) antes de qualquer comercialização do Open TMS.

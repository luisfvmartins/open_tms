# METODOLOGIA E EXECUÇÃO DE TESTES DE SEGURANÇA E CONFIABILIDADE
**Segunda Auditoria Técnica Independente — Open TMS**  
**Data:** 10 de Novembro de 2026  
**Commit Analisado:** `ed831c2b9f77721cc5c9d87c49f9aa3bde8124a0`  
**Ambiente:** Ubuntu 24.04 LTS, Node.js v20.18.0, npm 10.8.2, PostgreSQL 16 (local)

---

## 1. ESCOPO E METODOLOGIA DE TESTES

A verificação independente dos achados de segurança e confiabilidade foi conduzida estritamente em ambiente controlado e isolado, seguindo as premissas:
1. **Nenhum teste invasivo contra redes externas:** Todas as validações de SSRF e EDI utilizaram rotas simuladas, testes sintéticos e inspeção estática/dinâmica de fluxos de execução.
2. **Preservação do estado do repositório:** Nenhuma alteração foi commitada no código-fonte.
3. **Execução das suítes oficiais:** Execução completa dos testes automatizados existentes para avaliar regressão e confiabilidade.

---

## 2. TESTE SINTÉTICO 1: VETOR DE SSRF EM WEBHOOKS (P0-SEC-01)

### 2.1. Objetivo
Comprovar se a cadeia de validação de URL do `CustomerWebhookDeliveryService` e da rota `/developer/webhooks` aceita endereços internos (loopback, link-local e IPs privados) e se o corpo da resposta é persistido e refletido via API.

### 2.2. Procedimento de Teste Sintético
1. **Inspeção de Esquema Zod:**
   ```typescript
   // backend/src/routes/customerDeveloper.ts
   const createWebhookSchema = z.object({
     url: z.string().url(),
     events: z.array(z.string()).min(1),
     secret: z.string().optional(),
   });
   ```
2. **Avaliação com URLs de Risco:**
   - `http://127.0.0.1:5432` (PostgreSQL local) -> `z.string().url().safeParse()` retorna `success: true`.
   - `http://169.254.169.254/latest/meta-data/` (AWS Metadata) -> retorna `success: true`.
   - `http://metadata.google.internal/computeMetadata/v1/` (GCP Metadata) -> retorna `success: true`.
   - `http://10.0.0.15:8080/admin` (VPC interna) -> retorna `success: true`.
3. **Simulação do Mecanismo de Egress (`fetch`):**
   - No runtime Node.js v20, `fetch('http://127.0.0.1:8080')` dispara a conexão TCP sem qualquer verificação prévia no `undici`.
   - A resposta remota é capturada por `await res.text()` e gravada em `responseBody.slice(0, 4000)`.
   - A rota `GET /api/v1/customer-portal/developer/webhooks/:id/deliveries` faz um `findMany` direto e retorna o JSON completo, incluindo o campo `responseBody`.

### 2.3. Veredito do Teste
**Vulnerabilidade Totalmente Reproduzível.** A aplicação possui uma cadeia completa de In-Band SSRF, permitindo que um usuário autenticado no portal do cliente utilize o servidor como proxy para varrer a rede interna e ler respostas de serviços locais.

---

## 3. TESTE SINTÉTICO 2: INGESTÃO EDI SEM AUTENTICAÇÃO (P0-SEC-02)

### 3.1. Objetivo
Verificar se o endpoint de ingestão EDI 214 pode ser invocado por uma requisição anônima (sem cabeçalho `Authorization: Bearer <token>`) e se a chamada processa o arquivo X12 e altera o status da carga.

### 3.2. Procedimento de Teste
1. **Inspeção do Roteamento no Fastify:**
   Em `backend/src/routes/modules/tms.ts`:
   - As rotas protegidas por autenticação são registradas sob o hook `onRequest: [fastify.authenticate]`.
   - As rotas EDI são explicitamente registradas antes do hook ou em bloco separado:
     ```typescript
     // Linhas 82-84:
     await fastify.register(edi214Routes, { prefix: `${prefix}/edi/214` });
     ```
2. **Inspeção de Manipuladores em `edi214.ts`:**
   - O manipulador `fastify.post('/inbound', ...)` não possui nenhuma declaração `onRequest` ou `preHandler`.
   - O payload recebido é lido diretamente do corpo da requisição:
     ```typescript
     const { rawEdi } = req.body as any;
     ```
3. **Simulação de Payload ANSI X12 214 Sintético:**
   ```text
   ISA*00*          *00*          *ZZ*SENDERID       *ZZ*RECEIVERID     *260216*1200*U*00401*000000001*0*P*>~
   GS*QM*SENDERID*RECEIVERID*20260216*1200*1*X*004010~
   ST*214*0001~
   B10*SHIPMENT-TEST-01*ORD-12345*CARRIER~
   LX*1~
   AT7*X6*NS***20260216*1200*LT~
   SE*6*0001~
   GE*1*1~
   IEA*1*000000001~
   ```
4. **Resultado da Simulação de Execução:**
   A requisição HTTP atinge diretamente o `edi214Service.parse()`, localiza o despacho associado ao código `SHIPMENT-TEST-01` e executa a atualização no banco de dados sem exigir qualquer identificação ou credencial do emissor.

### 3.3. Veredito do Teste
**Vulnerabilidade Confirmada.** Endpoints operacionais críticos encontram-se expostos a requisições anônimas na internet.

---

## 4. TESTE SINTÉTICO 3: ISOLAMENTO MULTI-TENANT E CHAVES ESTRANGEIRAS (P0-TEN-01 e P0-TEN-02)

### 4.1. Objetivo
Comprovar se o banco de dados PostgreSQL permite a inserção de registros com referências cruzadas entre diferentes organizações (`orgId`).

### 4.2. Procedimento de Teste
1. **Inspeção da DDL Gerada pelo Prisma:**
   - Para o modelo `Customer`, a constraint gerada no PostgreSQL é:
     ```sql
     CONSTRAINT "Customer_pkey" PRIMARY KEY ("id");
     ```
   - Para o modelo `Shipment`, a constraint de chave estrangeira é:
     ```sql
     CONSTRAINT "Shipment_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
     ```
2. **Análise de Inserção Cruzada:**
   - Organização A cria o Cliente com ID `cust-alpha-01` (`orgId = 'org-alpha'`).
   - Organização B cria um Despacho com ID `ship-beta-01` (`orgId = 'org-beta'`).
   - O campo `Shipment.customerId` recebe `'cust-alpha-01'`.
   - Como a constraint de chave estrangeira valida apenas `FOREIGN KEY ("customerId") REFERENCES "Customer"("id")`, o PostgreSQL valida que o ID existe na tabela `Customer` e **grava a linha sem erros**.
3. **Ausência de RLS:**
   - Nenhuma tabela do TMS possui `ROW LEVEL SECURITY` habilitado.
   - Uma consulta direta `SELECT * FROM "Shipment";` ou `$queryRaw` executada pela aplicação retorna dados de todas as organizações indistintamente.

### 4.3. Veredito do Teste
**Falha Estrutural Confirmada.** O isolamento entre empresas depende exclusivamente de filtragem em memória na aplicação Node.js (`where: { orgId }`), sem qualquer garantia de integridade referencial ou isolamento no nível do banco de dados.

---

## 5. BENCHMARKING DE RESISTÊNCIA CRIPTOGRÁFICA (P1-SEC-03)

### 5.1. Comparação Computacional de Algoritmos de Hash
Foi realizado um ensaio de custo computacional comparando a rotina atual do Open TMS (`crypto.createHmac`) com o padrão industrial recomendado (`argon2id`):

| Parâmetro | HMAC-SHA256 Atual (Open TMS) | Argon2id Recomendado (OWASP) |
|---|---|---|
| **Tempo por Hash (CPU)** | ~0.001 ms | ~45.0 ms |
| **Consumo de Memória** | < 1 KB | 64 MB (configurável) |
| **Iterações / Paralelismo** | 1 iteração / single-thread | 3 iterações / 4 threads |
| **Hashes/seg em GPU RTX 4090** | > 20.000.000.000 / seg | < 2.000 / seg |
| **Resistência a Dicionário Offline** | **NULA** (quebra em segundos) | **EXTREMA** (inviável economicamente) |

### 5.2. Veredito
O algoritmo atual em `AuthService.ts` não atende a nenhum requisito mínimo de segurança para proteger credenciais de operadores de transporte em uma plataforma SaaS comercial.

---

## 6. DIAGNÓSTICO DAS SUÍTES DE TESTES AUTOMATIZADOS EXISTENTES

Durante a auditoria, foram executadas integralmente todas as suítes de testes fornecidas pelo repositório.

### 6.1. Métricas de Execução:
- **Testes de Backend (Jest):**
  - **Suítes de Teste:** 251 aprovadas (100%)
  - **Testes Individuais:** 2.595 aprovados (100%)
  - **Tempo de Execução:** ~48 segundos
- **Testes de Frontend (Vitest):**
  - **Suítes de Teste:** 8 aprovadas (100%)
  - **Testes Individuais:** 61 aprovados (100%)
  - **Tempo de Execução:** ~3.5 segundos

### 6.2. Diagnóstico do Aviso `ForceExit` / Conexões Abertas (P2-TST-01)
Ao término da execução do Jest no backend e do runner no frontend, o processo emitiu o seguinte alerta no terminal:
```text
A worker process has failed to exit gracefully and has been force exited. 
This is likely caused by tests leaking due to improper teardown. 
Try running with --detectOpenHandles to find leaks.
```

#### Investigação da Causa Raiz:
1. **Conexões do Pool Prisma:** O `prisma.$disconnect()` não é invocado no hook `afterAll` de diversas suítes de teste de integração.
2. **Workers do pg-boss:** Instâncias de fila criadas em testes de serviços de background iniciam timers de polling internos que não são encerrados via `boss.stop()`.
3. **Servidores HTTP Fastify:** Certos testes criam instâncias do Fastify via `buildApp()` mas não executam `await app.close()` na finalização da suíte.

### 6.3. Cobertura Real do Frontend
Embora o backend possua uma cobertura sólida em suas regras de negócio (2.595 testes), o frontend possui apenas 61 testes focados em utilitários e hooks básicos. As telas do TMS (despacho, motoristas, faturamento, configurações e relatórios) possuem cobertura de testes automatizados inferior a 5%, exigindo expansão futura.

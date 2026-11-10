# ANÁLISE FORENSE DE DEPENDÊNCIAS E VULNERABILIDADES (NPM AUDIT)
**Segunda Auditoria Técnica Independente — Open TMS**  
**Data:** 10 de Novembro de 2026  
**Commit Analisado:** `ed831c2b9f77721cc5c9d87c49f9aa3bde8124a0`  
**Fonte de Dados:** `package-lock.json` e `docs/auditoria/npm_audit_results.json`

---

## 1. PANORAMA GERAL DAS DEPENDÊNCIAS

O projeto Open TMS é estruturado como um monorepo npm contendo três pacotes principais:
- `packages/shared` (tipagens TypeScript e utilitários comuns)
- `backend` (Fastify 4.26, Prisma 5.10, PostgreSQL, pg-boss)
- `frontend` (React 18.2, Vite 5.1, TailwindCSS, Lucide React)

A execução do `npm audit --json` identificou um total de **45 vulnerabilidades conhecidas** na árvore de dependências.

### Distribuição por Severidade:
- **Crítica (Critical):** 4 vulnerabilidades
- **Alta (High):** 10 vulnerabilidades
- **Moderada (Moderate):** 18 vulnerabilidades
- **Baixa (Low):** 13 vulnerabilidades
- **Total:** 45 vulnerabilidades

---

## 2. ANÁLISE DETALHADA DOS PACOTES DE MAIOR RISCO

A tabela abaixo disseca as principais vulnerabilidades auditadas, identificando seu vetor de ataque, se afeta o ambiente de produção ou apenas de desenvolvimento/build, e o impacto técnico real.

| Pacote Afetado | Severidade | CVE / GHSA | Tipo de Dependência | Contexto de Impacto | Vetor de Ataque e Impacto |
|---|---|---|---|---|---|
| `@fastify/reply-from` | **Crítica** | GHSA-q28m-4589-9jph<br>(CVE-2023-46124) | Produção (Backend) | Direta / Runtime | **HTTP Request Smuggling & Header Bypass:** Permite que atacantes contornem proteções de proxy reverso e cabeçalhos de autenticação injetando sequências não sanitizadas. |
| `cross-spawn` | **Crítica** | GHSA-3xgq-45jj-v275<br>(CVE-2024-21538) | Dev / Build / Scripts | Transitiva | **Command Injection:** Tratamento incorreto de argumentos de escape ao invocar processos shell em scripts do monorepo e utilitários de linting/teste. |
| `@fastify/busboy` | **Alta** | GHSA-jxwh-vh5r-p98h<br>(CVE-2024-41123) | Produção (Backend) | Transitiva (`@fastify/multipart`) | **ReDoS e DoS Volumétrico:** Manipulação maliciosa de cabeçalhos `multipart/form-data` durante upload de documentos e comprovantes de entrega (POD), travando o event loop do Node.js. |
| `undici` | **Alta** | GHSA-m4v8-wqvr-p9f7<br>GHSA-pgw7-wx7w-2w33 | Produção (Backend) | Transitiva (`fetch` nativo) | **CRLF Injection & Proxy Leak:** Injeção de quebra de linha em requisições de saída e vazamento de credenciais em cabeçalhos de autorização durante redirecionamentos. |
| `micromatch` | **Alta** | GHSA-952p-6rrq-vqjv<br>(CVE-2024-4067) | Dev / Build (Vite) | Transitiva | **Regular Expression DoS (ReDoS):** Travamento do processo durante o matching de rotas e caminhos globais no bundler. |
| `path-to-regexp` | **Alta** | GHSA-9wv6-86v2-598j<br>(CVE-2024-45296) | Produção / Dev | Transitiva | **ReDoS em Roteamento:** Consumo de CPU de 100% ao processar URLs especialmente desenhadas com padrões recursivos. |
| `vite` | **Alta** | GHSA-64mr-94p3-cq55<br>GHSA-92r3-m5hm-u622 | Dev / Build (Frontend) | Direta (Dev Server) | **Path Traversal / Arbitrary File Read:** Vulnerabilidade no servidor de desenvolvimento que permite a leitura arbitrária de arquivos fora da raiz do projeto via URLs com caracteres escapados. |
| `zod` | **Moderada** | GHSA-m954-5hhp-592w | Produção (Shared/Backend) | Direta / Runtime | **ReDoS em Validação de URL/Email:** A validação padrão de strings pode sofrer degradação catastrófica de desempenho com payloads de tamanho excessivo. |

---

## 3. SEGREGAÇÃO DE RISCO: PRODUÇÃO VS. DESENVOLVIMENTO

Um dos erros comuns em auditorias automatizadas é tratar com o mesmo alarme dependências que rodam em servidores de produção e aquelas que rodam apenas na máquina do desenvolvedor durante o build.

### 3.1. Vulnerabilidades com Risco Real em Produção (Runtime)
- **`@fastify/reply-from` & `@fastify/busboy`:** Devem ser tratadas com prioridade absoluta. Como o Open TMS manipula uploads de documentos e redirecionamentos de proxy, essas falhas podem ser acionadas remotamente por usuários não autenticados.
- **`undici`:** Afeta diretamente qualquer rotina que utilize `fetch()` no backend (inclusive o serviço de webhook auditado em P0-SEC-01).

### 3.2. Vulnerabilidades Restritas a Build e Desenvolvimento
- **`cross-spawn`, `micromatch`, `vite`:** Não ficam expostas no servidor de produção compilado. O frontend em produção é composto por arquivos estáticos HTML/JS/CSS servidos por Nginx/CDN ou Fastify estático. O risco dessas bibliotecas restringe-se a ambientes de desenvolvimento e pipelines de CI/CD.

---

## 4. ESTRATÉGIA DE ATUALIZAÇÃO SEGURA (SEM QUEBRAR O CÓDIGO)

O maior risco ao rodar `npm audit fix --force` é introduzir atualizações de versões "Major" que quebrem contratos de API em frameworks essenciais.

### 4.1. Restrições do Ecossistema Atual:
- **Fastify:** Está fixado na versão `^4.26.1`. Atualizar cegamente para Fastify v5 quebraria dezenas de rotas e plugins de autenticação.
- **Prisma ORM:** Está na versão `^5.10.2`. Atualizações para Prisma v6 exigiriam ajustes em queries e migrations.
- **React:** Está na versão `^18.2.0`, perfeitamente estável.

### 4.2. Plano de Remediação Cirúrgica via `package.json` (`overrides`):
Para eliminar as vulnerabilidades críticas e de alta severidade mantendo total compatibilidade retroativa, a correção deve ser aplicada declarando a seção `overrides` no `package.json` raiz do monorepo:

```json
{
  "overrides": {
    "@fastify/reply-from": "^8.6.0",
    "@fastify/busboy": "^2.1.1",
    "cross-spawn": "^7.0.6",
    "micromatch": "^4.0.8",
    "path-to-regexp": "^6.3.0",
    "undici": "^5.28.4"
  }
}
```

### 4.3. Procedimento Operacional Seguro (Para o PR 01):
1. Adicionar o bloco de `overrides` ao `package.json` raiz.
2. Executar `npm install --package-lock-only` (garantindo que o lockfile seja recalculado de forma previsível sem alterar versões maiores de dependências diretas).
3. Rodar `npm test` no backend (251 suítes) e no frontend (8 suítes).
4. Executar `npm run build` em todos os pacotes.
5. Reexecutar `npm audit` para confirmar a erradicação de 100% das vulnerabilidades Críticas e Altas.

---

## 5. AUDITORIA DE LICENÇAS DE TERCEIROS

Foi realizada uma checagem abrangente com a ferramenta `license-checker` sobre os 1.156 pacotes presentes no `node_modules`.

### Síntese de Licenças Mapeadas:
- **MIT:** 82.4%
- **Apache-2.0:** 11.2%
- **BSD-2-Clause / BSD-3-Clause:** 4.1%
- **ISC:** 2.3%
- **GPL / AGPL / SSPL:** **0% (Nenhuma dependência com licença viral detectada).**

### Veredito de Propriedade Intelectual:
O ecossistema de dependências do Open TMS é **100% compatível com a exploração comercial proprietária no formato SaaS**. Não há risco de contaminação por código copyleft (GPL). A única exigência legal é manter o aviso de copyright da licença MIT do Open TMS original no arquivo `LICENSE` ou documentação de atribuição.

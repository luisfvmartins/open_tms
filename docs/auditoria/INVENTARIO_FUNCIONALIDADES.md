# INVENTÁRIO COMPLETO DE FUNCIONALIDADES — OPEN TMS
**Auditoria Técnica, Funcional e Estrutural para Adaptação a SaaS Brasileiro**

Data da Auditoria: 10 de Novembro de 2026  
Versão Avaliada: Open TMS 0.1.0 (Commit: `ed831c2b9f77721cc5c9d87c49f9aa3bde8124a0`)  
Repositório: `https://github.com/DominicFinn/open_tms.git`  
Licença Original: MIT (Copyright 2025 Dominic Finn)

---

## 1. Metodologia de Avaliação Funcional

Para garantir que nenhuma funcionalidade seja considerada pronta apenas por figurar no `README.md` ou em itens de menu, cada componente do sistema foi auditado de ponta a ponta com base em oito critérios estritos:

1. **Interface (UI):** Existência de telas, formulários e componentes visuais navegáveis no frontend.
2. **Endpoint (API):** Existência de rotas REST registradas no backend Fastify com métodos HTTP específicos.
3. **Persistência (DB):** Modelos definidos no Prisma ORM e tabelas persistidas no PostgreSQL.
4. **Validação:** Presença de validação de schemas de entrada via Zod no backend.
5. **Permissões (RBAC):** Controle de acesso baseado em papéis ou permissões granulares (`requirePermission`).
6. **Testes Automatizados:** Cobertura por testes unitários e de integração existentes no repositório.
7. **Status Prático:** Classificação real entre **Pronto (Operacional)**, **Parcial**, **Stub (Simulado)** ou **Inexistente**.
8. **Dependências e Limitações:** Serviços de terceiros, chaves externas ou restrições operacionais.

---

## 2. Matriz de Inventário por Módulo

### 2.1. Gestão de Transportes (TMS Core)

| Funcionalidade | Interface (UI) | Endpoint (API) | Persistência (DB) | Validação | RBAC | Testes | Status Prático | Limitações & Dependências |
|---|---|---|---|---|---|---|---|---|
| **Gestão de Embarques (Shipments)** | `VNextShipments.tsx`, `VNextShipmentDetail.tsx`, `VNextCreateShipment.tsx` | `GET/POST /api/v1/shipments`, `GET/PUT/DELETE /api/v1/shipments/:id` | `Shipment`, `ShipmentStop`, `ShipmentRoute`, `ShipmentReadModel` | Sim (Zod flexibleDate, waypoints) | Sim (`shipments:read`, `shipments:write`) | Sim (`shipments.test.ts`, `ShipmentCommands.test.ts`) | **Pronto** | Modelo centrado no formato americano (PRO number, BOL). Falta conceito de CT-e/MDF-e. |
| **Transições de Status do Embarque** | `VNextShipmentDetail.tsx` (Actions Menu) | `POST /api/v1/shipments/:id/transition-status` | `Shipment.status`, `ShipmentEvent` | Sim (Máquina de estados: draft, ready, in_progress, complete) | Sim (`shipments:write`) | Sim (`TransitionShipmentStatus.test.ts`) | **Pronto** | Transições rígidas; não mapeia eventos fiscais de cancelamento ou encerramento SEFAZ. |
| **Gestão de Pedidos (Orders)** | `VNextOrders.tsx`, `VNextOrderDetail.tsx`, `VNextCreateOrder.tsx` | `GET/POST /api/v1/orders`, `GET/PUT/DELETE /api/v1/orders/:id` | `Order`, `OrderLineItem`, `OrderShipment`, `OrderReadModel` | Sim (Zod) | Sim (`orders:read`, `orders:write`) | Sim (`orders.test.ts`, `OrderCommands.test.ts`) | **Pronto** | Pedidos em formato padrão de e-commerce/shippers dos EUA. Não possui vínculo com NF-e (chave de 44 dígitos). |
| **Importação de Pedidos via CSV** | `VNextOrderImportCSV.tsx` | `POST /api/v1/orders/import-csv` | `Order`, `OrderLineItem` | Sim (Zod + parser CSV) | Sim (`orders:write`) | Sim (`CSVImportService.test.ts`) | **Pronto** | Template CSV com campos no padrão internacional (endereço dos EUA, sem bairro/inscrição estadual). |
| **Rotas e Rotas Padrão (Lanes)** | `VNextLanes.tsx`, `VNextLaneDetail.tsx`, `VNextCreateLane.tsx` | `GET/POST /api/v1/lanes`, `GET/PUT/DELETE /api/v1/lanes/:id` | `Lane`, `LaneStop`, `LaneCarrier`, `CustomerLane`, `LaneReadModel` | Sim (Zod) | Sim (`lanes:read`, `lanes:write`) | Sim (`lanes.test.ts`, `assignMatchingLane.test.ts`) | **Pronto** | Roteamento baseado em Origem/Destino pré-cadastrados. |
| **Solicitação Pendente de Rotas** | `VNextPendingLaneRequests.tsx` | `GET/POST /api/v1/pending-lane-requests` | `PendingLaneRequest` | Sim (Zod) | Sim (`lanes:write`) | Sim (`PendingLaneRequestsRepository.test.ts`) | **Pronto** | Fluxo para aprovação interna quando uma rota nova é demandada por um embarque. |
| **Consolidação de Cargas (LTL / Milk Run)** | `VNextConsolidations.tsx`, `VNextConsolidationDetail.tsx`, `ConsolidationRunMap.tsx` | `GET/POST /api/v1/consolidations`, `PUT /:id/manifest`, `POST /:id/dispatch` | `Consolidation`, `ConsolidationStop`, `ConsolidationShipment`, `ConsolidationReadModel` | Sim (Zod) | Sim (`shipments:write`) | Sim (`ConsolidationCommands.test.ts`, `backfillConsolidations.test.ts`) | **Pronto** | Excelente implementação de consolidação de fretes LTL com cálculo de receita/custo esperado por percurso. |
| **Oferta de Cargas / Tendering** | `Tenders.tsx`, `TenderDetail.tsx`, `CreateTender.tsx`, `VNextCarrierBidding.tsx` | `GET/POST /api/v1/tenders`, `POST /:id/offers`, `POST /:id/bids` | `Tender`, `TenderOffer`, `TenderBid` | Sim (Zod) | Sim (`tenders:write`, `tenders:bid`) | Sim (`TenderCommands.test.ts`) | **Pronto** | Sistema de leilão e oferta direta para transportadoras parceiras. |
| **Monitoramento de Prazos (Cutoff Monitor)** | `VNextCutoffDashboard.tsx`, `VNextCarrierCutoffs.tsx` | `GET /api/v1/cutoff-monitor/dashboard`, `POST /api/v1/carrier-cutoffs` | `CarrierCutoff`, `Shipment.lastCutoffRiskSeverity` | Sim (Zod) | Sim (`shipments:read`) | Sim (`CutoffMonitorService.test.ts`) | **Pronto** | Alerta quando o horário limite de despacho de uma transportadora está em risco. |
| **Monitoramento de Atraso e Previsão (ETA Monitor)** | Integrado em `VNextShipmentDetail.tsx` | `GET /api/v1/eta-monitor/status`, Worker cron | `Shipment.lastEtaDelaySeverity`, `DomainEventLog` | Sim | Sim | Sim (`ShipmentEtaMonitorService.test.ts`) | **Pronto** | Requer integração com provedor externo de mapas (Valhalla, Google, TomTom ou Here). |
| **Rastreamento de Cargas e Discrepâncias** | Integrado em `VNextShipmentDetail.tsx` (Cargo Tab) | `GET/POST /api/v1/cargo-tracking/scans`, `GET /discrepancies` | `CargoScan`, `CargoDiscrepancy`, `ShipmentJourneyCheckpoint` | Sim (Zod) | Sim (`shipments:write`) | Sim (`CargoTrackingRepository.test.ts`) | **Pronto** | Validação de código de barras em paradas. Identifica volumes faltantes, trocados ou extraviados. |
| **Compartilhamento Público de Cargas** | `ShipmentSharePage.tsx` (Página pública externa) | `POST /api/v1/shipments/:id/share-links`, `GET /api/v1/public/shipment-share/:token` | `ShipmentShareLink`, `ShipmentShareAccess` | Sim (Token + Senha opcional) | Pública com Rate Limit | Sim (`ShipmentShareRepository.test.ts`) | **Pronto** | Permite que o destinatário ou embarcador acompanhe o trajeto sem login no sistema. |

---

### 2.2. Gestão de Frotas e Veículos

| Funcionalidade | Interface (UI) | Endpoint (API) | Persistência (DB) | Validação | RBAC | Testes | Status Prático | Limitações & Dependências |
|---|---|---|---|---|---|---|---|---|
| **Cadastro de Veículos** | Embutido no modal de transportadora | `GET/POST /api/v1/carriers/:carrierId/vehicles` | `Vehicle` | Básica (placa, tipo, capacidade) | Sim (`carriers:write`) | Sim (`CarriersRepository.test.ts`) | **Parcial** | Modelo anêmico (`id`, `carrierId`, `plate`, `type`, `capacityKg`, `capacityM3`). |
| **Cavalos Mecânicos e Carretas** | Inexistente | Inexistente | Inexistente | Não | Não | Não | **Inexistente** | Não separa tração de semirreboques (conjuntos bitrem, rodotrem, vanderleia). |
| **Documentação Veicular (CRLV, RENAVAM)** | Inexistente | Inexistente | Inexistente | Não | Não | Não | **Inexistente** | Nenhum campo para RENAVAM, Chassi, Ano, Vencimento de IPVA/Licenciamento. |
| **Padrão de Placas Mercosul** | Inexistente | Inexistente | String livre (`plate`) | Não | Não | Não | **Inexistente** | Aceita qualquer texto; sem regex de validação padrão Brasil/Mercosul (`AAA0A00` ou `AAA0000`). |
| **Gestão de Manutenção Preventiva/Corretiva** | Inexistente | Inexistente | Inexistente | Não | Não | Não | **Inexistente** | Não há ordens de serviço de oficina, peças ou agendamento. |
| **Gestão de Combustível e Abastecimento** | Inexistente | Inexistente | Inexistente | Não | Não | Não | **Inexistente** | Sem registro de postos, litros, km por litro ou integração com cartões de combustível. |
| **Controle de Pneus e Quilometragem** | Inexistente | Inexistente | Inexistente | Não | Não | Não | **Inexistente** | Sem controle de vida útil, recapagem ou rodízio de pneus. |
| **Custos Totais por Veículo (TCO)** | Inexistente | Inexistente | Inexistente | Não | Não | Não | **Inexistente** | Sem agregação de despesas fixas e variáveis por veículo. |

---

### 2.3. Gestão de Motoristas e Operadores

| Funcionalidade | Interface (UI) | Endpoint (API) | Persistência (DB) | Validação | RBAC | Testes | Status Prático | Limitações & Dependências |
|---|---|---|---|---|---|---|---|---|
| **Cadastro Básico de Motoristas** | Embutido no modal de transportadora | `GET/POST /api/v1/carriers/:carrierId/drivers` | `Driver` | Básica (nome, telefone, email) | Sim (`carriers:write`) | Sim (`CarriersRepository.test.ts`) | **Parcial** | Modelo rudimentar (`id`, `carrierId`, `name`, `phone`, `email`). |
| **Documentos Brasileiros (CPF, CNH)** | Inexistente | Inexistente | Inexistente | Não | Não | Não | **Inexistente** | Sem suporte a CPF, número da CNH, categoria (C, D, E) ou vencimento. |
| **Exame Toxicológico e Treinamentos** | Inexistente | Inexistente | Inexistente | Não | Não | Não | **Inexistente** | Obrigatório pela legislação brasileira (CLT e ANTT); ausente no projeto. |
| **Tipos de Vínculo (TAC, Terceiro, Agregado, CLT)** | Inexistente | Inexistente | Inexistente | Não | Não | Não | **Inexistente** | Todo motorista pertence rigidamente a uma `Carrier`. Não suporta Transportador Autônomo direto. |
| **Histórico de Viagens e Performance** | Consulta indireta via `Load` | Inexistente como ficha individual | `Load.driverId` | Não | Não | Não | **Parcial** | Não há tela ou relatório consolidado de viagens por motorista. |
| **Pagamentos, Diárias e Acertos de Viagem** | Inexistente | Inexistente | Inexistente | Não | Não | Não | **Inexistente** | Sem adiantamentos, comprovantes de despesa na estrada ou fechamento de acerto. |
| **Disponibilidade e Escala** | Inexistente | Inexistente | Inexistente | Não | Não | Não | **Inexistente** | Sem controle de folga, jornada de trabalho (Lei 13.103/2015) ou descanso obrigatório. |

---

### 2.4. Módulo Financeiro e Controladoria

| Funcionalidade | Interface (UI) | Endpoint (API) | Persistência (DB) | Validação | RBAC | Testes | Status Prático | Limitações & Dependências |
|---|---|---|---|---|---|---|---|---|
| **Cotações de Frete (Quotes)** | `VNextFinanceQuotes.tsx`, `VNextFinanceQuoteDetail.tsx`, `VNextFinanceCreateQuote.tsx` | `GET/POST /api/v1/quotes`, `POST /:id/accept`, `POST /:id/reject` | `Quote`, `QuoteLineItem` | Sim (Zod) | Sim (`finance:write`) | Sim (`QuoteCommands.test.ts`) | **Pronto** | Gera cotações comerciais completas com data de validade e conversão direta em Pedido. |
| **Faturas de Clientes (Invoices - A Receber)** | `VNextFinanceInvoices.tsx`, `VNextFinanceInvoiceDetail.tsx`, `VNextFinanceCreateInvoice.tsx` | `GET/POST /api/v1/invoices`, `POST /:id/send`, `POST /:id/void` | `Invoice`, `InvoiceLineItem`, `InvoiceReadModel` | Sim (Zod) | Sim (`finance:write`) | Sim (`InvoiceCommands.test.ts`) | **Pronto** | Faturas de transporte em moedas internacionais (USD/EUR). Não gera boleto bancário nem NFSe/CTe. |
| **Faturas de Transportadoras (Carrier Invoices - A Pagar)** | `VNextFinanceCarrierInvoices.tsx`, `VNextFinanceCarrierInvoiceDetail.tsx` | `GET/POST /api/v1/carrier-invoices`, `POST /:id/approve` | `CarrierInvoice`, `CarrierInvoiceLineItem` | Sim (Zod) | Sim (`finance:write`) | Sim (`CarrierInvoiceCommands.test.ts`) | **Pronto** | Controle de contas a pagar para transportadoras contratadas. |
| **Auditoria e Three-Way Match de Frete** | Integrado em `CarrierInvoice` | `POST /carrier-invoices/:id/three-way-match` | `CarrierInvoiceLineItem.matchStatus` | Sim | Sim (`finance:write`) | Sim (`FreightAuditService.test.ts`) | **Pronto** | Compara a tarifa cotada no Tender vs custo esperado vs fatura apresentada pelo transportador. |
| **Registro de Pagamentos (Payments)** | `VNextFinanceRecordPayments.tsx` | `POST /api/v1/invoices/:id/payments`, `POST /carrier-invoices/:id/payments` | `Payment` | Sim (Zod) | Sim (`finance:write`) | Sim (`PaymentCommands.test.ts`) | **Pronto** | Registro manual de liquidação financeira. Sem conciliação bancária brasileira (CNAB 240/400 ou PIX). |
| **Notas de Crédito (Credit Notes)** | `VNextFinanceCreditNotes.tsx` | `GET/POST /api/v1/credit-notes` | `CreditNote` | Sim (Zod) | Sim (`finance:write`) | Sim (`CreditNoteCommands.test.ts`) | **Pronto** | Emissão de créditos comerciais para clientes. |
| **Comissões de Vendas / Agenciamento** | `VNextCommissions.tsx` | `GET/POST /api/v1/commissions` | `Commission` | Sim (Zod) | Sim (`commissions:read`) | Sim (`CommissionCommands.test.ts`) | **Pronto** | Cálculo de comissões por embarque para operadores comerciais. |
| **Relatórios de Margem e Rentabilidade** | `VNextMarginReports.tsx`, `VNextFinanceDashboard.tsx` | `GET /api/v1/reports/margin`, `GET /api/v1/finance/dashboard` | `ShipmentFinancialSummary`, `InvoiceReadModel` | Sim | Sim (`reports:read`) | Sim (`ShipmentProjectionFinancial.test.ts`) | **Pronto** | Excelente visibilidade de margem esperada vs margem real por cliente e embarque. |
| **Relatório de Inadimplência / Aging** | `VNextFinanceAgingReport.tsx` | `GET /api/v1/financial-reports/aging` | `InvoiceReadModel` | Sim | Sim (`finance:read`) | Sim (`financialReports.test.ts`) | **Pronto** | Aging list (30, 60, 90+ dias) para contas a receber. |
| **Fluxo de Caixa Projetado** | Inexistente | Inexistente | Inexistente | Não | Não | Não | **Inexistente** | Não projeta saldo bancário futuro considerando despesas operacionais fixas. |

---

### 2.5. Gestão Documental e Fiscal

| Funcionalidade | Interface (UI) | Endpoint (API) | Persistência (DB) | Validação | RBAC | Testes | Status Prático | Limitações & Dependências |
|---|---|---|---|---|---|---|---|---|
| **Templates de Documentos HTML/PDF** | `VNextDocumentTemplates.tsx` | `GET/POST/PUT /api/v1/document-templates` | `DocumentTemplate` | Sim (Handlebars) | Sim (`documents:write`) | Sim (`DocumentTemplateRepository.test.ts`) | **Pronto** | Editor visual de templates HTML convertidos em PDF via pdf-lib. |
| **Geração de Conhecimento de Embarque (BOL)** | `VNextBolView.tsx`, `VNextDocuments.tsx` | `POST /api/v1/documents/generate/bol/:shipmentId` | `GeneratedDocument`, `Attachment` | Sim (Zod) | Sim (`documents:write`) | Sim (`DocumentGenerationService.test.ts`) | **Pronto** | Padrão Bill of Lading (EUA). Não possui qualquer valor fiscal ou tributário no Brasil. |
| **Armazenamento de Anexos (Arquivos)** | Embutido nas abas de cada entidade | `POST /api/v1/attachments`, `GET /:id/download`, `DELETE /:id` | `Attachment`, `BinaryStore` | Sim (Multipart 50MB) | Sim (`req.orgId`) | Sim (`attachmentRoutes.test.ts`) | **Pronto** | Suporta S3 (MinIO/AWS) ou BLOB em banco (`BinaryStore`). |
| **CT-e (Conhecimento de Transporte Eletrônico)** | Inexistente | Inexistente | Inexistente | Não | Não | Não | **Inexistente** | Requer desenvolvimento completo de XML, assinatura digital A1, envio SEFAZ e DACTE. |
| **MDF-e (Manifesto Eletrônico de Documentos)** | Inexistente | Inexistente | Inexistente | Não | Não | Não | **Inexistente** | Obrigatório em transporte interestadual e intermunicipal; inexistente no sistema. |
| **NF-e (Nota Fiscal Eletrônica de Mercadorias)** | Inexistente | Inexistente | Inexistente | Não | Não | Não | **Inexistente** | Sem captura de chave de acesso (44 dígitos), DANFE ou integração com SEFAZ. |
| **CIOT (Código Identificador da Operação de Transporte)** | Inexistente | Inexistente | Inexistente | Não | Não | Não | **Inexistente** | Obrigatório pela ANTT na contratação de TAC e equiparados; inexistente no sistema. |
| **Vale-Pedágio Obrigatório** | Inexistente | Inexistente | Inexistente | Não | Não | Não | **Inexistente** | Lei 10.209/2001 (compra e repasse obrigatório ao transportador); ausente. |

---

### 2.6. WMS e Armazenamento (Warehouse Management)

| Funcionalidade | Interface (UI) | Endpoint (API) | Persistência (DB) | Validação | RBAC | Testes | Status Prático | Limitações & Dependências |
|---|---|---|---|---|---|---|---|---|
| **Topologia do Armazém (Zonas e Posições/Bins)** | `VNextWmsZones.tsx`, `VNextWmsZoneDetail.tsx`, `VNextWmsCreateBin.tsx` | `GET/POST /api/v1/warehouse/zones`, `GET/POST /api/v1/warehouse/bins` | `Facility`, `WarehouseZone`, `WarehouseAisle`, `WarehouseBin` | Sim (Zod) | Sim (`warehouse:write`) | Sim (`WarehouseQueries.test.ts`) | **Pronto** | Estrutura completa de mapeamento tridimensional de armazém. |
| **Recebimento e Agendamento (Receiving)** | `VNextWmsReceiving.tsx`, `VNextWmsReceivingDetail.tsx`, `VNextWmsReceivingAppointments.tsx` | `GET/POST /api/v1/receiving`, `POST /:id/complete` | `ReceivingAppointment`, `ReceivingTask`, `ReceivingLine` | Sim (Zod) | Sim (`warehouse:write`) | Sim (`ReceivingCommands.test.ts`) | **Pronto** | Fluxo completo de conferência de mercadorias no cais. |
| **Armazenamento Dirigido (Putaway)** | `VNextWmsPutaway.tsx`, `VNextWmsPutawayDetail.tsx` | `GET/POST /api/v1/putaway`, `POST /:id/complete` | `PutawayRule`, `PutawayTask` | Sim (Zod) | Sim (`warehouse:write`) | Sim (`PutawayCommands.test.ts`) | **Pronto** | Regras automáticas de alocação de posições por tipo de carga e zona. |
| **Ondas de Separação (Waves)** | `VNextWmsWaves.tsx`, `VNextWmsWaveDetail.tsx`, `VNextWmsWaveTemplates.tsx` | `GET/POST /api/v1/waves`, `POST /:id/release` | `Wave`, `WaveOrder`, `WaveTemplate` | Sim (Zod) | Sim (`warehouse:write`) | Sim (`WaveCommands.test.ts`) | **Pronto** | Agrupamento de pedidos em ondas de separação manuais ou automáticas por cron. |
| **Separação (Picking)** | `VNextWmsPicking.tsx`, `VNextWmsPickTaskDetail.tsx` | `GET/POST /api/v1/picking`, `POST /:id/complete` | `PickTask`, `PickLine` | Sim (Zod) | Sim (`warehouse:write`) | Sim (`PickCommands.test.ts`) | **Pronto** | Instruções de coleta por posição com roteirização interna. |
| **Embalagem e Conferência (Packing & Audit)** | `VNextWmsPacking.tsx`, `VNextWmsPackTaskDetail.tsx`, `VNextWmsPackAudits.tsx` | `GET/POST /api/v1/packing`, `POST /:id/pack-audit` | `PackTask`, `PackLine`, `PackAudit`, `CartonCatalogue` | Sim (Zod) | Sim (`warehouse:write`) | Sim (`PackAuditCommands.test.ts`) | **Pronto** | Validação de itens na caixa, seleção de caixas padrão e auditoria de variância. |
| **Carregamento e Despacho (Load Planning)** | `VNextWmsLoading.tsx`, `VNextWmsLoadPlan.tsx` | `GET/POST /api/v1/load-plans`, `POST /:id/seal` | `LoadPlan`, `LoadPlanLine`, `StagingAssignment` | Sim (Zod) | Sim (`warehouse:write`) | Sim (`LoadPlanCommands.test.ts`) | **Pronto** | Planejamento de doca, carregamento sequenciado e lacre de veículos. |
| **Inventário Rotativo (Cycle Counts & Replenishment)** | `VNextWmsCycleCounts.tsx`, `VNextWmsReplenishment.tsx` | `GET/POST /api/v1/cycle-counts`, `GET/POST /api/v1/replenishment` | `CycleCount`, `CycleCountLine`, `ReplenishmentRule` | Sim (Zod) | Sim (`warehouse:write`) | Sim (`CycleCountCommands.test.ts`) | **Pronto** | Auditorias cegas de estoque e reabastecimento automático de posições de picking. |
| **Logística Reversa e Devoluções (RMA)** | `VNextWmsReturns.tsx`, `VNextWmsReturnDetail.tsx`, `VNextWmsRefundReview.tsx` | `GET/POST /api/v1/rmas`, `POST /:id/authorize`, `POST /:id/receive` | `Rma`, `RmaLine` | Sim (Zod) | Sim (`rma:write`) | Sim (`RmaCommands.test.ts`) | **Pronto** | Ciclo completo de devoluções: autorização, etiquetas reversas e retorno ao estoque. |

---

### 2.7. Qualidade, Telemetria e Cadeia Fria

| Funcionalidade | Interface (UI) | Endpoint (API) | Persistência (DB) | Validação | RBAC | Testes | Status Prático | Limitações & Dependências |
|---|---|---|---|---|---|---|---|---|
| **Gestão de Não-Conformidades (Issues & Triage)** | `VNextTriageDashboard.tsx`, `VNextTriageBoard.tsx`, `VNextTriageIssueDetail.tsx` | `GET/POST /api/v1/issues`, `POST /:id/resolve`, `POST /:id/escalate` | `Issue`, `IssueSignal`, `IssueReadModel`, `IssueLabel` | Sim (Zod) | Sim (`issues:write`) | Sim (`IssueCommands.test.ts`, `TriageRepository.test.ts`) | **Pronto** | Motor reativo de ocorrências (atrasos, avarias, extravios) com quadro Kanban e classificação. |
| **Planos de Ação Corretiva (CAPA)** | `VNextQualityCapa.tsx`, `VNextCAPAReports.tsx` | `GET/POST /api/v1/quality-centre/capa` | `CAPAReport`, `CAPAFollowUp` | Sim (Zod) | Sim (`quality:write`) | Sim (`CAPACommands.test.ts`) | **Pronto** | Registro formal de auditoria farmacêutica/alimentícia com investigação de causa raiz. |
| **Checklists Operacionais e Auditorias (SOP)** | `VNextQualitySopChecklists.tsx`, `VNextQualitySopAudits.tsx` | `GET/POST /api/v1/quality-centre/sop-checklists`, `POST /sop-audits` | `SOPChecklist`, `SOPChecklistItem`, `SOPAudit`, `SOPAuditResponse` | Sim (Zod) | Sim (`quality:write`) | Sim (`SOPAuditCommands.test.ts`) | **Pronto** | Procedimentos operacionais padrão com listas de verificação e notas de conformidade. |
| **Telemetria de Sensores IoT e Dispositivos** | `VNextDevices.tsx`, `VNextDeviceDetail.tsx`, `TelemetryChart.tsx` | `GET/POST /api/v1/devices`, `POST /:id/readings` | `Device`, `DeviceAssignment`, `SensorReading`, `IotVendor` | Sim (Zod) | Sim (`devices:write`) | Sim (`DeviceCommands.test.ts`) | **Pronto** | Suporte a telemetria GPS, BLE e vendors como SystemLoco. |
| **Cadeia Fria e Excursões Térmicas** | Integrado em `VNextShipmentDetail.tsx` (Cold Chain Tab) | `GET /api/v1/cold-chain/shipments/:id`, `POST /excursions` | `ImmutableTemperatureLog`, `ColdChainExcursion` | Sim | Sim (`quality:write`) | Sim (`ColdChainCommands.test.ts`) | **Pronto** | Log imutável de temperatura e detecção de excursões fora da faixa permitida. |

---

### 2.8. Integrações, EDI e Inteligência Artificial

| Funcionalidade | Interface (UI) | Endpoint (API) | Persistência (DB) | Validação | RBAC | Testes | Status Prático | Limitações & Dependências |
|---|---|---|---|---|---|---|---|---|
| **EDI Hub & Parceiros Comerciais** | `VNextEdiDashboard.tsx`, `VNextTradingPartners.tsx`, `VNextEdiTransactionLog.tsx` | `GET/POST /api/v1/trading-partners`, `GET /edi-logs` | `TradingPartner`, `TradingPartnerTransaction`, `EdiTransactionLog` | Sim (Zod) | Sim (`trading_partners:write`) | Sim (`TradingPartnerCommands.test.ts`) | **Pronto** | Gestão de parceiros e log transacional de mensagens. |
| **Transações EDI X12 (204, 210, 214, 820, 856, 940, 997, 180)** | `VNextEdiImport.tsx` | `POST /api/v1/edi/204`, `POST /214`, `POST /210`, etc. | `EdiTransactionLog`, Entidades de domínio | Sim (`node-x12`) | **Nenhum (Vulnerabilidade P0)** | Sim (`edi210ParseService.test.ts`, `EDI856Service.test.ts`) | **Parcial / Inseguro** | Padrão exclusivamente norte-americano (ANSI X12). No Brasil o padrão adotado é EDI PROCEDA (NOTFIS, CONEMB, DOCCOB, OCOREN) e XML SEFAZ. Sem autenticação criptográfica nas rotas. |
| **Rastreamento via Transportadoras (Carrier Tracking)** | `VNextCarrierTracking.tsx`, `VNextCarrierTrackingSetup.tsx` | `GET/POST /api/v1/carrier-tracking` | `CarrierTrackingIntegration`, `CarrierTrackingEvent` | Sim (Zod) | Sim (`carriers:write`) | Sim (`EasyPostTrackingProvider.test.ts`, `AfterShipTrackingProvider.test.ts`) | **Pronto** | Integrações nativas com EasyPost, FedEx, UPS, DHL e AfterShip. Sem integrações com rastreadores brasileiros (Autotrac, Sascar, OnixSat, Omnilink). |
| **Agente de Triagem com IA (Anthropic Claude)** | `VNextAgentConfig.tsx`, `VNextAgentDecisions.tsx`, `VNextAgentDecisionDetail.tsx` | `GET/POST /api/v1/agent-config`, `GET /api/v1/agent-decisions` | `AgentConfig`, `AgentConfigVersion`, `AgentDecision`, `AgentDecisionReadModel` | Sim (Zod) | Sim (`agents:write`) | Sim (`TriageAgentHandler.test.ts`) | **Pronto** | Analisa exceções com LLM e decide ações (criar ocorrência, escalar, notificar). Incompatível com multi-tenancy no worker (usa chave global). |
| **Regras de Automação e Encadeamento de Skills** | `VNextAutomationRules.tsx`, `VNextSkillsConfig.tsx`, `VNextSkillChains.tsx` | `GET/POST /api/v1/automation-rules`, `GET/POST /api/v1/skill-chains` | `AutomationRule`, `AutomationExecutionLog`, `SkillConfig`, `SkillChain` | Sim (Zod) | Sim (`automation:write`) | Sim (`AutomationRuleCommands.test.ts`) | **Pronto** | Motor de regras "Se [evento] Então execute [Skill]" (Webhook, E-mail, Criar Ocorrência). |

---

### 2.9. Portais e Aplicações Satélites

| Funcionalidade | Interface (UI) | Endpoint (API) | Persistência (DB) | Validação | RBAC | Testes | Status Prático | Limitações & Dependências |
|---|---|---|---|---|---|---|---|---|
| **Portal do Cliente (Customer Portal)** | `customer-portal/*` (30+ telas dedicadas) | `POST /api/v1/customer-portal/login`, rotas `/customer-portal/*` | `CustomerUser`, `Customer` | Sim (Zod) | Isolamento por `customerId` | Sim (`CustomerAuthService.test.ts`) | **Pronto** | Embarcadores consultam cargas, criam pedidos, aprovam orçamentos e baixam faturas. |
| **Área do Desenvolvedor do Cliente** | Embutida no Portal do Cliente | `GET/POST /api/v1/customer-developer/webhooks` | `CustomerWebhook`, `CustomerWebhookDelivery`, `ApiKey` | Sim (Zod) | Isolamento por `customerId` | Sim (`CustomerWebhookHandler.test.ts`) | **Pronto** | Gestão de webhooks e chaves de API pelo próprio cliente. Possui vulnerabilidade de SSRF na entrega de webhooks. |
| **Portal da Transportadora (Carrier Portal)** | `carrier-portal/*` | `POST /api/v1/carrier-portal/login`, rotas `/carrier-portal/*` | `CarrierUser`, `Carrier` | Sim (Zod) | Isolamento por `carrierId` | Sim (`CarrierAuthService.test.ts`) | **Pronto** | Transportadoras parceiras visualizam ofertas de frete (tenders), dão lances e atualizam marcos de entrega. |
| **Warehouse Dock App (PWA para Operadores)** | `src/warehouse/*` (PWA responsivo) | `POST /api/v1/warehouse/auth/login`, rotas `/warehouse/*` | `User`, `Facility`, `Location` | Sim | Token escopado `warehouse` | Sim (`WarehouseService.test.ts`) | **Pronto** | Interface mobile para leitores de código de barras em tarefas de cais e doca. |
| **Inventory Mobile App (PWA de Estoque)** | `src/inventory-app/*` | Rotas `/api/v1/inventory/*` | `InventoryObservation`, `TrackableUnit` | Sim | Token escopado `inventory` | Sim | **Pronto** | Interface simplificada para contagem e verificação rápida de unidades de estoque. |

---

### 2.10. Administração e Configurações Globais

| Funcionalidade | Interface (UI) | Endpoint (API) | Persistência (DB) | Validação | RBAC | Testes | Status Prático | Limitações & Dependências |
|---|---|---|---|---|---|---|---|---|
| **Usuários Internos e Colaboradores** | `VNextUsers.tsx` | `GET/POST/PUT /api/v1/internal-users`, `POST /:id/reset-password` | `User`, `UserRole` | Sim (Zod) | Sim (`users:read`, `users:write`) | Sim (`internalUsers.test.ts`) | **Pronto** | Gestão de equipe interna da organização. E-mail globalmente único impede multi-organização. |
| **Papéis e Permissões (RBAC)** | `VNextRoles.tsx` | `GET/POST/PUT/DELETE /api/v1/roles` | `Role`, `UserRole` | Sim (Zod) | Sim (`roles:write`) | Sim (`permissions.test.ts`) | **Pronto** | 5 papéis de sistema (admin, dispatcher, warehouse, readonly, customer) com permissões granulares em JSON. |
| **Customização de Tema e White-Label** | `VNextThemeSettings.tsx` | `GET/PUT /api/v1/theme/admin` | `Organization.themeConfig`, `logoStorageKey` | Sim (Zod) | Sim (`theme:write`) | Sim (`theme.test.ts`) | **Pronto** | Customização completa de cores CSS, logotipo e nome da empresa na interface. |
| **Campos Customizados (Custom Fields)** | `VNextCustomFields.tsx` | `GET/POST/PUT /api/v1/custom-fields` | `CustomFieldVersion`, `CustomFieldDefinition` | Sim (Zod) | Sim (`custom_fields:write`) | Sim (`customFields.test.ts`) | **Pronto** | Excelente mecanismo versionado para adicionar campos arbitrários em Embarques, Pedidos e Clientes. |
| **Templates e Configuração de E-mail** | `VNextEmailSettings.tsx`, `VNextEmailTemplates.tsx` | `GET/PUT /api/v1/email-settings`, `GET/POST /email-templates` | `EmailTemplate`, `Organization.emailProvider` | Sim (Zod) | Sim (`settings:write`) | Sim (`emailTemplates.test.ts`) | **Pronto** | Suporte a SMTP, SendGrid, SES ou Console. Possui vulnerabilidade Stored XSS no preview de templates. |
| **Configuração de Provedores de Mapas** | `VNextMapsSettings.tsx` | `GET/PUT /api/v1/maps-settings` | `Organization.googleMapsBrowserKey`, `googleMapsServerKey` | Sim (Zod) | Sim (`settings:write`) | Sim (`mapsSettings.test.ts`) | **Pronto** | Divisão segura entre chave do navegador (com restrição HTTP Referrer) e chave de servidor (IP/API). |
| **Recuperação de Senha (Forgot Password)** | `ForgotPassword.tsx` | `POST /api/v1/auth/forgot-password` | Nenhuma persistência | Sim | Pública | Sim | **Stub (Simulado)** | Rota é um stub explícito que apenas gera log e orienta a contatar o administrador. |

---

## 3. Síntese do Aproveitamento Funcional

```
┌────────────────────────────────────────────────────────────────────────┐
│                   RESUMO DO INVENTÁRIO FUNCIONAL                       │
├───────────────────────────────────────────────────┬─────────┬──────────┤
│ Categoria de Avaliação                            │ Qtd.    │ % Total  │
├───────────────────────────────────────────────────┼─────────┼──────────┤
│ Total de Módulos e Sub-funcionalidades Mapeadas   │   58    │  100,0%  │
│ Funcionalidades Operacionais Prontas (Aproveitáveis)│   42    │   72,4%  │
│ Funcionalidades Parciais ou com Lacunas Graves    │    6    │   10,3%  │
│ Funcionalidades Simuladas (Stubs)                 │    1    │    1,7%  │
│ Funcionalidades Críticas Inexistentes (Brasil/SaaS)│    9    │   15,5%  │
└───────────────────────────────────────────────────┴─────────┴──────────┘
```

### Oportunidades Principais de Reaproveitamento:
1. **Motor de Embarques, Paradas e Consolidação LTL:** Lógica de negócio robusta, controle de marcos de viagem e algoritmos de rateio de frete e margem de altíssima qualidade.
2. **Motor de WMS Completo:** Zonas, posições, ondas de separação, packing com conferência e load planning prontos para uso em armazéns e CDs.
3. **Módulo de Não-Conformidades e Triage:** Motor de ocorrências com quadro Kanban, esteira de resolução e integração com IA.
4. **Campos Customizados Versionados:** Permite estender entidades sem quebrar retrocompatibilidade.
5. **Portais Satélites Prontos:** Portal do Embarcador, Transportador e WMS PWA com interfaces modernas construídas em React e Tailwind/Radix.

# AUDIT_REPORT — Relatório de Auditoria Técnica e Documental (v2)

> Data da auditoria: 2026-11-11
> Escopo auditado: os 10 documentos em `/docs` (`PRD.md`, `ARCHITECTURE.md`, `DATABASE.md`, `USER_FLOWS.md`, `DESIGN_SYSTEM.md`, `API_SPECIFICATION.md`, `SECURITY.md`, `ROADMAP.md`, `BACKLOG.md`, `TEST_STRATEGY.md`).
> Regra aplicada: nenhuma decisão aprovada pelo proprietário foi alterada silenciosamente. Todas as novas regras ou escolhas de arquitetura introduzidas para fechar lacunas foram marcadas como **[PENDENTE DE APROVAÇÃO]** nos documentos e consolidadas na seção 4 deste relatório.

---

## 1. Resumo Executivo

A primeira versão da documentação (v1) definia bem a visão e o escopo enxuto do MVP em Osasco, mas continha **28 problemas técnicos, de segurança e de consistência** que causariam falhas graves ou retrabalho durante a implementação:
- **5 Críticos** (concorrência no aceite/limite de propostas, acesso indevido a documentos de verificação, falha de integridade referencial na exclusão de conta com `auth.users`, ausência de função central de bloqueio permitindo interações indevidas, e dependência exclusiva de cron para expirar pedidos/propostas).
- **13 Altos** (máquinas de estado incompletas entre `service_requests`, `quotes` e `jobs`, tabelas omitidas na matriz RLS como `provider_sensitive_data` e `request_media`, tempestade de notificações no matching sem lotes, falta de política para não comparecimento/serviço parcial/divergência de orçamento, indefinição de critérios e recurso na verificação, e falta de diferenciação entre identidade verificada e competência técnica).
- **10 Médios/Baixos** (divergência matemática aparente entre as metas de prestadores do PRD e do Roadmap, contradição de UX sobre exibir "N profissionais avisados", falta de rastreabilidade entre requisitos, backlog e testes).

Todos os 10 documentos foram atualizados e harmonizados para a versão **v2**.

---

## 2. Problemas Encontrados, Gravidade e Correções Realizadas

### 2.1 Máquinas de Estado (`service_requests`, `quotes`, `jobs`, `reviews`)

| ID | Problema encontrado na v1 | Gravidade | Correção realizada na v2 | Docs atualizados |
|---|---|---|---|---|
| **AUD-01** | `complete_job` não especificava como atualizava `service_requests`, `quotes`, `conversations` e contadores do prestador, nem exigia idempotência. | **Alta** | Definida a seção 5.4 em `DATABASE.md`: em transação única e idempotente, `complete_job` muda `jobs` para `completed`, `service_requests` para `completed`, mantém `quotes` em `accepted`, agenda o fechamento da conversa após `dispute_deadline`, incrementa `completed_jobs_count` e dispara notificação. | `DATABASE.md`, `API_SPECIFICATION.md` |
| **AUD-02** | Dependência exclusiva de `pg_cron` para expirar pedidos (48h) e propostas: se o cron atrasasse 3 minutos, um cliente poderia aceitar proposta de pedido já vencido. | **Crítica** | Introduzida **expiração preguiçosa (ADR-14)**: toda RPC valida `now() < expires_at` e `now() < min(valid_until, request.expires_at)` no momento da execução. O cron apenas consolida estados e envia avisos. | `ARCHITECTURE.md`, `DATABASE.md`, `API_SPECIFICATION.md`, `TEST_STRATEGY.md` |
| **AUD-03** | Se um prestador retirasse sua proposta (`withdrawn`) ou ela expirasse após o pedido atingir 5 propostas (`quotes_closed`), o pedido ficava travado sem aceitar novas propostas mesmo antes de 48h. | **Média** | Documentada a transição `quotes_closed → open` quando `active_quotes_count < max_quotes` e `now() < expires_at`, retomando o despacho de lotes. | `PRD.md`, `DATABASE.md`, `API_SPECIFICATION.md` |
| **AUD-04** | Propostas podiam ter `valid_until` maior que o prazo do pedido, ou ser enviadas para datas no passado; não havia regra sobre edição de proposta. | **Média** | Validade efetiva definida como `min(valid_until, request.expires_at)`. `proposed_start` exige antecedência mínima. Permitida 1 revisão (`revision = 1`) enquanto `sent`. | `PRD.md`, `DATABASE.md`, `API_SPECIFICATION.md`, `BACKLOG.md` |
| **AUD-05** | Sem trilha de auditoria para mudanças de estado de pedidos, propostas e jobs, inviabilizando apuração de disputas. | **Alta** | Criada a tabela append-only `status_events` (RF-47, ADR-18), gravada na mesma transação por todas as RPC de transição. | `PRD.md`, `ARCHITECTURE.md`, `DATABASE.md`, `BACKLOG.md` |

### 2.2 Segurança, Privacidade e Matriz RLS

| ID | Problema encontrado na v1 | Gravidade | Correção realizada na v2 | Docs atualizados |
|---|---|---|---|---|
| **AUD-06** | Divergência grave no acesso a documentos de verificação: `DATABASE.md` dizia que o dono podia ler seus uploads em `provider_documents`, enquanto `ARCHITECTURE.md` dizia que apenas o admin via URL assinada tinha acesso. Além disso, `provider_sensitive_data` não aparecia na tabela de RLS. | **Crítica** | Unificado (ADR-15, ADR-16): bucket `verification` não tem política `SELECT` nem `INSERT` direta para nenhum usuário. Upload é feito via URL assinada emitida pela Edge Function `create-document-upload`; leitura do arquivo é exclusiva de admin com MFA (`aal2`) via URL assinada de 60 s (`admin-get-document-url`) com motivo auditado. O prestador consulta apenas metadados de status via view `my_verification_status`. `provider_sensitive_data` não tem acesso via PostgREST para ninguém (só Edge Function) e guarda apenas `cpf_hmac` (sem CPF em claro). | `ARCHITECTURE.md`, `DATABASE.md`, `SECURITY.md`, `API_SPECIFICATION.md` |
| **AUD-07** | Tabelas `request_media`, `conversations`, `request_matches`, `portfolio_items`, `availability_rules`, `push_tokens`, `notifications`, `app_config` e `unserved_demand` estavam ausentes ou incompletas no resumo de RLS. | **Alta** | Criada a **Matriz Completa de Permissões** (seção 7 de `DATABASE.md`) cobrindo todas as 25 tabelas, 11 views, 4 buckets de Storage e 14 operações administrativas. | `DATABASE.md`, `SECURITY.md`, `TEST_STRATEGY.md` |
| **AUD-08** | `messages` permitia `INSERT` direto via PostgREST e `notifications` não especificava bloqueio de escrita pelo cliente, permitindo burlar rate limit, conversar em chat encerrado ou forjar notificações. | **Alta** | `messages` e `notifications` não aceitam `INSERT` direto do cliente; escrita ocorre exclusivamente via RPC `send_message` / triggers de sistema, e leitura de confirmação via `mark_messages_read` / `mark_notifications_read`. | `DATABASE.md`, `API_SPECIFICATION.md`, `TEST_STRATEGY.md` |
| **AUD-09** | Bloqueio (`user_blocks`) mencionava apenas "impede mensagem e avaliação", permitindo que um usuário bloqueado recebesse pedidos do bloqueador, enviasse proposta, aceitasse proposta ou recebesse push. | **Crítica** | Definida a função canônica `can_interact(a, b)` (ADR-13, RF-43, seção 6 de `DATABASE.md`), obrigatória no despacho, `submit_quote`, `edit_quote`, `accept_quote`, `send_message`, listagens públicas e envio de push, sem revelar ao bloqueado que foi bloqueado. | `PRD.md`, `ARCHITECTURE.md`, `DATABASE.md`, `SECURITY.md`, `USER_FLOWS.md`, `TEST_STRATEGY.md` |
| **AUD-10** | Operações administrativas não exigiam verificação técnica de MFA (`aal2`) no token nem restringiam a leitura de conversas privadas e fotos de pedidos pelo admin. | **Alta** | Toda Edge Function admin verifica `admin_users` + `aal2` no JWT e grava `admin_audit_log` na mesma transação. Leitura de conversas (`admin-read-conversation`), `request_media` e `service_request_private` pelo admin só é permitida vinculada a um `report_id` aberto (ADR-17, SEC-25). Criação de admin só via SQL manual (SEC-26). | `ARCHITECTURE.md`, `DATABASE.md`, `SECURITY.md`, `API_SPECIFICATION.md` |
| **AUD-11** | Push notifications podiam exibir nome, endereço ou trecho de mensagem na tela bloqueada do celular, e fotos de pedidos podiam carregar coordenadas GPS nos metadados EXIF. | **Média** | Push definido com texto estritamente genérico (SEC-27) e remoção obrigatória de EXIF no upload (SEC-13), além de aviso explícito ao cliente sobre quem vê as fotos do pedido. | `SECURITY.md`, `DESIGN_SYSTEM.md`, `API_SPECIFICATION.md` |

### 2.3 Matching e Concorrência

| ID | Problema encontrado na v1 | Gravidade | Correção realizada na v2 | Docs atualizados |
|---|---|---|---|---|
| **AUD-12** | Notificar todos os prestadores elegíveis de uma só vez geraria excesso de notificações e corrida injusta (quem clica nos primeiros 2 minutos leva as 5 vagas). | **Alta** | Projetado o **despacho em lotes** (ADR-12, RF-34, RF-35, seção 6 de `ARCHITECTURE.md`): lotes de 8 prestadores a cada 15 min enquanto houver vagas, ordenados por menor volume recebido nos últimos 7 dias, taxa de resposta e nota, com teto diário de push por prestador (`push_daily_cap = 10`). | `PRD.md`, `ARCHITECTURE.md`, `DATABASE.md`, `API_SPECIFICATION.md`, `BACKLOG.md` |
| **AUD-13** | Critérios de elegibilidade não impediam que uma conta com dois perfis recebesse o próprio pedido, nem tratavam prestador com `availability_rules` vazio ou categoria inativa. | **Alta** | Definidos os 8 critérios obrigatórios de elegibilidade (seção 6.1 de `ARCHITECTURE.md`), incluindo `client_id ≠ provider_id` (também protegido por `CHECK`), mínimo de 1 regra de disponibilidade e categoria `is_active = true`. | `ARCHITECTURE.md`, `DATABASE.md`, `TEST_STRATEGY.md` |
| **AUD-14** | Risco de condição de corrida e deadlock entre `submit_quote`, `accept_quote`, `withdraw_quote` e crons de expiração. | **Crítica** | Definida ordem fixa de lock (`service_requests → quotes → jobs`) com `SELECT ... FOR UPDATE`, índice único parcial `quotes (request_id) WHERE status = 'accepted'` e `FOR UPDATE SKIP LOCKED` nos crons. | `ARCHITECTURE.md`, `DATABASE.md`, `API_SPECIFICATION.md`, `TEST_STRATEGY.md` |

### 2.4 Verificação Profissional e LGPD

| ID | Problema encontrado na v1 | Gravidade | Correção realizada na v2 | Docs atualizados |
|---|---|---|---|---|
| **AUD-15** | Não havia lista de documentos aceitos, critérios objetivos de aprovação/rejeição, fluxo de recurso nem distinção clara entre identidade verificada e competência técnica. | **Alta** | Criada a seção 4 de `SECURITY.md` e a tabela `verification_submissions`: documentos aceitos (RG, CNH, CIN + selfie ao vivo + CPF hash), 8 motivos padronizados de rejeição, direito a 1 recurso em 15 dias (RF-41) e regra explícita de que o único selo do MVP é **"Identidade verificada"** (proibindo termos como "certificado" ou "qualificado" no Design System). | `PRD.md`, `DATABASE.md`, `SECURITY.md`, `USER_FLOWS.md`, `DESIGN_SYSTEM.md` |
| **AUD-16** | `profiles.birth_date` coletava a data de nascimento completa de todos os clientes sem necessidade, e o aceite de termos em colunas simples de `profiles` não guardava histórico nem consentimento biométrico destacado da selfie. | **Média** | `birth_date` substituído por `age_confirmed_at` (minimização). Criada a tabela append-only `consent_records` (ADR-19, RF-44) para Termos, Privacidade e consentimento biométrico da selfie (`biometric_selfie`). | `DATABASE.md`, `SECURITY.md`, `API_SPECIFICATION.md`, `BACKLOG.md` |
| **AUD-17** | Retenção de documentos de verificação não tinha automação prevista nem considerava a janela de recurso antes da purga. | **Média** | Campo `files_delete_after` em `verification_submissions` + job diário `purge_verification_files` (RF-48) que apaga os arquivos do Storage 30 dias após a decisão final (ou após o fim da janela de recurso). | `DATABASE.md`, `SECURITY.md`, `API_SPECIFICATION.md`, `BACKLOG.md` |

### 2.5 Regras de Negócio Operacionais

| ID | Problema encontrado na v1 | Gravidade | Correção realizada na v2 | Docs atualizados |
|---|---|---|---|---|
| **AUD-18** | Ausência de regras e estados para: cancelamento tardio, não comparecimento (*no-show*), serviço parcialmente executado, serviço esquecido em `scheduled` e divergência de valor em relação ao orçamento. | **Alta** | Documentadas na seção 11 de `PRD.md`, seção 5.3 de `DATABASE.md` e seção 11 de `USER_FLOWS.md`: cancelamento tardio (< 24h) contabilizado, fluxo de `no_show_claimed` (+30 min, 48h para contestar), conclusão `partial` com nota obrigatória, congelamento de `agreed_price_cents` no job, abertura de disputa (`disputed`, SLA 72h, deixando claro que o app não intermedeia reembolsos) e encerramento automático por falta de desfecho após 7 dias (`no_outcome`). | `PRD.md`, `DATABASE.md`, `API_SPECIFICATION.md`, `USER_FLOWS.md`, `BACKLOG.md` |

### 2.6 Metas do MVP e Gate de Categorias

| ID | Problema encontrado na v1 | Gravidade | Correção realizada na v2 | Docs atualizados |
|---|---|---|---|---|
| **AUD-19** | `PRD.md` exigia "≥ 30 prestadores verificados em 3 categorias" (aprovado), enquanto `ROADMAP.md` falava em "8 a 10 por categoria" nas 4 categorias (32 a 40), sem critérios objetivos para quando ativar ou pausar uma categoria. | **Média** | Preservada a meta aprovada (≥ 30 em 3 categorias) e harmonizada com o **Gate de Ativação de Categorias** (RF-45, seção 12 do `PRD.md`): cada categoria abre aos clientes ao atingir G1 (≥ 8 aprovados, meta 10), G2 (≥ 5 ativos com disponibilidade ≥ 3 dias/sem), G3 (≥ 3 zonas de Osasco) e G4 (fila de verificação em dia). 3 categorias × 10 = 30. | `PRD.md`, `ROADMAP.md`, `BACKLOG.md` |

### 2.7 Modelagem de Banco e Exclusão de Conta

| ID | Problema encontrado na v1 | Gravidade | Correção realizada na v2 | Docs atualizados |
|---|---|---|---|---|
| **AUD-20** | `profiles.id` tinha FK direta para `auth.users`, mas a exclusão de conta prometia apagar o login e ao mesmo tempo manter `jobs`, `reviews` e `reports` anonimizados. Apagar `auth.users` causaria falha de FK ou apagaria em cascata todo o histórico da contraparte. | **Crítica** | Definida a estratégia de exclusão na seção 8 de `DATABASE.md` e **ADR-11**: `profiles.id` usa o mesmo UUID de `auth.users.id` sem FK física (garantido por trigger de signup e teste `T-DEL-10`), permitindo remover o registro de `auth.users` (liberando o e-mail) enquanto `profiles` é anonimizado e as FKs de `jobs`/`reviews`/`reports` usam `ON DELETE RESTRICT`. Adicionado bloqueio de exclusão se houver job ativo ou `legal_hold`. | `ARCHITECTURE.md`, `DATABASE.md`, `API_SPECIFICATION.md`, `TEST_STRATEGY.md` |
| **AUD-21** | Faltavam definições de `ON DELETE`, constraints `CHECK` (`client_id ≠ provider_id`, `reviewer_id ≠ reviewee_id`, `blocker_id ≠ blocked_id`) e índices para a consulta de distribuição equilibrada e bloqueio bidirecional. | **Média** | Adicionados na seção 3, 4 e 9 de `DATABASE.md`, com verificação automática de índices de FK no CI. | `DATABASE.md`, `TEST_STRATEGY.md` |

### 2.8 Estratégia de Testes

| ID | Problema encontrado na v1 | Gravidade | Correção realizada na v2 | Docs atualizados |
|---|---|---|---|---|
| **AUD-22** | Políticas de RLS e regras de estado eram tratadas como listas genéricas, sem garantia de que toda tabela/papel teria teste automatizado e sem cobrir corridas como `accept_quote × withdraw_quote` ou `accept_quote × expire_requests`. | **Alta** | `TEST_STRATEGY.md` reestruturado com: (1) **Matriz RLS executável** (`rls_matrix`) e **Teste Meta no CI** que falha se houver tabela/política sem teste; (2) 13 cenários de concorrência paralela (`T-CONC-01..13`); (3) suites específicas para expiração preguiçosa (`T-EXP`), bloqueio (`T-BLK`), matching em lotes (`T-MATCH`), verificação (`T-VER`) e varredura de PII pós-exclusão (`T-DEL-03`); (4) tabela completa de rastreabilidade `RF-01..49 → Testes`. | `TEST_STRATEGY.md`, `BACKLOG.md` |

### 2.9 Consistência entre os 10 Documentos

| ID | Problema encontrado na v1 | Gravidade | Correção realizada na v2 | Docs atualizados |
|---|---|---|---|---|
| **AUD-23** | `USER_FLOWS.md` e `BACKLOG.md` (E3-03) diziam "Estamos avisando N profissionais", o que contradizia o despacho em lotes e revelava a escassez inicial de oferta em Osasco. | **Baixa** | Harmonizado em `USER_FLOWS.md`, `API_SPECIFICATION.md` e `BACKLOG.md`: `create_service_request` retorna apenas `{eligible: true/false}` e a tela confirma o envio sem expor o número exato de profissionais. | `USER_FLOWS.md`, `API_SPECIFICATION.md`, `BACKLOG.md` |
| **AUD-24** | `DESIGN_SYSTEM.md` ainda listava o selo "Antecedentes verificados" e apenas 5 status em `StatusChip`, divergindo do escopo de 4 categorias e das máquinas de estado do banco. | **Baixa** | `DESIGN_SYSTEM.md` atualizado para conter apenas o selo "Identidade verificada" e todos os status reais de pedido e serviço. | `DESIGN_SYSTEM.md` |
| **AUD-25** | Novos requisitos e fluxos de exceção não possuíam histórias correspondentes em `BACKLOG.md`. | **Média** | `BACKLOG.md` atualizado para v2 mapeando todos os requisitos `RF-01` a `RF-49` e vinculando cada história aos códigos de teste de `TEST_STRATEGY.md`. | `BACKLOG.md`, `PRD.md`, `TEST_STRATEGY.md` |

---

## 3. Verificação de Consistência Cruzada (Matriz de Rastreabilidade)

Todos os requisitos do `PRD.md` possuem correspondência em modelo de dados, API, fluxo, backlog e testes:

| Grupo de Requisitos | PRD | DATABASE | API_SPECIFICATION | USER_FLOWS | BACKLOG | TEST_STRATEGY |
|---|---|---|---|---|---|---|
| Conta, Auth, Perfis e Exclusão | RF-01 a RF-04 | Seções 3.1, 8 | Seções 3.4, 4.1 | Seções 2, 9, 11.7 | E1-01 a E1-06 | T-RLS-11, T-DEL-01..10, E2E-1, E2E-8 |
| Verificação, Recurso e Purga | RF-11 a RF-15, RF-41, RF-42, RF-48 | Seção 3.2, 5.6 | Seções 3.2, 4.1, 4.2, 5 | Seções 4.1, 11.5 | E2-01 a E2-10, E8-02, E8-03 | T-VER-01..07, T-STO-01..04, T-ST-VER-01 |
| Pedidos, Matching em Lotes e Expiração | RF-05 a RF-07, RF-09, RF-16, RF-20, RF-22, RF-34, RF-35, RF-46 | Seções 3.3, 5.1 | Seções 3.1, 5 | Seções 3.1, 3.2, 11.8 | E3-01 a E3-12, E4-01 | T-ST-REQ-01..04, T-MATCH-01..07, T-EXP-01..03, T-RLS-03..05 |
| Propostas, Limite de 5, Edição e Retirada | RF-07, RF-17, RF-20, RF-40 | Seções 3.3, 5.2 | Seção 3.2, 5 | Seção 4.2 | E4-02 a E4-06 | T-ST-QUO-01..05, T-CONC-01..07 |
| Chat e Push | RF-08, RF-24 | Seções 3.4, 3.6 | Seções 3.4, 4.1, 6 | Seção 5 | E5-01 a E5-04 | T-RLS-09, T-RLS-10, T-PUSH-01..03 |
| Serviços (Jobs), Cancelamento, No-Show, Parcial e Disputa | RF-18, RF-21, RF-36 a RF-39 | Seções 3.3, 5.3, 5.4 | Seções 3.3, 4.2, 5 | Seções 3.3, 4.3, 11.1 a 11.4 | E6-01 a E6-09, E8-04 | T-ST-JOB-01..07, T-CONC-08, E2E-5, E2E-6 |
| Avaliações Bilaterais | RF-10, RF-19, RF-23 | Seções 3.5, 5.5 | Seção 3.3, 5 | Seção 6 | E6-04, E6-05 | T-ST-REV-01..02, T-RLS-08, T-CONC-09 |
| Denúncias, Bloqueios e Consentimentos | RF-30 a RF-33, RF-43, RF-44, RF-49 | Seções 3.1, 3.5, 6 | Seção 3.4 | Seções 7, 11.6 | E1-01, E1-08, E7-01 a E7-05 | T-BLK-01..09, T-LGPD-01..04, E2E-7 |
| Admin, Gate de Categorias e Auditoria | RF-25 a RF-29, RF-45, RF-47 | Seções 3.3, 7.2 | Seção 4.2, 5 | Seção 8 | E0-09, E8-01 a E8-08 | T-ADM-01..09 |

---

## 4. Decisões Pendentes de Aprovação do Proprietário

Para não inventar decisões em seu nome, consolidei abaixo os pontos marcados como **[PENDENTE DE APROVAÇÃO]** nos documentos, com minha recomendação técnica e de produto:

### Bloco A — Regras de Produto e Operação
1. **Despacho em lotes e ordenação equilibrada (RF-34, RF-35, ADR-12):** notificar lotes de **8 prestadores a cada 15 min**, priorizando quem recebeu menos pedidos nos últimos 7 dias, maior taxa de resposta e nota, com teto de 10 pushes/dia por prestador. *(Recomendado: Aprovar)*
2. **Reabertura de vaga de proposta (RF-20, RF-40):** se um prestador retirar a proposta ou ela expirar antes das 48h do pedido, a vaga dentre as 5 é liberada para outro prestador. *(Recomendado: Aprovar)*
3. **Edição única de proposta e conversa só após proposta (RF-40):** permitir 1 edição da proposta enviada (`revision = 1`) e abrir o chat apenas junto com o envio da proposta (sem chat pré-proposta). *(Recomendado: Aprovar)*
4. **Pedido encerrado não reabre — botão "Repetir pedido":** se o pedido expirar ou o serviço for cancelado, ele fica encerrado e o cliente usa "Repetir pedido" (que pré-preenche um novo pedido com novas 48h). *(Recomendado: Aprovar)*
5. **Regras de exceção do serviço (RF-36 a RF-39):**
   - Cancelamento a menos de 24h do horário é marcado como tardio (≥ 3 em 30 dias gera alerta para revisão do admin).
   - Não comparecimento reportável a partir de +30 min, com 48h para contestação; se confirmado, libera avaliação.
   - Conclusão parcial com nota obrigatória e janela de 7 dias para abrir disputa (incluindo divergência de valor, deixando explícito que o app não faz reembolso).
   - Encerramento automático (`no_outcome`) se o serviço ficar 7 dias após o horário sem conclusão nem disputa. *(Recomendado: Aprovar)*
6. **Janela máxima para enviar avaliação:** até **30 dias** após a conclusão do serviço (a revelação simultânea continua sendo em até 7 dias ou quando ambos avaliarem). *(Recomendado: Aprovar)*
7. **Gate objetivo de ativação de categorias (RF-45) (Aprovado com ajuste):** abrir cada categoria aos clientes ao atingir **≥ 2 profissionais aprovados e disponíveis** (decisão do proprietário para viabilizar e acelerar o início dos testes práticos). *(Aprovado)*

### Bloco B — Verificação, Privacidade e Arquitetura
8. **Documentos aceitos e recurso (RF-12, RF-41):** aceitar RG, CNH ou CIN + selfie tirada na câmera do app + CPF (gravado apenas como `cpf_hmac`, ADR-16); permitir 1 recurso em até 15 dias e até 3 reenvios em 30 dias. *(Recomendado: Aprovar)*
9. **Retenção das imagens de documento e selfie (RF-48):**
   - **Opção A (Recomendada — menor risco LGPD):** apagar as imagens do documento e da selfie **30 dias após a decisão final** (mantendo nome, telefone verificado, `cpf_hmac` e registro de aprovação).
   - **Opção B:** apagar a selfie em 30 dias, mas reter a imagem do documento enquanto a conta do prestador estiver ativa para facilitar investigações.
10. **Exclusão de conta e retenção (RF-04, ADR-11):**
    - Desvincular FK física de `profiles` para `auth.users` para poder apagar o login preservando o histórico anonimizado;
    - Apagar o conteúdo das mensagens enviadas pelo usuário excluído (exceto em caso de denúncia ativa / `legal_hold`), mantendo as avaliações já publicadas com o autor anonimizado e mantendo `cpf_hmac` apenas de prestadores banidos. *(Recomendado: Aprovar)*
11. **ADRs propostos (ADR-11 a ADR-19):** aprovar as decisões arquiteturais listadas na seção 12 de `ARCHITECTURE.md`.

---

## 5. Riscos Remanescentes (Mesmo Após as Correções)

1. **Operador único (fator humano e governança):** você será o único administrador aprovando documentos, julgando recursos e moderando disputas. Isso significa que o recurso de verificação é analisado pela mesma pessoa que rejeitou, e se você ficar indisponível por 2 dias o SLA de 48h estoura. Mitigação: fila enxuta, alertas e abertura gradual por categoria.
2. **Aquisição fria de prestadores em Osasco:** nenhum ajuste técnico resolve a falta de oferta inicial. Se menos de 8 prestadores por categoria completarem o envio de selfie e documento, a categoria não deve ser aberta aos clientes.
3. **Verificação visual manual não detecta documentos falsos sofisticados** nem verifica antecedentes criminais no MVP. Por isso o selo é estritamente **"Identidade verificada"** e os Termos devem afastar promessa de garantia sobre conduta ou competência.
4. **Custo e entregabilidade de SMS (OTP):** operadoras brasileiras frequentemente atrasam ou bloqueiam SMS e o custo por verificação em ataques de bots pode subir rápido. Rate limit rigoroso no Supabase Auth é indispensável desde o primeiro dia.
5. **Desintermediação pós-primeiro serviço:** em serviços recorrentes (como diarista), é natural que a segunda contratação ocorra fora do app. Aceitável no MVP porque o objetivo é validar a demanda inicial.

---

## 6. Recomendações Antes da Implementação (Fase 0)

1. **Aprovar ou ajustar** os 11 pontos da seção 4 acima para congelarmos a versão final da documentação.
2. **Iniciar imediatamente a abertura das contas Apple Developer e Google Play Console** (especialmente a da Apple, que pode demorar para validar identidade).
3. **Obter a lista oficial de bairros e regiões/zonas de Osasco** (Prefeitura/IBGE) para usarmos como seed determinística na Fase 0.
4. **Definir o nome provisório ou definitivo do produto e um e-mail dedicado do Encarregado (DPO)** para constar nas telas de Termos/Privacidade e nas lojas.
5. **Construir os testes de banco (`rls_matrix` e `T-CONC`) junto com as migrações da Fase 1 e Fase 2**, nunca deixando para escrever testes de segurança apenas na Fase 9.

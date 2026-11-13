# API_SPECIFICATION — Especificação das APIs

> Status: **Revisado pela auditoria (v2), pendente de aprovação**. Novos itens: **[PENDENTE DE APROVAÇÃO]**.
> Sem backend próprio. A "API" é: **(A)** leituras via views com RLS, **(B)** RPC no Postgres para escrita com regra de negócio, **(C)** Edge Functions, **(D)** jobs agendados, **(E)** Realtime. Estados e transições: ver [DATABASE.md](DATABASE.md) seção 5.

## 1. Princípios

1. O app **nunca** altera status diretamente. Toda transição passa por RPC/Edge Function e grava `status_events`.
2. A identidade vem de `auth.uid()`. **Nenhuma** função aceita `user_id` do cliente.
3. Toda RPC com duas partes chama `can_interact(a, b)` (DATABASE seção 6).
4. Toda RPC de prazo compara com `now()` (**expiração preguiçosa**). O cron só consolida.
5. Operações que mudam estado são **idempotentes**: repetir a chamada retorna o estado atual sem duplicar efeitos. Suportam `idempotency_key` opcional do cliente nas criações.
6. Concorrência: RPC críticas bloqueiam a linha do pedido/job (`SELECT … FOR UPDATE`) em **ordem fixa** (pedido → proposta → job) para evitar deadlock.
7. Validação de entrada no app (Zod) **e** no servidor (CHECK/RPC).
8. Listas paginadas por cursor `(created_at, id)`.
9. Notificações e push **não** carregam dados pessoais nem conteúdo de mensagens (texto genérico).

## 2. Leituras (views `security_invoker` com RLS)

| View | Quem | Observação |
|---|---|---|
| `categories`, `neighborhoods` (ativos) | Autenticado | Cache longo |
| `public_provider_profiles` | Autenticado | Só `approved`, `is_active` da categoria e `can_interact`. Selo apenas **"Identidade verificada"** |
| `public_reviews` | Autenticado | Só `published`. Autor anonimizado se removido |
| `my_requests`, `quotes_for_my_request` | Cliente | |
| `incoming_requests` | Prestador | Só pedidos com match notificado. **Sem** endereço, telefone ou identidade do cliente (apenas primeiro nome) |
| `my_quotes`, `my_jobs`, `my_conversations`, `my_notifications` | Dono/participante | `my_jobs` inclui endereço só para o prestador do job |
| `my_verification_status` | Prestador | Status, motivo de rejeição, prazos. **Sem notas internas** |
| `public_app_config` | Autenticado | Só parâmetros públicos (limites do app, versão mínima) |

## 3. RPC (escrita)

### 3.1 Cliente

| Função | Pré-condições | Efeito |
|---|---|---|
| `create_service_request` | Telefone verificado, categoria `is_active`, `max_open_requests` e limite diário respeitados, termos aceitos | Cria pedido (`open`) + privado + mídia, calcula elegíveis, cria `request_matches` com lotes (seção 5 do ARCHITECTURE). Sem elegíveis: cria como `expired` (`no_eligible_providers`) + `unserved_demand`. Retorna **apenas** `{eligible: true/false}` (não o número) |
| `cancel_service_request` | Dono. Status `open`/`quotes_closed` | `cancelled`; propostas `sent` → `rejected`; conversas → `read_only` |
| `accept_quote` | Dono do pedido. Proposta `sent` com validade efetiva futura. Pedido `open`/`quotes_closed`. `can_interact`. Prestador `approved`/ativo. `proposed_start` futuro | Transação única: proposta `accepted`, irmãs `rejected`, pedido `hired`, cria job (`agreed_price_cents`, `scheduled_for`), libera endereço, conversas não aceitas → `read_only`, eventos, push |
| `repeat_service_request` | Dono. Pedido terminal | Copia dados para novo pedido (passa pelas mesmas validações) **[PENDENTE DE APROVAÇÃO]** |
| `set_notify_when_available` | Dono de pedido `no_eligible_providers` | Marca "Avise-me" **[PENDENTE DE APROVAÇÃO]** |

### 3.2 Prestador

| Função | Pré-condições | Efeito |
|---|---|---|
| `submit_quote` | `approved`, ativo, não pausado, match notificado e não dispensado, pedido `open`, sem proposta anterior, `can_interact`, vaga disponível (sob lock), validade e valor válidos | Cria proposta `sent` e conversa. Incrementa `active_quotes_count`. Fecha o pedido ao atingir o limite. Erros: `REQUEST_CLOSED`, `QUOTE_LIMIT_REACHED`, `ALREADY_QUOTED` |
| `edit_quote` | Dono. `sent`. `revision = 0` | Atualiza valores. `revision = 1`. Notifica cliente **[PENDENTE DE APROVAÇÃO]** |
| `withdraw_quote` | Dono. `sent` | `withdrawn`. Libera vaga. Reabre pedido se `quotes_closed` e antes de `expires_at` |
| `dismiss_request` | Match próprio | Preenche `dismissed_at` |
| `set_provider_paused` | Aprovado | Pausa/retoma recebimento |
| `update_provider_profile` | Dono | Só campos de perfil. **Nunca** status/nota/contadores |
| `set_availability`, `set_categories`, `set_neighborhoods` | Dono | Categorias apenas ativas. Pelo menos 1 regra de disponibilidade para ficar elegível |
| `create_document_upload_intent` → ver EF `create-document-upload` | | |
| `submit_provider_for_review` | Telefone verificado, consentimento biométrico registrado, 3 documentos (`id_front`, `id_back`, `selfie`) e CPF informado enviados | Cria `verification_submissions` (`pending`). `pending_review` |
| `appeal_verification` | Submissão `rejected` há ≤ 15 dias, sem recurso anterior | Cria submissão `appeal` (`pending`) |
| `resubmit_verification` | `rejected`, limite de reenvios (3 em 30 dias) **[PENDENTE DE APROVAÇÃO]** | Nova submissão `resubmission` |

### 3.3 Job (cliente e prestador)

| Função | Quem | Condições | Efeito |
|---|---|---|---|
| `cancel_job` | Ambos | `scheduled`, `now < scheduled_for`. Motivo obrigatório | `cancelled`, `is_late_cancellation` se < 24h. Pedido → `cancelled` (`job_cancelled`). Contador de cancelamentos tardios do prestador |
| `complete_job` | Prestador | `scheduled`, `now ≥ scheduled_for`, ≤ +7 dias. `completion_type` | DATABASE seção 5.4 |
| `report_no_show` | Ambos | `scheduled`, ≥ `scheduled_for + 30 min`, ≤ +72h | `no_show_claimed`, prazo de contestação 48h, notifica o acusado |
| `respond_no_show` | Acusado | `no_show_claimed` | Contesta → `disputed` + report |
| `withdraw_no_show_claim` | Acusador | `no_show_claimed` | Volta a `scheduled` |
| `open_dispute` | Ambos | `scheduled` (após horário) ou `completed` (≤ 7 dias). Motivo (`report_reason`) | `disputed` + report `job` (`priority = safety` se ameaça/violência/dano/roubo) |
| `submit_review` | Ambos | Job `completed`/`no_show`, dentro de `reviews_open_until`, sem avaliação prévia, **não** `disputed` | Cria `pending_reveal`. Publica ambas se as duas existem **ou** se `now ≥ reviews_reveal_at`. Recalcula nota ao publicar |

### 3.4 Comunicação e conta

| Função | Pré-condições | Efeito |
|---|---|---|
| `send_message` | Participante, conversa `open`, `can_interact`, 1–2000 caracteres, rate limit | Insere mensagem. Dispara push genérico |
| `mark_messages_read` | Participante | `read_at` nas mensagens recebidas |
| `mark_notifications_read` | Dono | `read_at` |
| `register_push_token` / `remove_push_token` | Autenticado | Upsert / remoção (logout) |
| `block_user` / `unblock_user` | Autenticado | Cria/remove bloqueio. Conversas entre as partes → `read_only` |
| `create_report` | Autenticado | Dedup por usuário+alvo+motivo. `priority = safety` para `threat_or_violence`, `damage_or_theft`, `harassment` grave. `sla_due_at` = 24h (safety) ou 72h |
| `accept_terms` / `record_consent` | Autenticado | Registra versão e tipo em `consent_records`. `biometric_selfie` exige texto específico |
| `request_account_deletion` → ver EF `delete-account` | | |

## 4. Edge Functions

Todas validam JWT e corpo (Zod), retornam o formato de erro padrão e **nunca** logam dados pessoais.

### 4.1 Usuário

| Função | Descrição |
|---|---|
| `create-document-upload` | Valida que o prestador tem submissão em edição. Emite **URL assinada de upload** (um arquivo por tipo, tamanho e MIME fixos). Remove EXIF no processamento. Calcula e grava `cpf_hmac` quando recebe o CPF (o CPF **não** é persistido ou logado) |
| `send-push` | Webhook de banco. Agrega por usuário, respeita `can_interact`, limite diário do prestador (`push_daily_cap`), tokens inválidos removidos. Excesso vira só notificação no app |
| `delete-account` | Reautenticação recente. Verifica pré-condições. Executa DATABASE seção 8 |

### 4.2 Administrativas (exigem `admin_users` + aal2 + auditoria transacional)

`admin-review-provider`, `admin-decide-appeal`, `admin-get-document-url` (60 s, auditado por documento), `admin-moderate`, `admin-resolve-report`, `admin-resolve-dispute`, `admin-read-conversation` (**só com `report_id`**), `admin-set-category`, `admin-set-neighborhood`, `admin-metrics`. Tabela detalhada: DATABASE seção 7.2.
**Não existe** função para criar admin: é manual.

## 5. Jobs agendados (`pg_cron`)

Cada job é **idempotente**, usa `FOR UPDATE SKIP LOCKED` e registra execução. Execução sobreposta não duplica efeitos.

| Job | Frequência | Ação |
|---|---|---|
| `dispatch_batches` | 1 min | Notifica o próximo lote (`scheduled_notify_at ≤ now`) de pedidos `open` com vagas |
| `expire_requests` | 5 min | `open`/`quotes_closed` com `expires_at ≤ now` → `expired`. Propostas `sent` → `expired`. Conversas → `read_only`. Push ao cliente |
| `expire_quotes` | 5 min | Propostas `sent` com validade efetiva vencida → `expired`. Libera vaga e reabre pedido se couber |
| `remind_request_expiring` | 15 min | Cliente com propostas e 12h para expirar **[PENDENTE DE APROVAÇÃO]** |
| `confirm_no_show` | 15 min | `no_show_claimed` com prazo vencido → `no_show` |
| `job_no_outcome` | 1 h | `scheduled` com `scheduled_for + 7d ≤ now` → `cancelled` (`no_outcome`) |
| `job_outcome_reminder` | 1 h | Lembra ambas as partes em `scheduled_for + 24h` sem desfecho |
| `reveal_reviews` | 15 min | Publica avaliações com `reviews_reveal_at ≤ now`. Recalcula nota |
| `archive_conversations` | 1 h | `read_only` após `dispute_deadline` |
| `purge_verification_files` | 1 dia | Apaga arquivos com `files_delete_after ≤ now` (Storage + `purged_at`) |
| `refresh_provider_metrics` | 15 min | Tempo de resposta, contadores |
| `purge_notifications` | 1 dia | 90 dias |
| `check_category_gate` | 1 dia | Calcula métricas do gate e alerta o admin (não altera categorias sozinho) |

## 6. Realtime

- Canal por `conversation_id` para `INSERT` em `messages`. RLS garante que só participantes assinam.
- Sem presença nem "digitando" no MVP.

## 7. Códigos de erro

| Código | Significado |
|---|---|
| `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND` | Sessão, permissão, inexistente/sem acesso (indistinguíveis) |
| `PHONE_NOT_VERIFIED`, `TERMS_NOT_ACCEPTED`, `CONSENT_REQUIRED` | Pré-requisitos de conta |
| `PROVIDER_NOT_APPROVED`, `PROVIDER_PAUSED` | Estado do prestador |
| `CATEGORY_INACTIVE` | Categoria não aberta (gate) |
| `REQUEST_CLOSED`, `REQUEST_EXPIRED` | Pedido não aceita mais ações |
| `QUOTE_LIMIT_REACHED`, `ALREADY_QUOTED`, `QUOTE_EXPIRED`, `QUOTE_ALREADY_EDITED` | Propostas |
| `JOB_TOO_EARLY`, `JOB_TOO_LATE`, `INVALID_STATE` | Transições |
| `BLOCKED` | Falha de `can_interact` (a mensagem ao usuário **não** revela quem bloqueou) |
| `RATE_LIMITED`, `OPEN_REQUESTS_LIMIT` | Limites |
| `ACCOUNT_DELETION_BLOCKED` | Job ativo ou denúncia aberta |
| `VALIDATION_ERROR` | Dados inválidos (com campo) |

## 8. Limites e proteção (parâmetros em `app_config`, PRD seção 11)

- Pedidos: `max_open_requests` por cliente e limite por dia.
- Mensagens: limite por minuto/conversa. 2000 caracteres.
- Denúncias: limite diário por usuário.
- Documentos: 3 arquivos por submissão, 5 MB, MIME `image/jpeg|png`.
- OTP e login: throttle do Auth + CAPTCHA em caso de abuso.
- Alerta de abertura em massa de documentos pelo admin.

## 9. Versionamento

Nova versão incompatível = nova função (`..._v2`). `min_app_version` em `public_app_config` força atualização.

## 10. Fora do escopo do MVP

Webhooks públicos, API para terceiros, pagamentos, busca geoespacial, áudio/vídeo, exportação automática de dados do titular (atendimento manual pelo DPO).

# TEST_STRATEGY — Estratégia de Testes

> Status: **Revisado pela auditoria (v2), pendente de aprovação**.
> Princípio: onde está o **risco** está a cobertura. Aqui o risco está em **autorização (RLS)**, **máquinas de estado**, **concorrência**, **tempo (expiração)**, **bloqueios** e **exclusão de dados**, não na UI.
> **Regra de ouro:** uma política RLS, regra de estado ou função **só é considerada testada quando existe um teste automatizado que falha se ela for removida**. Descrição em documento não conta.

## 1. Pirâmide

| Nível | Foco | Ferramenta | Peso |
|---|---|---|---|
| **Banco** (RLS, RPC, constraints, crons) | Autorização, estados, concorrência, tempo, exclusão | `supabase test db` (pgTAP) + scripts SQL paralelos para concorrência | **Máximo** |
| **Edge Functions** | Autorização admin (aal2), validação, URLs assinadas, hash | Testes Deno | Alto |
| **Unitário** | Schemas Zod, formatação, regras puras | Jest (jest-expo) | Alto |
| **Componentes** | Telas, estados vazio/erro/carregando/offline, acessibilidade | React Native Testing Library | Médio |
| **E2E mobile** | Fluxos críticos | Maestro | Enxuto |
| **Manual** | Push real, acessibilidade, usabilidade, lojas | Roteiros | Obrigatório |

Sem outras ferramentas de teste no MVP.

## 2. Garantia de que as políticas estão testadas (não só descritas)

1. **Matriz executável.** A matriz de permissões (DATABASE seção 7) é transcrita em um arquivo de dados versionado (`supabase/tests/rls_matrix`) com, para cada **tabela × papel × operação (S/I/U/D)**, o resultado esperado (permitido, negado ou "só via função X").
2. **Gerador de testes.** Um teste percorre a matriz e executa **cada célula** com os papéis: `anon`, cliente A, cliente B, prestador aprovado com match, prestador aprovado sem match, prestador não aprovado, prestador do job, prestador de outro job, admin sem MFA, admin com MFA, `service_role` (não exposto). Cada célula tem **um positivo e um negativo**.
3. **Teste meta (CI).** Falha se: (a) existir tabela/view/bucket em `public`/Storage **ausente da matriz**; (b) existir tabela sem RLS; (c) existir política sem teste associado; (d) existir coluna de status atualizável por `authenticated`; (e) existir FK sem índice; (f) existir função `SECURITY DEFINER` sem `search_path` fixo ou sem uso de `auth.uid()`; (g) existir RPC bilateral que não chame `can_interact` (verificado por inspeção do catálogo e por teste comportamental).
4. **Mutação.** Em revisão semestral e antes do beta: remover (em ambiente local) cada política crítica e confirmar que ao menos um teste falha.
5. **Storage:** testes de leitura/escrita por bucket e papel (T-STO).

## 3. Catálogo de testes críticos

Convenção: **ID** → o que prova. Todos obrigatórios (Must) salvo indicação.

### 3.1 Autorização e RLS
| ID | Prova |
|---|---|
| T-RLS-01 | Para toda célula da matriz: negado onde "—", permitido onde permitido |
| T-RLS-02 | Cliente A não lê pedido, proposta, job, conversa, mensagem, notificação, bloqueio ou denúncia do cliente B |
| T-RLS-03 | Prestador sem `request_matches` notificado não vê o pedido nem a mídia |
| T-RLS-04 | **Prestador não aceito nunca lê `service_request_private`**. Prestador do job lê |
| T-RLS-05 | Cliente nunca lê `request_matches` (não vê quem foi notificado) |
| T-RLS-06 | Usuário não altera `verification_status`, `rating_*`, `status` de pedido/proposta/job/perfil, `completed_jobs_count` |
| T-RLS-07 | Usuário não escreve em `admin_users`, `admin_audit_log`, `app_config`, `provider_sensitive_data`, `status_events` |
| T-RLS-08 | `reviews` `pending_reveal` só visível ao autor |
| T-RLS-09 | `messages`: INSERT direto negado. UPDATE só `read_at` por RPC. DELETE negado |
| T-RLS-10 | `notifications`: INSERT negado a usuário. UPDATE só `read_at` |
| T-RLS-11 | Prestador só lê/escreve as próprias categorias, bairros, disponibilidade e portfólio |
| T-RLS-12 | `public_provider_profiles` exclui não aprovados, categorias inativas e bloqueados |
| T-RLS-13 | `incoming_requests` não expõe endereço, telefone ou nome completo |
| T-RLS-14 | `profiles.phone` e dados pessoais não vazam via views públicas |

### 3.2 Documentos de verificação e Storage
| ID | Prova |
|---|---|
| T-STO-01 | Anônimo, outro usuário, **o próprio prestador** e admin (direto) não leem o bucket `verification` por política |
| T-STO-02 | Upload só com URL assinada da EF. INSERT direto negado |
| T-STO-03 | URL assinada de documento **expira em 60 s** (leitura após expirar falha) |
| T-STO-04 | `admin-get-document-url` exige admin + aal2 + motivo e grava auditoria por documento |
| T-STO-05 | `request-media`: acesso conforme matriz (match ativo, contratado, encerrado → revogado) |
| T-STO-06 | EXIF removido em imagens enviadas (ausência de coordenadas) |
| T-STO-07 | Limites de MIME e tamanho |
| T-VER-01 | `provider_sensitive_data` inacessível a qualquer papel exceto EF. CPF em claro **não** persiste (varredura de colunas e logs) |
| T-VER-02 | `cpf_hmac` duplicado bloqueia segunda conta. Banido bloqueia recadastro |
| T-VER-03 | Critérios de rejeição geram motivos corretos. Mensagem ao prestador não vaza critério antifraude |
| T-VER-04 | Recurso: só um por rejeição, só em 15 dias, só do dono. Reenvio respeita o limite |
| T-VER-05 | Purga: arquivos de decisão final são apagados após o prazo (Storage e `purged_at`). Falha gera alerta |
| T-VER-06 | Fila: no máximo uma submissão `pending` por prestador |
| T-VER-07 | Prestador sem consentimento biométrico não submete |

### 3.3 Máquinas de estado
| ID | Prova |
|---|---|
| T-ST-REQ-01 | Toda transição **válida** da tabela 5.1 funciona e grava `status_events` |
| T-ST-REQ-02 | Toda transição **inválida** retorna `INVALID_STATE` (matriz completa estado × ação) |
| T-ST-REQ-03 | Estados terminais não reabrem |
| T-ST-REQ-04 | Criação sem elegíveis nasce `expired` + `unserved_demand` |
| T-ST-QUO-01 | Transições válidas/inválidas de proposta (tabela 5.2) |
| T-ST-QUO-02 | Validade efetiva = `min(valid_until, expires_at)`. Proposta além do pedido é rejeitada |
| T-ST-QUO-03 | Edição única: segunda edição falha. Cliente notificado |
| T-ST-QUO-04 | Retirada libera vaga, reabre `quotes_closed` antes de `expires_at`, e **não** reabre depois |
| T-ST-QUO-05 | Reenvio após retirada negado |
| T-ST-JOB-01 | Transições válidas/inválidas de job (tabela 5.3) incl. janelas de tempo (completar antes do horário falha, cancelar depois falha) |
| T-ST-JOB-02 | `complete_job`: todos os efeitos colaterais (seção 5.4) e **idempotência** |
| T-ST-JOB-03 | Cancelamento tardio sinalizado (< 24h) e contador de 30 dias |
| T-ST-JOB-04 | Não comparecimento: reportar, contestar, retirar, confirmação automática em 48h |
| T-ST-JOB-05 | Parcial exige nota. Disputa a partir de `completed` até 7 dias |
| T-ST-JOB-06 | Disputa resolvida pelo admin aplica `dispute_outcome` e espelha no pedido |
| T-ST-JOB-07 | Sem desfecho em 7 dias → `cancelled` (`no_outcome`), sem avaliações |
| T-ST-REV-01 | Uma avaliação por autor e job. Só participante. Só `completed`/`no_show`. Nunca `cancelled`/`disputed`. Janela de 30 dias |
| T-ST-REV-02 | Revelação: ambos enviaram; ou 7 dias; ou envio após o prazo publica na hora. `rating_*` só com `published` |
| T-ST-VER-01 | Transições de verificação (diagrama 5.6) e suspensão de prestador |

### 3.4 Concorrência (obrigatórios, rodam em CI com sessões paralelas reais)
| ID | Cenário | Resultado esperado |
|---|---|---|
| T-CONC-01 | 20 prestadores enviam proposta ao mesmo pedido ao mesmo tempo | **Exatamente 5** `sent`. Demais `QUOTE_LIMIT_REACHED`. Pedido `quotes_closed` |
| T-CONC-02 | Mesmo prestador envia a mesma proposta 2x em paralelo | Uma só criada |
| T-CONC-03 | `accept_quote` duas vezes em paralelo (mesma proposta) | Um job. Segunda é idempotente |
| T-CONC-04 | `accept_quote` em duas propostas diferentes ao mesmo tempo | Um job. Índice único parcial barra a outra |
| T-CONC-05 | `accept_quote` × `withdraw_quote` da mesma proposta | Resultado consistente. Nunca job de proposta retirada |
| T-CONC-06 | `accept_quote` × `expire_requests` no limite de `expires_at` | Nunca job em pedido expirado |
| T-CONC-07 | `cancel_service_request` × `accept_quote` | Um só vence. Estado coerente |
| T-CONC-08 | `complete_job` × `cancel_job`, e × `open_dispute` | Um só vence. Sem estado híbrido |
| T-CONC-09 | `submit_review` duplicado, e dois autores simultâneos na revelação | Uma por autor. Publicação única. Nota correta |
| T-CONC-10 | `dispatch_batches` executado duas vezes sobreposto | Cada lote notificado uma vez |
| T-CONC-11 | `block_user` × `accept_quote`/`send_message` | Nenhuma interação após o commit do bloqueio |
| T-CONC-12 | `delete-account` × RPC do mesmo usuário | Sem registros órfãos ou parcialmente anonimizados |
| T-CONC-13 | Ausência de deadlock sob carga cruzada (ordem de lock) | Zero deadlocks em N execuções |

### 3.5 Expiração e tempo
| ID | Prova |
|---|---|
| T-EXP-01 | Pedido com `expires_at` vencido: RPC (`accept_quote`, `submit_quote`) **recusa mesmo sem o cron ter rodado** |
| T-EXP-02 | `expire_requests`: pedido → `expired`, propostas → `expired`, conversas → `read_only`, push ao cliente. Idempotente |
| T-EXP-03 | `expire_quotes` por validade menor que a do pedido libera vaga |
| T-EXP-04 | `confirm_no_show`, `job_no_outcome`, `reveal_reviews`, `archive_conversations` no limite exato e um instante antes |
| T-EXP-05 | Fuso `America/Sao_Paulo`: janelas de disponibilidade, "24h antes" e horário de verão não quebram |
| T-EXP-06 | Crons idempotentes com execução repetida e sobreposta |
Técnica: manipular os timestamps das linhas (retroagir `expires_at`, `scheduled_for`, `completed_at`) para simular o tempo, sem *sleep*.

### 3.6 Bloqueio
| ID | Prova |
|---|---|
| T-BLK-01 | Bloqueio em **qualquer direção** impede: elegibilidade em despacho, `submit_quote`, `edit_quote`, `accept_quote`, `send_message` |
| T-BLK-02 | Bloqueado não vê o bloqueador em listagens e perfil público |
| T-BLK-03 | Push/notificações entre as partes são suprimidos |
| T-BLK-04 | Erro não revela quem bloqueou |
| T-BLK-05 | Conversas ficam `read_only` e o histórico permanece legível |
| T-BLK-06 | **Não** são bloqueados: denunciar, concluir/cancelar job existente, avaliar job existente, excluir conta |
| T-BLK-07 | Suspenso/excluído também falha em `can_interact` |
| T-BLK-08 | Meta: toda RPC bilateral falha se `can_interact` for removida |
| T-BLK-09 | Bloqueio durante job agendado fecha o chat e sinaliza admin |

### 3.7 Matching
| ID | Prova |
|---|---|
| T-MATCH-01 | Cada critério de elegibilidade, isoladamente, exclui o prestador (aprovação, pausa, categoria inativa, bairro, disponibilidade, sem regras, bloqueio, mesmo usuário, excesso de pendências) |
| T-MATCH-02 | Lotes: lote 1 imediato com `batch_size`. Seguintes no intervalo, só se há vagas. Para ao fechar |
| T-MATCH-03 | Menos elegíveis que `batch_size`: todos no lote 1 |
| T-MATCH-04 | Ordenação: menos recebidos em 7 dias primeiro. Desempate reprodutível em teste (semente) |
| T-MATCH-05 | Distribuição equilibrada em simulação: 1000 pedidos × 30 prestadores → dispersão limitada |
| T-MATCH-06 | Sem rematch retroativo |
| T-MATCH-07 | Desempenho: despacho com 5.000 prestadores usa os índices (EXPLAIN) |
| T-PUSH-01 | Teto diário por prestador respeitado. Excesso só no app |
| T-PUSH-02 | Payload sem PII (varredura) |
| T-PUSH-03 | Token inválido é removido |

### 3.8 Administração
| ID | Prova |
|---|---|
| T-ADM-01 | Toda EF admin rejeita: sem JWT, usuário comum, admin **sem aal2** |
| T-ADM-02 | Toda EF admin grava `admin_audit_log` **na mesma transação** (falha de auditoria desfaz a ação) |
| T-ADM-03 | `admin_audit_log` imutável (UPDATE/DELETE falham, inclusive para service role via trigger) |
| T-ADM-04 | `admin-read-conversation` e acesso a mídia/endereço exigem `report_id` válido |
| T-ADM-05 | Admin não acessa `provider_sensitive_data` nem Storage `verification` por PostgREST |
| T-ADM-06 | Suspender usuário rejeita propostas `sent`, fecha conversas, tira de listagens |
| T-ADM-07 | Gate de categoria calcula G1 a G4 corretamente. Ativar sem gate exige motivo explícito (registrado) |
| T-ADM-08 | Nenhuma função cria admin |
| T-ADM-09 | Alerta de abertura em massa de documentos |

### 3.9 Exclusão de conta e retenção
| ID | Prova |
|---|---|
| T-DEL-01 | Bloqueada com job `scheduled`/`no_show_claimed`/`disputed` ou denúncia aberta contra o usuário |
| T-DEL-02 | Pedidos abertos cancelados e propostas rejeitadas, com contraparte notificada |
| T-DEL-03 | **Varredura de PII:** após exclusão, nenhuma tabela contém nome, telefone, e-mail, endereço ou caminhos de arquivo do usuário (lista gerada do catálogo) |
| T-DEL-04 | Arquivos apagados dos buckets (`verification`, `avatars`, `portfolio`, `request-media`) |
| T-DEL-05 | Mensagens: `body` nulo e `redacted_at`. Contraparte vê "mensagem removida". Com `legal_hold`, retidas |
| T-DEL-06 | Avaliações mantidas com autor anonimizado. Jobs, propostas, eventos e denúncias mantidos e **consistentes** (sem FK quebrada) |
| T-DEL-07 | `auth.users` removido. E-mail reutilizável. `profiles` e demais registros íntegros (ADR-11) |
| T-DEL-08 | `cpf_hmac` apagado, exceto banido (se aprovado) |
| T-DEL-09 | Idempotência: repetir a exclusão não falha nem duplica `account_deletion_log` |
| T-DEL-10 | Consistência `profiles.id` × `auth.users.id` (trigger de signup) |

### 3.10 Consentimento, LGPD e dados
| ID | Prova |
|---|---|
| T-LGPD-01 | `consent_records` append-only e versionado. Reaceite obrigatório em nova versão |
| T-LGPD-02 | Revogar consentimento biométrico impede nova verificação |
| T-LGPD-03 | Logs e Sentry sem PII (varredura) |
| T-LGPD-04 | Cliente menor de 18 anos não conclui cadastro (declaração) |

### 3.11 Constraints e integridade
| ID | Prova |
|---|---|
| T-INT-01 | Cada CHECK, UNIQUE (incl. parciais) e FK da modelagem tem um teste de violação |
| T-INT-02 | `client_id ≠ provider_id`, `reviewer ≠ reviewee`, `blocker ≠ blocked` |
| T-INT-03 | `ON DELETE` conforme DATABASE (RESTRICT impede apagar linhas de negócio) |
| T-INT-04 | Migrações aplicam do zero e sobre staging |

## 4. Testes de aplicação (app)

- **Unitário:** schemas Zod (limites e mensagens pt-BR), moeda (centavos → R$), datas no fuso de negócio, cálculo de rótulos de estado.
- **Componentes:** criar pedido, comparar propostas, enviar/editar proposta, onboarding e verificação, concluir (parcial), cancelar, não comparecimento, disputa, recurso, bloqueio, exclusão de conta. Cada tela em **carregando, vazio, erro, offline**.
- **Acessibilidade (RNTL):** rótulos, papéis, ordem, alvos ≥ 48dp, ausência de informação só por cor.
- **Copy:** teste que falha se aparecerem termos proibidos nos selos ("qualificado", "certificado", "garantido").

## 5. E2E (Maestro, contra staging)

1. Cadastro → login.
2. Prestador: onboarding → "em análise" → (admin aprova) → aprovado.
3. Cliente: criar pedido. Prestador: receber e enviar proposta.
4. Cliente: comparar e aceitar. Chat.
5. Prestador: concluir. Ambos avaliam. Revelação.
6. Cancelar e "Repetir pedido".
7. Bloqueio entre as partes impede nova mensagem.
8. Excluir conta.

## 6. Testes manuais obrigatórios

Push real (Android/iOS, app aberto/segundo plano/fechado), acessibilidade (TalkBack/VoiceOver, fonte 200%), rede ruim, aparelhos de entrada, usabilidade com 5 pessoas por perfil, exclusão de conta ponta a ponta, fila de verificação do admin, fluxo de disputa, teste de restauração de backup.

## 7. Segurança adicional

MASVS L1 antes do beta, `npm audit`/Dependabot, secret scanning, IDOR manual (trocar IDs), rate limits (login, OTP, pedido, mensagem, denúncia), verificação de que `service_role` e *pepper* não aparecem no bundle.

## 8. Rastreabilidade: requisito → testes

Cada RF do PRD deve ter ≥ 1 teste. Verificação semiautomática no CI: arquivo `docs/traceability` (a criar) comparado com os IDs.

| RF | Testes |
|---|---|
| RF-01, RF-02, RF-03 | T-RLS-11, T-LGPD-04, E2E-1, componentes de auth |
| RF-04 | T-DEL-01..10, T-CONC-12, E2E-8 |
| RF-05 | T-RLS-12, T-BLK-02 |
| RF-06 | T-ST-REQ-01, T-ST-REQ-04, T-MATCH-01..03, T-RLS-13, T-STO-05, E2E-3 |
| RF-07 | T-ST-QUO-01..05, T-CONC-01..07, E2E-4 |
| RF-08 | T-RLS-09, T-BLK-01, T-BLK-05, E2E-4 |
| RF-09 | T-RLS-02, componentes de histórico |
| RF-10, RF-19, RF-23 | T-ST-REV-01, T-ST-REV-02, T-RLS-08, T-CONC-09, E2E-5 |
| RF-11, RF-14, RF-15 | T-RLS-11, T-MATCH-01, T-STO-07, componentes |
| RF-12, RF-41, RF-42, RF-48 | T-VER-01..07, T-STO-01..04, T-ST-VER-01 |
| RF-13 | T-RLS-12, T-RLS-14, teste de copy |
| RF-16, RF-34, RF-35 | T-MATCH-01..07, T-PUSH-01..03, T-CONC-10 |
| RF-17, RF-40 | T-ST-QUO-02..05, T-INT-01 |
| RF-18, RF-36, RF-37, RF-38, RF-39 | T-ST-JOB-01..07, T-CONC-08, E2E-5, E2E-6 |
| RF-20, RF-21 | T-EXP-01..06, T-ST-REQ-01..03, T-CONC-06 |
| RF-22 | T-RLS-04, T-RLS-13 |
| RF-24 | T-PUSH-01..03, T-RLS-10 |
| RF-25, RF-26, RF-27, RF-28, RF-29 | T-ADM-01..09 |
| RF-30 | T-BLK-06, T-ADM-04, componentes de denúncia |
| RF-31, RF-43 | T-BLK-01..09, T-CONC-11, E2E-7 |
| RF-32, RF-33, RF-44 | T-LGPD-01, T-LGPD-02, T-LGPD-04 |
| RF-45 | T-ADM-07 |
| RF-46 | T-EXP-04 |
| RF-47 | T-ST-REQ-01, T-ST-JOB-01 (verificam `status_events`) |
| RF-49 | Roteiro manual de atendimento ao titular |
| Segurança estrutural (SEC-06..09, 24..26) | T-RLS-01, T-ADM-01..03, teste meta da seção 2 |

## 9. Pipeline de CI

1. Tipos (TS estrito), lint, formatação.
2. Unitário e componentes.
3. Supabase local + migrações + **testes de banco** (RLS, estados, constraints) + **concorrência** + **teste meta**.
4. Testes de Edge Functions.
5. Auditoria de dependências e secret scanning.
6. `main`: build de preview (EAS) conforme necessidade.

Merge bloqueado com CI vermelho. Testes de concorrência rodam N vezes (ex.: 20) para reduzir falso verde.

## 10. Critérios de saída

| Fase | Critério |
|---|---|
| Toda migração | Banco, RLS e teste meta verdes |
| Fase 2 | T-CONC-01..07, T-MATCH, T-EXP-01..03 verdes |
| Fase 4 | Todos os T-ST e T-CONC restantes |
| Fase 5 | T-ADM, T-DEL, T-BLK verdes |
| Antes do beta | Toda a seção 3 + E2E + push real + acessibilidade |
| Antes do piloto aberto | Zero bugs críticos/altos. Backup restaurado. Revisão jurídica concluída. Matriz RLS com mutação executada |

## 11. Dados de teste
Seeds determinísticas por estado, nunca dados reais. Contas admin de teste separadas. Dados sintéticos de 5.000 prestadores para T-MATCH-07.

## 12. Definição de pronto (DoD) de uma história
Critérios atendidos, testes do catálogo correspondente escritos e verdes, estados vazio/erro/offline tratados, acessibilidade conferida, sem PII em logs, **linha atualizada na matriz RLS e na rastreabilidade** se mudou tabela, política ou requisito, documentação (DATABASE/API) atualizada.

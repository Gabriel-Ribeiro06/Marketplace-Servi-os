# BACKLOG — Histórias de Usuário e Tarefas

> Status: **Revisado pela auditoria (v2), pendente de aprovação**. Itens novos ou alterados pela auditoria: **[PENDENTE DE APROVAÇÃO]**. Ver [AUDIT_REPORT.md](AUDIT_REPORT.md).
> Prioridade: **M** = Must (MVP), **S** = Should (MVP se couber), **C** = Could (pós-MVP próximo), **W** = Won't (fora).
> Tamanho: P (≤1 dia), M (2–3 dias), G (4–5 dias), GG (>1 sem, quebrar).
> Cada história referencia os requisitos do [PRD.md](PRD.md) (`RF-xx`) e os grupos de teste de [TEST_STRATEGY.md](TEST_STRATEGY.md).

## Épico E0 — Fundação (Fase 0)

| ID | História / Tarefa | RF / SEC | Testes | Pri | Tam |
|---|---|---|---|---|---|
| E0-01 | Como dev, quero repositório com TypeScript estrito, lint, format e CI (tipos, lint, testes, secret scanning) | SEC-15 | CI | M | M |
| E0-02 | Como dev, quero projeto Expo com Expo Router e estrutura de pastas definida | — | CI | M | P |
| E0-03 | Como dev, quero Supabase local (CLI) + staging com migrações versionadas, enums e `app_config` inicial | — | T-INT-04 | M | M |
| E0-04 | Como dev, quero **teste meta no CI** que falha se houver tabela sem RLS, tabela fora da matriz, coluna de status editável, FK sem índice ou RPC bilateral sem `can_interact` **[PENDENTE DE APROVAÇÃO]** | SEC-06..08, SEC-24 | Seção 2 | M | M |
| E0-05 | Como dev, quero tokens do design system e componentes base (`Button`, `TextField`, `StatusChip`, `VerificationBadge`) | — | RNTL | M | M |
| E0-06 | Como dev, quero Sentry integrado ao app e Edge Functions sem vazamento de PII | SEC-14 | T-LGPD-03 | S | P |
| E0-07 | Como dono, quero abrir contas Apple Developer e Google Play | — | Manual | M | P |
| E0-08 | Como dono, quero definir nome/marca, e-mail do encarregado (DPO) e canais de atendimento ao titular | RF-49 | Manual | M | P |
| E0-09 | Como sistema, quero tabela `status_events` append-only e helper transacional para gravar todas as transições de estado **[PENDENTE DE APROVAÇÃO]** | RF-47 | T-ST-REQ-01, T-ST-JOB-01 | M | P |

## Épico E1 — Conta, consentimentos e perfis (RF-01 a RF-04, RF-32, RF-33, RF-44, RF-49)

| ID | História | RF | Testes | Pri | Tam |
|---|---|---|---|---|---|
| E1-01 | Como usuário, quero criar conta com e-mail/senha, declarar 18+ e registrar aceite versionado em `consent_records` | RF-01, RF-32, RF-33, RF-44 | T-LGPD-01, T-LGPD-04, E2E-1 | M | M |
| E1-02 | Como usuário, quero fazer login, recuperar senha e armazenar sessão no SecureStore | RF-01, SEC-05 | E2E-1 | M | M |
| E1-03 | Como usuário, quero verificar meu telefone por OTP com rate limit | RF-02, SEC-02 | T-RLS-11 | M | M |
| E1-04 | Como usuário, quero alternar entre perfil Cliente e Prestador na mesma conta | RF-03 | T-RLS-11 | M | M |
| E1-05 | Como usuário, quero editar meu perfil (nome, foto com remoção de EXIF, bairro) | RF-01, SEC-13 | T-RLS-11, T-STO-06 | M | M |
| E1-06 | Como usuário, quero excluir minha conta no app (com bloqueio se houver job ativo/disputa/legal hold, anonimização de `profiles`, remoção de `auth.users` e purga de arquivos) **[PENDENTE DE APROVAÇÃO]** | RF-04 | T-DEL-01..10, T-CONC-12, E2E-8 | M | G |
| E1-07 | Como usuário, quero login social (Google/Apple) | — | — | W | — |
| E1-08 | Como titular, quero canal e procedimento documentado com o DPO para exercer direitos da LGPD (acesso, correção, revogação) **[PENDENTE DE APROVAÇÃO]** | RF-49 | T-LGPD-02 | M | P |

## Épico E2 — Cadastro e verificação do prestador (RF-11 a RF-15, RF-41, RF-42, RF-48)

| ID | História | RF | Testes | Pri | Tam |
|---|---|---|---|---|---|
| E2-01 | Como prestador, quero informar nome público, bio, foto e anos de experiência (rotulados como autodeclarados) | RF-11, RF-13 | T-RLS-11, teste de copy | M | P |
| E2-02 | Como prestador, quero escolher categorias ativas e especialidades | RF-11 | T-RLS-11, T-MATCH-01 | M | M |
| E2-03 | Como prestador, quero escolher os bairros de Osasco que atendo | RF-11 | T-RLS-11, T-MATCH-01 | M | M |
| E2-04 | Como prestador, quero definir dias/períodos de disponibilidade (mínimo 1 regra) e pausar recebimento | RF-15 | T-MATCH-01 | M | M |
| E2-05 | Como prestador, quero registrar consentimento biométrico, informar CPF (gravado apenas como `cpf_hmac`) e enviar documento + selfie ao vivo via URL assinada (`create-document-upload`) **[PENDENTE DE APROVAÇÃO]** | RF-12, RF-44, SEC-11, SEC-12 | T-VER-01, T-VER-02, T-VER-07, T-STO-01, T-STO-02 | M | G |
| E2-06 | Como prestador de categoria de cuidado, quero enviar antecedentes e referência (**adiado**: categorias fora do MVP) | — | — | W | — |
| E2-07 | Como prestador, quero acompanhar o status da verificação (`verification_submissions`), ver motivo padronizado de rejeição e reenviar (até 3x/30d) ou **recorrer uma vez em até 15 dias** **[PENDENTE DE APROVAÇÃO]** | RF-12, RF-41, RF-42 | T-VER-03, T-VER-04, T-VER-06, T-ST-VER-01 | M | M |
| E2-08 | Como prestador, quero montar um portfólio com até 12 fotos | RF-14 | T-STO-07 | S | M |
| E2-09 | Como cliente, quero ver o perfil público do prestador com selo **"Identidade verificada"** explicado (deixando claro que não atesta competência) | RF-13 | T-RLS-12, T-RLS-14, teste de copy | M | M |
| E2-10 | Como sistema, quero purgar automaticamente arquivos de verificação (`purge_verification_files`) 30 dias após decisão final **[PENDENTE DE APROVAÇÃO]** | RF-48 | T-VER-05 | M | P |

## Épico E3 — Pedidos do cliente e matching (RF-05 a RF-07, RF-09, RF-20 a RF-22, RF-34, RF-35, RF-46)

| ID | História | RF | Testes | Pri | Tam |
|---|---|---|---|---|---|
| E3-01 | Como cliente, quero navegar categorias ativas (e ver "Em breve" nas inativas) e listar profissionais aprovados por categoria/bairro | RF-05, RF-45 | T-RLS-12, T-BLK-02 | M | M |
| E3-02 | Como cliente, quero criar pedido em passos (categoria, descrição, fotos com aviso de visibilidade, janela de datas, bairro, endereço privado) | RF-06, RF-22 | T-ST-REQ-01, T-RLS-04, T-RLS-13, T-STO-05, E2E-3 | M | G |
| E3-03 | Como cliente, quero ser avisado honestamente quando não há profissionais elegíveis e marcar **"Avise-me"** (`unserved_demand`), sem que o app exponha o número exato de profissionais notificados **[PENDENTE DE APROVAÇÃO]** | RF-06 | T-ST-REQ-04, T-RLS-05 | M | M |
| E3-04 | Como cliente, quero comparar até 5 propostas lado a lado e ordenar por preço, nota ou tempo de resposta | RF-07 | E2E-4 | M | G |
| E3-05 | Como cliente, quero aceitar uma proposta válida com confirmação explícita e aviso de pagamento externo | RF-07, RF-21, RF-22 | T-ST-QUO-01, T-CONC-03..07, T-RLS-04, E2E-4 | M | M |
| E3-06 | Como cliente, quero cancelar um pedido aberto e usar **"Repetir pedido"** para criar novo a partir de pedido encerrado **[PENDENTE DE APROVAÇÃO]** | RF-20 | T-ST-REQ-01..03, T-CONC-07, E2E-6 | M | M |
| E3-07 | Como cliente, quero ver meu histórico de pedidos e serviços | RF-09 | T-RLS-02 | M | M |
| E3-08 | Como sistema, quero expirar pedidos em 48h (checagem preguiçosa nas RPC + cron `expire_requests`) e fechar/reabrir vagas conforme propostas ativas **[PENDENTE DE APROVAÇÃO]** | RF-20, RF-40 | T-EXP-01..03, T-ST-QUO-04 | M | M |
| E3-09 | Como sistema, quero proteger `service_request_private` para que somente o cliente dono e o prestador do job aceito leiam o endereço completo | RF-22 | T-RLS-04 | M | P |
| E3-10 | Como cliente, quero favoritar profissionais | — | — | C | — |
| E3-11 | Como sistema, quero calcular prestadores elegíveis, ordenar de forma equilibrada (menos notificados em 7d, taxa de resposta, nota) e despachar em lotes (`dispatch_batches`) **[PENDENTE DE APROVAÇÃO]** | RF-16, RF-34, RF-35 | T-MATCH-01..07, T-CONC-10 | M | G |
| E3-12 | Como cliente, quero receber lembrete quando meu pedido tiver propostas e faltar 12h para expirar **[PENDENTE DE APROVAÇÃO]** | RF-46 | T-EXP-04 | S | P |

## Épico E4 — Propostas do prestador (RF-16, RF-17, RF-40)

| ID | História | RF | Testes | Pri | Tam |
|---|---|---|---|---|---|
| E4-01 | Como prestador aprovado, quero listar pedidos compatíveis notificados para mim (`incoming_requests`), vendo quantas vagas restam | RF-16 | T-RLS-03, T-RLS-13 | M | M |
| E4-02 | Como prestador, quero enviar proposta estruturada (valor total, inclusões, taxa de visita opcional, horário proposto, validade ≤ pedido) | RF-17, RF-40 | T-ST-QUO-01, T-ST-QUO-02, E2E-3 | M | G |
| E4-03 | Como prestador, quero editar uma única vez minha proposta (`revision = 1`) ou retirá-la (liberando a vaga, sem poder reenviar) **[PENDENTE DE APROVAÇÃO]** | RF-40 | T-ST-QUO-03..05, T-CONC-05 | M | M |
| E4-04 | Como sistema, quero garantir o limite de 5 propostas ativas com `SELECT ... FOR UPDATE` no pedido e índice único parcial para proposta aceita | RF-07, RF-20 | T-CONC-01..04 | M | M |
| E4-05 | Como prestador, quero descartar pedidos que não me interessam (`dismiss_request`) | RF-16 | T-RLS-03 | S | P |
| E4-06 | Como prestador, quero ver o status e o motivo de encerramento das minhas propostas | RF-17 | T-ST-QUO-01 | S | P |

## Épico E5 — Chat e notificações (RF-08, RF-24)

| ID | História | RF | Testes | Pri | Tam |
|---|---|---|---|---|---|
| E5-01 | Como participante de uma proposta, quero conversar por texto em tempo real via RPC `send_message` (respeitando `can_interact` e status `open`/`read_only`) | RF-08, RF-43 | T-RLS-09, T-BLK-01, T-BLK-05, E2E-4 | M | G |
| E5-02 | Como usuário, quero ver indicador de mensagens não lidas (`mark_messages_read`) | RF-08 | T-RLS-09 | M | P |
| E5-03 | Como usuário, quero receber push genérico (sem PII na tela de bloqueio), respeitando `can_interact`, janela e teto diário do prestador (`send-push`) | RF-24, SEC-27 | T-PUSH-01..03, T-BLK-03 | M | G |
| E5-04 | Como usuário, quero central de notificações no app com purga em 90 dias | RF-24 | T-RLS-10 | S | M |
| E5-05 | Como usuário, quero enviar imagens no chat | — | — | C | — |
| E5-06 | Como usuário, quero configurar preferências de notificação | — | — | C | — |

## Épico E6 — Serviços (jobs), exceções e avaliações (RF-10, RF-18, RF-19, RF-21, RF-23, RF-36 a RF-39, RF-46)

| ID | História | RF | Testes | Pri | Tam |
|---|---|---|---|---|---|
| E6-01 | Como cliente/prestador, quero ver os detalhes do serviço agendado (`agreed_price_cents`, horário, e endereço liberado ao prestador) | RF-18, RF-21, RF-22 | T-RLS-04 | M | M |
| E6-02 | Como cliente ou prestador, quero cancelar o serviço antes do horário com motivo obrigatório, sinalizando cancelamento tardio (< 24h) **[PENDENTE DE APROVAÇÃO]** | RF-36 | T-ST-JOB-01, T-ST-JOB-03, T-CONC-08, E2E-6 | M | M |
| E6-03 | Como prestador, quero marcar o serviço como concluído (**completo** ou **parcial** com nota obrigatória) a partir do horário agendado **[PENDENTE DE APROVAÇÃO]** | RF-18, RF-38 | T-ST-JOB-01, T-ST-JOB-02, T-ST-JOB-05, E2E-5 | M | M |
| E6-04 | Como cliente e prestador, quero avaliar um ao outro (1–5 estrelas e comentário) em até 30 dias após `completed` ou `no_show` confirmado **[PENDENTE DE APROVAÇÃO]** | RF-10, RF-19, RF-23 | T-ST-REV-01, E2E-5 | M | M |
| E6-05 | Como sistema, quero revelar simultaneamente as avaliações quando ambos enviarem ou após 7 dias (`reveal_reviews`), atualizando a nota pública | RF-23 | T-ST-REV-02, T-RLS-08, T-CONC-09, T-EXP-04 | M | M |
| E6-06 | Como sistema, quero atualizar nº de serviços concluídos, nota e tempo médio da 1ª proposta (`refresh_provider_metrics`) | RF-13 | T-ST-JOB-02, T-ST-REV-02 | M | M |
| E6-07 | Como cliente ou prestador, quero reportar **não comparecimento** (+30 min), retirar a acusação ou contestar em até 48h **[PENDENTE DE APROVAÇÃO]** | RF-37 | T-ST-JOB-04, T-EXP-04 | M | M |
| E6-08 | Como cliente ou prestador, quero abrir **disputa de serviço** ("Algo deu errado": incompleto, divergência de valor, dano/roubo, etc.) em até 7 dias, suspendendo avaliações até decisão do admin **[PENDENTE DE APROVAÇÃO]** | RF-39 | T-ST-JOB-05, T-ST-JOB-06 | M | M |
| E6-09 | Como sistema, quero lembrar as partes em +24h e encerrar automaticamente jobs sem desfecho após 7 dias (`job_no_outcome`) **[PENDENTE DE APROVAÇÃO]** | RF-46 | T-ST-JOB-07, T-EXP-04 | S | P |
| E6-10 | Agenda/calendário avançado e serviços recorrentes | — | — | W | — |

## Épico E7 — Confiança, bloqueios e segurança (RF-30 a RF-33, RF-43)

| ID | História | RF | Testes | Pri | Tam |
|---|---|---|---|---|---|
| E7-01 | Como usuário, quero denunciar perfil, mensagem, avaliação, pedido, proposta ou serviço com priorização `safety` (SLA 24h) vs. normal (72h) | RF-30 | T-BLK-06, T-ADM-04 | M | M |
| E7-02 | Como usuário, quero bloquear/desbloquear outro usuário, aplicando `can_interact` em todas as operações bilaterais sem revelar o bloqueio ao bloqueado **[PENDENTE DE APROVAÇÃO]** | RF-31, RF-43 | T-BLK-01..09, T-CONC-11, E2E-7 | M | M |
| E7-03 | Como usuário, quero ler e aceitar novas versões de Termos e Política de Privacidade | RF-32, RF-44 | T-LGPD-01 | M | P |
| E7-04 | Como usuário, quero avisos contextuais de segurança (chat, fotos do pedido, pagamento fora do app, ausência de intermediação financeira) | RF-08, RF-39 | RNTL | M | P |
| E7-05 | Como sistema, quero aplicar rate limit nas RPC de criação (pedidos, propostas, mensagens, denúncias) | SEC-02 | Manual / integração | M | M |

## Épico E8 — Admin web (RF-25 a RF-29, RF-39, RF-41, RF-42, RF-45)

| ID | História | RF | Testes | Pri | Tam |
|---|---|---|---|---|---|
| E8-01 | Como admin, quero login com MFA obrigatório (`aal2` verificado em todas as Edge Functions admin) e auditoria transacional imutável (`admin_audit_log`) | RF-25, SEC-03, SEC-09 | T-ADM-01..03, T-ADM-08 | M | M |
| E8-02 | Como admin, quero fila de verificação para abrir documentos via URL assinada de 60 s (`admin-get-document-url`) com motivo obrigatório e alerta de acesso em massa | RF-25, SEC-11 | T-STO-03, T-STO-04, T-ADM-05, T-ADM-09 | M | G |
| E8-03 | Como admin, quero aprovar/rejeitar verificações com motivo padronizado e julgar recursos (`admin-review-provider`, `admin-decide-appeal`) **[PENDENTE DE APROVAÇÃO]** | RF-25, RF-41, RF-42 | T-VER-03, T-VER-04 | M | M |
| E8-04 | Como admin, quero fila de denúncias e disputas (`admin-resolve-report`, `admin-resolve-dispute`) e leitura de conversa/mídia **exclusivamente vinculada a um `report_id`** **[PENDENTE DE APROVAÇÃO]** | RF-27, RF-39, SEC-25 | T-ADM-04, T-ST-JOB-06 | M | G |
| E8-05 | Como admin, quero buscar, suspender, reativar ou banir usuários (`admin-moderate`) e ver fila de prestadores com ≥ 3 cancelamentos tardios em 30d | RF-28, RF-36 | T-ADM-06 | M | M |
| E8-06 | Como admin, quero gerenciar bairros e ativar/pausar categorias visualizando os critérios do **gate de ativação (G1 a G4)** **[PENDENTE DE APROVAÇÃO]** | RF-26, RF-45 | T-ADM-07 | M | M |
| E8-07 | Como admin, quero painel de indicadores do funil, oferta por categoria, demanda não atendida e saúde dos jobs `pg_cron` (`admin-metrics`) | RF-29 | T-ADM-01 | M | G |
| E8-08 | Como admin, quero consultar o log de auditoria (`admin_audit_log`) | SEC-09 | T-ADM-02, T-ADM-03 | S | M |

## Épico E9 — Qualidade, conformidade e lançamento

| ID | Tarefa | Testes / Entregável | Pri | Tam |
|---|---|---|---|---|
| E9-01 | Implementar matriz executável de RLS (`rls_matrix`) e suíte `T-RLS-01..14`, `T-STO-01..07`, `T-VER-01..07` | Seções 2, 3.1, 3.2 | M | G |
| E9-02 | Implementar suíte de máquinas de estado (`T-ST-*`), expiração (`T-EXP-*`), bloqueio (`T-BLK-*`), matching (`T-MATCH-*`), admin (`T-ADM-*`) e exclusão (`T-DEL-*`) | Seções 3.3, 3.5 a 3.11 | M | G |
| E9-03 | Implementar suíte de **concorrência com sessões paralelas** (`T-CONC-01..13`) no CI | Seção 3.4 | M | M |
| E9-04 | Implementar fluxos E2E Maestro (`E2E-1..8`) contra staging | Seção 5 | M | M |
| E9-05 | Executar testes manuais de acessibilidade (TalkBack/VoiceOver, fonte 200%, contraste) e usabilidade | Seção 6 | M | M |
| E9-06 | Testar restauração completa de backup no staging e checklists OWASP MASVS L1 | Seção 7, SEC-23 | M | P |
| E9-07 | Configurar builds EAS, TestFlight, teste interno Android, Privacy Labels e Data Safety coerentes com coleta de selfie/documento | Seção 8 do SECURITY | M | M |
| E9-08 | Revisão jurídica de Termos de Uso, Política de Privacidade, base legal de selfie biométrica e RIPD (PRD D-08) | SECURITY seção 6 | M | — |
| E9-09 | Validar e carregar seed oficial de bairros e zonas de Osasco | DATABASE seção 10 | M | P |
| E9-10 | Executar plano de aquisição fria de prestadores até atingir o gate G1–G4 em pelo menos 3 categorias | PRD seção 12 | M | — |

## Ordem sugerida de execução

`E0 → E1 → E2 + E8-01..03 (verificação e admin mínimo funcionando cedo) → E3 + E4 (pedidos, lotes e propostas) → E5 (chat e push) → E6 (jobs, exceções e avaliações) → E7 + E8-04..08 (moderação, disputas, gate e métricas) → E9`

> Os testes de banco (`E9-01..03`) não ficam todos para o final: cada épico só é considerado pronto (DoD) quando seus respectivos testes de RLS, estado e concorrência estão verdes no CI.

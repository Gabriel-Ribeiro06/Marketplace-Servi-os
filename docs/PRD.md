# PRD — Marketplace de Serviços (Osasco)

> Status: **Revisado pela auditoria (v2), pendente de aprovação**. Nenhum código foi escrito.
> Itens marcados com **[PREMISSA]** foram propostos por mim e precisam da sua confirmação. Itens novos da auditoria estão marcados **[PENDENTE DE APROVAÇÃO]** e listados em [AUDIT_REPORT.md](AUDIT_REPORT.md). Decisões já aprovadas foram preservadas: 4 categorias, expiração de 48h, metas do piloto.

## 1. Visão

Conectar moradores de Osasco a prestadores de serviço **verificados**, com pedido de orçamento simples, propostas comparáveis e comunicação dentro do app.

**Hipótese a validar no MVP:** *moradores de Osasco pedem orçamentos pelo app e prestadores verificados respondem em tempo útil, a ponto de gerar contratações.*

O MVP **não** valida monetização, pagamento nem escala nacional.

## 2. Decisões da entrevista

| Tema | Decisão |
|---|---|
| Região | Osasco (SP), uma única cidade |
| Objetivo do MVP | Validar demanda (pedido → proposta → contratação informada) |
| Contratação | Orçamento e chat no app. Pagamento combinado fora, sem escrow |
| Equipe | 1 pessoa + agentes de IA, com tempo integral |
| Plataformas | Android e iOS (Expo) + painel admin web simples |
| Categorias (**decisão fechada**) | **Somente 4**: Eletricista, Encanador, Diarista e Técnico em computadores. Carpinteiro, Passadeira, Cozinheira, Cuidadora, Babá e Freelancer ficam fora do MVP (ver seção 5.3) |
| Verificação | Telefone + documento com selfie, aprovação manual |
| Distribuição | Automática por categoria + bairro, limite de 5 propostas |
| Área de atendimento | Lista de bairros/zonas |
| Notificações | Push (Expo Notifications) |
| Aquisição inicial | Fria (sem base de contatos) |
| Avaliação | Bilateral, após o prestador concluir o chamado |
| Contas | Uma conta, dois perfis (cliente e prestador) |
| Monetização | Decidir após o MVP |

## 3. Personas

- **Cliente (Marta, 38):** precisa de diarista ou eletricista com rapidez, tem receio de deixar um estranho em casa, usa WhatsApp o dia todo.
- **Prestador (Seu José, 52):** autônomo, baixa familiaridade digital, quer serviços sem pagar para ter contato, desconfia de apps que cobram antes.
- **Admin (você):** precisa aprovar prestadores, moderar denúncias e ver indicadores sem ferramentas complexas.

Consequência de design: **telas simples, textos em linguagem direta, poucos campos, tolerância a internet fraca**.

## 4. Riscos principais

| # | Risco | Impacto | Mitigação |
|---|---|---|---|
| R1 | **Ovo e galinha com aquisição fria**: sem prestadores, o cliente não recebe proposta e abandona | Crítico | Lançar primeiro o lado prestador, com meta mínima de prestadores verificados por categoria **antes** de abrir aos clientes. Ativar categorias gradualmente (flag) |
| R2 | **Oferta ainda pode ser rala mesmo com 4 categorias** em uma cidade | Alto | Meta mínima de prestadores por categoria antes de abrir aos clientes. Cada categoria tem flag de ativação, e uma que não atingir a meta pode ser pausada |
| R3 | **Segurança física em categorias de cuidado** (Babá, Cuidadora) | Mitigado por escopo | **Fora do MVP.** Só entram com verificação reforçada (antecedentes, referência e selo próprio) e revisão jurídica. Diarista e outras que entram na casa do cliente ficam sob o fluxo padrão, com denúncia e bloqueio |
| R4 | **Risco trabalhista/jurídico** (vínculo, diarista recorrente) | Médio | Plataforma é intermediária, não empregadora. Sem agendamento recorrente no MVP. Revisão jurídica dos Termos antes do lançamento |
| R6 | **Verificação manual vira gargalo** (só você) | Médio | Fila no admin, SLA de 48h, comunicação de status ao prestador |
| R7 | **Avaliações falsas** (sem pagamento no app, só dá para provar a contratação pela marcação das partes) | Médio | Avaliação só após job com aceite de proposta. Revelação simultânea. Contas verificadas por telefone |
| R8 | **Desintermediação** (trocam telefone e saem do app) | Baixo no MVP, alto para monetização | Medir o funil; não bloquear contato no MVP; decidir após os dados |
| R9 | **Custo de SMS/OTP e de contas de loja** | Baixo | Ver D-04 |
| R10 | **Dados pessoais sensíveis** (selfie = biométrico, dados de crianças/idosos) | Alto | Ver SECURITY.md |
| R11 | **Conteúdo gerado pelo usuário**: Apple e Google exigem denúncia, bloqueio e exclusão de conta | Alto | Entram no escopo MVP (RF-30 a RF-33) |

## 5. Escopo do MVP

### 5.1 Entra (Must)

**Conta e perfis**
- RF-01 Cadastro/login com e-mail e senha (e login social: ver D-05).
- RF-02 Verificação de telefone por OTP.
- RF-03 Uma conta, perfis Cliente e Prestador, com alternância.
- RF-04 Exclusão de conta no app (obrigatório nas lojas e LGPD).

**Cliente**
- RF-05 Navegar categorias e ver prestadores aprovados (por categoria e bairro).
- RF-06 Criar pedido de orçamento: categoria, descrição, bairro, janela de data desejada, fotos opcionais.
- RF-07 Receber até 5 propostas, comparar lado a lado e aceitar uma.
- RF-08 Chat com o prestador de cada proposta.
- RF-09 Acompanhar histórico de pedidos e serviços.
- RF-10 Avaliar o prestador após conclusão.

**Prestador**
- RF-11 Cadastro profissional: nome, foto, bio, categorias, bairros atendidos.
- RF-12 Verificação: telefone + documento com selfie, aprovação manual. (Verificação reforçada com antecedentes fica para quando categorias de cuidado forem abertas.)
- RF-13 Perfil público: foto, bio, categorias, bairros, selo **"Identidade verificada"** (único selo do MVP, **não** atesta competência: ver SECURITY seção 4.1), nota, nº de serviços, tempo médio de resposta, portfólio. Experiência declarada pelo prestador é rotulada como "informada pelo profissional".
- RF-14 Portfólio com fotos.
- RF-15 Disponibilidade simples: dias da semana e período (manhã/tarde/noite), com pausa temporária.
- RF-16 Receber pedidos compatíveis (categoria + bairro + disponibilidade) com push, distribuídos em lotes (RF-34, RF-35).
- RF-17 Enviar proposta estruturada: valor total, o que está incluído, visita técnica (valor, se houver), prazo/data proposta, validade.
- RF-18 Gerenciar serviços aceitos e marcar como concluído.
- RF-19 Avaliar o cliente após conclusão.

**Orquestração**
- RF-20 Pedido expira em 48h sem aceite (**aprovado**). Fecha para novas propostas ao atingir 5. A vaga volta se uma proposta for retirada ou expirar antes do fim do pedido **[PENDENTE DE APROVAÇÃO]**. Estados e transições: DATABASE seção 5.
- RF-21 Cada proposta tem uma data/horário proposto. O aceite confirma o agendamento.
- RF-22 O endereço completo só é liberado ao prestador cujo orçamento foi aceito. Antes disso, só o bairro.
- RF-23 Avaliações bilaterais com revelação simultânea (ambos enviaram ou 7 dias).

**Notificações**
- RF-24 Push: novo pedido compatível, nova proposta, nova mensagem, proposta aceita, serviço concluído, resultado da verificação.

**Admin (web)**
- RF-25 Fila de aprovação de prestadores (ver documentos, aprovar/rejeitar com motivo).
- RF-26 Gerenciar categorias e bairros (ativar/desativar).
- RF-27 Fila de denúncias, com ação (advertir, suspender, remover avaliação).
- RF-28 Suspender/reativar usuários.
- RF-29 Indicadores do funil (ver seção 7).

**Segurança e conformidade**
- RF-30 Denunciar usuário, avaliação, mensagem ou pedido.
- RF-31 Bloquear usuário.
- RF-32 Termos de Uso e Política de Privacidade com aceite registrado.
- RF-33 Idade mínima de 18 anos declarada.

### 5.2 Não entra no MVP (Won't now)

Pagamento, escrow, comissão, assinatura, venda de leads, destaque pago, busca por raio/mapa, PostGIS, localização em tempo real, vídeo, chamada de voz, agendamento recorrente (diarista semanal), cupom, multi-cidade, chat com imagem/áudio (Could), verificação automática de documento, antecedentes via terceiro pago, e-mail/WhatsApp transacional, web para clientes, IA.

### 5.3 Categorias fora do MVP

Carpinteiro, Passadeira, Cozinheira, Cuidadora, Babá e Freelancer (atendimento/comércio).
- Carpinteiro, Passadeira e Cozinheira: candidatas à primeira expansão, após o piloto, sem exigências novas de verificação.
- Babá e Cuidadora: só com verificação reforçada e revisão jurídica.
- Freelancer: exigiria desenho próprio de produto (parece vaga de emprego).
- O modelo de dados já suporta novas categorias por cadastro, sem mudança de código.

### 5.4 Requisitos adicionais decorrentes da auditoria **[PENDENTE DE APROVAÇÃO]**

Estes requisitos **não ampliam funcionalidades novas ao produto**: eles tornam explícitas regras que os fluxos aprovados já exigiam e que estavam indefinidas. Cada um tem tarefas em BACKLOG.md e testes em TEST_STRATEGY.md.

- RF-34 **Despacho em lotes:** pedidos são entregues a prestadores elegíveis em lotes, com intervalo, para evitar excesso de notificações (ARCHITECTURE seção 6).
- RF-35 **Elegibilidade e ordenação equilibrada:** critérios obrigatórios (categoria ativa, bairro, disponibilidade, aprovado, não pausado, sem bloqueio, não ser o próprio cliente) e ordenação por distribuição de oportunidades.
- RF-36 **Cancelamento de serviço** por cliente ou prestador, com motivo, antes do horário. Cancelamento a menos de 24h é sinalizado. Sem multa (não há pagamento no app).
- RF-37 **Não comparecimento:** qualquer parte pode reportar a partir de 30 min após o horário. A outra parte tem 48h para contestar. Sem contestação, confirma. Contestação vira disputa.
- RF-38 **Conclusão parcial:** o prestador marca o serviço como `parcial` com nota obrigatória. O cliente pode abrir disputa.
- RF-39 **Disputa de serviço** (inclui divergência de valor e serviço incompleto): aberta por qualquer parte até 7 dias após a conclusão, resolvida pelo admin em até 72h. Resultado limitado a moderação (a plataforma não media valores nem reembolsa).
- RF-40 **Validade, retirada e edição de proposta:** validade nunca excede a do pedido. Retirada libera a vaga. Uma edição permitida, com aviso ao cliente.
- RF-41 **Recurso de verificação:** prestador rejeitado pode recorrer uma vez em até 15 dias.
- RF-42 **Motivos padronizados de rejeição** (parte de RF-25).
- RF-43 **Efeito do bloqueio:** bloqueio impede despacho, propostas, aceite, mensagens, visibilidade e notificações entre as partes (DATABASE seção 6).
- RF-44 **Registro de consentimentos** versionado (termos, privacidade, selfie biométrica, push). Complementa RF-32.
- RF-45 **Gate de ativação de categorias** com critérios objetivos (seção 12).
- RF-46 **Lembretes:** pedido prestes a expirar com propostas e serviço sem desfecho (prioridade Should).
- RF-47 **Histórico de transições de estado** (`status_events`) para auditoria e disputas.
- RF-48 **Purga automática** dos arquivos de verificação conforme retenção.
- RF-49 **Atendimento a direitos do titular (LGPD)** por processo manual do DPO no MVP.

## 6. Requisitos não funcionais

- **Acessibilidade:** alvos de toque mínimos de 48dp, contraste WCAG AA, suporte a fontes grandes, rótulos para leitor de tela.
- **Desempenho:** listas paginadas; imagens redimensionadas e comprimidas no envio; funcionamento tolerável em 3G.
- **Idioma:** pt-BR.
- **Segurança e LGPD:** ver SECURITY.md.
- **Disponibilidade:** meta informal de 99% no MVP. Sem SLA contratual.
- **Observabilidade:** log de erros no app e no backend (ver ARCHITECTURE.md).

## 7. Métricas de validação

Contadores obrigatórios no MVP:

| Métrica | Pergunta que responde |
|---|---|
| Prestadores verificados por categoria | Há oferta suficiente? |
| Tempo da inscrição à aprovação | A operação manual é viável? |
| % de pedidos com ≥1 proposta em 2h | O prestador responde? |
| Tempo mediano até a 1ª proposta | O produto é rápido? |
| % de pedidos que viram aceite | O cliente encontra o que busca? |
| % de jobs concluídos e avaliados | O ciclo fecha? |
| Pedidos por categoria/bairro | Onde está a demanda? |
| Retenção de prestadores (ativos em 30 dias) | O prestador volta? |
| Denúncias por 100 jobs | A confiança se sustenta? |

**Metas de sucesso do piloto** **(aprovadas, valores preservados)**: ≥ 30 prestadores verificados em 3 categorias, ≥ 100 pedidos, ≥ 60% dos pedidos com proposta em até 2h, ≥ 25% dos pedidos aceitos.

> **Harmonização com o roadmap [PENDENTE DE APROVAÇÃO: interpretação]:** a meta de **30 é o total do piloto** e a de **8 a 10 por categoria é o critério para abrir cada categoria aos clientes** (seção 12). Conciliação: 3 categorias × 10 = 30, ou 4 categorias × 8 = 32. Ou seja, as duas metas são compatíveis: o piloto só atinge 30 se pelo menos 3 categorias alcançarem o gate. "Aceito" significa aceite da proposta no app (contratação informada). "Com proposta em até 2h" conta a partir da criação do pedido, e o intervalo de 15 min entre lotes está dentro desse prazo.

## 8. Análise de monetização (decisão após o MVP)

| Modelo | Vantagem | Desvantagem | Quando considerar |
|---|---|---|---|
| Comissão | Alinhado ao sucesso do prestador. Sem custo para entrar | Exige pagamento no app, que já é a maior complexidade. Vazamento para fora é fácil | Se o funil mostrar contratação fora do app e quiser escrow |
| Assinatura | Receita previsível. Simples de implementar | Prestador paga antes de provar valor | Depois de demonstrar fluxo de pedidos |
| Venda de leads | Receita imediata | Tem a pior fama no mercado (paga-se sem garantia de ganhar). Conflita com o diferencial de limite de 5 propostas | Só com limite estrito e garantia de reembolso |
| Destaque | Fácil, sem atrito | Afeta a confiança se parecer pagar para ranquear | Quando houver volume de busca |
| Híbrido (assinatura + destaque) | Mais estável | Mais complexidade | Fase 2 |

**Recomendação provisória:** não monetizar no piloto. Coletar as métricas acima e decidir entre **assinatura de prestador** e **comissão com pagamento no app**. Registro como ADR-09 em ARCHITECTURE.md.

## 9. Diferencial competitivo

> Baseado em conhecimento público geral sobre GetNinjas e Triider. **Validar** com pesquisa de campo e leitura de avaliações reais nas lojas de aplicativos antes de afirmar em materiais de marketing.

| Hipótese | É diferencial real? | Por quê |
|---|---|---|
| Foco hiperlocal em Osasco | **Sim, no curto prazo** | Concorrentes são nacionais e diluídos, mas a concorrência pode copiar |
| Limite de 5 propostas | **Sim**, se for comunicado | Reduz a briga entre prestadores e o spam para o cliente |
| Prestador não paga para enviar proposta (MVP) | **Sim, temporário** | Some quando a monetização entrar |
| Verificação em níveis com selo explicado | **Parcial** | Concorrentes têm verificação. O diferencial é o significado claro do selo e, no futuro, a verificação reforçada para categorias de cuidado |
| Proposta estruturada e comparável | **Parcial** | Padroniza, mas é fácil de copiar |
| Avaliação bilateral com revelação simultânea | **Parcial** | Reduz retaliação |
| Tempo médio de resposta visível | **Sim, se for cumprido** | Depende de oferta |
| Chat, agendamento, histórico | **Não** | Obrigação de mercado |
| Categorias de cuidado (Babá, Cuidadora) | **Fora do MVP** | Alto valor e alto risco. Só serão diferencial com confiança comprovada |

O diferencial **defensável** é a **confiança local operada de perto**, e ela não vem de funcionalidade, vem da operação (você aprovando cada prestador).

## 10. Decisões em aberto

| ID | Decisão | Minha recomendação |
|---|---|---|
| D-01 | Categorias do MVP | ✅ **Decidido:** Eletricista, Encanador, Diarista e Técnico em computadores |
| D-02 | Freelancer | ✅ **Decidido:** fora do MVP |
| D-03 | Verificação reforçada (Babá/Cuidadora) | ✅ **Adiada** junto com as categorias. Pré-requisito para reabri-las |
| D-10 | Pedido expira em 48h | ✅ **Decidido** |
| D-11 | Metas do piloto | ✅ **Aprovadas** |
| D-04 | Custo de SMS (OTP) | Usar OTP de telefone só para prestadores no cadastro e para clientes antes do 1º pedido. Estimar o custo no início |
| D-05 | Login social | E-mail+senha no MVP. Login Google exigiria também Apple Sign-In no iOS |
| D-06 | Moderação de contatos no chat (telefone/links) | Sem bloqueio no MVP, só aviso de segurança |
| D-07 | Data-alvo | Sem data fixa. Roadmap em fases com estimativa em semanas (ROADMAP.md) |
| D-08 | Revisão jurídica dos Termos e da Privacidade | Fazer antes do piloto aberto |
| D-09 | Nome e marca do produto | Pendente. Usamos "o app" nos documentos |

## 11. Regras de negócio e parâmetros

> Valores aprovados: **48h** de expiração, **5** propostas, **7 dias** de revelação de avaliações, meta de 48h de análise. **Todos os demais valores são propostas [PENDENTE DE APROVAÇÃO]** e ficam em `app_config` (ajustáveis sem nova versão do app).

### 11.1 Parâmetros

| Chave | Valor | Status |
|---|---|---|
| `request_expiry_hours` | 48 | Aprovado |
| `max_quotes` | 5 | Aprovado |
| `reviews_reveal_days` | 7 | Aprovado |
| `verification_sla_hours` | 48 | Aprovado (PRD original) |
| `batch_size` / `batch_interval_minutes` | 8 / 15 | Pendente |
| `max_open_requests` (por cliente) / pedidos por dia | 3 / 5 | Pendente |
| `provider_max_pending_quotes` | 10 | Pendente |
| `quote_min_validity_hours` / `quote_min_lead_hours` | 2 / 2 | Pendente |
| `quote_edit_limit` | 1 | Pendente |
| `late_cancellation_hours` | 24 | Pendente |
| `no_show_claim_after_minutes` / `no_show_contest_hours` | 30 / 48 | Pendente |
| `job_no_outcome_days` | 7 | Pendente |
| `dispute_window_days` | 7 | Pendente |
| `dispute_sla_hours` | 72 | Pendente |
| `review_window_days` | 30 | Pendente |
| `appeal_window_days` / `appeal_sla_business_days` | 15 / 5 | Pendente |
| `resubmission_limit_30d` | 3 | Pendente |
| `verification_files_retention_days` | 30 | Pendente |
| `push_daily_cap_provider` | 10 | Pendente |
| `report_sla_safety_hours` / `report_sla_normal_hours` | 24 / 72 | Pendente |
| `late_cancellations_flag_30d` | 3 | Pendente |

### 11.2 Regras

**Pedido e proposta**
- O pedido **não é editável**. Para mudar, cancelar e usar "Repetir pedido" **[PENDENTE DE APROVAÇÃO]**.
- Pedido expirado, cancelado ou concluído é **terminal**.
- Proposta tem **validade ≤ validade do pedido**. Retirada ou expiração libera a vaga se o pedido ainda aceitar propostas. Cada prestador envia **uma** proposta por pedido. Edição única com aviso ao cliente. Não é possível reenviar depois de retirar.
- Só vale a data/horário da proposta aceita. Para alterar o horário depois, as partes combinam pelo chat e, se necessário, cancelam.

**Cancelamento (RF-36)**
- Antes do horário: cliente ou prestador cancelam com motivo da lista. Sem penalidade financeira.
- Menos de 24h do horário: marcado como **cancelamento tardio**. Prestador com 3 ou mais em 30 dias entra em fila de revisão do admin (sem punição automática).
- Cancelar **não reabre** o pedido. O cliente usa "Repetir pedido".
- A partir do horário não se cancela: o caminho é conclusão, não comparecimento ou disputa.

**Não comparecimento (RF-37)**
- Pode ser reportado a partir de 30 min após o horário, até 72h depois.
- A parte acusada tem 48h para contestar. Sem resposta, `no_show` confirmado. Contestou, vira disputa.
- O acusador pode retirar a acusação.
- Efeitos: sinalização no perfil (contador interno, não público), possibilidade de avaliação, nenhum efeito financeiro.

**Conclusão parcial e divergência de valor (RF-38, RF-39)**
- Parcial: prestador marca `partial` com nota obrigatória. O cliente vê a nota. Pode concordar (nada a fazer) ou disputar.
- O valor da proposta é registrado como `agreed_price_cents` e é **imutável**. Mudanças de escopo ou valor combinadas no chat **não** alteram o registro.
- Divergência de valor (cobrança diferente do orçamento) é tratada como **disputa** com motivo `price_divergence`. O admin pode advertir, remover conteúdo, suspender. **A plataforma não media valores nem reembolsa** (pagamento é externo). Isso deve estar nos Termos.
- Serviço sem desfecho 7 dias após o horário: cancelado automaticamente (`no_outcome`), sem avaliações.

**Denúncias (RF-30)**
- Motivos padronizados, com detalhe opcional.
- Prioridade `safety` (ameaça, violência, dano ou roubo, assédio grave): resposta em até 24h. Demais: 72h.
- Ações do admin: arquivar, advertir, remover conteúdo, suspender, banir. Denunciante é informado do desfecho (sem detalhes sobre o denunciado).
- Denúncias abusivas repetidas podem levar à suspensão do denunciante.
- Denunciar nunca é bloqueado por bloqueio.

**Avaliações (RF-10, RF-19, RF-23)**
- Liberadas em job concluído (e não comparecimento confirmado **[PENDENTE DE APROVAÇÃO]**), em até 30 dias **[PENDENTE DE APROVAÇÃO]**.
- Reveladas quando ambas existem **ou** 7 dias após a conclusão. Se o prazo já passou, publica ao enviar.
- Sem edição. Remoção só por moderação.

**Verificação (RF-12, RF-41, RF-42, RF-48):** SECURITY seção 4.

## 12. Gate de ativação de categorias (RF-45) (**decisão aprovada**)

Cada categoria nasce **inativa** para clientes (aparece como "Em breve"). Os prestadores podem se cadastrar e ser verificados antes disso.

### 12.1 Critérios para **abrir** a categoria aos clientes (todos)

| # | Critério | Valor |
|---|---|---|
| G1 | Prestadores **aprovados** na categoria | **≥ 2** (decidido pelo proprietário) |
| G2 | Desses, prestadores **não pausados e com disponibilidade cadastrada** | **≥ 2** |
| G3 | Fila de verificação da categoria | **0 pedidos pendentes há mais de 48h** |
| G4 | Termos, Privacidade e fluxos de denúncia/bloqueio publicados e testados | Sim |

### 12.2 Critérios para **pausar** uma categoria já aberta (revisão do admin, nunca automática)
- Prestadores ativos e disponíveis na categoria caírem para menos de 2 por 14 dias consecutivos; **ou**
- Denúncias `safety` graves recorrentes sob apuração.

### 12.3 Ligação com as metas
A categoria pode ser aberta para os clientes assim que atingir 2 profissionais verificados, permitindo tração e validação rápida. O painel admin mostra os indicadores por categoria e alerta quando o limiar for alcançado. **Quem abre ou pausa a categoria é sempre o admin.**

## 13. Decisões pendentes de aprovação (resumo)

A lista completa, com justificativa e recomendação, está em [AUDIT_REPORT.md](AUDIT_REPORT.md) seção 4. Em resumo: parâmetros da seção 11.1, regras de cancelamento/não comparecimento/disputa, distribuição em lotes, retenção de documentos (alternativa A ou B), documentos aceitos, gate de categorias, exclusão de conta (mensagens e avaliações), e ADR-11 a ADR-19.

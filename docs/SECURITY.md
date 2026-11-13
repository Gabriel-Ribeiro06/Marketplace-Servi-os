# SECURITY — Segurança e LGPD

> Status: **Revisado pela auditoria (v2), pendente de aprovação**. Não substitui assessoria jurídica (PRD D-08). Itens novos: **[PENDENTE DE APROVAÇÃO]**.
> A matriz de permissões completa (tabelas, views, buckets, operações admin) está em [DATABASE.md](DATABASE.md) seção 7. Este documento define requisitos e política.

## 1. Ativos a proteger

| Ativo | Sensibilidade |
|---|---|
| Imagem do documento de identidade | Alta |
| **Selfie de verificação** | **Alta, possível dado biométrico (LGPD art. 5º, II)** |
| CPF | Alta (só HMAC é guardado) |
| Endereço do cliente | Alta (segurança física) |
| Fotos do pedido (podem mostrar interior da casa, pessoas) | Média/Alta |
| Telefone, e-mail | Média |
| Mensagens | Média |
| Credenciais, tokens, chaves, *pepper* do HMAC | Crítica |

Categorias de cuidado (Babá, Cuidadora) estão fora do MVP. Se abertas, reabrir a análise de dados de crianças/idosos e antecedentes criminais.

## 2. Modelo de ameaças (resumo)

| Ameaça | Controle |
|---|---|
| IDOR / acesso cruzado | RLS em todas as tabelas, **matriz testada** |
| Escalada (virar admin/aprovado) | `admin_users` só manual. Status só por RPC/EF. GRANT por coluna |
| Vazamento de endereço | Tabela privada, liberada só ao prestador do job |
| Vazamento de documentos | Bucket sem política de leitura, upload e leitura por URL assinada, acesso auditado |
| Abuso por admin ou conta admin roubada | MFA (aal2), motivo obrigatório, auditoria imutável, alerta de abertura em massa. **Risco residual: operador único** |
| Prestador falso | Verificação manual, hash de CPF contra duplicidade, denúncia, suspensão |
| Cliente mal-intencionado | Telefone verificado, bloqueio, denúncia, limite de pedidos |
| Avaliações falsas/retaliação | Só após job, revelação simultânea, janela, moderação |
| Acusação falsa de não comparecimento | Contestação em 48h, disputa com admin, registro em `status_events` |
| Spam | Limites de pedidos, propostas, mensagens, denúncias |
| Interação com bloqueado | `can_interact` em todas as RPC bilaterais, testes obrigatórios |
| Vazamento por push/tela de bloqueio | Push genérico, sem PII |
| Fotos de casa vistas por muitos prestadores | Aviso ao cliente, acesso revogado após encerramento, EXIF removido |
| Engenharia social no chat | Avisos. Sem pagamento no app |
| Sessão roubada | Rate limit, reautenticação em ações críticas |
| Injeção/XSS no admin | Consultas parametrizadas, escape, CSP |
| Chave vazada | Só `anon` no app. `service_role` e *pepper* nunca no cliente/repositório |
| Dependências | Dependabot, `npm audit` |
| Perda de dados | Plano Pro, backup testado |

## 3. Requisitos de segurança

### 3.1 Autenticação e sessão
- SEC-01 Senha ≥ 8 caracteres e checagem contra senhas vazadas quando disponível.
- SEC-02 Rate limit de login e OTP.
- SEC-03 **Admin com MFA obrigatório (aal2 verificado em toda EF admin).**
- SEC-04 Reautenticação para exclusão de conta, troca de e-mail/senha.
- SEC-05 Tokens em Expo SecureStore.

### 3.2 Autorização
- SEC-06 RLS em **todas** as tabelas. O CI falha se alguma não tiver RLS **ou** não tiver teste na matriz.
- SEC-07 Sem `GRANT` amplo a `anon`/`authenticated`: GRANT por tabela e por coluna. Colunas de status não atualizáveis por usuário.
- SEC-08 `SECURITY DEFINER` com `search_path` fixo e `auth.uid()` obrigatório.
- SEC-09 Toda ação admin grava `admin_audit_log` na mesma transação. Tabela imutável.
- SEC-24 `can_interact` aplicado em toda RPC bilateral (cobertura verificada por teste).
- SEC-25 Admin **não** lê mensagens, mídia ou endereços fora de contexto de denúncia (EF com `report_id`).
- SEC-26 Nenhuma função cria admin. Criação manual por quem detém o banco.

### 3.3 Dados
- SEC-10 TLS em todo o tráfego.
- SEC-11 Bucket `verification` **sem** política de leitura ou escrita direta.
- SEC-12 **CPF em claro nunca persistido**: HMAC com *pepper* em segredo de EF. Nº do documento não é persistido.
- SEC-13 Uploads: MIME, tamanho, extensão. EXIF removido em todas as imagens.
- SEC-14 Logs sem dados pessoais, sem corpo de mensagem, sem CPF.
- SEC-15 Segredos em variáveis de ambiente/EAS Secrets. Secret scanning no Git.
- SEC-27 Push e notificações com conteúdo genérico.

### 3.4 Aplicação
- SEC-16 Validação com Zod e no servidor.
- SEC-17 Deep links validados.
- SEC-18 Sem HTML de usuário no admin.
- SEC-19 Erros sem detalhes internos. `NOT_FOUND` e `FORBIDDEN` indistinguíveis quando o recurso pertence a outro.

### 3.5 Operação
- SEC-20 Staging separado, sem dados reais.
- SEC-21 Plano de incidentes (seção 7).
- SEC-22 Conta admin nominal, sem compartilhamento.
- SEC-23 Backup e teste de restauração antes do lançamento.
- SEC-28 Jobs de purga monitorados (falha de purga gera alerta).

## 4. Verificação profissional: política

### 4.1 O que o selo significa (e não significa)

| Selo | Significa | Não significa |
|---|---|---|
| **Identidade verificada** (único selo do MVP) | Um documento oficial com foto e uma selfie foram conferidos manualmente e correspondem à pessoa cadastrada, que é maior de 18 anos | **Não** atesta competência técnica, qualificação, registro profissional, antecedentes, idoneidade ou qualidade |

- **Competência profissional não é verificada no MVP.** Fica à avaliação do cliente por **avaliações, portfólio e experiência autodeclarada**. A interface rotula informações autodeclaradas ("informado pelo profissional") e **proíbe** textos como "qualificado", "certificado", "garantido", "profissional de confiança" nos selos e materiais.
- Possível selo futuro de competência (certificados NR-10 etc.) fica fora do escopo e exigiria sua própria política.

### 4.2 Documentos aceitos **[PENDENTE DE APROVAÇÃO]**

- **Documento com foto:** RG (frente e verso), CNH (física ou digital exportada) ou CIN. Passaporte: decisão pendente.
- **Selfie:** capturada **dentro do app** (câmera ao vivo, sem galeria) para dificultar fotos reaproveitadas. Comparação **manual** pelo admin. **Sem reconhecimento facial automatizado.**
- **CPF:** digitado pelo prestador (hash imediato). O admin confere visualmente se coincide com o documento.
- **Não coletar:** comprovante de residência, certidão de antecedentes, dados bancários, data de nascimento em campo próprio.

### 4.3 Critérios

**Aprovar** se todos: documento legível e dentro da validade; foto do documento corresponde à selfie; nome do documento corresponde ao nome do perfil (nome social aceito mediante explicação); idade ≥ 18 pelo documento; CPF digitado corresponde ao documento; `cpf_hmac` não duplicado em conta ativa; `cpf_hmac` não consta em lista de banidos.

**Rejeitar** com **um** motivo padronizado: `illegible`, `expired_document`, `face_mismatch`, `name_mismatch`, `underage`, `duplicate_account`, `suspected_fraud`, `incomplete`. A mensagem ao prestador explica o que corrigir, **sem** revelar critérios antifraude.

**Prazos (propostos):** análise inicial até 48h (meta de SLA do PRD). Recurso respondido em até 5 dias úteis.

### 4.4 Recurso e reenvio **[PENDENTE DE APROVAÇÃO]**
- Recurso: em até **15 dias** da rejeição, **um** por rejeição, com texto (≤ 1000) e novos documentos opcionais. Decisão final por admin.
- Reenvio com novos documentos: até 3 em 30 dias (anti-abuso).
- `suspected_fraud` e `duplicate_account` não permitem reenvio automático: só recurso.
- Limite honesto: com um único operador, o recurso é revisado pela mesma pessoa. Registrado como risco.

### 4.5 Retenção e minimização **[PENDENTE DE APROVAÇÃO]**

| Dado | Retenção |
|---|---|
| Selfie e imagens do documento | Apagadas **30 dias** após a decisão final (aprovação, ou rejeição sem recurso em curso). Em rejeição, prazo estendido até o fim da janela de recurso (15 dias) + 30 dias. Purga automática diária |
| Resultado da verificação | Mantido: status, data, motivo da rejeição, revisor |
| `cpf_hmac` | Enquanto a conta existir. De banidos: mantido após exclusão (legítimo interesse, prevenção a fraude) |
| CPF em claro, nº do documento | **Nunca persistidos** |
| Alternativa B | Manter a imagem do documento (não a selfie) enquanto a conta estiver ativa, para fins de segurança/investigação. Maior risco e maior utilidade. Decisão do proprietário |

Trade-off registrado: apagar imagens reduz risco, mas dificulta identificar o prestador em investigação. Mitigação: nome, e-mail, telefone verificado e `cpf_hmac` permanecem.

### 4.6 Proteção do dado durante a análise
URL assinada de 60 s, auditada por documento e com motivo. Alerta se um admin abre documentos em volume anormal. Acesso só pela EF. O prestador não vê o arquivo após o envio.

## 5. Bloqueios e interações indevidas

`can_interact(a, b)` (DATABASE seção 6) é aplicada em despacho, `submit_quote`, `edit_quote`, `accept_quote`, `send_message`, perfil público/listagem, notificações e push.
- O bloqueado **não é informado**. As mensagens de erro não revelam quem bloqueou.
- Denúncia, conclusão/cancelamento de job existente, avaliação de job existente e exclusão de conta **não** são bloqueadas.
- O histórico da conversa permanece legível (read-only) para as duas partes.

## 6. LGPD

### 6.1 Bases legais (proposta, validar com advogado)

| Tratamento | Base sugerida |
|---|---|
| Cadastro, pedidos, propostas, chat | Execução de contrato (art. 7º, V) |
| Verificação de identidade | Legítimo interesse (prevenção a fraude, art. 7º, IX) e/ou consentimento |
| **Selfie (biométrico)** | **Consentimento específico e destacado (art. 11, I)**, registrado em `consent_records` (`biometric_selfie`). Alternativa: art. 11, II, g. Decidir com o jurídico |
| Push operacional | Execução de contrato. Marketing: fora do MVP |
| Logs e segurança | Legítimo interesse |

### 6.2 Direitos do titular
- Exclusão **no app** (DATABASE seção 8). Pré-condição: sem job ativo ou denúncia aberta.
- Demais direitos (acesso, correção, portabilidade, informação, revogação) atendidos **manualmente** pelo Encarregado (DPO) por e-mail no MVP, em até 15 dias. Automação é pós-MVP.
- Revogar o consentimento biométrico impede nova verificação (e pode suspender o prestador).

### 6.3 Retenção

| Dado | Retenção |
|---|---|
| Arquivos de verificação | Seção 4.5 |
| Mensagens | Enquanto a conta existir. Na exclusão: corpo apagado, **exceto** com `legal_hold` **[PENDENTE DE APROVAÇÃO]** |
| Pedidos, propostas, jobs, eventos | Mantidos, com perfil anonimizado, para defesa em processo e integridade (prazo a definir pelo jurídico, sugestão 5 anos) |
| Avaliações | Mantidas com autor anonimizado **[PENDENTE DE APROVAÇÃO]** |
| Denúncias e auditoria admin | Sugestão 5 anos |
| Consentimentos | Pelo mesmo prazo de defesa |
| Notificações | 90 dias. Logs técnicos 90 dias |

### 6.4 Governança
ROPA simples. **RIPD** (dado biométrico). DPA com operadores (Supabase, SMS, Expo, Sentry) e análise de transferência internacional. Aceite versionado em `consent_records` e reaceite em mudanças. Cadastro só para maiores de 18.

### 6.5 Natureza da plataforma
O app é **intermediário**, não empregador. A verificação confirma identidade, **não** conduta nem competência. Como o pagamento é feito fora do app, a plataforma **não** intermedeia valores, reembolsos ou indenizações: as disputas resultam apenas em medidas de moderação (aviso, remoção de conteúdo, suspensão, banimento). Os Termos devem dizer isso com clareza.

## 7. Resposta a incidentes

Detectar → Conter (revogar chaves, suspender) → Avaliar (titulares e dados) → Notificar ANPD e titulares se houver risco relevante (a regulamentação da ANPD indica 3 dias úteis, **confirmar a norma vigente**) → Corrigir e documentar. Incidente envolvendo `verification` é tratado como **crítico**.

## 8. Requisitos das lojas
Exclusão de conta no app, denúncia e bloqueio, Política pública, Privacy Labels / Data Safety coerentes (declarar dados de selfie/documento), termos contra conteúdo ofensivo.

## 9. Checklist pré-lançamento

- [ ] Todas as tabelas com RLS **e** teste por papel (matriz verde).
- [ ] Nenhuma `service_role` ou *pepper* no app ou repositório.
- [ ] Buckets privados testados (anônimo e outro usuário negados).
- [ ] URL de documento expira em 60 s (testado).
- [ ] MFA do admin ativo e EF rejeita sem aal2.
- [ ] Exclusão de conta ponta a ponta + varredura de PII.
- [ ] Purga de verificação funcionando e monitorada.
- [ ] Termos, Privacidade, RIPD revisados.
- [ ] Backup restaurado.
- [ ] Rate limits ativos.
- [ ] Bloqueio testado em todas as RPC bilaterais.
- [ ] Revisão MASVS L1.

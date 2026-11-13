# DESIGN_SYSTEM — Diretrizes Visuais

> Status: **Revisado pela auditoria (v2), pendente de aprovação**. Valores de cor são propostas e devem ser conferidos em verificador de contraste WCAG antes do uso. Nome e logotipo ainda não definidos (PRD D-09). Ver [AUDIT_REPORT.md](AUDIT_REPORT.md).

## 1. Princípios

1. **Clareza antes de estilo.** Quem usa pode ter pouca familiaridade digital.
2. **Confiança visível.** Selos, notas e status ocupam lugar de destaque e têm significado explicado.
3. **Menos campos, uma ação principal por tela.**
4. **Acessível por padrão.** Contraste, tamanho, leitor de tela, fonte ampliada.
5. **Linguagem direta em pt-BR.** Sem jargão. Frases curtas. Tom respeitoso e próximo.

## 2. Tokens

### 2.1 Cor (propostas)

| Token | Valor | Uso |
|---|---|---|
| `primary` | #0B5FFF | Botão principal, links |
| `primary-dark` | #0842B8 | Pressionado |
| `success` | #167934 | Verificado, concluído (contraste WCAG AA ≥ 4,5:1 aferido) |
| `warning` | #995800 | Em análise, atenção (contraste WCAG AA ≥ 4,5:1 aferido) |
| `danger` | #C62828 | Erro, denúncia |
| `text` | #1A1F2B | Texto principal |
| `text-muted` | #566073 | Texto secundário |
| `surface` | #FFFFFF | Cartões |
| `background` | #F5F7FA | Fundo |
| `border` | #D5DBE4 | Divisores |

Regras:
- Texto normal: contraste mínimo 4,5:1. Texto grande e ícones: 3:1.
- **Nunca usar cor como único indicador** (somar ícone e texto).
- Modo escuro: fase 2.

### 2.2 Tipografia

- Fonte do sistema (San Francisco/Roboto) no MVP, para desempenho e legibilidade.
- Escala: `display 28/34`, `title 22/28`, `subtitle 18/24`, `body 16/24`, `caption 14/20`. Peso 400/600/700.
- Texto mínimo 14. Respeitar escala de fonte do sistema (testar até 200%).

### 2.3 Espaçamento e forma

- Grade de 4: `4, 8, 12, 16, 24, 32, 48`.
- Raio: `8` (campos), `12` (cartões), `999` (chips).
- Elevação: sombras sutis, bordas preferidas em listas.
- **Área mínima de toque: 48×48dp**, com espaçamento de pelo menos 8dp entre alvos.

## 3. Componentes do MVP

| Componente | Variantes e regras |
|---|---|
| Button | Primário, secundário, texto, destrutivo. Altura 48. Estado de carregamento e desabilitado com motivo |
| TextField | Rótulo sempre visível (não só placeholder), mensagem de erro, contador quando houver limite |
| CategoryTile | Ícone + nome. Estado inativo ("Em breve") |
| RequestCard | Título, bairro, status, tempo |
| QuoteCard | Preço em destaque, inclusões, data, nota, selo. Pensado para comparação |
| ProviderCard / ProfileHeader | Foto, nome, selos, nota, nº de serviços, tempo de resposta |
| VerificationBadge | **Único selo do MVP: "Identidade verificada"**. Toque abre explicação do que foi e do que **não** foi verificado ("não garante qualidade nem competência"). Informações autodeclaradas (experiência) levam o rótulo "informado pelo profissional" |
| RatingStars / RatingInput | Entrada acessível por toque e por leitor de tela (ajustável) |
| StatusChip | Ícone + texto. Pedido: Aberto, Propostas encerradas, Contratado, Concluído, Cancelado, Expirado. Serviço: Agendado, Não comparecimento reportado, Concluído, Concluído parcialmente, Cancelado, Em análise (disputa) |
| ChatBubble / Composer | Hora, leitura, estado de envio |
| EmptyState | Ilustração simples, texto e ação |
| Banner | Offline, aviso de segurança |
| BottomSheet / Dialog | Confirmações de ações irreversíveis |
| Toast | Confirmações rápidas (não crítico) |
| Skeleton | Carregamento de listas |

## 4. Padrões de interação

- **Formulários em passos curtos** com barra de progresso.
- **Confirmação explícita** antes de aceitar proposta, cancelar, excluir conta.
- **Feedback imediato** em toda ação (carregando, sucesso, erro com solução).
- **Rascunho preservado** no pedido de orçamento.
- **Mensagens de segurança contextuais** (aviso de pagamento fora do app, compartilhamento de dados).
- **Selos explicados**: nunca exibir um selo sem dizer o que foi verificado.
- **Proibido** em selos e textos: "qualificado", "certificado", "garantido", "profissional de confiança". A verificação é de **identidade**, não de competência (SECURITY seção 4.1).
- **Push e telas de bloqueio** não mostram nome, valor, endereço nem texto de mensagem (conteúdo genérico).
- **Bloqueio**: o bloqueado nunca vê indicação de que foi bloqueado.
- **Aviso de fotos do pedido**: informar que podem ser vistas por vários profissionais antes da contratação.
- **Aviso de pagamento externo** em aceite e em disputas: o app não intermedeia valores.

## 5. Acessibilidade (checklist)

- [ ] Todo elemento interativo com `accessibilityLabel` e `role`.
- [ ] Ordem de foco lógica.
- [ ] Contraste AA em todos os estados.
- [ ] Texto escalável até 200% sem cortar conteúdo.
- [ ] Alvos de toque ≥ 48dp.
- [ ] Sem informação só por cor.
- [ ] Mensagens de erro anunciadas.
- [ ] Animações respeitam "reduzir movimento".
- [ ] Teste manual com TalkBack e VoiceOver nos fluxos principais.

## 6. Conteúdo e tom

- Chame de **"profissional"** (e não "prestador") na interface do cliente; "cliente" na do profissional.
- Botões com verbo: "Pedir orçamento", "Enviar proposta", "Aceitar proposta".
- Erros: *o que houve + o que fazer*. Ex.: "Não conseguimos enviar. Verifique a internet e tente de novo."
- Evitar linguagem de culpa.

## 7. Ícones e imagem

- Conjunto único de ícones (por exemplo, o que já vem no Expo), sem dependência extra, se atender.
- Fotos de perfil recortadas em círculo. Portfólio em 4:3.
- Compressão e redimensionamento no envio (largura máxima planejada: 1280 px).

## 8. Telas-chave a prototipar primeiro

1. Início do cliente (categorias).
2. Criar pedido (passos).
3. Comparação de propostas.
4. Perfil público do profissional.
5. Envio de proposta.
6. Onboarding/verificação do prestador.
7. Fila de verificação (admin).

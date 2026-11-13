-- =============================================================================
-- Testes pgTAP da Fase 3 — Chat em Tempo Real, RLS de Mensagens e Notificações
-- Cobertura: T-RLS-09, T-RLS-10, T-PUSH-01..03, SEC-25, SEC-27
-- =============================================================================

BEGIN;
SELECT plan(9);

-- Cenário: Cliente (c1), Prestador 1 (p1), Prestador 2 (p2) e Admin (adm1)
INSERT INTO public.profiles (id, full_name, phone, phone_verified_at, age_confirmed_at, status)
VALUES
  ('41111111-1111-4111-8111-111111111111', 'Clara Cliente', '+5511988880001', now(), now(), 'active'),
  ('42222222-2222-4222-8222-222222222222', 'Marcos Encanador', '+5511988880002', now(), now(), 'active'),
  ('43333333-3333-4333-8333-333333333333', 'Lucas Encanador', '+5511988880003', now(), now(), 'active'),
  ('49999999-9999-4999-8999-999999999999', 'Admin Operador', '+5511988880099', now(), now(), 'active');

INSERT INTO public.admin_users (user_id)
VALUES ('49999999-9999-4999-8999-999999999999');

INSERT INTO public.provider_profiles (user_id, display_name, bio, verification_status, verified_at, is_paused)
VALUES
  ('42222222-2222-4222-8222-222222222222', 'Marcos Encanador', 'Reparos hidráulicos em Osasco', 'approved', now(), false),
  ('43333333-3333-4333-8333-333333333333', 'Lucas Encanador', 'Caça-vazamentos e registros', 'approved', now(), false);

UPDATE public.categories SET is_active = true, activated_at = now() WHERE slug = 'encanador';

INSERT INTO public.provider_categories (provider_id, category_id)
SELECT '42222222-2222-4222-8222-222222222222', id FROM public.categories WHERE slug = 'encanador'
UNION ALL
SELECT '43333333-3333-4333-8333-333333333333', id FROM public.categories WHERE slug = 'encanador';

INSERT INTO public.provider_neighborhoods (provider_id, neighborhood_id)
SELECT '42222222-2222-4222-8222-222222222222', id FROM public.neighborhoods WHERE name = 'Vila Yara'
UNION ALL
SELECT '43333333-3333-4333-8333-333333333333', id FROM public.neighborhoods WHERE name = 'Vila Yara';

INSERT INTO public.availability_rules (provider_id, weekday, period)
SELECT '42222222-2222-4222-8222-222222222222', gs, 'morning'::public.availability_period
FROM generate_series(0, 6) AS gs
UNION ALL
SELECT '43333333-3333-4333-8333-333333333333', gs, 'morning'::public.availability_period
FROM generate_series(0, 6) AS gs;

-- Cliente cria pedido
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '41111111-1111-4111-8111-111111111111';

SELECT live_ok(
  $$
    SELECT public.create_service_request(
      (SELECT id FROM public.categories WHERE slug = 'encanador'),
      (SELECT id FROM public.neighborhoods WHERE name = 'Vila Yara'),
      'Conserto de vazamento na pia',
      'Vazamento no sifão e flexível da pia da cozinha no apartamento.',
      now() + interval '1 day',
      now() + interval '2 days',
      'Av. dos Autonomistas, 2000, Apto 81',
      'Bloco B',
      ARRAY[]::text[]
    )
  $$,
  'Cliente cria pedido para teste de chat'
);

-- Prestador 1 envia proposta -> trigger cria conversa automaticamente e notifica cliente
SET LOCAL "request.jwt.claim.sub" = '42222222-2222-4222-8222-222222222222';
SELECT live_ok(
  $$
    SELECT public.submit_quote(
      (SELECT request_id FROM public.incoming_requests LIMIT 1),
      15000,
      'Troca de sifão e engate flexível com vedação completa.',
      now() + interval '1 day',
      now() + interval '24 hours',
      0,
      60
    )
  $$,
  'E5-01: submit_quote cria conversa aberta automaticamente via trigger'
);

-- 1. Prestador 1 envia mensagem na conversa
SELECT live_ok(
  $$
    SELECT public.send_message(
      (SELECT conversation_id FROM public.my_conversations LIMIT 1),
      'Olá, Clara! Posso levar o sifão novo se preferir.'
    )
  $$,
  'E5-01: Prestador envia mensagem de texto via RPC send_message'
);

-- 2. SEC-25 / T-RLS-09: Admin NÃO consegue ler conversations nem messages diretamente via SELECT
SET LOCAL "request.jwt.claim.sub" = '49999999-9999-4999-8999-999999999999';
SELECT is(
  (SELECT COUNT(*)::int FROM public.messages),
  0,
  'SEC-25 / T-RLS-09: Admin não possui leitura direta sobre messages (somente via EF vinculada a report_id)'
);

-- 3. T-RLS-09: Prestador 2 (terceiro não participante da conversa) NÃO lê a conversa nem mensagens
SET LOCAL "request.jwt.claim.sub" = '43333333-3333-4333-8333-333333333333';
SELECT is(
  (SELECT COUNT(*)::int FROM public.messages),
  0,
  'T-RLS-09: Terceiro autenticado não lê mensagens de conversa alheia'
);

-- 4. Cliente vê unread_count = 1 em my_conversations e marca como lida via mark_messages_read
SET LOCAL "request.jwt.claim.sub" = '41111111-1111-4111-8111-111111111111';
SELECT is(
  (SELECT unread_count FROM public.my_conversations LIMIT 1),
  1,
  'E5-02: Cliente enxerga 1 mensagem não lida em my_conversations'
);

SELECT is(
  public.mark_messages_read((SELECT conversation_id FROM public.my_conversations LIMIT 1)),
  1,
  'E5-02: mark_messages_read marca a mensagem recebida como lida'
);

-- 5. SEC-27: Notificação gerada em notifications.payload NÃO contém o texto da mensagem nem nome
SELECT is(
  (
    SELECT (payload ? 'body') OR (payload::text ILIKE '%sifão%')
    FROM public.my_notifications
    WHERE type = 'new_message'
    LIMIT 1
  ),
  false,
  'SEC-27: Payload da notificação não armazena conteúdo de mensagem nem PII'
);

-- 6. Quando o cliente cancela o pedido, a conversa passa automaticamente para read_only e bloqueia novas mensagens
SELECT live_ok(
  $$
    SELECT public.cancel_service_request((SELECT id FROM public.my_requests LIMIT 1))
  $$,
  'Cliente cancela o pedido'
);

SELECT throws_ok(
  $$
    SELECT public.send_message(
      (SELECT conversation_id FROM public.my_conversations LIMIT 1),
      'Tentativa de mensagem após conversa read_only'
    )
  $$,
  '22023',
  NULL,
  'E5-01: Conversa em modo read_only bloqueia envio de novas mensagens'
);

SELECT * FROM finish();
ROLLBACK;

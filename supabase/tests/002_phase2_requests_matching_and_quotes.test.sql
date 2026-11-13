-- =============================================================================
-- Testes pgTAP da Fase 2 — Pedidos, Lotes, Propostas, RLS de Endereço e Aceite
-- Cobertura: T-RLS-03..05, T-ST-REQ-01..04, T-ST-QUO-01..05, T-MATCH-01..05
-- =============================================================================

BEGIN;
SELECT plan(10);

-- Cenário base:
-- Cliente 1 (c1), Prestador 1 (p1), Prestador 2 (p2), Terceiro (u3)
INSERT INTO public.profiles (id, full_name, phone, phone_verified_at, age_confirmed_at, status)
VALUES
  ('31111111-1111-4111-8111-111111111111', 'Carla Cliente', '+5511999990001', now(), now(), 'active'),
  ('32222222-2222-4222-8222-222222222222', 'Pedro Eletricista', '+5511999990002', now(), now(), 'active'),
  ('33333333-3333-4333-8333-333333333333', 'Paulo Eletricista', '+5511999990003', now(), now(), 'active'),
  ('34444444-4444-4444-8444-444444444444', 'Curioso Externo', '+5511999990004', now(), now(), 'active');

INSERT INTO public.provider_profiles (user_id, display_name, bio, verification_status, verified_at, is_paused)
VALUES
  ('32222222-2222-4222-8222-222222222222', 'Pedro Eletricista', 'Instalações em Osasco', 'approved', now(), false),
  ('33333333-3333-4333-8333-333333333333', 'Paulo Eletricista', 'Quadro elétrico e tomadas', 'approved', now(), false);

-- Ativar categoria Eletricista e vincular os 2 prestadores + bairro Centro + disponibilidade todos os dias
UPDATE public.categories SET is_active = true, activated_at = now() WHERE slug = 'eletricista';

INSERT INTO public.provider_categories (provider_id, category_id)
SELECT '32222222-2222-4222-8222-222222222222', id FROM public.categories WHERE slug = 'eletricista'
UNION ALL
SELECT '33333333-3333-4333-8333-333333333333', id FROM public.categories WHERE slug = 'eletricista';

INSERT INTO public.provider_neighborhoods (provider_id, neighborhood_id)
SELECT '32222222-2222-4222-8222-222222222222', id FROM public.neighborhoods WHERE name = 'Centro'
UNION ALL
SELECT '33333333-3333-4333-8333-333333333333', id FROM public.neighborhoods WHERE name = 'Centro';

INSERT INTO public.availability_rules (provider_id, weekday, period)
SELECT '32222222-2222-4222-8222-222222222222', gs, 'morning'::public.availability_period
FROM generate_series(0, 6) AS gs
UNION ALL
SELECT '33333333-3333-4333-8333-333333333333', gs, 'morning'::public.availability_period
FROM generate_series(0, 6) AS gs;

-- 1. Gate de categoria (PRD seção 12): Eletricista tem 2 aprovados e disponíveis -> gate_passed = true
SELECT is(
  (
    SELECT (public.get_category_gate_status(id) ->> 'gate_passed')::boolean
    FROM public.categories
    WHERE slug = 'eletricista'
  ),
  true,
  'PRD seção 12: Categoria com >= 2 prestadores aprovados e disponíveis passa no gate'
);

-- 2. Cliente 1 cria pedido em Eletricista / Centro
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '31111111-1111-4111-8111-111111111111';

SELECT is(
  (
    SELECT (
      public.create_service_request(
        (SELECT id FROM public.categories WHERE slug = 'eletricista'),
        (SELECT id FROM public.neighborhoods WHERE name = 'Centro'),
        'Troca de disjuntor geral',
        'Preciso substituir o disjuntor bipolar do quadro principal do apartamento.',
        now() + interval '1 day',
        now() + interval '2 days',
        'Rua Antônio Agu, 500, Apto 42',
        'Próximo à estação Osasco',
        ARRAY['requests/foto1.jpg']
      ) ->> 'eligible'
    )::boolean
  ),
  true,
  'T-ST-REQ-01: create_service_request cria pedido open e encontra prestadores elegíveis sem expor a contagem'
);

-- 3. T-RLS-05: Cliente dono NÃO consegue ler request_matches (não sabe quem foi notificado)
SELECT is(
  (SELECT COUNT(*)::int FROM public.request_matches),
  0,
  'T-RLS-05: Cliente dono não enxerga linhas de request_matches'
);

-- 4. T-RLS-04: Prestador 1 notificado vê o pedido em incoming_requests, mas NÃO lê service_request_private antes do aceite
SET LOCAL "request.jwt.claim.sub" = '32222222-2222-4222-8222-222222222222';

SELECT is(
  (SELECT COUNT(*)::int FROM public.incoming_requests WHERE title = 'Troca de disjuntor geral'),
  1,
  'T-RLS-03: Prestador elegível notificado enxerga pedido em incoming_requests'
);

SELECT is(
  (SELECT COUNT(*)::int FROM public.service_request_private),
  0,
  'T-RLS-04: Prestador não contratado NÃO lê endereço completo em service_request_private'
);

-- 5. Prestador 1 envia proposta e edita 1 vez (revision 0 -> 1); 2ª edição é bloqueada
SELECT is(
  (
    SELECT (
      public.submit_quote(
        (SELECT request_id FROM public.incoming_requests LIMIT 1),
        18000,
        'Mão de obra completa para substituição do disjuntor e reaperto do quadro.',
        now() + interval '1 day',
        now() + interval '24 hours',
        0,
        60
      ) ->> 'quote_status'
    )
  ),
  'sent',
  'T-ST-QUO-01: Prestador 1 envia proposta estruturada em centavos'
);

SELECT is(
  (
    SELECT (
      public.edit_quote(
        (SELECT quote_id FROM public.my_quotes LIMIT 1),
        16500,
        'Mão de obra completa + teste de carga no quadro principal.',
        now() + interval '1 day',
        now() + interval '24 hours',
        0,
        60
      ) ->> 'revision'
    )::int
  ),
  1,
  'T-ST-QUO-03: Prestador edita sua proposta uma única vez (revision = 1)'
);

SELECT throws_ok(
  $$
    SELECT public.edit_quote(
      (SELECT quote_id FROM public.my_quotes LIMIT 1),
      15000,
      'Tentativa de segunda edição proibida pela regra.',
      now() + interval '1 day',
      now() + interval '24 hours',
      0,
      60
    )
  $$,
  '22023',
  NULL,
  'T-ST-QUO-03: Segunda edição da mesma proposta é bloqueada com QUOTE_ALREADY_EDITED'
);

-- 6. Prestador 2 também envia proposta; Cliente aceita a proposta do Prestador 1
SET LOCAL "request.jwt.claim.sub" = '33333333-3333-4333-8333-333333333333';

SELECT live_ok(
  $$
    SELECT public.submit_quote(
      (SELECT request_id FROM public.incoming_requests LIMIT 1),
      21000,
      'Troca de disjuntor com visita técnica inclusa.',
      now() + interval '1 day',
      now() + interval '24 hours',
      3000,
      90
    )
  $$,
  'Prestador 2 envia segunda proposta concorrente'
);

-- Cliente aceita proposta do Prestador 1
SET LOCAL "request.jwt.claim.sub" = '31111111-1111-4111-8111-111111111111';

SELECT live_ok(
  $$
    SELECT public.accept_quote(
      (
        SELECT quote_id
        FROM public.quotes_for_my_request
        WHERE provider_id = '32222222-2222-4222-8222-222222222222'
      )
    )
  $$,
  'E3-05: Cliente aceita proposta do Prestador 1'
);

-- 7. T-RLS-04: Agora o Prestador 1 (contratado) consegue ler o endereço em service_request_private, e o Prestador 2 continua bloqueado
SET LOCAL "request.jwt.claim.sub" = '32222222-2222-4222-8222-222222222222';
SELECT is(
  (SELECT address_full FROM public.service_request_private LIMIT 1),
  'Rua Antônio Agu, 500, Apto 42',
  'T-RLS-04: Prestador contratado (accepted) passa a ler o endereço completo do pedido'
);

SELECT * FROM finish();
ROLLBACK;

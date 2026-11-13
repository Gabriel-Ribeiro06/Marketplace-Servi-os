-- =============================================================================
-- Seeds iniciais do MVP "Eu Faço" (Osasco)
-- Fonte: docs/DATABASE.md seção 10, docs/PRD.md seções 5.1, 11.1 e 12
-- =============================================================================

-- 1. Parâmetros operacionais (app_config)
INSERT INTO public.app_config (key, value, is_public, description)
VALUES
  ('min_app_version', '"0.1.0"'::jsonb, true, 'Versão mínima suportada do app'),
  ('request_expiry_hours', '48'::jsonb, true, 'Prazo de expiração do pedido sem aceite (horas)'),
  ('max_quotes', '5'::jsonb, true, 'Limite máximo de propostas ativas por pedido'),
  ('reviews_reveal_days', '7'::jsonb, true, 'Dias para revelação automática de avaliações'),
  ('verification_sla_hours', '48'::jsonb, true, 'SLA de análise inicial de verificação (horas)'),
  ('category_gate_min_approved', '2'::jsonb, false, 'Mínimo de profissionais aprovados e disponíveis para abrir categoria (G1/G2)'),
  ('batch_size', '8'::jsonb, false, 'Tamanho do lote de despacho de pedidos'),
  ('batch_interval_minutes', '15'::jsonb, false, 'Intervalo em minutos entre lotes de despacho'),
  ('max_open_requests', '3'::jsonb, true, 'Máximo de pedidos abertos simultâneos por cliente'),
  ('max_requests_per_day', '5'::jsonb, false, 'Limite diário de criação de pedidos por cliente'),
  ('provider_max_pending_quotes', '10'::jsonb, false, 'Máximo de propostas pendentes simultâneas por prestador'),
  ('quote_min_validity_hours', '2'::jsonb, true, 'Validade mínima de uma proposta (horas)'),
  ('quote_min_lead_hours', '2'::jsonb, true, 'Antecedência mínima do horário proposto (horas)'),
  ('quote_edit_limit', '1'::jsonb, true, 'Número máximo de edições permitidas por proposta'),
  ('late_cancellation_hours', '24'::jsonb, true, 'Janela em horas para caracterizar cancelamento tardio'),
  ('no_show_claim_after_minutes', '30'::jsonb, true, 'Minutos após o horário agendado para reportar não comparecimento'),
  ('no_show_contest_hours', '48'::jsonb, true, 'Prazo em horas para contestar acusação de não comparecimento'),
  ('job_no_outcome_days', '7'::jsonb, false, 'Dias após o horário agendado para encerrar serviço sem desfecho'),
  ('dispute_window_days', '7'::jsonb, true, 'Janela em dias após conclusão para abertura de disputa'),
  ('dispute_sla_hours', '72'::jsonb, true, 'SLA de análise de disputa pelo admin (horas)'),
  ('review_window_days', '30'::jsonb, true, 'Prazo máximo em dias após conclusão para enviar avaliação'),
  ('appeal_window_days', '15'::jsonb, true, 'Prazo em dias para recorrer de rejeição de verificação'),
  ('appeal_sla_business_days', '5'::jsonb, true, 'Prazo em dias úteis para resposta a recurso'),
  ('resubmission_limit_30d', '3'::jsonb, false, 'Limite de reenvios de verificação em 30 dias'),
  ('verification_files_retention_days', '30'::jsonb, false, 'Dias de retenção dos arquivos de verificação após decisão final'),
  ('push_daily_cap_provider', '10'::jsonb, false, 'Teto diário de notificações push de novos pedidos por prestador'),
  ('report_sla_safety_hours', '24'::jsonb, false, 'SLA em horas para denúncias de segurança física'),
  ('report_sla_normal_hours', '72'::jsonb, false, 'SLA em horas para denúncias gerais'),
  ('late_cancellations_flag_30d', '3'::jsonb, false, 'Quantidade de cancelamentos tardios em 30 dias que gera alerta admin')
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value,
    is_public = EXCLUDED.is_public,
    description = EXCLUDED.description;

-- 2. Quatro categorias aprovadas do MVP (nascem inativas até atingir o gate de 2 profissionais)
INSERT INTO public.categories (slug, name, icon, is_active, requires_enhanced_verification, sort_order)
VALUES
  ('eletricista', 'Eletricista', 'zap', false, false, 1),
  ('encanador', 'Encanador', 'droplet', false, false, 2),
  ('diarista', 'Diarista', 'home', false, false, 3),
  ('tecnico-computadores', 'Técnico em computadores', 'monitor', false, false, 4)
ON CONFLICT (slug) DO UPDATE
SET name = EXCLUDED.name,
    icon = EXCLUDED.icon,
    requires_enhanced_verification = EXCLUDED.requires_enhanced_verification,
    sort_order = EXCLUDED.sort_order;

-- 3. Bairros de Osasco distribuídos por zona geográfica
INSERT INTO public.neighborhoods (name, zone, city, is_active)
VALUES
  ('Centro', 'Centro', 'Osasco', true),
  ('Vila Yara', 'Leste', 'Osasco', true),
  ('Vila Campesina', 'Sul', 'Osasco', true),
  ('Cidade de Deus', 'Sul', 'Osasco', true),
  ('Bela Vista', 'Sul', 'Osasco', true),
  ('Jaguaribe', 'Sul', 'Osasco', true),
  ('Cipava', 'Sul', 'Osasco', true),
  ('Jardim das Flores', 'Oeste', 'Osasco', true),
  ('Km 18', 'Oeste', 'Osasco', true),
  ('Quitaúna', 'Oeste', 'Osasco', true),
  ('Pestana', 'Oeste', 'Osasco', true),
  ('Vila Osasco', 'Centro', 'Osasco', true),
  ('Presidente Altino', 'Leste', 'Osasco', true),
  ('Continental', 'Leste', 'Osasco', true),
  ('Rochdale', 'Norte', 'Osasco', true),
  ('Jardim Piratininga', 'Norte', 'Osasco', true),
  ('Baronesa', 'Norte', 'Osasco', true),
  ('Helena Maria', 'Norte', 'Osasco', true),
  ('Jardim Mutinga', 'Norte', 'Osasco', true),
  ('Vila Menck', 'Norte', 'Osasco', true)
ON CONFLICT (city, name) DO NOTHING;

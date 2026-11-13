import { z } from 'zod';

import { isValidBrazilianCPF } from '@/features/verification/verification-core';

/**
 * Schemas Zod compartilhados (ARCHITECTURE.md ADR-10; DATABASE.md seção 3; TEST_STRATEGY.md seção 4).
 * Todas as mensagens de validação estão em pt-BR.
 */

export const CURRENT_TERMS_VERSION = '1.0.0';
export const CURRENT_PRIVACY_VERSION = '1.0.0';
export const CURRENT_BIOMETRIC_CONSENT_VERSION = '1.0.0';

export const phoneE164Schema = z
  .string()
  .regex(/^\+55\d{10,11}$/, 'Informe um telefone brasileiro válido no formato +55DD9XXXXXXXX.');

// Fase 1 — Autenticação, Cadastro e Consentimentos (E1-01..03, SEC-01, RF-32, RF-33, RF-44)
export const signUpInputSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(2, 'Informe seu nome completo (mín. 2 caracteres).')
    .max(120, 'O nome deve ter no máximo 120 caracteres.'),
  email: z.string().trim().email('Informe um e-mail válido.'),
  password: z
    .string()
    .min(8, 'A senha deve ter pelo menos 8 caracteres.')
    .max(128, 'A senha deve ter no máximo 128 caracteres.'),
  ageConfirmed: z.literal(true, {
    message: 'Você precisa confirmar que tem 18 anos ou mais.',
  }),
  termsAccepted: z.literal(true, {
    message: 'É obrigatório aceitar os Termos de Uso e a Política de Privacidade.',
  }),
});

export const signInInputSchema = z.object({
  email: z.string().trim().email('Informe um e-mail válido.'),
  password: z.string().min(1, 'Informe sua senha.'),
});

export const otpVerificationSchema = z.object({
  phone: phoneE164Schema,
  code: z.string().regex(/^\d{6}$/, 'Informe o código de 6 dígitos enviado por SMS.'),
});

// Fase 1 — Onboarding e Verificação do Prestador (E2-01..07)
export const availabilitySlotSchema = z.object({
  weekday: z.number().int().min(0).max(6),
  period: z.enum(['morning', 'afternoon', 'evening']),
});

export const providerOnboardingInputSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(2, 'Informe seu nome profissional (mín. 2 caracteres).')
    .max(80, 'O nome profissional deve ter no máximo 80 caracteres.'),
  bio: z.string().trim().max(500, 'A apresentação deve ter no máximo 500 caracteres.'),
  experienceYears: z
    .number()
    .int('Informe anos inteiros.')
    .min(0, 'O tempo de experiência não pode ser negativo.')
    .max(70, 'Informe um tempo de experiência válido.')
    .optional(),
  categoryIds: z
    .array(z.string().uuid('Categoria inválida.'))
    .min(1, 'Selecione pelo menos uma categoria de serviço.'),
  neighborhoodIds: z
    .array(z.string().uuid('Bairro inválido.'))
    .min(1, 'Selecione pelo menos um bairro de Osasco.'),
  availabilitySlots: z
    .array(availabilitySlotSchema)
    .min(1, 'Defina pelo menos um dia e período de disponibilidade.'),
});

export const providerVerificationSubmitSchema = z.object({
  cpf: z.string().refine((val) => isValidBrazilianCPF(val), { message: 'Informe um CPF válido.' }),
  biometricConsentAccepted: z.literal(true, {
    message:
      'É necessário consentir com o uso da selfie exclusivamente para conferência manual de identidade.',
  }),
  hasIdFront: z.literal(true, {
    message: 'Envie a foto da frente do documento.',
  }),
  hasIdBack: z.literal(true, {
    message: 'Envie a foto do verso do documento.',
  }),
  hasSelfie: z.literal(true, {
    message: 'Tire a selfie ao vivo no aplicativo.',
  }),
});

export const verificationAppealSchema = z.object({
  rejectedSubmissionId: z.string().uuid('Submissão inválida.'),
  appealText: z
    .string()
    .trim()
    .min(10, 'Explique o motivo do recurso (mín. 10 caracteres).')
    .max(1000, 'O recurso deve ter no máximo 1000 caracteres.'),
});

// Fases seguintes — Pedidos, Propostas, Chat e Avaliações
export const serviceRequestInputSchema = z
  .object({
    categoryId: z.string().uuid('Selecione uma categoria válida.'),
    neighborhoodId: z.string().uuid('Selecione um bairro válido.'),
    title: z
      .string()
      .trim()
      .min(5, 'O título deve ter pelo menos 5 caracteres.')
      .max(80, 'O título deve ter no máximo 80 caracteres.'),
    description: z
      .string()
      .trim()
      .min(15, 'Descreva o serviço com pelo menos 15 caracteres.')
      .max(1000, 'A descrição deve ter no máximo 1000 caracteres.'),
    windowStart: z.string().datetime({ message: 'Data inicial inválida.' }),
    windowEnd: z.string().datetime({ message: 'Data final inválida.' }),
    addressFull: z
      .string()
      .trim()
      .min(8, 'Informe o endereço completo.')
      .max(250, 'O endereço deve ter no máximo 250 caracteres.'),
    addressNotes: z
      .string()
      .trim()
      .max(200, 'O complemento deve ter no máximo 200 caracteres.')
      .optional(),
  })
  .refine((data) => new Date(data.windowEnd).getTime() >= new Date(data.windowStart).getTime(), {
    message: 'A data final da janela deve ser igual ou posterior à data inicial.',
    path: ['windowEnd'],
  });

export const quoteInputSchema = z.object({
  requestId: z.string().uuid('Pedido inválido.'),
  totalPriceCents: z
    .number()
    .int('O valor deve ser em centavos inteiros.')
    .positive('O valor total deve ser maior que zero.')
    .max(5_000_000, 'O valor excede o limite permitido.'),
  visitFeeCents: z
    .number()
    .int('A taxa de visita deve ser em centavos inteiros.')
    .min(0, 'A taxa de visita não pode ser negativa.')
    .max(500_000, 'A taxa de visita excede o limite permitido.')
    .optional(),
  includesDescription: z
    .string()
    .trim()
    .min(10, 'Explique o que está incluído no orçamento (mín. 10 caracteres).')
    .max(500, 'A descrição do orçamento deve ter no máximo 500 caracteres.'),
  proposedStart: z.string().datetime({ message: 'Informe uma data e horário válidos.' }),
  estimatedDurationMinutes: z
    .number()
    .int()
    .positive('A duração estimada deve ser positiva.')
    .max(24 * 60, 'A duração máxima por agendamento é de 24 horas.')
    .optional(),
  validUntil: z.string().datetime({ message: 'Validade da proposta inválida.' }),
});

export const chatMessageSchema = z.object({
  conversationId: z.string().uuid('Conversa inválida.'),
  body: z
    .string()
    .trim()
    .min(1, 'Digite uma mensagem.')
    .max(2000, 'A mensagem deve ter no máximo 2000 caracteres.'),
});

export const reviewInputSchema = z.object({
  jobId: z.string().uuid('Serviço inválido.'),
  rating: z
    .number()
    .int()
    .min(1, 'A nota mínima é 1 estrela.')
    .max(5, 'A nota máxima é 5 estrelas.'),
  comment: z.string().trim().max(500, 'O comentário deve ter no máximo 500 caracteres.').optional(),
});

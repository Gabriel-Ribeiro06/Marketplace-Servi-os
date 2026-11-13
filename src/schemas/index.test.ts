import {
  chatMessageSchema,
  otpVerificationSchema,
  phoneE164Schema,
  providerOnboardingInputSchema,
  providerVerificationSubmitSchema,
  quoteInputSchema,
  reviewInputSchema,
  serviceRequestInputSchema,
  signUpInputSchema,
  verificationAppealSchema,
} from './index';

describe('schemas Zod compartilhados', () => {
  it('valida telefone brasileiro E.164 e OTP de 6 dígitos', () => {
    expect(phoneE164Schema.safeParse('+5511987654321').success).toBe(true);
    expect(phoneE164Schema.safeParse('11987654321').success).toBe(false);
    expect(
      otpVerificationSchema.safeParse({ phone: '+5511987654321', code: '123456' }).success,
    ).toBe(true);
    expect(
      otpVerificationSchema.safeParse({ phone: '+5511987654321', code: '12345' }).success,
    ).toBe(false);
  });

  it('T-LGPD-04 / SEC-01: signUpInputSchema exige senha >= 8, 18+ e aceite de termos', () => {
    expect(
      signUpInputSchema.safeParse({
        fullName: 'Maria da Silva',
        email: 'maria@exemplo.com',
        password: 'senha_forte_123',
        ageConfirmed: true,
        termsAccepted: true,
      }).success,
    ).toBe(true);

    // Menor de 18 anos / não confirmado
    expect(
      signUpInputSchema.safeParse({
        fullName: 'Maria da Silva',
        email: 'maria@exemplo.com',
        password: 'senha_forte_123',
        ageConfirmed: false,
        termsAccepted: true,
      }).success,
    ).toBe(false);

    // Senha curta (< 8)
    expect(
      signUpInputSchema.safeParse({
        fullName: 'Maria da Silva',
        email: 'maria@exemplo.com',
        password: '1234567',
        ageConfirmed: true,
        termsAccepted: true,
      }).success,
    ).toBe(false);
  });

  it('valida onboarding do prestador (exige >= 1 categoria, >= 1 bairro e >= 1 regra de disponibilidade)', () => {
    expect(
      providerOnboardingInputSchema.safeParse({
        displayName: 'José Eletricista',
        bio: 'Atendo residências em Osasco.',
        experienceYears: 10,
        categoryIds: ['550e8400-e29b-41d4-a716-446655440000'],
        neighborhoodIds: ['550e8400-e29b-41d4-a716-446655440001'],
        availabilitySlots: [{ weekday: 1, period: 'morning' }],
      }).success,
    ).toBe(true);

    expect(
      providerOnboardingInputSchema.safeParse({
        displayName: 'José Eletricista',
        bio: 'Atendo residências.',
        categoryIds: [],
        neighborhoodIds: ['550e8400-e29b-41d4-a716-446655440001'],
        availabilitySlots: [{ weekday: 1, period: 'morning' }],
      }).success,
    ).toBe(false);
  });

  it('T-VER-07: exige CPF válido, consentimento biométrico e os 3 documentos para submeter verificação', () => {
    expect(
      providerVerificationSubmitSchema.safeParse({
        cpf: '529.982.247-25',
        biometricConsentAccepted: true,
        hasIdFront: true,
        hasIdBack: true,
        hasSelfie: true,
      }).success,
    ).toBe(true);

    expect(
      providerVerificationSubmitSchema.safeParse({
        cpf: '529.982.247-25',
        biometricConsentAccepted: false,
        hasIdFront: true,
        hasIdBack: true,
        hasSelfie: true,
      }).success,
    ).toBe(false);
  });

  it('valida recurso de verificação (10 a 1000 caracteres)', () => {
    expect(
      verificationAppealSchema.safeParse({
        rejectedSubmissionId: '550e8400-e29b-41d4-a716-446655440000',
        appealText: 'Enviei uma nova foto legível e utilizo nome social.',
      }).success,
    ).toBe(true);
  });

  it('rejeita pedido cuja janela final é anterior à inicial', () => {
    const result = serviceRequestInputSchema.safeParse({
      categoryId: '550e8400-e29b-41d4-a716-446655440000',
      neighborhoodId: '550e8400-e29b-41d4-a716-446655440001',
      title: 'Trocar disjuntor do quadro',
      description: 'O disjuntor do chuveiro está desarmando após 5 minutos ligado.',
      windowStart: '2026-11-15T14:00:00.000Z',
      windowEnd: '2026-11-14T14:00:00.000Z',
      addressFull: 'Rua Antônio Agu, 500 - Centro, Osasco',
    });
    expect(result.success).toBe(false);
  });

  it('valida proposta com valor em centavos positivo', () => {
    const valid = quoteInputSchema.safeParse({
      requestId: '550e8400-e29b-41d4-a716-446655440000',
      totalPriceCents: 18000,
      visitFeeCents: 0,
      includesDescription: 'Mão de obra inclusa, disjuntor por conta do cliente.',
      proposedStart: '2026-11-15T13:00:00.000Z',
      validUntil: '2026-11-15T18:00:00.000Z',
    });
    expect(valid.success).toBe(true);
  });

  it('limita mensagem de chat a 2000 caracteres e avaliação de 1 a 5', () => {
    expect(
      chatMessageSchema.safeParse({
        conversationId: '550e8400-e29b-41d4-a716-446655440000',
        body: 'a'.repeat(2001),
      }).success,
    ).toBe(false);

    expect(
      reviewInputSchema.safeParse({
        jobId: '550e8400-e29b-41d4-a716-446655440000',
        rating: 6,
      }).success,
    ).toBe(false);
  });
});

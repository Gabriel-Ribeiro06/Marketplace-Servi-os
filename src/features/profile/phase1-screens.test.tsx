import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';

import AdminVerificationsScreen from '@/app/(admin)/verifications';
import SignUpScreen from '@/app/(auth)/sign-up';
import CustomerHomeScreen from '@/app/(customer)/index';
import ProviderOnboardingScreen from '@/app/(provider)/onboarding';
import VerificationStatusScreen from '@/app/(provider)/verification-status';

import { ProviderPublicCard } from './ProviderPublicCard';
import { RoleProvider } from './role-context';

describe('Fase 1 — Cadastro, 18+ e Consentimentos (E1-01, T-LGPD-04)', () => {
  it('bloqueia cadastro se não confirmar 18+ ou aceite de Termos, e conclui quando ambos marcados', async () => {
    const onSuccess = jest.fn();
    await render(<SignUpScreen onSuccess={onSuccess} />);

    await fireEvent.changeText(screen.getByTestId('signup-full-name'), 'Maria da Silva');
    await fireEvent.changeText(screen.getByTestId('signup-email'), 'maria@exemplo.com');
    await fireEvent.changeText(screen.getByTestId('signup-password'), 'senha_segura_123');

    // Tenta enviar sem 18+
    await fireEvent.press(screen.getByTestId('signup-submit'));
    expect(onSuccess).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/18 anos/);

    // Marca 18+ e Termos
    await fireEvent.press(screen.getByTestId('signup-age-checkbox'));
    await fireEvent.press(screen.getByTestId('signup-terms-checkbox'));
    await fireEvent.press(screen.getByTestId('signup-submit'));

    expect(onSuccess).toHaveBeenCalledWith(
      expect.objectContaining({
        fullName: 'Maria da Silva',
        email: 'maria@exemplo.com',
      }),
    );
  });
});

describe('Fase 1 — Alternância Cliente/Profissional e Perfil Público (E1-04, E2-09, RF-13)', () => {
  it('alterna entre perfil Cliente e Profissional na mesma conta e rotula experiência como autodeclarada', async () => {
    await render(
      <RoleProvider initialRole="customer">
        <CustomerHomeScreen
          activeCategorySlugs={['eletricista']}
          featuredProviders={[
            {
              providerId: '22222222-2222-4222-8222-222222222222',
              displayName: 'Seu José Eletricista',
              bio: 'Instalações residenciais em Osasco.',
              categories: ['Eletricista'],
              neighborhoods: ['Centro', 'Vila Yara'],
              experienceYears: 12,
              ratingAvg: 4.9,
              ratingCount: 15,
              completedJobsCount: 28,
              avgFirstResponseMinutes: 18,
            },
          ]}
        />
      </RoleProvider>,
    );

    expect(screen.getByText('Perfil ativo: Cliente')).toBeTruthy();
    expect(screen.getByText('Experiência: 12 anos (informado pelo profissional)')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('role-switch-button'));
    expect(screen.getByText('Perfil ativo: Profissional')).toBeTruthy();
  });

  it('ProviderPublicCard exibe apenas o selo "Identidade verificada"', async () => {
    await render(
      <ProviderPublicCard
        provider={{
          providerId: '22222222-2222-4222-8222-222222222222',
          displayName: 'Ana Diarista',
          bio: 'Limpeza residencial.',
          categories: ['Diarista'],
          neighborhoods: ['Vila Campesina'],
          experienceYears: 5,
          ratingAvg: 5,
          ratingCount: 4,
          completedJobsCount: 7,
        }}
      />,
    );

    expect(screen.getByText('✓ Identidade verificada')).toBeTruthy();
    expect(screen.getByText('Experiência: 5 anos (informado pelo profissional)')).toBeTruthy();
  });
});

describe('Fase 1 — Onboarding do Prestador e Consentimento Biométrico (E2-05, T-VER-07)', () => {
  it('impede submissão sem consentimento biométrico da selfie e permite quando completo', async () => {
    const onSubmitted = jest.fn();
    await render(<ProviderOnboardingScreen onSubmitted={onSubmitted} />);

    await fireEvent.changeText(screen.getByTestId('provider-display-name'), 'Carlos Encanador');
    await fireEvent.changeText(screen.getByTestId('provider-cpf'), '529.982.247-25');
    await fireEvent.press(screen.getByTestId('upload-id-front'));
    await fireEvent.press(screen.getByTestId('upload-id-back'));
    await fireEvent.press(screen.getByTestId('capture-live-selfie'));

    // Tenta submeter sem marcar o consentimento biométrico
    await fireEvent.press(screen.getByTestId('provider-submit-verification'));
    expect(onSubmitted).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/selfie/);

    // Marca o consentimento biométrico e submete
    await fireEvent.press(screen.getByTestId('provider-biometric-consent'));
    await fireEvent.press(screen.getByTestId('provider-submit-verification'));
    expect(onSubmitted).toHaveBeenCalledTimes(1);
  });
});

describe('Fase 1 — Status de Verificação, Rejeição e Recurso (E2-07, T-VER-03, T-VER-04)', () => {
  it('bloqueia reenvio automático em suspected_fraud mas permite recurso dentro de 15 dias', async () => {
    const onAppealSubmitted = jest.fn();
    await render(
      <VerificationStatusScreen
        submissionId="550e8400-e29b-41d4-a716-446655440000"
        verificationStatus="rejected"
        rejectionReason="suspected_fraud"
        reviewedAt={new Date()}
        onAppealSubmitted={onAppealSubmitted}
      />,
    );

    const resubmitBtn = screen.getByTestId('provider-resubmit-button');
    expect(resubmitBtn.props.accessibilityState?.disabled).toBe(true);

    await fireEvent.changeText(
      screen.getByTestId('provider-appeal-input'),
      'Meu documento é a nova Carteira de Identidade Nacional expedida em SP.',
    );
    await fireEvent.press(screen.getByTestId('provider-appeal-submit'));

    expect(onAppealSubmitted).toHaveBeenCalledWith(
      'Meu documento é a nova Carteira de Identidade Nacional expedida em SP.',
    );
  });
});

describe('Fase 1 — Fila Admin com MFA (aal2) e URL Assinada de 60s (E8-01..03, T-ADM-01, T-STO-04)', () => {
  it('bloqueia acesso se o admin não estiver com MFA (aal2)', async () => {
    await render(<AdminVerificationsScreen isAdmin={true} aal="aal1" />);
    expect(screen.getByText(/MFA obrigatório/i)).toBeTruthy();
  });

  it('exige motivo de auditoria antes de abrir URL assinada de 60s e permite aprovar/rejeitar', async () => {
    const onOpenDocument = jest.fn();
    const onDecision = jest.fn();
    const subId = '550e8400-e29b-41d4-a716-446655440099';

    await render(
      <AdminVerificationsScreen
        isAdmin={true}
        aal="aal2"
        queue={[
          {
            submissionId: subId,
            providerId: '22222222-2222-4222-8222-222222222222',
            providerDisplayName: 'Seu José Eletricista',
            submissionType: 'initial',
            submittedAt: '2026-11-13T12:00:00.000Z',
          },
        ]}
        onOpenDocument={onOpenDocument}
        onDecision={onDecision}
      />,
    );

    // Sem motivo -> bloqueia abertura
    await fireEvent.press(screen.getByTestId(`admin-open-docs-${subId}`));
    expect(onOpenDocument).not.toHaveBeenCalled();

    // Com motivo -> gera URL de 60s auditada
    await fireEvent.changeText(
      screen.getByTestId('admin-document-open-reason'),
      'Conferência de foto do RG versus selfie',
    );
    await fireEvent.press(screen.getByTestId(`admin-open-docs-${subId}`));
    expect(onOpenDocument).toHaveBeenCalledWith({
      submissionId: subId,
      reason: 'Conferência de foto do RG versus selfie',
      ttlSeconds: 60,
    });

    // Aprovar
    await fireEvent.press(screen.getByTestId(`admin-approve-${subId}`));
    expect(onDecision).toHaveBeenCalledWith({
      submissionId: subId,
      decision: 'approved',
    });
  });
});

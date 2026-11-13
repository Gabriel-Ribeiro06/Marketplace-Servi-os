import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { CURRENT_BIOMETRIC_CONSENT_VERSION, providerVerificationSubmitSchema } from '@/schemas';
import { Button } from '@/ui/Button';
import { TextField } from '@/ui/TextField';
import { colors, radius, spacing, touch, typography } from '@/ui/tokens';

export interface ProviderOnboardingScreenProps {
  onSubmitted?: (payload: {
    displayName: string;
    bio: string;
    biometricConsentVersion: string;
  }) => void;
}

/**
 * Onboarding e Verificação de Identidade do Prestador (E2-01..05, USER_FLOWS.md 4.1, SECURITY.md 4).
 * Regras críticas:
 * - Exige consentimento biométrico específico e destacado para a selfie (LGPD art. 11, I).
 * - Valida CPF por dígito verificador antes do envio para geração de cpf_hmac na Edge Function.
 * - Exige frente do documento, verso do documento e selfie ao vivo no app.
 */
export default function ProviderOnboardingScreen({ onSubmitted }: ProviderOnboardingScreenProps) {
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [cpf, setCpf] = useState('');
  const [hasIdFront, setHasIdFront] = useState(false);
  const [hasIdBack, setHasIdBack] = useState(false);
  const [hasSelfie, setHasSelfie] = useState(false);
  const [biometricConsentAccepted, setBiometricConsentAccepted] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = () => {
    setErrorMessage(null);
    if (displayName.trim().length < 2) {
      setErrorMessage('Informe seu nome profissional (mín. 2 caracteres).');
      return;
    }

    const parsed = providerVerificationSubmitSchema.safeParse({
      cpf,
      biometricConsentAccepted,
      hasIdFront,
      hasIdBack,
      hasSelfie,
    });

    if (!parsed.success) {
      setErrorMessage(parsed.error.issues[0]?.message ?? 'Preencha todos os itens obrigatórios.');
      return;
    }

    setSubmitted(true);
    onSubmitted?.({
      displayName: displayName.trim(),
      bio: bio.trim(),
      biometricConsentVersion: CURRENT_BIOMETRIC_CONSENT_VERSION,
    });
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title} accessibilityRole="header">
        Cadastro e Verificação Profissional
      </Text>
      <Text style={styles.subtitle}>
        Você só recebe pedidos e aparece nas buscas após a aprovação manual da sua identidade (em
        até 48h).
      </Text>

      <TextField
        testID="provider-display-name"
        label="Nome profissional público"
        value={displayName}
        onChangeText={setDisplayName}
        maxLength={80}
      />

      <TextField
        testID="provider-bio"
        label="Apresentação (experiência e serviços)"
        value={bio}
        onChangeText={setBio}
        maxLength={500}
        multiline
      />

      <TextField
        testID="provider-cpf"
        label="CPF (apenas para verificação antifraude)"
        value={cpf}
        onChangeText={setCpf}
        keyboardType="number-pad"
        helperText="Seu CPF não fica visível e é armazenado apenas como código criptográfico."
      />

      <View style={styles.docsSection}>
        <Text style={styles.sectionTitle}>Documentos obrigatórios (RG, CNH ou CIN)</Text>

        <Button
          testID="upload-id-front"
          label={hasIdFront ? '✓ Frente do documento anexada' : 'Anexar frente do documento'}
          variant={hasIdFront ? 'secondary' : 'primary'}
          onPress={() => setHasIdFront(true)}
        />

        <Button
          testID="upload-id-back"
          label={hasIdBack ? '✓ Verso do documento anexado' : 'Anexar verso do documento'}
          variant={hasIdBack ? 'secondary' : 'primary'}
          onPress={() => setHasIdBack(true)}
        />

        <Button
          testID="capture-live-selfie"
          label={hasSelfie ? '✓ Selfie ao vivo capturada' : 'Tirar selfie ao vivo na câmera'}
          variant={hasSelfie ? 'secondary' : 'primary'}
          onPress={() => setHasSelfie(true)}
        />
      </View>

      <Pressable
        testID="provider-biometric-consent"
        accessibilityRole="checkbox"
        accessibilityState={{ checked: biometricConsentAccepted }}
        accessibilityLabel="Autorizo o uso da minha selfie exclusivamente para conferência manual de identidade"
        onPress={() => setBiometricConsentAccepted((prev) => !prev)}
        style={styles.consentBox}
      >
        <Text style={styles.checkboxSymbol}>{biometricConsentAccepted ? '☑' : '☐'}</Text>
        <Text style={styles.consentText}>
          Consentimento específico (LGPD art. 11, I): autorizo o tratamento da minha selfie e imagem
          do documento exclusivamente para conferência manual de identidade e prevenção a fraude. Os
          arquivos serão eliminados 30 dias após a decisão final.
        </Text>
      </Pressable>

      {errorMessage ? (
        <Text style={styles.errorBanner} accessibilityRole="alert">
          {errorMessage}
        </Text>
      ) : null}

      {submitted ? (
        <Text style={styles.successBanner} accessibilityRole="alert">
          Documentos enviados! Sua verificação está em análise (prazo de até 48h).
        </Text>
      ) : null}

      <Button
        testID="provider-submit-verification"
        label="Enviar para análise"
        onPress={handleSubmit}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    backgroundColor: colors.background,
    padding: spacing.xl,
  },
  title: {
    ...typography.title,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  subtitle: {
    ...typography.body,
    color: colors.textMuted,
    marginBottom: spacing.xl,
  },
  docsSection: {
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  sectionTitle: {
    ...typography.subtitle,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  consentBox: {
    minHeight: touch.minSize,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.card,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  checkboxSymbol: {
    ...typography.subtitle,
    color: colors.primary,
  },
  consentText: {
    ...typography.caption,
    color: colors.text,
    flex: 1,
  },
  errorBanner: {
    ...typography.body,
    color: colors.danger,
    backgroundColor: colors.surface,
    borderColor: colors.danger,
    borderWidth: 1,
    borderRadius: radius.field,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  successBanner: {
    ...typography.body,
    color: colors.success,
    backgroundColor: colors.surface,
    borderColor: colors.success,
    borderWidth: 1,
    borderRadius: radius.field,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
});

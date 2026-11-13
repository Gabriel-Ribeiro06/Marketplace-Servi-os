import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';

import { Button } from './Button';
import { STATUS_DESCRIPTORS, StatusChip, type StatusKind } from './StatusChip';
import { TextField } from './TextField';
import {
  VERIFICATION_BADGE_EXPLANATION,
  VERIFICATION_BADGE_TITLE,
  VerificationBadge,
} from './VerificationBadge';

describe('Button', () => {
  it('aciona onPress quando habilitado', async () => {
    const onPress = jest.fn();
    await render(<Button label="Pedir orçamento" onPress={onPress} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Pedir orçamento' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('inclui o motivo quando desabilitado', async () => {
    const onPress = jest.fn();
    await render(
      <Button
        label="Enviar proposta"
        disabled
        disabledReason="Aguardando aprovação de identidade"
        onPress={onPress}
      />,
    );
    const btn = screen.getByRole('button', {
      name: 'Enviar proposta. Indisponível: Aguardando aprovação de identidade',
    });
    expect(btn).toBeTruthy();
    await fireEvent.press(btn);
    expect(onPress).not.toHaveBeenCalled();
  });
});

describe('TextField', () => {
  it('exibe rótulo visível, contador e mensagem de erro acessível', async () => {
    const onChangeText = jest.fn();
    await render(
      <TextField
        label="Descrição do problema"
        value="Torneira pingando"
        onChangeText={onChangeText}
        maxLength={1000}
        errorMessage="Descreva com mais detalhes"
      />,
    );
    expect(screen.getByText('Descrição do problema')).toBeTruthy();
    expect(screen.getByText('17/1000')).toBeTruthy();
    expect(screen.getByRole('alert')).toHaveTextContent('Descreva com mais detalhes');
  });
});

describe('StatusChip', () => {
  const allStatuses = Object.keys(STATUS_DESCRIPTORS) as StatusKind[];

  it.each(allStatuses)('renderiza símbolo e texto para %s', async (status: StatusKind) => {
    await render(<StatusChip status={status} />);
    const { symbol, label } = STATUS_DESCRIPTORS[status];
    expect(screen.getByText(`${symbol} ${label}`)).toBeTruthy();
  });
});

describe('VerificationBadge (conformidade com SECURITY.md 4.1 e DESIGN_SYSTEM.md 4)', () => {
  const forbiddenPatterns: RegExp[] = [
    /qualificad/i,
    /certificad/i,
    /\bgarantid/i,
    /profissional de confiança/i,
  ];

  it('usa apenas o título aprovado "Identidade verificada"', () => {
    expect(VERIFICATION_BADGE_TITLE).toBe('Identidade verificada');
  });

  it.each(forbiddenPatterns)(
    'não usa termo proibido %s em afirmação positiva',
    (pattern: RegExp) => {
      expect(VERIFICATION_BADGE_TITLE).not.toMatch(pattern);
      // Na explicação só pode aparecer precedido de "não garante"
      const sanitized = VERIFICATION_BADGE_EXPLANATION.replace(/não garante[^.]*\./gi, '');
      expect(sanitized).not.toMatch(pattern);
    },
  );

  it('abre explicação ao tocar no selo', async () => {
    await render(<VerificationBadge />);
    await fireEvent.press(screen.getByTestId('verification-badge'));
    expect(screen.getByText(VERIFICATION_BADGE_EXPLANATION)).toBeTruthy();
  });
});

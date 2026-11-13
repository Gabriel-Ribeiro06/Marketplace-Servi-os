import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';

import AdminModerationScreen from '../../app/(admin)/moderation';
import AccountSettingsScreen from '../../app/(customer)/account-settings';

describe('Telas da Fase 5 — Moderação Admin, Gate de Categorias e Conta/LGPD', () => {
  describe('AdminModerationScreen (SEC-25, E8-04..07)', () => {
    it('T-ADM-04: bloqueia leitura de conversa pelo admin quando a justificativa de auditoria está vazia', async () => {
      const onReadConversation = jest.fn();
      await render(<AdminModerationScreen onReadConversation={onReadConversation} />);

      await fireEvent.press(screen.getByTestId('read-conv-rep-safety-1'));

      expect(onReadConversation).not.toHaveBeenCalled();
      expect(screen.getByRole('alert')).toHaveTextContent(
        /conversationId, reportId vinculado e justificativa/i,
      );
    });

    it('T-ADM-03: libera leitura de conversa vinculada a report_id quando justificativa é preenchida', async () => {
      const onReadConversation = jest.fn();
      await render(<AdminModerationScreen onReadConversation={onReadConversation} />);

      await fireEvent.changeText(
        screen.getByLabelText(
          'Justificativa de auditoria (obrigatória para ações e leitura de chat)',
        ),
        'Apuração da denúncia de ameaça rep-safety-1',
      );
      await fireEvent.press(screen.getByTestId('read-conv-rep-safety-1'));

      expect(onReadConversation).toHaveBeenCalledWith({
        conversationId: 'conv-1',
        reportId: 'rep-safety-1',
        reason: 'Apuração da denúncia de ameaça rep-safety-1',
      });
      expect(screen.getByTestId('audited-conversation-reader')).toHaveTextContent(/conv-1/i);
    });

    it('E8-06/07: impede ativar categoria Técnico em computadores quando há menos de 2 prestadores aprovados', async () => {
      const onToggleCategoryGate = jest.fn();
      await render(<AdminModerationScreen onToggleCategoryGate={onToggleCategoryGate} />);

      await fireEvent.changeText(
        screen.getByLabelText(
          'Justificativa de auditoria (obrigatória para ações e leitura de chat)',
        ),
        'Tentativa de abertura antecipada',
      );
      await fireEvent.press(screen.getByTestId('toggle-category-cat-tecnico-pc'));

      expect(onToggleCategoryGate).not.toHaveBeenCalled();
      expect(screen.getByRole('alert')).toHaveTextContent(/pelo menos 2 prestadores aprovados/i);
    });
  });

  describe('AccountSettingsScreen (E7-01, E7-02, E1-06 / RF-04 / RF-49)', () => {
    it('registra denúncia com prioridade de segurança (SLA 24h) e exibe canal DPO', async () => {
      const onCreateReport = jest.fn();
      await render(<AccountSettingsScreen onCreateReport={onCreateReport} />);

      expect(screen.getByText(/privacidade@eufaco\.com\.br/i)).toBeTruthy();

      await fireEvent.changeText(
        screen.getByLabelText('Detalhes da ocorrência (opcional)'),
        'Comportamento agressivo no local.',
      );
      await fireEvent.press(screen.getByTestId('submit-report-btn'));

      expect(onCreateReport).toHaveBeenCalledWith({
        reason: 'threat_or_violence',
        details: 'Comportamento agressivo no local.',
        priority: 'safety',
        slaHours: 24,
      });
      expect(screen.getByTestId('account-feedback-banner')).toHaveTextContent(/SLA até 24h/i);
    });

    it('T-DEL-01: bloqueia exclusão de conta se houver serviço agendado ou em disputa', async () => {
      const onDeleteAccount = jest.fn();
      await render(
        <AccountSettingsScreen
          activeJobStatuses={['scheduled']}
          onDeleteAccount={onDeleteAccount}
        />,
      );

      await fireEvent.changeText(
        screen.getByLabelText('Confirmação de exclusão (digite EXCLUIR)'),
        'EXCLUIR',
      );
      await fireEvent.press(screen.getByTestId('delete-account-btn'));

      expect(onDeleteAccount).not.toHaveBeenCalled();
      expect(screen.getByRole('alert')).toHaveTextContent(
        /Conclua ou cancele seus serviços agendados\/em disputa/i,
      );
    });

    it('T-DEL-03: executa exclusão de conta após digitar EXCLUIR quando elegível', async () => {
      const onDeleteAccount = jest.fn();
      await render(
        <AccountSettingsScreen
          activeJobStatuses={['completed']}
          onDeleteAccount={onDeleteAccount}
        />,
      );

      await fireEvent.changeText(
        screen.getByLabelText('Confirmação de exclusão (digite EXCLUIR)'),
        'excluir',
      );
      await fireEvent.press(screen.getByTestId('delete-account-btn'));

      expect(onDeleteAccount).toHaveBeenCalledWith('EXCLUIR');
      expect(screen.getByTestId('account-feedback-banner')).toHaveTextContent(/anonimizados/i);
    });
  });
});

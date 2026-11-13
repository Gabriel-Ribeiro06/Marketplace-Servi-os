import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';

import JobDetailsScreen from '@/app/(customer)/job/[id]';

describe('Fase 4 — Tela de Serviço Agendado, Conclusão Parcial, No-Show, Disputa e Avaliação (E6-01..08)', () => {
  it('exige nota explicativa na conclusão parcial, permite concluir e depois enviar avaliação bilateral', async () => {
    const onCompleteJob = jest.fn();
    const onSubmitReview = jest.fn();

    await render(
      <JobDetailsScreen
        jobId="job-100"
        viewerRole="provider"
        onCompleteJob={onCompleteJob}
        onSubmitReview={onSubmitReview}
      />,
    );

    // Seleciona conclusão parcial e tenta concluir sem nota -> bloqueado
    await fireEvent.press(screen.getByTestId('completion-type-partial'));
    await fireEvent.press(screen.getByTestId('job-complete-button'));
    expect(onCompleteJob).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/nota explicativa/);

    // Preenche a nota obrigatória e conclui
    await fireEvent.changeText(
      screen.getByTestId('job-partial-note-input'),
      'Troca do SSD realizada; cliente pediu para deixar a instalação da impressora para outro dia.',
    );
    await fireEvent.press(screen.getByTestId('job-complete-button'));
    expect(onCompleteJob).toHaveBeenCalledWith({
      jobId: 'job-100',
      completionType: 'partial',
      completionNote:
        'Troca do SSD realizada; cliente pediu para deixar a instalação da impressora para outro dia.',
    });

    // Agora envia avaliação bilateral (5 estrelas)
    await fireEvent.press(screen.getByTestId('review-star-5'));
    await fireEvent.changeText(
      screen.getByTestId('review-comment-input'),
      'Cliente muito atenciosa.',
    );
    await fireEvent.press(screen.getByTestId('review-submit-button'));

    expect(onSubmitReview).toHaveBeenCalledWith({
      jobId: 'job-100',
      rating: 5,
      comment: 'Cliente muito atenciosa.',
    });
    expect(screen.getByTestId('review-submitted-banner')).toBeTruthy();
  });

  it('permite reportar não comparecimento, retirar acusação ou contestar gerando disputa', async () => {
    const onReportNoShow = jest.fn();
    const onContestNoShow = jest.fn();

    await render(
      <JobDetailsScreen
        jobId="job-200"
        viewerRole="client"
        onReportNoShow={onReportNoShow}
        onContestNoShow={onContestNoShow}
      />,
    );

    await fireEvent.press(screen.getByTestId('job-report-no-show-button'));
    expect(onReportNoShow).toHaveBeenCalledWith('job-200');

    // Contestar acusação encaminha para disputa e suspende avaliações
    await fireEvent.changeText(
      screen.getByTestId('job-contest-no-show-input'),
      'Compareci no horário agendado e toquei o interfone.',
    );
    await fireEvent.press(screen.getByTestId('job-contest-no-show-button'));

    expect(onContestNoShow).toHaveBeenCalledWith({
      jobId: 'job-200',
      contestNote: 'Compareci no horário agendado e toquei o interfone.',
    });
    expect(screen.getByTestId('job-disputed-banner')).toBeTruthy();
    expect(screen.queryByTestId('review-submit-button')).toBeNull();
  });
});

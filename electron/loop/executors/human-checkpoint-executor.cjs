'use strict';

// Executor de etapa 'human_checkpoint': NÃO espera a interface numa Promise
// aberta. Ele só devolve "waiting_for_approval" com os dados do checkpoint; o
// LoopRunner persiste, emite 'approval-required' e PARA de dirigir. A decisão
// chega depois por approveCheckpoint()/rejectCheckpoint(), que retomam o drive
// do ponto persistido — sobrevive a reinício do app.

function createHumanCheckpointExecutor() {
  return {
    type: 'human_checkpoint',

    async execute(input, signal) {
      if (signal.aborted) {
        return {
          stepStatus: 'cancelled',
          condition: 'cancelled',
          summary: 'Checkpoint cancelado.',
        };
      }
      const cfg = input.stepDef.config;
      return {
        stepStatus: 'waiting_for_approval',
        condition: null, // decidida depois, por approve/reject
        summary: `Aguardando aprovação: ${cfg.title}`,
        checkpoint: {
          title: cfg.title,
          description: cfg.description,
          allowReject: cfg.allowReject !== false,
        },
      };
    },
  };
}

module.exports = { createHumanCheckpointExecutor };

import {
    Engine,
    ErrorCode,
    LeaseLostError,
    RunStatus,
} from '@chamvi/core';
import type { Agent, IEngine, IStore } from '@chamvi/core';

declare const logger: { error(fields: object, message: string): void };

export function createEngine(store: IStore, agents: Agent[]) {
    // #region on-error
    const engine = new Engine({
        store,
        agents,
        onError: (error, run) => {
            if (error instanceof LeaseLostError) {
                // another replica carries the run on; nothing to do
                return;
            }

            logger.error({ err: error, runId: run?.id }, 'chamvi');
        },
    });
    // #endregion on-error

    return engine;
}

export async function explainFailure(engine: IEngine, runId: string) {
    // #region run-error
    const run = await engine.getRun(runId);

    if (run?.status === RunStatus.FAILED) {
        switch (run.error?.code) {
            case ErrorCode.BUDGET_EXCEEDED:
                return 'Raise maxSteps or maxTokens, or narrow the instructions.';
            case ErrorCode.TIMEOUT:
                return 'Raise timeoutMs or make the tools faster.';
            case ErrorCode.FATAL_TOOL:
                return `A tool stopped the run: ${run.error.message}`;
            default:
                return run.error?.message;
        }
    }

    // #endregion run-error
    return undefined;
}

/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { StepResult, StopCondition, ToolSet } from 'ai';
import { DEFAULT_MAX_STEPS } from '../agent/constants.ts';
import type { Agent } from '../agent/types.ts';
import type { IClock } from '../clock/index.ts';
import { TimeoutError } from '../errors/index.ts';
import type { Budget, Usage } from '../run/types.ts';

export function resolveBudget(agent: Agent): Budget {
    const { budget } = agent.definition;

    return {
        maxSteps: budget.maxSteps ?? DEFAULT_MAX_STEPS,
        maxTokens: budget.maxTokens,
        timeoutMs: budget.timeoutMs,
    };
}

export function stepTokens(step: Pick<StepResult<ToolSet>, 'usage'>): Usage {
    return {
        inputTokens: step.usage.inputTokens ?? 0,
        outputTokens: step.usage.outputTokens ?? 0,
    };
}

/** True once `spent` plus the tokens of this call's steps reach `maxTokens`. */
export function tokensExceeded(maxTokens: number, spent = 0): StopCondition<ToolSet> {
    return ({ steps }) => steps.reduce((sum, step) => {
        const { inputTokens, outputTokens } = stepTokens(step);

        return sum + inputTokens + outputTokens;
    }, spent) >= maxTokens;
}

/** Aborts after `ms` on the given clock (so tests can drive it); call `clear` when done. */
export function timeoutSignal(clock: IClock, ms: number): { signal: AbortSignal; clear(): void } {
    const controller = new AbortController();
    const timer = clock.setTimeout(() => controller.abort(new TimeoutError(ms)), ms);

    return { signal: controller.signal, clear: () => timer.clear() };
}

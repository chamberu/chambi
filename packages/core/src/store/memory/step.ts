/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { Step } from '../../run/types.ts';
import type { IStepStore } from '../types.ts';
import { copy } from './helpers.ts';

export class MemoryStepStore implements IStepStore {
    protected steps = new Map<string, Step[]>();

    async appendStep(step: Step): Promise<void> {
        const list = this.steps.get(step.runId) ?? [];
        list.push(copy(step));
        this.steps.set(step.runId, list);
    }

    async listSteps(runId: string): Promise<Step[]> {
        return copy([...(this.steps.get(runId) ?? [])].sort((a, b) => a.index - b.index));
    }
}

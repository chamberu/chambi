/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { RepositoryNotFoundError, RunNotFoundError } from '../../errors/index.ts';
import type { Step } from '../../run/types.ts';
import type { IStepRepository } from '../types.ts';
import { copy } from './helpers.ts';
import type { MemoryRunReferenceOptions } from './types.ts';

export class MemoryStepRepository implements IStepRepository {
    protected steps = new Map<string, Step[]>();

    protected hasRun?: (runId: string) => boolean;

    constructor(opts: MemoryRunReferenceOptions = {}) {
        this.hasRun = opts.hasRun;
    }

    async insert(step: Step): Promise<void> {
        if (this.hasRun && !this.hasRun(step.runId)) {
            throw new RunNotFoundError(step.runId);
        }

        const list = this.steps.get(step.runId) ?? [];

        list.push(copy(step));
        this.steps.set(step.runId, list);
    }

    async findOrFail(runId: string): Promise<Step[]> {
        const result = await this.find(runId);

        if (result.length === 0) {
            throw new RepositoryNotFoundError('steps');
        }

        return result;
    }

    async find(runId: string): Promise<Step[]> {
        return copy([...(this.steps.get(runId) ?? [])].sort((a, b) => a.index - b.index));
    }
}

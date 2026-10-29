/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { assertConcurrencyMaxRuns } from '../channel/concurrency.ts';
import { InvalidAgentDefinitionError } from '../errors/index.ts';
import { snapshotSkillInputs } from '../skill/helpers.ts';
import type { StateSchema } from '../state/types.ts';
import {
    DEFAULT_MAX_STEPS,
    DEFAULT_TIMEOUT_MS,
    NAME_MAX_LENGTH,
    NAME_PATTERN,
} from './constants.ts';
import { assertNoNeedsApproval, assertToolsContext } from './asserts.ts';
import type { Agent, AgentDefinition } from './types.ts';

export function defineAgent<S extends StateSchema = StateSchema>(def: AgentDefinition<S>): Agent<S> {
    if (
        typeof def.name !== 'string' ||
        def.name.length > NAME_MAX_LENGTH ||
        !NAME_PATTERN.test(def.name)
    ) {
        throw new InvalidAgentDefinitionError(
            `Invalid agent name "${String(def.name)}": must match ${NAME_PATTERN} and be at most ${NAME_MAX_LENGTH} characters.`,
        );
    }

    assertConcurrencyMaxRuns(def.concurrencyMaxRuns, `Agent "${def.name}" concurrencyMaxRuns`);
    const seen = new Set<string>();
    for (const subscription of def.channels ?? []) {
        assertConcurrencyMaxRuns(subscription.concurrencyMaxRuns, `Agent "${def.name}" subscription "${subscription.id}" concurrencyMaxRuns`);
        if (seen.has(subscription.id)) {
            throw new InvalidAgentDefinitionError(
                `Agent "${def.name}" has duplicate subscription id "${subscription.id}".`,
            );
        }
        seen.add(subscription.id);
    }

    const skills = snapshotSkillInputs(def.skills, typeof def.tools === 'function' ? {} : def.tools ?? {});

    // a factory's set is only known per execution, the engine checks it there
    if (typeof def.tools !== 'function') {
        assertNoNeedsApproval(def.name, def.tools ?? {});
        if (def.toolsContext) assertToolsContext(def.name, def.tools ?? {}, def.toolsContext);
    }

    return {
        name: def.name,
        definition: {
            ...def,
            ...(def.skills !== undefined && { skills }),
            budget: {
                maxSteps: DEFAULT_MAX_STEPS,
                timeoutMs: DEFAULT_TIMEOUT_MS,
                ...def.budget,
            },
        },
    };
}

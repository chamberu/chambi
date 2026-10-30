/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type {
    Agent,
    ISkillRuntimeProvider,
    SkillContribution,
    SkillInput,
} from '@chamvi/core';

export function fakeSkillRuntime(options: {
    protocol?: string;
    prepare?: (signal: AbortSignal) => Promise<void>;
    check?: (agent: Agent, inputs: readonly SkillInput[]) => void;
    commit?: () => void;
    contribution?: SkillContribution;
} = {}) {
    const calls = {
        snapshots: 0,
        creates: 0,
        checks: 0,
        prepares: 0,
        commits: 0,
    };
    const contribution = options.contribution ?? Object.freeze({
        instructions: 'prepared contribution',
        tools: {},
        checkTools: () => {},
    });
    const runtime: ISkillRuntimeProvider = {
        protocol: options.protocol ?? 'test/runtime-v1',
        snapshot(inputs: readonly SkillInput[]) {
            calls.snapshots++;

            return Object.freeze(inputs.map((input) => Object.freeze({ ...input })));
        },
        create() {
            calls.creates++;

            return {
                checkAgent(agent, inputs) {
                    calls.checks++; options.check?.(agent, inputs);
                },
                async prepare(agents, { signal }) {
                    calls.prepares++;
                    await options.prepare?.(signal);

                    return {
                        commit() {
                            calls.commits++;
                            options.commit?.();

                            return Object.freeze(agents.map((agent) => Object.freeze({ agent, contribution })));
                        },
                    };
                },
            };
        },
    };

    return {
        input: Object.freeze({ runtime }),
        runtime,
        calls,
    };
}

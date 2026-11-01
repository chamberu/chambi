/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

// a skill input whose preparation always fails (pinned)
const skill = {
    async prepare() {
        throw Object.assign(new Error('pin mismatch'), { code: 'invalid_agent_definition' });
    },
    runtime: {
        protocol: 'test/runtime-v1',
        snapshot(inputs: unknown) {
            return inputs;
        },
        create() {
            return {
                checkAgent() {},
                async prepare(agents: { definition: { skills?: { prepare(): Promise<void> }[] } }[]) {
                    for (const agent of agents) {
                        for (const input of agent.definition.skills ?? []) {
                            await input.prepare();
                        }
                    }

                    return { commit: () => [] };
                },
            };
        },
    },
};

export default {
    name: 'pinned',
    definition: {
        instructions: 'pinned',
        skills: [skill],
    },
};

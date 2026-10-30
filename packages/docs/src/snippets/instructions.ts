/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

// #region instructions
import { defineAgent } from '@chamvi/core';
import type {
    AgentInstructions,
    AssistantModelMessage,
    SystemModelMessage,
    UserModelMessage,
} from '@chamvi/core';

const policy: SystemModelMessage = {
    role: 'system',
    content: 'Summarize reports in one sentence.',
    providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } },
};
const example: UserModelMessage = {
    role: 'user',
    content: [{ type: 'text', text: 'Report: the release passed all checks.' }],
};
const answer: AssistantModelMessage = {
    role: 'assistant',
    content: 'The release is ready.',
};
const instructions: AgentInstructions = [policy, example, answer];

export const reporter = defineAgent({ name: 'reporter', instructions });
// #endregion instructions

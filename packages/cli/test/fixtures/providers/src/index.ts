/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { createApp, defineAgent, http } from '@chamvi/app';

// on a declared provider (its key from the env)
const triage = defineAgent({
    name: 'triage',
    model: 'team-a/m',
    instructions: 'Triage the issue.',
    channels: [http.on()],
});

// on a provider nothing declares
const other = defineAgent({
    name: 'other',
    model: 'nope/m',
    instructions: 'Do something else.',
    channels: [http.on()],
});

export default createApp({
    agents: [triage, other],
    providers: {
        'team-a': {
            type: 'anthropic',
            apiKey: { env: 'CHAMVI_PROVIDER_TEAM_A_API_KEY' },
            headers: { 'x-team': 'a' },
        },
    },
});

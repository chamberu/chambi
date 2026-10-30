import type { Agent } from '@chamvi/app';
import { createApp } from '@chamvi/app';
import { customProvider } from 'ai';
import type { MockLanguageModelV4 } from 'ai/test';

export async function smokeTest(agents: Agent[], model: MockLanguageModelV4) {
    // #region testing
    const app = createApp({
        agents,
        // 'anthropic/claude-sonnet-5-5' resolves to the mock: no package, no key, no request
        models: { anthropic: customProvider({ languageModels: { 'claude-sonnet-5-5': model } }) },
    });

    // the env replaces process.env for the built-in modules
    await app.start({
        env: {
            PORT: '3101',
            HOST: '127.0.0.1',
            CHAMVI_TOKENS: JSON.stringify([{
                value: 'test-token-0123456789',
                id: 'test',
                permissions: ['*'],
            }]),
            CHAMVI_LOG_LEVEL: 'error',
        },
    });

    try {
        const response = await fetch('http://127.0.0.1:3101/agents', { headers: { authorization: 'Bearer test-token-0123456789' } });

        return await response.json();
    } finally {
        // drains the engine, closes the server and the store
        await app.stop();
    }
    // #endregion testing
}

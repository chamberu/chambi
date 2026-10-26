import type { LanguageModel } from 'ai';
import { codingTools } from '@chamvi/coding';
import { ToolDeniedError, approve, defineAgent } from '@chamvi/core';
import type { IWorkspaceManager } from '@chamvi/sandbox';

export function createCodingAgent(model: LanguageModel, workspaces: IWorkspaceManager) {
    return defineAgent({
        name: 'triage',
        model,
        instructions: 'Check out the repository named in the payload, reproduce the reported bug ' +
            'with a failing test and answer with what you found and the diff.',
        // create_workspace and dispose_workspace, then the coding tools
        tools: { ...workspaces.tools(), ...codingTools(workspaces) },
        hooks: {
            // every shell command waits for a human
            async beforeToolExecution({ toolName, input }, ctx) {
                if (toolName !== 'bash') return input;
                const { command } = input as { command: string };
                const decision = await approve(ctx, { title: 'Run a shell command?', body: command });
                if (!decision.approved) throw new ToolDeniedError(`Command refused: ${decision.reason ?? 'denied'}`);
                return input;
            },
        },
        budget: { maxSteps: 40 },
    });
}

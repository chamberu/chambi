// src/index.ts
import { createApp, defineAgent } from '@chamvi/app';
import {
    defineKnowledgeSource,
    folder,
    knowledgeCollection,
    knowledgeTools,
} from '@chamvi/knowledge';
import { knowledgeModule } from '@chamvi/knowledge/module';

// your own source: anything that yields documents with stable ids
const releases = defineKnowledgeSource({
    kind: 'releases',
    // fed from outside the deploy: a search over it taints the run
    trusted: false,
    async* documents({ signal }) {
        const response = await fetch('https://releases.example.com/notes.json', { signal });
        const notes = await response.json() as Array<{ version: string; body: string }>;

        for (const note of notes) {
            yield {
                id: note.version,
                title: `Release ${note.version}`,
                content: note.body,
            };
        }
    },
});

const support = defineAgent({
    name: 'support',
    instructions: 'Answer customer questions. Search the handbook and the release notes first.',
    // knowledge_search over these two collections, and no other
    tools: knowledgeTools({ collections: ['handbook', 'releases'] }),
});

export default createApp({
    agents: [support],
    modules: [knowledgeModule({
        collections: [
            // resolved through the app's providers and keys, like chat models
            knowledgeCollection('handbook', {
                model: 'openai/text-embedding-3-small',
                sources: [folder('./handbook')],
            }),
            knowledgeCollection('releases', {
                model: 'openai/text-embedding-3-small',
                sources: [releases],
            }),
        ],
    })],
});

# @chamvi/knowledge

Knowledge collections an agent searches by meaning through `knowledge_search`: declared in code, fed by sources, embedded in the background through the AI SDK. The public API of `packages/knowledge/src/index.ts` and its `/module` entry. See [Knowledge](/guide/knowledge) for the guide.

```bash
npm install @chamvi/knowledge @chamvi/core ai --save
```

`@chamvi/core` and `ai` are peer dependencies; `@chamvi/app` is an optional peer of `@chamvi/knowledge/module`.

## knowledgeModule

```ts
// @chamvi/knowledge/module
function knowledgeModule(options?: KnowledgeModuleOptions): KnowledgeModule; // 'chamvi:knowledge', .knowledge: IKnowledge once set up

type KnowledgeModuleOptions = {
    collections?: readonly KnowledgeCollectionDefinition[];
    repository?: IKnowledgeRepository; // default in memory, warned outside dev
    owner?: string;                     // the indexer's lock owner, default `${hostname}-${pid}`
};
```

The options are checked when the factory is called. `setup` (start, job and a check) builds `createKnowledge()` over the store's locks, the app's model resolver (`AppToken.MODELS`) and clock, its errors logged as `knowledge error`; `onReady` runs `knowledge.check()`, so a folder that is no directory or a declared name the store holds as managed fails the boot and `start --check`. Only a start indexes (`started`, stopped first in the shutdown); the engine gets the knowledge provided, for `injectKnowledgeContext(ctx)`.

## Collections and sources

```ts
function knowledgeCollection(name: string, options: KnowledgeCollectionOptions): KnowledgeCollectionDefinition;
function folder(path: string, options?: FolderSourceOptions): IKnowledgeSource;
function defineKnowledgeSource(input: KnowledgeSourceInput): IKnowledgeSource;

type KnowledgeCollectionOptions = {
    model: string | EmbeddingModel;   // '<provider>/<model id>' through the app's providers, or an object as is
    sources: readonly IKnowledgeSource[];
    trusted?: boolean;                // default: every source is trusted
};

type FolderSourceOptions = { extensions?: readonly string[]; trusted?: boolean };

type KnowledgeSourceInput = {
    kind?: string;                    // default 'custom'
    trusted?: boolean;                // default true
    check?: () => Promise<void>;      // configuration check at the boot and in start --check
    documents(ctx: { signal: AbortSignal; onError(error: unknown): void }): AsyncIterable<KnowledgeDocumentInput>;
};

type KnowledgeDocumentInput = { id: string; content: string; title?: string; source?: string; metadata?: Record<string, unknown> };

const FOLDER_EXTENSIONS: ['.md', '.markdown', '.mdx', '.txt'];
const FOLDER_FILE_MAX_BYTES: 1_048_576;
const KNOWLEDGE_DOCUMENT_ID_MAX_LENGTH: 255;
```

Every factory throws `InvalidAgentDefinitionError` for bad options. `folder()` never follows a symbolic link (a file or a directory) and reports it, a subdirectory it cannot list, an oversized or non-UTF-8 file through `onError` and skips it.

## createKnowledge

```ts
function createKnowledge(options: KnowledgeOptions): IKnowledge;

type KnowledgeOptions = {
    repository: IKnowledgeRepository;
    locks: ILockRepository;           // the store's: one indexer per collection across replicas
    collections?: readonly KnowledgeCollectionDefinition[];
    models?: IModelResolver;          // resolves string models (embedding())
    clock?: IClock;
    owner?: string;
    onError?: (error: unknown, context: { collection?: string }) => void; // a throwing one is contained
};

interface IKnowledge {
    readonly repository: IKnowledgeRepository;
    collection(name: string): ResolvedKnowledgeCollection | undefined;
    embedding(model: string): EmbeddingModel;
    start(): void;                    // indexes every declared collection in the background
    stop(): Promise<void>;
    check(): Promise<void>;           // read-only: the sources' checks, managed name conflicts
}

function provideKnowledgeContext(provider: IContextProvider, knowledge: IKnowledge): void;
function injectKnowledgeContext(ctx: ToolContext): IKnowledge;

const KNOWLEDGE_LOCK_TTL_MS: 300_000;
const KNOWLEDGE_RETRY_MS: 5_000;        // the first wait after a failure, doubling per failure in a row
const KNOWLEDGE_RETRY_MAX_MS: 300_000;
const KNOWLEDGE_EMBED_TIMEOUT_MS: 60_000; // an indexing embedMany call is given up after it
const KNOWLEDGE_REQUEST_ERROR_CODE: 'knowledge_request';
```

The failure count and the time of the next attempt are stored on the collection, so the backoff holds across replicas. An `InvalidAgentDefinitionError` from a source is stored and reported once, never retried.

## knowledgeTools

```ts
function knowledgeTools(options: KnowledgeToolsOptions): ToolSet; // { knowledge_search }

type KnowledgeToolsOptions = { collections: readonly string[]; topK?: number; minScore?: number };
type KnowledgeSearchInput = { query: string; collection?: string; topK?: number };
type KnowledgeSearchResult = { matches: KnowledgeMatch[]; truncated: boolean };

const KNOWLEDGE_SEARCH_DEFAULT_RESULTS: 5;
const KNOWLEDGE_SEARCH_MAX_RESULTS: 20;
const KNOWLEDGE_SEARCH_MAX_CHARS: 20_000;
const KNOWLEDGE_QUERY_MAX_LENGTH: 1000;
```

A search over an untrusted collection, or one without a record that this app does not declare trusted, taints the run (`tool:knowledge_search`).

## Repository

```ts
interface IKnowledgeRepository {
    saveCollection(collection: KnowledgeCollection): Promise<void>;
    findOneCollection(name: string): Promise<KnowledgeCollection | undefined>;
    findOneCollectionOrFail(name: string): Promise<KnowledgeCollection>;
    findCollections(): Promise<KnowledgeCollection[]>;
    deleteCollection(name: string): Promise<boolean>;
    saveDocument(document: KnowledgeDocument): Promise<void>;
    findOneDocument(collection: string, id: string): Promise<KnowledgeDocument | undefined>;
    findOneDocumentOrFail(collection: string, id: string): Promise<KnowledgeDocument>;
    findDocumentIds(collection: string): Promise<string[]>;
    deleteDocument(collection: string, id: string): Promise<boolean>;
    replaceChunks(collection: string, document: string, generation: number, chunks: KnowledgeChunkInput[]): Promise<void>;
    deleteGeneration(collection: string, generation: number): Promise<void>;
    deleteGenerationsExcept(collection: string, generation: number): Promise<void>;
    search(collection: string, generation: number, vector: number[], options: { topK: number; minScore?: number }): Promise<KnowledgeMatch[]>;
}

function createMemoryKnowledgeRepository(): MemoryKnowledgeRepository;
```

A `KnowledgeCollection` record holds the served `generation`, its `model`, `dimensions` and `chunker`, an optional `pending` re-embed, `lastGeneration` (never reused), `status` (`pending`, `ready`, `stale`, `orphaned`), `trusted`, and after a failure `error`, `failures` and `retryAt` (a `Date`). Every repository runs `describeKnowledgeRepositoryContract()` from [`@chamvi/test-kit`](/reference/test-kit).

## Chunking

```ts
function chunkText(text: string): KnowledgeChunk[];
function contentHash(text: string): string;

const CHUNKER_VERSION: 'text-v1';
const CHUNK_MAX_CHARS: 2000;
const CHUNK_OVERLAP_CHARS: 200;
```

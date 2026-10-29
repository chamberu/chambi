/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { Artifact } from '../../artifact/types.ts';
import type { IArtifactStore } from '../types.ts';
import { copy } from './helpers.ts';

export class MemoryArtifactStore implements IArtifactStore {
    protected artifacts = new Map<string, { artifact: Artifact; data: Uint8Array }>();

    async putArtifact(artifact: Artifact, data: Uint8Array): Promise<boolean> {
        if (this.artifacts.has(artifact.id)) return false;
        this.artifacts.set(artifact.id, { artifact: copy(artifact), data: new Uint8Array(data) });
        return true;
    }

    async getArtifact(id: string): Promise<Artifact | undefined> {
        const entry = this.artifacts.get(id);
        return entry ? copy(entry.artifact) : undefined;
    }

    async readArtifact(id: string): Promise<Uint8Array | undefined> {
        const entry = this.artifacts.get(id);
        return entry ? new Uint8Array(entry.data) : undefined;
    }

    async listArtifacts(runId: string): Promise<Artifact[]> {
        return this.artifacts.values().toArray()
            .map((entry) => entry.artifact)
            .filter((artifact) => artifact.runId === runId)
            .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id, 'en'))
            .map((artifact) => copy(artifact));
    }
}

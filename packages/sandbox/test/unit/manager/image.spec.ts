/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import {
    InvalidAgentDefinitionError,
    SandboxError,
    ValidationError,
} from '@chamvi/core';
import { createWorkspaceManager } from '@chamvi/sandbox';
import type { WorkspaceManagerOptions, WorkspaceToolResult } from '@chamvi/sandbox';
import { ControllableClock } from '../../utils/clock.ts';
import { callTool, toolContext } from '../../utils/context.ts';
import { createFakeProvider } from '../../utils/provider.ts';

function setup(options: Partial<WorkspaceManagerOptions> = {}) {
    const clock = new ControllableClock(new Date(1_000_000));
    const provider = createFakeProvider({ clock });
    const manager = createWorkspaceManager({
        provider,
        clock,
        gcIntervalMs: 0,
        ...options,
    });
    return {
        clock, 
        provider, 
        manager, 
    };
}

describe('workspace manager: images', () => {
    it('passes the requested image to the provider, over the manager\'s', async () => {
        const { provider, manager } = setup({ image: 'operator:1' });
        const { workspace } = await manager.acquire('r1', { image: 'python:3.13' });
        expect(provider.created[0]!.image).toBe('python:3.13');
        expect(workspace.info.image).toBe('python:3.13');
    });

    it('marks a requested image for the provider\'s pull rule, never the manager\'s own', async () => {
        const { provider, manager } = setup({ image: 'operator:1' });
        await manager.acquire('r1', { image: 'python:3.13' });
        await manager.acquire('r2', {});
        await manager.acquire('r3', { image: 'operator:1' });
        expect(provider.created.map((input) => input.imageRequested)).toEqual([true, undefined, undefined]);
    });

    it('keeps the manager\'s image without a request', async () => {
        const { provider, manager } = setup({ image: 'operator:1' });
        await manager.acquire('r1', {});
        expect(provider.created[0]!.image).toBe('operator:1');
    });

    it('refuses an image allowImage refuses, before any create', async () => {
        const seen: string[] = [];
        const { provider, manager } = setup({
            allowImage: (image) => {
                seen.push(image);
                return image.startsWith('ghcr.io/acme/');
            },
        });
        await expect(manager.acquire('r1', { image: 'evil:latest' })).rejects.toThrow(ValidationError);
        await expect(manager.acquire('r1', { image: 'evil:latest' })).rejects.toThrow('image not allowed.');
        expect(provider.created).toHaveLength(0);
        await manager.acquire('r1', { image: 'ghcr.io/acme/tools:2' });
        expect(seen).toEqual(['evil:latest', 'evil:latest', 'ghcr.io/acme/tools:2']);
    });

    it('never asks allowImage without a requested image', async () => {
        const { manager } = setup({ allowImage: () => false });
        await expect(manager.acquire('r1', {})).resolves.toMatchObject({ reused: false });
    });

    it('refuses a malformed image', async () => {
        const { provider, manager } = setup();
        await expect(manager.acquire('r1', { image: 'node 24' })).rejects.toThrow(ValidationError);
        expect(provider.created).toHaveLength(0);
    });

    it('refuses an allowImage that is no function', () => {
        expect(() => setup({ allowImage: 'node' as never })).toThrow(InvalidAgentDefinitionError);
    });

    it('refuses another image for a repository the run holds', async () => {
        const { manager } = setup();
        await manager.acquire('r1', { repo: 'octo/demo', image: 'node:24' });
        await expect(manager.acquire('r1', { repo: 'octo/demo', image: 'python:3.13' }))
            .rejects.toThrow(SandboxError);
        await expect(manager.acquire('r1', { repo: 'octo/demo', image: 'python:3.13' }))
            .rejects.toThrow(/node:24.*dispose it first \(dispose_workspace\).*python:3\.13/);
    });

    it('reuses a held workspace for the same image or none', async () => {
        const { provider, manager } = setup();
        const first = await manager.acquire('r1', { repo: 'octo/demo', image: 'node:24' });
        expect((await manager.acquire('r1', { repo: 'octo/demo', image: 'node:24' })).workspace.id).toBe(first.workspace.id);
        expect((await manager.acquire('r1', { repo: 'octo/demo' })).workspace.id).toBe(first.workspace.id);
        expect(provider.created).toHaveLength(1);
    });

    it('compares a request with the image a found workspace runs', async () => {
        const {
            clock, 
            provider, 
            manager, 
        } = setup();
        await manager.acquire('r1', { repo: 'octo/demo', image: 'node:24' });
        // a restarted process finds it through the provider
        const other = createWorkspaceManager({
            provider, 
            clock, 
            gcIntervalMs: 0, 
        });
        await expect(other.acquire('r1', { repo: 'octo/demo', image: 'python:3.13' })).rejects.toThrow(/dispose it first/);
        await expect(other.acquire('r1', { repo: 'octo/demo', image: 'node:24' })).resolves.toMatchObject({ reused: true });
    });

    it('create_workspace takes an image and reports it', async () => {
        const { provider, manager } = setup();
        const result = await callTool<WorkspaceToolResult>(manager.tools(), 'create_workspace', { image: 'rust:1' }, toolContext('r1'));
        expect(provider.created[0]!.image).toBe('rust:1');
        expect(result.image).toBe('rust:1');
    });

    it('create_workspace refuses a non-string image', async () => {
        const { manager } = setup();
        await expect(callTool(manager.tools(), 'create_workspace', { image: 24 }, toolContext('r1'))).rejects.toThrow(ValidationError);
    });
});

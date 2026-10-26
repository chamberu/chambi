/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import * as sandbox from '@chamvi/sandbox';
import * as module from '@chamvi/sandbox/module';

describe('public api', () => {
    it.each([
        'createOutputCollector',
        'resolveWorkspacePath',
        'normalizeRepo',
        'assertGitRef',
        'prepareWorkspace',
        'resolveLimits',
        'parseCpu',
        'parseMemory',
        'assertSandboxEnv',
        'createWorkspaceManager',
        'createRemoteWorkspace',
        'absoluteWorkspacePath',
        'assertArgv',
        'decodeUtf8File',
        'assertCreateInput',
        'abortedCreate',
        'assertImageOption',
        'assertTmpSizeOption',
        'assertClockOption',
        'buildWorkspaceInfo',
        'isExpiredAt',
        'collectionError',
        'assertDeployment',
        'workspaceLabels',
        'workspaceMetadata',
        'readWorkspaceInfo',
        'repoKey',
        'readCheckout',
        'createSettledCheck',
        'createSinkStream',
        'delay',
        'injectSandboxContext',
        'provideSandboxContext',
        'assertImage',
        'cacheEnv',
        'isRootUser',
        'probeImage',
        'staticGitCredentials',
    ])('exports %s', (name) => {
        expect(sandbox).toHaveProperty(name);
        expect(sandbox[name as keyof typeof sandbox]).toBeTypeOf('function');
    });

    it('exports the workspace constants', () => {
        expect(sandbox.WORKSPACE_ROOT).toBe('/workspace');
        expect(sandbox.WORKSPACE_HOME).toBe('/home/sandbox');
        expect(sandbox.OUTPUT_MAX_BYTES).toBe(65_536);
        expect(sandbox.FILE_MAX_BYTES).toBe(16_777_216);
        expect(sandbox.EXEC_TIMEOUT_MS).toBe(300_000);
        expect(sandbox.EXEC_TIMEOUT_MAX_MS).toBe(1_800_000);
        expect(sandbox.SANDBOX_ENV).toEqual({
            HOME: '/home/sandbox',
            GIT_TERMINAL_PROMPT: '0',
            GIT_CONFIG_NOSYSTEM: '1',
            GIT_CONFIG_COUNT: '1',
            GIT_CONFIG_KEY_0: 'safe.directory',
            GIT_CONFIG_VALUE_0: '/workspace',
            NPM_CONFIG_UPDATE_NOTIFIER: 'false',
            CI: 'true',
        });
        expect(sandbox.SANDBOX_ENV.GIT_CONFIG_NOSYSTEM).toBe('1');
    });

    it('exports the credential constants', () => {
        expect(sandbox.REDACTED).toBe('[redacted]');
        expect(sandbox.CREDENTIAL_REFRESH_MS).toBe(600_000);
        expect(sandbox.CREDENTIAL_RETRY_MS).toBe(60_000);
        expect(sandbox.CREDENTIALS_FILE).toBe('.chamvi/credentials');
        expect(sandbox.REDACT_MIN_LENGTH).toBe(4);
    });

    it('exports the provider constants', () => {
        expect(sandbox.DEFAULT_LIMITS).toEqual({
            cpu: '1',
            memory: '2Gi',
            storage: '4Gi',
            pids: 512,
            maxLifetimeMs: 604_800_000,
        });
        expect(sandbox.DEFAULT_SANDBOX_IMAGE).toBe('ghcr.io/chamvi/sandbox-dev:trixie');
        expect(sandbox.TMP_SIZE).toBe('1Gi');
        expect(sandbox.SANDBOX_LABELS).toEqual({
            'app.kubernetes.io/managed-by': 'chamvi',
            'app.kubernetes.io/component': 'sandbox',
        });
        expect(sandbox.RUN_LABEL).toBe('chamvi.dev/run');
        expect(sandbox.WORKSPACE_LABEL).toBe('chamvi.dev/workspace');
        expect(sandbox.EXPIRES_AT_KEY).toBe('chamvi.dev/expires-at');
        expect(sandbox.CREATED_AT_KEY).toBe('chamvi.dev/created-at');
        expect(sandbox.DEPLOYMENT_LABEL).toBe('chamvi.dev/deployment');
        expect(sandbox.REPO_KEY_LABEL).toBe('chamvi.dev/repo-key');
        expect(sandbox.REPO_URL_KEY).toBe('chamvi.dev/repo');
        expect(sandbox.REF_KEY).toBe('chamvi.dev/ref');
        expect(sandbox.IMAGE_KEY).toBe('chamvi.dev/image');
        expect(sandbox.DEFAULT_DEPLOYMENT).toBe('default');
        expect(sandbox.SANDBOX_LABEL_SELECTORS).toEqual([
            'app.kubernetes.io/managed-by=chamvi',
            'app.kubernetes.io/component=sandbox',
        ]);
    });

    it('exports the manager constants', () => {
        expect(sandbox.MAX_WORKSPACES_PER_RUN).toBe(3);
        expect(sandbox.CREDENTIAL_INSTALL_TIMEOUT_MS).toBe(30_000);
        expect(sandbox.PUSH_LOG_MAX_COMMITS).toBe(50);
        expect(sandbox.GC_INTERVAL_MS).toBe(600_000);
        expect(sandbox.CLOSE_TIMEOUT_MS).toBe(30_000);
    });

    it('exports the image constants', () => {
        expect(sandbox.CACHE_DIR).toBe('/cache');
        expect(sandbox.CACHE_ENV.MISE_DATA_DIR).toBe('/cache/mise');
        expect(sandbox.IMAGE_PROBE_TIMEOUT_MS).toBe(30_000);
        expect(sandbox.IMAGE_REQUIREMENTS).toEqual(['sh', 'git', 'timeout']);
        expect(sandbox.ROOT_CAPABILITIES).toContain('SETUID');
    });

    it('exports the remote constants', () => {
        expect(sandbox.TIMEOUT_KILL_AFTER_SECONDS).toBe(5);
        expect(sandbox.EXEC_GRACE_MS).toBe(15_000);
        expect(sandbox.ALIVE_PROBE_TIMEOUT_MS).toBe(5_000);
    });

    it('freezes the shared constants', () => {
        expect(Object.isFrozen(sandbox.SANDBOX_ENV)).toBe(true);
        expect(Object.isFrozen(sandbox.SANDBOX_LABELS)).toBe(true);
        expect(Object.isFrozen(sandbox.DEFAULT_LIMITS)).toBe(true);
        expect(Object.isFrozen(sandbox.SANDBOX_LABEL_SELECTORS)).toBe(true);
    });

    it.each([
        'checkoutCommands',
        'createWorkspaceTools',
        'wrapTimeout',
        'isTimeoutExit',
        'isName',
        'IMAGE_PATTERN',
        'IMAGE_PROBE_SCRIPT',
        'CACHE_FOLDERS',
        'SANDBOX_CONTEXT',
    ])('keeps %s internal', (name) => {
        expect(sandbox).not.toHaveProperty(name);
    });

    it('@chamvi/sandbox/module exports sandboxModule', () => {
        expect(Object.keys(module).sort()).toEqual([
            'SANDBOX_MODULE_NAME',
            'SANDBOX_PROVIDER_NAMES',
            'SandboxModule',
            'sandboxModule',
        ]);
        expect(module.SANDBOX_MODULE_NAME).toBe('chamvi:sandbox');
        expect(module.SANDBOX_PROVIDER_NAMES).toEqual(['local', 'docker', 'kubernetes']);
    });

    it.each([
        'SANDBOX_MODULE_NAME',
        'SANDBOX_PROVIDER_NAMES',
        'SandboxModule',
        'sandboxModule',
        'createLazyProvider',
    ])('the main entry keeps %s out', (name) => {
        expect(sandbox).not.toHaveProperty(name);
    });

    it.each([
        'createLazyProvider',
        'isPackageNotFound',
        'SANDBOX_PROVIDER_PACKAGES',
        'SANDBOX_PROVIDER_IDS',
    ])('the module entry keeps %s internal', (name) => {
        expect(module).not.toHaveProperty(name);
    });
});

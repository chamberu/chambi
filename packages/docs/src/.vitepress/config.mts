/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import tailwindcss from '@tailwindcss/vite';
import type { UserConfig } from 'vitepress';
import { defineConfig, postcssIsolateStyles } from 'vitepress';
import { chamviCodeTheme } from './shiki-theme';

// a plugin as the vite bundled with VitePress types it
type VitePressVitePlugin = NonNullable<NonNullable<UserConfig['vite']>['plugins']>[number];

export default defineConfig({
    title: 'chamvi',
    description: 'A TypeScript framework for self-hosted, channel-driven AI agents on the Vercel AI SDK: durable runs, checkpoints, approvals and a pluggable store.',
    base: '/',
    sitemap: { hostname: 'https://chamvi.dev' },
    cleanUrls: true,
    lastUpdated: true,

    vite: {
        // @tailwindcss/vite is typed against the workspace's newer vite (via
        // vitest), VitePress bundles vite 5; the plugin supports both at runtime.
        plugins: [tailwindcss() as unknown as VitePressVitePlugin],
        css: {
            postcss: {
                plugins: [
                    // VitePress base + doc styles are unlayered and would override
                    // Tailwind utilities, so exclude them inside `.vp-raw` subtrees.
                    postcssIsolateStyles({ includeFiles: [/base\.css/, /vp-doc\.css/] }),
                ],
            },
        },
    },

    markdown: {
        // code blocks sit on a fixed-dark surface in both color modes
        theme: chamviCodeTheme,
    },

    head: [
        ['link', {
            rel: 'icon',
            type: 'image/svg+xml',
            href: '/logo.svg',
        }],
        ['meta', { name: 'theme-color', content: '#19171a' }],
        ['meta', { property: 'og:type', content: 'website' }],
        ['meta', { property: 'og:url', content: 'https://chamvi.dev/' }],
        ['meta', { property: 'og:title', content: 'chamvi' }],
        ['meta', {
            property: 'og:description',
            content: 'Self-hosted, channel-driven AI agents on the Vercel AI SDK.',
        }],
    ],

    themeConfig: {
        logo: {
            light: '/logo-light.svg', 
            dark: '/logo-dark.svg', 
            alt: 'chamvi', 
        },

        nav: [
            {
                text: 'Getting Started',
                link: '/getting-started/',
                activeMatch: '/getting-started/',
            },
            {
                text: 'Guide',
                link: '/guide/',
                activeMatch: '/guide/',
            },
            {
                text: 'Stores',
                link: '/stores/',
                activeMatch: '/stores/',
            },
            {
                text: 'Deployment',
                link: '/deployment/',
                activeMatch: '/deployment/',
            },
            {
                text: 'Reference',
                link: '/reference/',
                activeMatch: '/reference/',
            },
            {
                text: 'Roadmap',
                link: '/roadmap',
            },
        ],

        sidebar: {
            '/getting-started/': [
                {
                    text: 'Getting Started',
                    items: [
                        { text: 'Introduction', link: '/getting-started/' },
                        { text: 'Installation', link: '/getting-started/installation' },
                        { text: 'Quick Start', link: '/getting-started/quick-start' },
                        { text: 'Your First Agent', link: '/guide/first-agent' },
                    ],
                },
            ],
            '/guide/': [
                {
                    text: 'Concepts',
                    items: [
                        { text: 'Overview', link: '/guide/' },
                        { text: 'Your First Agent', link: '/guide/first-agent' },
                        { text: 'Agents', link: '/guide/agents' },
                        { text: 'Channels & the Envelope', link: '/guide/channels' },
                        { text: 'Run Lifecycle', link: '/guide/run-lifecycle' },
                    ],
                },
                {
                    text: 'Execution',
                    items: [
                        { text: 'Execution & Checkpoints', link: '/guide/execution' },
                        { text: 'Budgets & Timeouts', link: '/guide/budgets' },
                        { text: 'Tools & Tool Errors', link: '/guide/tools' },
                        { text: 'Approved Local Skills', link: '/guide/skills' },
                        { text: 'Effect Tools & Reconciliation', link: '/guide/effect-tools' },
                        { text: 'Approvals & Hooks', link: '/guide/approvals' },
                        { text: 'Hand-offs', link: '/guide/handoffs' },
                        { text: 'Agent State', link: '/guide/state' },
                        { text: 'Workspaces & Coding', link: '/guide/workspaces' },
                    ],
                },
                {
                    text: 'Operations',
                    items: [
                        { text: 'Apps & Modules', link: '/guide/app' },
                        { text: 'Pick a Model', link: '/guide/models' },
                        { text: 'Agent Folders', link: '/guide/agent-folders' },
                        { text: 'Concurrency, Leases & Multi-Replica', link: '/guide/concurrency' },
                        { text: 'Cancel, Drain & Recovery', link: '/guide/recovery' },
                        { text: 'Cron Scheduling', link: '/guide/scheduler' },
                        { text: 'HTTP API & MCP', link: '/guide/http' },
                        { text: 'Dashboard', link: '/guide/ui' },
                        { text: 'Errors', link: '/guide/errors' },
                    ],
                },
            ],
            '/stores/': [
                {
                    text: 'Stores',
                    items: [
                        { text: 'Store Contract', link: '/stores/' },
                        { text: 'MemoryStore', link: '/stores/memory' },
                        { text: 'Writing a Store', link: '/stores/writing-a-store' },
                        { text: 'TypeORM', link: '/stores/typeorm' },
                    ],
                },
            ],
            '/deployment/': [
                {
                    text: 'Deployment (planned)',
                    items: [
                        { text: 'Overview', link: '/deployment/' },
                        { text: 'Docker Image', link: '/deployment/docker' },
                        { text: 'Kubernetes & Flux', link: '/deployment/kubernetes' },
                        { text: 'Multiple Replicas', link: '/deployment/replicas' },
                        { text: 'OpenClaw', link: '/deployment/openclaw' },
                        { text: 'GitHub App', link: '/deployment/github-app' },
                    ],
                },
            ],
            '/reference/': [
                {
                    text: 'Reference',
                    items: [
                        { text: '@chamvi/core', link: '/reference/' },
                        { text: '@chamvi/app', link: '/reference/app' },
                        { text: '@chamvi/channel-cron', link: '/reference/channel-cron' },
                        { text: '@chamvi/channel-openclaw', link: '/reference/channel-openclaw' },
                        { text: '@chamvi/cli', link: '/reference/cli' },
                        { text: '@chamvi/coding', link: '/reference/coding' },
                        { text: '@chamvi/github', link: '/reference/github' },
                        { text: '@chamvi/http', link: '/reference/http' },
                        { text: '@chamvi/sandbox', link: '/reference/sandbox' },
                        { text: '@chamvi/skills', link: '/reference/skills' },
                        { text: '@chamvi/test-kit', link: '/reference/test-kit' },
                        { text: '@chamvi/tool-web', link: '/reference/tool-web' },
                        { text: '@chamvi/ui', link: '/reference/ui' },
                    ],
                },
            ],
        },

        socialLinks: [
            { icon: 'github', link: 'https://github.com/chamvi/chamvi' },
        ],

        editLink: {
            pattern: 'https://github.com/chamvi/chamvi/edit/master/packages/docs/src/:path',
            text: 'Edit this page on GitHub',
        },

        search: { provider: 'local' },
    },
});

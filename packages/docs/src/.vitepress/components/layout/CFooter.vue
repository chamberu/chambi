<!--
  - Copyright (c) 2026.
  - Author Peter Placzek (tada5hi)
  - For the full copyright and license information,
  - view the LICENSE file that was distributed with this source code.
  -->
<script lang="ts">
import { VPLink } from 'vitepress/theme';
import { defineComponent } from 'vue';

const COLUMNS = [
    {
        title: 'Documentation',
        links: [
            { text: 'Getting Started', link: '/getting-started/' },
            { text: 'Guide', link: '/guide/' },
            { text: 'Repositories', link: '/repositories/' },
            { text: 'Reference', link: '/reference/' },
        ],
    },
    {
        title: 'Project',
        links: [
            { text: 'Roadmap', link: '/roadmap' },
            { text: 'GitHub', link: 'https://github.com/chamvi/chamvi' },
            { text: 'npm', link: 'https://www.npmjs.com/package/@chamvi/core' },
        ],
    },
];

const LINK_CLASS = 'text-night-muted no-underline transition-colors duration-150 hover:text-night-fg';

export default defineComponent({
    name: 'CFooter',
    components: { VPLink },
    setup() {
        return {
            columns: COLUMNS,
            linkClass: LINK_CLASS,
        };
    },
});
</script>
<template>
    <footer class="ch-footer vp-raw font-sans">
        <div class="ch-wrap grid grid-cols-1 gap-10 py-14 sm:grid-cols-2 md:grid-cols-[1.6fr_1fr_1fr]">
            <div class="sm:col-span-2 md:col-span-1">
                <p class="m-0 flex items-center gap-3">
                    <img
                        src="/logo-dark.svg"
                        alt=""
                        width="32"
                        height="32"
                    >
                    <span class="ch-display text-xl text-night-fg">chamvi</span>
                </p>
                <p class="m-0 mt-4 max-w-[38ch] text-sm leading-relaxed">
                    Self-hosted, channel-driven AI agents with durable runs, built on the Vercel AI SDK.
                </p>
            </div>
            <nav
                v-for="column in columns"
                :key="column.title"
                :aria-label="column.title"
            >
                <h2 class="m-0 mb-4 font-mono text-xs font-medium tracking-[0.14em] text-night-fg uppercase">
                    {{ column.title }}
                </h2>
                <ul class="m-0 grid list-none gap-2.5 p-0 text-sm">
                    <li
                        v-for="link in column.links"
                        :key="link.text"
                    >
                        <VPLink
                            :class="linkClass"
                            :href="link.link"
                        >
                            {{ link.text }}
                        </VPLink>
                    </li>
                </ul>
            </nav>
        </div>
        <div class="border-t border-night-line">
            <div class="ch-wrap flex flex-wrap items-center justify-between gap-2 py-5 text-xs">
                <span>&copy; 2026&ndash;present Peter Placzek</span>
                <VPLink
                    :class="linkClass"
                    href="https://github.com/chamvi/chamvi/blob/master/LICENSE"
                >
                    MIT License
                </VPLink>
            </div>
        </div>
    </footer>
</template>

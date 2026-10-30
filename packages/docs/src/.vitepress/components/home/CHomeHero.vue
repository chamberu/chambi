<!--
  - Copyright (c) 2026.
  - Author Peter Placzek (tada5hi)
  - For the full copyright and license information,
  - view the LICENSE file that was distributed with this source code.
  -->
<script lang="ts">
import { VPLink } from 'vitepress/theme';
import { computed, defineComponent } from 'vue';
import { useHome } from './use-home';

const TITLE_CLASS = 'ch-display mt-1 text-[clamp(2.75rem,7vw,4.75rem)] leading-[1.02] text-ink';
const GRID_CLASS = 'ch-wrap grid grid-cols-1 items-center gap-12 vp:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] vp:gap-16';

export default defineComponent({
    name: 'CHomeHero',
    components: { VPLink },
    setup() {
        const hero = useHome('hero');

        // the headline with its highlighted phrase split out
        const title = computed(() => {
            const { title: text, highlight } = hero.value;
            const index = highlight ? text.indexOf(highlight) : -1;

            if (!highlight || index === -1) {
                return {
                    before: text,
                    highlight: '',
                    after: '',
                };
            }

            return {
                before: text.slice(0, index),
                highlight,
                after: text.slice(index + highlight.length),
            };
        });

        return {
            hero,
            title,
            titleClass: TITLE_CLASS,
            gridClass: GRID_CLASS,
        };
    },
});
</script>
<template>
    <header class="ch-hero ch-section-alt pt-14 pb-16 md:pb-24">
        <div :class="gridClass">
            <div class="min-w-0">
                <p class="ch-eyebrow">
                    {{ hero.eyebrow }}
                </p>
                <h1 :class="titleClass">
                    {{ title.before }}<span
                        v-if="title.highlight"
                        class="text-accent-text"
                    >{{ title.highlight }}</span>{{ title.after }}
                </h1>
                <p class="ch-lede mt-6 max-w-[46ch]">
                    {{ hero.lead }}
                </p>
                <div class="mt-8 flex flex-wrap gap-3">
                    <VPLink
                        v-for="action in hero.actions"
                        :key="action.link"
                        :href="action.link"
                        :class="['ch-button', action.theme === 'alt' ? 'ch-button-secondary' : 'ch-button-primary']"
                    >
                        {{ action.text }}
                    </VPLink>
                </div>
            </div>

            <figure class="m-0 min-w-0">
                <div class="ch-code shadow-[0_24px_48px_-24px_rgb(0_0_0/0.45)]">
                    <div class="flex items-center justify-between gap-3 border-b border-night-line px-5 py-3">
                        <span class="truncate font-mono text-xs text-night-muted">{{ hero.file }}</span>
                        <span class="ch-chip ch-chip-accent shrink-0">running</span>
                    </div>
                    <slot name="code" />
                    <div
                        v-if="hero.approval"
                        class="flex items-center gap-3 border-t border-night-line px-5 py-3 font-mono text-xs text-night-fg"
                    >
                        <span class="ch-chip shrink-0 border-night-line bg-transparent text-night-fg">waiting</span>
                        <span class="min-w-0">{{ hero.approval }}</span>
                    </div>
                </div>
            </figure>
        </div>
    </header>
</template>

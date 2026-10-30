/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { useData } from 'vitepress';
import { computed } from 'vue';
import type { ComputedRef } from 'vue';
import type { HomeFrontmatter } from './types';

export function useHome<K extends keyof HomeFrontmatter>(key: K): ComputedRef<HomeFrontmatter[K]> {
    const { frontmatter } = useData();

    return computed(() => (frontmatter.value as HomeFrontmatter)[key]);
}

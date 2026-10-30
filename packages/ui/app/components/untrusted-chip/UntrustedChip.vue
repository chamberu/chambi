<script setup lang="ts">
/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { RunWire } from '../../api/types.ts';

defineProps<{ taint?: RunWire['taint'] }>();
</script>

<template>
    <span
        v-if="taint"
        class="chip chip-untrusted"
        :title="`First consumed from ${taint.source} at ${taint.at}`"
        :aria-label="`Untrusted content: first consumed from ${taint.source} at ${taint.at}`"
        data-testid="untrusted-content"
    >Untrusted content</span>
</template>

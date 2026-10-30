<script setup lang="ts">
/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { computed } from 'vue';
import { RouterLink } from 'vue-router';
import type { RunWire, ScheduleWire } from '../../api/types.ts';
import { RouteName } from '../../router/constants.ts';
import { describeCron, formatFireTime } from '../../schedules/helpers.ts';
import ExpiryCountdown from '../expiry-countdown/ExpiryCountdown.vue';
import StatusChip from '../status-chip/StatusChip.vue';

const props = defineProps<{
    schedule: ScheduleWire;
    /** The trigger's newest run: `null` when none is among the runs read, `undefined` to leave the line out. */
    last?: RunWire | null;
}>();

const reading = computed(() => {
    const zone = props.schedule.timezone ?? 'server time zone';
    const text = describeCron(props.schedule.expression);

    return text ? `${text} · ${zone}` : zone;
});
</script>

<template>
    <div
        class="card sched"
        data-testid="schedule"
    >
        <div class="sched-top">
            <b><RouterLink
                :to="{ name: RouteName.AGENT, params: { name: schedule.agent } }"
                data-testid="agent-link"
            >{{ schedule.agent }}</RouterLink></b>
            <span>{{ schedule.trigger }}</span>
        </div>
        <div class="sched-expr">
            <span class="cron">{{ schedule.expression }}</span>
            <span>{{ reading }}</span>
        </div>
        <div class="sched-next">
            <span class="field-label">Next fire in</span>
            <ExpiryCountdown
                :until="schedule.nextAt"
                :soon-ms="0"
            />
            <span>{{ formatFireTime(schedule.nextAt, schedule.timezone) }}</span>
        </div>
        <div class="sched-foot">
            <span>overlap <b>{{ schedule.overlap }}</b></span>
            <span v-if="last">last <StatusChip :status="last.status" /> <VCTimeago :datetime="last.createdAt" /></span>
            <span v-else-if="last === null">no recent run</span>
        </div>
    </div>
</template>

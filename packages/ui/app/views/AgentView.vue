<script setup lang="ts">
/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { useToast } from '@vuecs/overlays';
import { computed, ref } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { useAgentDetail } from '../agents/composables.ts';
import {
    channelChips,
    failedSummary,
    formatBudgetTime,
    hasHttpSubscription,
    lastRunOf,
    oldestWaiting,
} from '../agents/helpers.ts';
import type { ChannelChip as Chip } from '../agents/types.ts';
import type { StartRunResult } from '../api/types.ts';
import { approvalLinkQuery } from '../approvals/helpers.ts';
import { hasPermission } from '../auth/helpers.ts';
import AgentRuns from '../components/agent-runs/AgentRuns.vue';
import AgentStatePanel from '../components/agent-state/AgentStatePanel.vue';
import ChannelChip from '../components/channel-chip/ChannelChip.vue';
import EmptyState from '../components/empty-state/EmptyState.vue';
import ExpiryCountdown from '../components/expiry-countdown/ExpiryCountdown.vue';
import NavIcon from '../components/nav-icon/NavIcon.vue';
import ScheduleCard from '../components/schedule-card/ScheduleCard.vue';
import StartRunModal from '../components/start-run/StartRunModal.vue';
import StatusChip from '../components/status-chip/StatusChip.vue';
import { panelId, tabId } from '../components/tab-list/helpers.ts';
import TabList from '../components/tab-list/TabList.vue';
import { useAppContext } from '../context/module.ts';
import { RouteName } from '../router/constants.ts';
import { formatTokens, shortId } from '../runs/helpers.ts';
import { formatFireTime } from '../schedules/helpers.ts';
import { useAgentState } from '../state/composables.ts';

const TABS = ['overview', 'runs', 'state', 'schedules'] as const;
type Tab = typeof TABS[number];

const {
    client,
    config,
    session,
} = useAppContext();
const route = useRoute();
const router = useRouter();
const toast = useToast();

const name = computed(() => String(route.params.name));
const detail = useAgentDetail(client, name);
const {
    agent,
    schedules,
    activity,
    error,
} = detail;
const stateName = computed<string | undefined>(() => (agent.value ? agent.value.name : undefined));
const state = useAgentState(client, stateName);

const tab = computed<Tab>({
    get: () => (TABS as readonly string[]).includes(String(route.query.tab)) ? route.query.tab as Tab : 'overview',
    set: (value) => {
        void router.replace({ query: value === 'overview' ? {} : { tab: value } });
    },
});

const chips = computed(() => (agent.value ? channelChips(agent.value, schedules.value) : []));
const permissions = computed(() => session.principal.value?.permissions ?? []);
const canStart = computed(() => !!agent.value && hasHttpSubscription(agent.value) &&
    hasPermission(permissions.value, `agent:${agent.value.name}:run`));
const invoker = computed(() => session.principal.value?.name ?? session.principal.value?.id);
const stateCount = computed(() => (state.error.value ? undefined :
    `${state.kv.value.length + state.collections.value.length}${state.moreKv.value ? '+' : ''}`));
const oldest = computed(() => oldestWaiting(detail.waitingRuns.value));
const startOpen = ref(false);
const emptyRunsText = computed(() => `${name.value} has not run${canStart.value ? '. Use Start run to send a first payload.' : ' yet.'}`);

function onStarted(result: StartRunResult): void {
    toast.add({
        title: result.deduplicated ? `Already started · run ${shortId(result.runId)}` : `Run queued · ${name.value} · ${shortId(result.runId)}`,
        color: 'success',
    });
}

function runSub(run: { trigger: { trigger: string; invoker?: { id: string; name?: string } }; concurrencyKey?: string }): string {
    if (run.concurrencyKey) {
        return `${run.trigger.trigger} · ${run.concurrencyKey}`;
    }

    if (run.trigger.invoker) {
        return `${run.trigger.trigger} · by ${run.trigger.invoker.name ?? run.trigger.invoker.id}`;
    }

    return run.trigger.trigger;
}

/** The cron schedule of a chip's subscription, if it is one. */
function scheduleOf(chip: Chip) {
    return schedules.value.find((s) => s.channel === chip.channel && s.trigger === chip.id);
}
</script>

<template>
    <RouterLink
        class="back"
        :to="{ name: RouteName.AGENTS }"
    >
        <NavIcon name="back" />agents / {{ name }}
    </RouterLink>

    <div
        v-if="error?.status === 403"
        class="card notice"
    >
        Reading an agent needs <b class="mono">run:read</b>.
    </div>
    <div
        v-else-if="detail.notFound.value"
        class="card"
    >
        <EmptyState
            icon="search"
            title="No such agent"
            :text="`This app registers no agent named ${name}.`"
        />
    </div>
    <p
        v-else-if="error"
        class="err-line"
        data-testid="agent-error"
    >
        <template v-if="agent">
            Not updating, showing the last data:
        </template>{{ error.code }} · {{ error.message }}
    </p>

    <template v-if="agent">
        <section class="card run-head agent-head">
            <div class="run-head-top">
                <div class="run-title">
                    <h1 class="display">
                        {{ agent.name }}
                    </h1>
                    <div class="head-actions">
                        <VCButton
                            v-if="canStart"
                            class="btn btn-primary"
                            @click="startOpen = true"
                        >
                            <NavIcon name="play" />Start run
                        </VCButton>
                        <RouterLink
                            class="btn"
                            :to="{ name: RouteName.RUNS, query: { agent: agent.name } }"
                        >
                            View all runs
                        </RouterLink>
                    </div>
                </div>
                <div class="trigs">
                    <ChannelChip
                        v-for="chip in chips"
                        :key="`${chip.channel}:${chip.id}`"
                        :chip="chip"
                    />
                </div>
                <dl class="facts">
                    <div>
                        <dt>max steps</dt>
                        <dd class="tnum">
                            {{ agent.budget.maxSteps ?? '—' }}
                        </dd>
                    </div>
                    <div>
                        <dt>timeout</dt>
                        <dd>{{ formatBudgetTime(agent.budget.timeoutMs) }}</dd>
                    </div>
                    <div>
                        <dt>max tokens</dt>
                        <dd :class="agent.budget.maxTokens ? 'tnum' : 'muted'">
                            {{ agent.budget.maxTokens ? formatTokens(agent.budget.maxTokens) : 'no limit' }}
                        </dd>
                    </div>
                    <div>
                        <dt>state</dt>
                        <dd v-if="agent.state.length">
                            <span
                                v-for="collection in agent.state"
                                :key="collection"
                                class="tag"
                            >{{ collection }}</span>
                        </dd>
                        <dd
                            v-else
                            class="muted"
                        >
                            no collections
                        </dd>
                    </div>
                </dl>
            </div>
            <p class="head-note">
                Tools appear here only when they need approval: an agent can build its tool set per run, so the full list is not known ahead of time.
            </p>
        </section>

        <TabList
            v-model="tab"
            :tabs="TABS"
            prefix="agent"
            label="Agent sections"
        >
            <template #tab="{ tab: id }">
                <template v-if="id === 'overview'">
                    Overview
                </template>
                <template v-else-if="id === 'runs'">
                    Runs <span class="count">{{ detail.totalRuns.value }}</span>
                </template>
                <template v-else-if="id === 'state'">
                    State <span
                        v-if="stateCount !== undefined"
                        class="count"
                    >{{ stateCount }}</span>
                </template>
                <template v-else>
                    Schedules <span class="count">{{ schedules.length }}</span>
                </template>
            </template>
        </TabList>

        <div
            :id="panelId('agent')"
            role="tabpanel"
            :aria-labelledby="tabId('agent', tab)"
        >
            <AgentRuns
                v-if="tab === 'runs'"
                :agent="agent"
            />
            <AgentStatePanel
                v-else-if="tab === 'state'"
                :agent="agent.name"
                :state="state"
            />
            <template v-else-if="tab === 'schedules'">
                <template v-if="schedules.length">
                    <div class="tab-lede">
                        <p>Cron subscriptions of {{ agent.name }}. Times are in each subscription's time zone.</p>
                    </div>
                    <div class="sched-cards">
                        <ScheduleCard
                            v-for="schedule in schedules"
                            :key="`${schedule.channel}:${schedule.trigger}`"
                            :schedule="schedule"
                            :last="lastRunOf(detail.runs.value, schedule.trigger)"
                        />
                    </div>
                </template>
                <div
                    v-else
                    class="card"
                >
                    <EmptyState
                        icon="schedules"
                        title="No cron subscriptions"
                        :text="`${agent.name} has no cron.on() subscription, so nothing starts it on a schedule.`"
                    />
                </div>
            </template>
            <template v-else>
                <div class="stats">
                    <div class="card stat stat-run">
                        <small>Runs · 24 h</small>
                        <b data-testid="runs-24h">{{ activity.count }}{{ activity.saturated ? '+' : '' }}</b>
                        <span>{{ activity.count || detail.running.value ? `${detail.running.value} running now` : 'nothing started yet' }}</span>
                    </div>
                    <div class="card stat stat-fail">
                        <small>Failed · 24 h</small>
                        <b>{{ activity.failed }}</b>
                        <span>{{ failedSummary(activity) }}</span>
                    </div>
                    <div class="card stat stat-wait">
                        <small>Waiting</small>
                        <b>{{ detail.waitingTotal.value }}</b>
                        <span v-if="oldest">oldest asked <VCTimeago :datetime="oldest.updatedAt" /></span>
                        <span v-else>no approvals open</span>
                    </div>
                    <div class="card stat">
                        <small>Tokens · 24 h</small>
                        <b>{{ formatTokens(activity.tokens) }}{{ activity.saturated ? '+' : '' }}</b>
                        <span>{{ agent.budget.maxTokens ? `cap ${formatTokens(agent.budget.maxTokens)} per run` : 'no per-run cap' }}</span>
                    </div>
                </div>
                <div class="ov">
                    <div class="ov-col">
                        <section class="card panel">
                            <div class="panel-head">
                                <h3>Recent runs</h3>
                                <RouterLink
                                    v-if="detail.recent.value.length"
                                    :to="{ query: { tab: 'runs' } }"
                                >
                                    All runs of {{ agent.name }}
                                </RouterLink>
                            </div>
                            <ul
                                v-if="detail.recent.value.length"
                                class="rows"
                                data-testid="recent-runs"
                            >
                                <li
                                    v-for="run in detail.recent.value"
                                    :key="run.id"
                                >
                                    <RouterLink
                                        class="rrow"
                                        :to="{ name: RouteName.RUN, params: { id: run.id } }"
                                    >
                                        <StatusChip :status="run.status" />
                                        <span class="rrow-main">
                                            <span class="id">{{ shortId(run.id) }}</span>
                                            <span class="sub">{{ runSub(run) }}</span>
                                        </span>
                                        <span class="when"><VCTimeago :datetime="run.createdAt" /></span>
                                    </RouterLink>
                                </li>
                            </ul>
                            <EmptyState
                                v-else
                                icon="play"
                                title="No runs yet"
                                :text="emptyRunsText"
                            >
                                <VCButton
                                    v-if="canStart"
                                    class="btn btn-sm btn-primary"
                                    @click="startOpen = true"
                                >
                                    <NavIcon name="play" />Start run
                                </VCButton>
                            </EmptyState>
                        </section>
                    </div>
                    <div class="ov-col">
                        <section class="card panel">
                            <div class="panel-head">
                                <h3>
                                    Waiting for approval<span
                                        v-if="detail.waitingTotal.value"
                                        class="badge"
                                    >{{ detail.waitingTotal.value }}</span>
                                </h3>
                                <RouterLink
                                    v-if="detail.waitingRuns.value.length"
                                    :to="{ name: RouteName.APPROVALS }"
                                >
                                    Open approvals
                                </RouterLink>
                            </div>
                            <ul
                                v-if="detail.waitingRuns.value.length"
                                class="rows"
                            >
                                <li
                                    v-for="run in detail.waitingRuns.value"
                                    :key="run.id"
                                >
                                    <RouterLink
                                        class="aprow"
                                        :to="{ name: RouteName.APPROVALS, query: approvalLinkQuery(run) }"
                                    >
                                        <b>{{ run.waiting?.toolName }}</b>
                                        <span class="aprow-timer"><ExpiryCountdown :until="run.waiting!.expiresAt" /></span>
                                        <span class="sub">run {{ shortId(run.id) }}{{ run.concurrencyKey ? ` · ${run.concurrencyKey}` : '' }}</span>
                                    </RouterLink>
                                </li>
                            </ul>
                            <p
                                v-else
                                class="panel-empty"
                            >
                                Nothing waiting for a person.
                            </p>
                        </section>
                        <section class="card panel">
                            <div class="panel-head">
                                <h3>Channels</h3>
                                <span>{{ chips.length }}</span>
                            </div>
                            <ul class="rows tlist">
                                <li
                                    v-for="chip in chips"
                                    :key="`${chip.channel}:${chip.id}`"
                                >
                                    <div class="tlist-top">
                                        <ChannelChip :chip="chip" />
                                        <code v-if="chip.id !== chip.channel && chip.id !== `${chip.channel}:${chip.detail}`">{{ chip.id }}</code>
                                    </div>
                                    <div
                                        v-if="scheduleOf(chip)"
                                        class="endpoint"
                                    >
                                        <em>next</em>
                                        <code><ExpiryCountdown
                                            :until="scheduleOf(chip)!.nextAt"
                                            :soon-ms="0"
                                        /> · {{ formatFireTime(scheduleOf(chip)!.nextAt, scheduleOf(chip)!.timezone) }}</code>
                                    </div>
                                    <div
                                        v-else-if="chip.hook"
                                        class="endpoint"
                                    >
                                        <em>hook</em><code>POST {{ chip.hook }}</code>
                                    </div>
                                    <div
                                        v-else-if="chip.channel === 'http'"
                                        class="endpoint"
                                    >
                                        <em>route</em><code>POST {{ config.apiBase }}/agents/{{ agent.name }}/runs</code>
                                    </div>
                                </li>
                            </ul>
                        </section>
                    </div>
                </div>
            </template>
        </div>

        <StartRunModal
            v-model:open="startOpen"
            :agent="agent.name"
            :invoker="invoker"
            :start="detail.start"
            @started="onStarted"
        />
    </template>
</template>

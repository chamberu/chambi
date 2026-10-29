---
layout: page
pageClass: ch-home
title: chamvi
titleTemplate: Self-hosted, channel-driven AI agents

hero:
    eyebrow: Self-hosted agents
    title: Agents that keep the keys.
    highlight: keep the keys
    lead: You write the agent with the AI SDK. chamvi queues its runs, checkpoints every step, pauses for approvals and resumes interrupted runs, in your own Node process and database.
    file: agents/triage.ts
    approval: close(#412) waits for the owner, across restarts
    actions:
        -   text: Get started
            link: /getting-started/
        -   text: Run lifecycle
            link: /guide/run-lifecycle
            theme: alt

features:
    eyebrow: What the AI SDK leaves out
    title: The layer between a model call and an agent you can trust.
    items:
        -   title: One contract for every channel
            body: A webhook, a cron tick, a GitHub delivery or a manual call becomes the same envelope and the same queued run, and tools answer through the same channels. Idempotency keys turn redeliveries into the existing run; concurrency keys keep two runs for one issue apart.
            detail: dispatch({ idempotencyKey })
        -   title: Runs survive restarts
            body: A checkpoint after every step. drain() hands unfinished runs back, and recover() continues them from the latest checkpoint on any replica, without applying a recorded effect twice.
            detail: drain() → recover()
        -   title: Ask before acting
            body: A tool that needs a human awaits approve() and the run pauses in waiting. Approve or deny it an hour or a day later, from any replica; the call then runs again with the decision.
            detail: await approve(ctx, { title })

flow:
    eyebrow: How a run flows
    title: Seven statuses, one store.
    lead: Every run lives in your store, from dispatch to its final status. Whatever stops it halfway, the next execution starts from the latest checkpoint.
    statuses: [queued, running, waiting, interrupted, completed, failed, cancelled]
    active: running
    link:
        text: Run lifecycle
        link: /guide/run-lifecycle

packages:
    eyebrow: Packages
    title: Small today, planned in the open.
    lead: The engine, the cron, HTTP, GitHub and OpenClaw channels, the MCP API, the dashboard, the TypeORM store, sandboxes, the app and CLI and the test helpers ship now. The rest is designed milestone by milestone.
    shipped:
        -   name: '@chamvi/core'
            body: Agents, the channel contract, the run engine, checkpoints, budgets, effect tools, durable approvals, agent hooks, agent state and the in-memory store.
            link: /reference/
        -   name: '@chamvi/test-kit'
            body: ControllableClock and the store contract suite every storage backend must pass.
            link: /reference/test-kit
        -   name: '@chamvi/channel-cron'
            body: The cron channel. Fires cron.on() subscriptions once per tick across replicas, with overlap policies, timezones and one-shot jobs.
            link: /reference/channel-cron
        -   name: '@chamvi/store-typeorm'
            body: TypeORM store (PostgreSQL) for durable runs across replicas, passing the store contract suite.
            link: /stores/typeorm
        -   name: '@chamvi/http'
            body: REST, server-sent events, an MCP endpoint, the webhook channel and the /channels mount, with bearer, authup and OIDC authentication.
            link: /guide/http
        -   name: '@chamvi/app + @chamvi/cli'
            body: One createApp() default export booted from env, and the chamvi bin with dev, build, start, run-job and migrate.
            link: /guide/app
        -   name: '@chamvi/ui'
            body: A dashboard with an agents overview, runs started from the agent page, live steps, an approvals inbox, agent state and schedules, served by uiRoutes().
            link: /guide/ui
        -   name: '@chamvi/github'
            body: GitHub App auth, the GitHub channel (deliveries in, issue comments out) and issue tools with reconciliation.
            link: /reference/github
        -   name: '@chamvi/sandbox-*'
            body: Disposable workspaces, local for development, a container or a pod per workspace in production, plus coding tools.
            link: /guide/workspaces
        -   name: '@chamvi/channel-openclaw'
            body: The OpenClaw channel. Messages and approval requests into an OpenClaw chat, once per key.
            link: /reference/channel-openclaw
    planned:
        -   name: 'deploy kit'
            milestone: M1
            body: A base image, a Helm chart and a template repository around the app and the CLI.
    link:
        text: Roadmap
        link: /roadmap

cta:
    title: Start with one agent.
    lead: Define an agent, dispatch a run and watch it settle. In-memory stores need no database, so the quick start runs in a single file.
    command: npm install @chamvi/core ai zod
    actions:
        -   text: Quick start
            link: /getting-started/quick-start
        -   text: GitHub
            link: https://github.com/chamvi/chamvi
            theme: alt
---

<script setup>
import CHome from './.vitepress/components/home/CHome.vue';
</script>

<CHome>
<template #code>

<<< @/snippets/hero.ts#agent

</template>
</CHome>

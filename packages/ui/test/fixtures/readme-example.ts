import { Engine, createMemoryStores } from '@chamvi/core';
import { createHttpApp, staticTokens } from '@chamvi/http';
import { uiRoutes } from '@chamvi/ui';

const engine = new Engine({
    stores: createMemoryStores(),
    agents: [],
});

const admin = {
    value: process.env.ADMIN_TOKEN ?? 'admin-token-0123456789',
    id: 'admin',
    permissions: ['*'],
};

export const app = createHttpApp({
    engine,
    auth: [staticTokens({ tokens: [admin] })],
    // the dashboard at /ui: runs, approvals, agent state and schedules
    routes: uiRoutes(),
});

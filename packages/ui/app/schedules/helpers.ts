/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { ScheduleWire } from '../api/types.ts';

export type ScheduleGroup = { agent: string; schedules: ScheduleWire[] };

/** By agent name, each agent's triggers by their next fire time. */
export function groupByAgent(schedules: readonly ScheduleWire[]): ScheduleGroup[] {
    const groups = new Map<string, ScheduleWire[]>();

    for (const schedule of schedules) {
        groups.set(schedule.agent, [...groups.get(schedule.agent) ?? [], schedule]);
    }

    return Array.from(groups)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([agent, list]) => ({ agent, schedules: list.sort((a, b) => Date.parse(a.nextAt) - Date.parse(b.nextAt)) }));
}

/** `Thu 22 Oct, 08:00` in the trigger's time zone (the browser's without one). */
export function formatFireTime(iso: string, timezone?: string): string {
    return new Intl.DateTimeFormat(undefined, {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        timeZoneName: 'short',
        ...(timezone ? { timeZone: timezone } : {}),
    }).format(new Date(iso));
}

const WEEKDAYS = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];

const pad = (value: number) => String(value).padStart(2, '0');

function fieldNumber(field: string, max: number): number | undefined {
    if (!/^\d{1,2}$/.test(field)) {
        return undefined;
    }

    const value = Number(field);

    return value <= max ? value : undefined;
}

function dayPart(dow: string): string | undefined {
    if (dow === '*') {
        return 'daily';
    }

    if (dow === '1-5' || dow === 'MON-FRI' || dow === 'mon-fri') {
        return 'weekdays';
    }

    if (dow === '0,6' || dow === '6,0' || dow === 'SAT,SUN' || dow === 'sat,sun') {
        return 'weekends';
    }

    const day = fieldNumber(dow, 7);

    return day === undefined ? undefined : WEEKDAYS[day % 7];
}

/**
 * A short reading of the common five-field shapes (`0 8 * * 1-5` ->
 * `weekdays 08:00`, `*\/15 * * * *` -> `every 15 min`, `0 * * * *` ->
 * `hourly`), else `undefined` (the expression alone is shown).
 */
export function describeCron(expression: string): string | undefined {
    const fields = expression.trim().split(/\s+/);

    if (fields.length !== 5) {
        return undefined;
    }

    const [minute, hour, dom, month, dow] = fields as [string, string, string, string, string];

    if (dom !== '*' || month !== '*') {
        return undefined;
    }

    const step = /^\*\/(\d{1,2})$/.exec(minute);

    if (step && hour === '*' && dow === '*') {
        return Number(step[1]) === 1 ? 'every minute' : `every ${Number(step[1])} min`;
    }

    if (minute === '*' && hour === '*' && dow === '*') {
        return 'every minute';
    }

    const m = fieldNumber(minute, 59);

    if (m === undefined) {
        return undefined;
    }

    if (hour === '*') {
        if (dow !== '*') {
            return undefined;
        }

        return m === 0 ? 'hourly' : `hourly at :${pad(m)}`;
    }

    const h = fieldNumber(hour, 23);
    const days = dayPart(dow);

    if (h === undefined || !days) {
        return undefined;
    }

    return `${days} ${pad(h)}:${pad(m)}`;
}

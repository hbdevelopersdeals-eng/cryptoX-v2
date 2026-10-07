import React, { useMemo, useState } from 'react';
import { AlertTriangle, CalendarClock, Clock, Download, Plus, Trash2 } from 'lucide-react';
import { Card } from './ui.jsx';
import { useI18n } from '../lib/i18n.jsx';
import { loadSecurity } from '../lib/securityStore.js';
import { lsGet, lsSet } from '../lib/storage.js';
import {
  ZONE_LIST, UTC, isValidZone, resolveZone, resolveWallTime, toStorage, fromUTC,
  offsetLabel, offsetMinutes, isDST, expandRecurrence, planReminder,
  dstDriftForRecurrence, buildICS, googleCalendarUrl, formatRelative, zoneConsistency
} from '../lib/time.js';

/* Recurring events, scheduled reminders and calendar export.
 *
 * The three time zones that coexist are all visible here, because the bug they
 * prevent is invisible: a reminder stored against the wrong zone fires an hour
 * early, and nothing in the UI would say so.
 *   event zone  → the zone the reminder was created in
 *   org zone    → the organization's working zone
 *   user zone   → the browser's zone
 * resolveZone applies them in that order, and this panel shows which won.
 */

const REMINDER_KEY = 'cx_reminders';
const FREQUENCIES = ['none', 'daily', 'weekly', 'monthly'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const loadReminders = () => {
  const list = lsGet(REMINDER_KEY, []);
  return Array.isArray(list) ? list : [];
};

export default function SchedulerPanel() {
  const { t, lang, timeZone } = useI18n();
  const org = useMemo(() => {
    const state = loadSecurity();
    return state.organizations.find((o) => o.id === state.activeOrgId) || state.organizations[0] || null;
  }, []);

  const [reminders, setReminders] = useState(loadReminders);
  const [title, setTitle] = useState('Price alert review');
  const [date, setDate] = useState('2026-10-07');
  const [time, setTime] = useState('09:00');
  const [eventZone, setEventZone] = useState('');
  const [frequency, setFrequency] = useState('daily');
  const [interval, setInterval] = useState(1);
  const [weekdays, setWeekdays] = useState([1, 3]);
  const [leadMinutes, setLeadMinutes] = useState(15);
  const [note, setNote] = useState(null);

  const detected = timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;

  /* Which zone actually applies, and why. */
  const zone = resolveZone({
    eventZone: eventZone || null,
    organizationZone: org?.timezone || null,
    userZone: detected
  });

  const wall = useMemo(() => {
    const [y, m, d] = String(date).split('-').map(Number);
    const [hh, mm] = String(time).split(':').map(Number);
    if (![y, m, d, hh, mm].every(Number.isFinite)) return null;
    return { year: y, month: m, day: d, hour: hh, minute: mm };
  }, [date, time]);

  const plan = useMemo(
    () => (wall && isValidZone(zone.zone) ? planReminder({ wall, zone: zone.zone, leadMinutes }) : null),
    [wall, zone.zone, leadMinutes]
  );

  /* The occurrence list, and whether a naive "+24h" schedule would drift. */
  const occurrences = useMemo(() => {
    if (!plan?.ok || frequency === 'none') return plan?.instant ? [plan.instant] : [];
    return expandRecurrence({
      start: plan.instant,
      rule: { frequency, interval, weekdays },
      count: 4
    });
  }, [plan, frequency, interval, weekdays]);

  const drift = useMemo(() => {
    if (frequency === 'none' || !wall) return null;
    return dstDriftForRecurrence({ zone: zone.zone, wall, occurrences: 4 });
  }, [frequency, zone.zone, wall]);

  const consistency = useMemo(
    () => zoneConsistency({ claimed: zone.zone, actual: detected }),
    [zone.zone, detected]
  );

  const save = () => {
    if (!plan?.ok) {
      setNote({ kind: 'bad', text: `That local time ${plan?.reason === 'nonexistent' ? 'never happens — the clock jumps past it' : plan?.reason === 'ambiguous' ? 'happens twice — the clocks went back' : 'is not valid'}. Pick another.` });
      return;
    }
    const next = [...reminders, {
      id: `rem_${Date.now()}`,
      title,
      zone: zone.zone,
      zoneSource: zone.source,
      wall,
      recurrence: frequency === 'none' ? null : { frequency, interval, weekdays },
      leadMinutes,
      eventUtc: toStorage(plan.instant),
      reminderUtc: plan.reminderUtc,
      createdAt: new Date().toISOString()
    }];
    setReminders(next);
    lsSet(REMINDER_KEY, next);
    setNote({ kind: 'good', text: 'Reminder saved. It fires while this tab is open — there is no server-side scheduler in this build.' });
  };

  const remove = (id) => {
    const next = reminders.filter((r) => r.id !== id);
    setReminders(next);
    lsSet(REMINDER_KEY, next);
  };

  const downloadIcs = (items) => {
    const ics = buildICS({
      calendarName: 'CryptoX reminders',
      events: items.map((r) => {
        const start = new Date(r.eventUtc);
        return {
          uid: r.id,
          start,
          end: new Date(start.getTime() + 30 * 60000),
          summary: r.title,
          description: `Original zone: ${r.zone}${r.recurrence ? ` · repeats ${r.recurrence.frequency}` : ''}`,
          zone: r.zone
        };
      })
    });
    const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'cryptox-reminders.ics';
    a.click();
    URL.revokeObjectURL(url);
  };

  const toggleWeekday = (d) => {
    setWeekdays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort()));
  };

  return (
    <Card className="space-y-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <CalendarClock size={15} className="text-primary" /> Recurring events &amp; reminders
        <span className="text-xs font-normal text-muted-foreground">stored in UTC</span>
      </h2>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="space-y-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            aria-label="Reminder title"
            className="input-dark !h-9 w-full !text-[12px]"
          />
          <div className="grid grid-cols-2 gap-2">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Date" className="input-dark !h-9 w-full !text-[12px]" />
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} aria-label="Time" className="input-dark !h-9 w-full !text-[12px]" />
          </div>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">Event time zone</span>
            <select value={eventZone} onChange={(e) => setEventZone(e.target.value)} aria-label="Event time zone" className="input-dark !h-9 w-full !text-[12px]">
              <option value="">Inherit ({org?.timezone ? 'organization' : 'user'} zone)</option>
              {[...new Set([detected, org?.timezone, ...ZONE_LIST].filter(Boolean))].map((z) => (
                <option key={z} value={z}>{z}</option>
              ))}
            </select>
          </label>

          <div className="rounded-lg border border-border bg-muted/30 p-3 text-[11px]">
            <p className="font-medium">Zone precedence</p>
            <div className="mt-1 space-y-0.5">
              <p className="flex justify-between"><span className="text-muted-foreground">Event</span><span className="font-mono">{eventZone || '—'}</span></p>
              <p className="flex justify-between"><span className="text-muted-foreground">Organization</span><span className="font-mono">{org?.timezone || '—'}</span></p>
              <p className="flex justify-between"><span className="text-muted-foreground">User</span><span className="font-mono">{detected}</span></p>
              <p className="flex justify-between border-t border-border pt-1">
                <span className="text-muted-foreground">Applied</span>
                <span className="font-mono">{zone.zone} <span className="text-muted-foreground">({zone.source})</span></span>
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-2">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted-foreground">Repeats</span>
              <select value={frequency} onChange={(e) => setFrequency(e.target.value)} aria-label="Repeats" className="input-dark !h-9 !w-28 !text-[12px]">
                {FREQUENCIES.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted-foreground">Every</span>
              <input
                type="number"
                min={1}
                value={interval}
                onChange={(e) => setInterval(Math.max(1, Number(e.target.value) || 1))}
                aria-label="Interval"
                className="input-dark !h-9 !w-20 !text-[12px]"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted-foreground">Lead (min)</span>
              <input
                type="number"
                min={0}
                value={leadMinutes}
                onChange={(e) => setLeadMinutes(Math.max(0, Number(e.target.value) || 0))}
                aria-label="Lead minutes"
                className="input-dark !h-9 !w-24 !text-[12px]"
              />
            </label>
          </div>

          {frequency === 'weekly' ? (
            <div className="flex flex-wrap gap-1">
              {WEEKDAYS.map((d, i) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => toggleWeekday(i)}
                  aria-pressed={weekdays.includes(i)}
                  className={`rounded-md px-2 py-0.5 text-[10px] ${weekdays.includes(i) ? 'bg-primary text-primary-foreground' : 'border border-border text-muted-foreground'}`}
                >
                  {d}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className="space-y-2">
          <div className="rounded-lg border border-border p-3">
            <p className="text-[11px] font-medium">Next occurrences</p>
            {plan?.ok && occurrences.length ? (
              <div className="mt-1 space-y-1">
                {occurrences.map((o, i) => (
                  <p key={o.toISOString()} data-testid="occurrence" className="flex flex-wrap items-baseline justify-between gap-2 text-[10px]">
                    <span className="font-mono">{i === 0 ? 'event' : `+${i}`} {toStorage(o)}</span>
                    <span className="text-muted-foreground">{fromUTC(o, zone.zone, { timeStyle: 'short' })} {zone.zone.split('/').pop()}</span>
                  </p>
                ))}
              </div>
            ) : (
              <p className="mt-1 text-[11px] text-muted-foreground">
                {plan?.reason === 'nonexistent' ? 'That local time never happens — the clocks jump past it.'
                  : plan?.reason === 'ambiguous' ? 'That local time happens twice — the clocks went back.'
                    : 'Set a valid date and time.'}
              </p>
            )}
            {plan?.ok ? (
              <p className="mt-2 text-[10px] text-muted-foreground">
                Reminder fires {leadMinutes} min before, at <span className="font-mono">{plan.reminderUtc}</span>
              </p>
            ) : null}
          </div>

          {drift?.ok && drift.drifts ? (
            <p className="flex items-start gap-1.5 rounded-lg border border-amber-400/30 bg-amber-400/10 p-2.5 text-[11px] text-amber-300">
              <AlertTriangle size={12} className="mt-0.5 shrink-0" />
              A naive &ldquo;+24 hours&rdquo; schedule drifts by {drift.driftMinutes.find((d) => d !== 0)} minutes across the next DST change.
              This reminder is anchored to the local wall time instead, so it keeps firing at {time}.
            </p>
          ) : null}

          {!consistency.consistent ? (
            <p className="flex items-start gap-1.5 rounded-lg border border-border p-2.5 text-[11px] text-muted-foreground">
              <Clock size={12} className="mt-0.5 shrink-0" />
              Browser zone ({detected}, {offsetLabel(offsetMinutes(detected, new Date()))}) differs from the applied zone
              ({zone.zone}, {offsetLabel(offsetMinutes(zone.zone, new Date()))}).
              {consistency.offsetMatches ? ' Same offset today, different zone — they diverge at a DST change.' : ''}
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={save} className="btn-primary !h-8 !px-3 !text-[11px]">
              <Plus size={12} className="mr-1.5" /> Save reminder
            </button>
            {plan?.instant ? (
              <a
                href={googleCalendarUrl({
                  start: plan.instant,
                  end: new Date(plan.instant.getTime() + 1800000),
                  summary: title,
                  description: `Zone ${zone.zone}`
                })}
                target="_blank"
                rel="noreferrer"
                className="btn-ghost !h-8 !px-3 !text-[11px]"
              >
                Add to Google Calendar
              </a>
            ) : null}
          </div>
        </div>
      </div>

      {note ? (
        <p className={`text-[11px] ${note.kind === 'bad' ? 'text-down' : 'text-emerald-400'}`}>{note.text}</p>
      ) : null}

      {reminders.length ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-medium">{reminders.length} saved reminder(s)</p>
            <button type="button" onClick={() => downloadIcs(reminders)} className="btn-ghost !h-7 !px-2.5 !text-[10px]">
              <Download size={11} className="mr-1" /> Export all as .ics
            </button>
          </div>
          <div className="divide-y divide-border/60 rounded-lg border border-border">
            {reminders.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-[11px]">
                <span className="font-medium">{r.title}</span>
                <span className="font-mono text-muted-foreground">{r.eventUtc.slice(0, 16).replace('T', ' ')}Z</span>
                <span className="text-muted-foreground">{r.zone} ({r.zoneSource})</span>
                {r.recurrence ? <span className="text-muted-foreground">· {r.recurrence.frequency}/{r.recurrence.interval}</span> : null}
                <span className="ml-auto text-[10px] text-muted-foreground">saved {formatRelative(r.createdAt, { lang })}</span>
                <button type="button" onClick={() => remove(r.id)} aria-label={`Delete ${r.title}`} className="text-muted-foreground hover:text-down">
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground">
            The .ics uses the original zone for each event, so a calendar client lands on the same instant regardless of where it is opened.
          </p>
        </div>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          No reminders yet. Occurrences and the UTC instant are computed locally — nothing is scheduled on a server, and the reminder
          only fires while this tab is open.
        </p>
      )}
    </Card>
  );
}

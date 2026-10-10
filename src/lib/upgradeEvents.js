/* The upgrade funnel's event sink.
 *
 * Its own module on purpose. It started inside the Pricing page, and the header
 * button then imported it FROM a page — which pulled the entire pricing page
 * into the initial bundle and pushed the entry chunk over its budget. A shared
 * leaf module is the correct home: components and pages can both import it
 * without either dragging the other into the critical path.
 *
 * Events are validated against the registry in analytics.js before being
 * buffered, so an unknown name or a missing required property is refused here
 * rather than polluting a pipeline downstream.
 *
 * TRANSPORT IS NOT CONFIGURED. There is no analytics endpoint in this build, so
 * events are held in memory and can be read with `bufferedEvents()`. That is
 * deliberate and stated rather than pretending a backend is receiving them;
 * wiring a collector is a one-line change here when one exists.
 */

import { validateEvent } from './analytics.js';
import { UPGRADE_EVENTS, createEventDeduper } from './upgrade.js';

const buffer = [];
const dedupe = createEventDeduper();

/** Record an upgrade-funnel event once. Returns false if refused or a repeat. */
export function trackUpgradeEvent(eventName, properties = {}) {
  const key = `${eventName}:${JSON.stringify(properties)}`;
  if (!dedupe.shouldEmit(key)) return false;
  const res = validateEvent({ name: eventName, properties });
  const ok = res.ok ?? res.valid ?? (Array.isArray(res.errors) && res.errors.length === 0);
  if (!ok) return false;
  buffer.push({ name: eventName, properties, at: new Date().toISOString() });
  return true;
}

export const bufferedEvents = () => [...buffer];
export const resetBufferedEvents = () => { buffer.length = 0; dedupe.reset(); };
export const UPGRADE_EVENT_NAMES = UPGRADE_EVENTS;

/* Localized transactional and notification copy.
 *
 * SCOPE — what this does and does not do.
 * It renders localized subject/body pairs from the same catalogs the UI uses,
 * with plural and gender resolved. It does NOT send anything: email needs an
 * SMTP or API key, SMS and messaging need paid gateways, and none of those can
 * live in a public bundle. Delivery status is reported per channel so the UI
 * can say "copy is ready, delivery is not configured" instead of implying mail
 * has been sent.
 */

import { translate } from './translate.js';

/** Each template names the catalog keys it renders. */
export const TEMPLATES = {
  welcome: {
    id: 'welcome',
    label: 'Welcome',
    subjectKey: 'notify.digestSubject',
    bodyKey: 'gender.welcome',
    kind: 'email'
  },
  digest: {
    id: 'digest',
    label: 'Market digest',
    subjectKey: 'notify.digestSubject',
    bodyKey: 'notify.digestBody',
    kind: 'email'
  },
  alert: {
    id: 'alert',
    label: 'Alert triggered',
    subjectKey: 'notify.alertTriggered',
    bodyKey: 'notify.priceAbove',
    kind: 'push'
  }
};

export const TEMPLATE_LIST = Object.values(TEMPLATES);

/**
 * How each channel can actually be used today.
 * `live`         — works in the browser with no secret
 * `needs-setup`  — code path exists, but a server-side key must be configured
 * `unavailable`  — needs a paid provider and sender registration
 */
export const DELIVERY_CHANNELS = [
  { id: 'inapp', label: 'In-app / browser push', status: 'live', note: 'Rendered locally and delivered through the Notification API.' },
  { id: 'email', label: 'Email', status: 'needs-setup', note: 'Copy is generated and ready; sending needs an SMTP or provider API key on a server.' },
  { id: 'webhook', label: 'Webhook', status: 'needs-setup', note: 'Payload is built locally; delivery needs a server to avoid exposing the endpoint secret.' },
  { id: 'telegram', label: 'Telegram', status: 'needs-setup', note: 'Bot token and chat id must be stored server-side.' },
  { id: 'discord', label: 'Discord', status: 'needs-setup', note: 'Webhook URL must be stored server-side.' },
  { id: 'sms', label: 'SMS', status: 'unavailable', note: 'Requires a paid gateway and registered sender ID.' },
  { id: 'whatsapp', label: 'WhatsApp', status: 'unavailable', note: 'Requires a paid Business API account and approved templates.' }
];

export const channelStatus = (id) => DELIVERY_CHANNELS.find((c) => c.id === id)?.status || 'unavailable';

/**
 * Render a template in a language.
 * @returns { subject, body, text, channel, lang, placeholders }
 *   `placeholders` lists any {token} left unresolved, so a caller can see at a
 *   glance that a variable was not supplied rather than shipping "Hello {name}".
 */
export function renderTemplate({ template, lang = 'en', tables = {}, vars = {} } = {}) {
  const tpl = typeof template === 'string' ? TEMPLATES[template] : template;
  if (!tpl) return null;

  const subject = translate(tables, lang, tpl.subjectKey, vars);
  const body = translate(tables, lang, tpl.bodyKey, vars);
  const text = `${subject}\n\n${body}`;
  const unresolved = [...new Set((text.match(/\{\w+\}/g) || []))];

  return {
    id: tpl.id,
    kind: tpl.kind,
    lang,
    channel: channelStatus(tpl.kind === 'push' ? 'inapp' : 'email'),
    subject,
    body,
    text,
    placeholders: unresolved
  };
}

/** Render every template for a language in one pass. */
export function renderAll(lang, tables, vars = {}) {
  return TEMPLATE_LIST.map((tpl) => renderTemplate({ template: tpl, lang, tables, vars }));
}

/**
 * A webhook payload shaped like the one a server would forward. Built here so
 * the contract is explicit and testable; POSTing it is the server's job.
 */
export function webhookPayload({ event, lang, tables, vars }) {
  const rendered = renderTemplate({ template: event, lang, tables, vars });
  if (!rendered) return null;
  return {
    event: rendered.id,
    lang,
    occurredAt: new Date().toISOString(),
    title: rendered.subject,
    body: rendered.body
  };
}

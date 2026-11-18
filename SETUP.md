# Setup Checklist

This project is delivered in stages so beginners can see the site before cloud setup.

## 1. Local Preview

- Build locally with `node scripts/site.js build --cwd <project>`.
- Start preview with `node scripts/site.js preview:start --cwd <project> --mode vite`.
- Keep the preview running until a public URL is verified.

## 2. Supabase Activation

Use this only when the site needs real products, inventory, orders, auth, or user-owned data.

The agent first checks product authorization:

```bash
accio-mcp-cli server supabase
```

If Supabase is not connected, open Accio, go to the Accio Site Builder plugin, connect Supabase, and finish authorization. If connected, the Agent should run `accio-mcp-cli search supabase` to query tool usage, then use Supabase MCP tools such as `get_project_url`, `get_publishable_keys`, `list_tables`, `list_migrations`, `apply_migration`, `execute_sql`, `generate_typescript_types`, `deploy_edge_function`, `get_logs`, and `get_advisors`.

Never paste a service-role credential, database passwords, connection strings, or account access tokens in chat. secret-scan:allow this line names the prohibition; it carries no credential.

## 2.1 Edge Function Secrets (payment integration)

CryptoX takes no card details itself. Lemon Squeezy hosts the checkout; two
Supabase Edge Functions are the only code that talks to it, and both read their
credentials from Edge Function secrets — never from the client bundle.

Set these in Supabase → Project `bvyiqinyakxlefaeomoj` → **Project Settings →
Edge Functions → Secrets**. Enter values directly in the dashboard; never paste
a secret value into chat, a file, or source control.

| Secret | Where it comes from | Required |
|---|---|---|
| `LEMONSQUEEZY_API_KEY` | Lemon Squeezy → Settings → API (a key named `cryptox-server`) | yes — without it the checkout function returns `503 not-configured` |
| `LEMONSQUEEZY_WEBHOOK_SECRET` | The signing secret you set on the webhook in Lemon Squeezy → Settings → Webhooks (max 40 chars) | yes — without it the webhook refuses every delivery with `500 not-configured` |
| `CHECKOUT_REDIRECT_URL` | Where a buyer returns after paying. **Must include the hash**, because the app uses a hash router: `https://cryptox-v2.site.accio.ai/#/upgrade/success` | recommended — without it Lemon Squeezy uses its own thank-you page |

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and the service-role key are all injected by Supabase automatically. secret-scan:allow this line names the credential only to explain the split, and carries no value.

The webhook function needs that key because `cx_subscriptions` grants clients
`SELECT` only: entitlement can be read by its owner and written by nobody but
the webhook.

Deployed functions and their auth model:

| Function | `verify_jwt` | Why |
|---|---|---|
| `lemonsqueezy-checkout` | `true` | Called by a signed-in browser; the user id is taken from the token, never from the request body |
| `lemonsqueezy-webhook` | `false` | Lemon Squeezy cannot present a Supabase JWT; the HMAC signature over the raw body is the authentication, and a delivery without a valid one is rejected `401` |

Both fail closed. With a required secret missing, the webhook refuses every
event and the checkout returns no URL. Redeploy after changing function code:

```bash
node scripts/deploy-edge-function.mjs lemonsqueezy-webhook false
accio-mcp-cli call deploy_edge_function --json-file "$env:TEMP/cx_deploy_lemonsqueezy-webhook.json"
```

`scripts/probe-edge-functions.mjs` checks fail-closed behaviour from outside,
without needing any credential.

## 2.2 Quota Migrations (0007, 0008)

Apply in order. 0008 depends on the helpers `0007_entitlements.sql` creates.

```bash
# Supabase SQL editor, or: supabase db push
#   0007_entitlements.sql            alerts, bots, API calls; cx_plan_limits; cx_consume_quota
#   0008_quotas_portfolios_seats.sql portfolios + seats; cx_organizations; cx_org_members
```

After 0008 is applied, flip `portfolios` and `seats` to `server: true` in
`src/lib/entitlements.js` and redeploy. Until then the pricing page correctly says
those two are "blocked by migration 0008 as soon as it is applied" — a client
cannot verify a migration from the browser, and claiming otherwise is the false
claim the disclosure exists to prevent. The page text shrinks by itself once the
flags flip, because it is derived from `ENFORCEMENT`.

Verify from the SQL editor:

```sql
select plan_id, key, limit_value from public.cx_plan_limits order by 1, 2;
select public.cx_consume_quota('portfolios', 1);   -- as an authenticated user
```

## 2.3 AI Assistant (optional)

The assistant works without this: with no key it answers from the deterministic
router (`src/lib/analyst.js`) and says so. To enable model answers, set **one** of
these as an Edge Function secret and deploy the function:

```bash
# Supabase -> Edge Functions -> Secrets
#   ANTHROPIC_API_KEY | OPENAI_API_KEY | GOOGLE_API_KEY   (first one found wins)
```

Deploy with `verify_jwt = true`, exactly like the Lemon Squeezy functions. The key
never reaches the browser: the client sends `{ message, context }` and the system
prompt is built server-side. Responses that look like investment advice are
refused by the handler, not by a prompt instruction alone.

## 2.4 Build Environment (required for a real deployment)

`npm run check` now fails a build without `VITE_SUPABASE_URL` and
`VITE_SUPABASE_PUBLISHABLE_KEY`, because such a build runs in demo auth mode and a
completed purchase would have no account to attach to:

```bash
node scripts/check-deploy-env.mjs            # report only
node scripts/check-deploy-env.mjs --strict   # what `npm run check` runs
```

Set both values in the site-builder build settings (not only in a local
`.env.local`), then rebuild and confirm the login footer no longer says
"Demo build".

## 3. Commerce Requests

> **Superseded for this site.** The note below is the Site Builder plugin's
> default position: it does not generate payment flows. CryptoX is the
> deliberate exception — checkout was requested explicitly and implemented as
> server-side Edge Functions with webhook-verified entitlement, per §2.1.
> Everything below still applies to any other commerce-shaped site.

This plugin does not generate online payment, cart, checkout, or payment placeholder flows. For commerce-shaped sites, use product/service display, inquiry forms, booking requests, or off-site contact links.

## 4. Site Publish

Two equivalent ways to get a public URL:

- The user clicks the product UI publish button.
- When host builtin `web_builder_publish` is visible/available, the agent asks for explicit consent, then publishes and reports the public URL.

Keep the local preview running until the public URL is verified.

Company-domain subdomains from site publish are supported. Binding a user's own domain is not supported yet. If asked to bind their own domain, do not guide DNS/CNAME setup; say that feature is in development and coming later.

## Completion

Final handoff should include either a public URL, a still-running local preview URL, or a blocker plus the exact next action. Format a local preview URL according to `skills/react-local-runtime/SKILL.md` so its link text matches the user's current conversation language and has no preceding label.

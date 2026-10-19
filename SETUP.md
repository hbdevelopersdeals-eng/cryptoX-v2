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

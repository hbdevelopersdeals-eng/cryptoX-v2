# CryptoX Commercial Release — Blocker Closure Runbook

Last checked: 2026-11-18 (Supabase release-gate run #26)
Project: `bvyiqinyakxlefaeomoj`

## Release status

The database structural/security gates pass (130/130 public tables and 20/20 private tables have RLS; zero unindexed application foreign keys; no client-callable public SECURITY DEFINER functions; all four required cron jobs active). Commercial release remains **BLOCKED**: 15 blocker gates fail. Do not bypass, suppress, or manually mark these gates as passed.

## Blockers and closure evidence

| Gate | Closure work | Required proof / owner |
|---|---|---|
| `auth_leaked_password_protection` | Enable leaked-password protection in Supabase Auth password/security settings. | Dashboard setting visibly enabled; re-run release gate. Project owner |
| `licensed_live_market_source` | Select a market-data provider, execute/accept the applicable commercial data licence, configure credentials in Supabase Vault, and obtain approval for the intended display/redistribution use. | Executed licence + provider credential health check + approved source record. Project owner/legal |
| `mfa_protected_platform_admin` | Enrol a platform admin in Supabase Auth TOTP MFA, verify the factor, then obtain an AAL2 session and ensure the active platform-admin role maps to that account. | Verified Auth MFA factor and AAL2 session; re-run gate. Admin |
| `live_billing_api_and_webhook_credentials` | Configure Lemon Squeezy live API key and webhook signing secret in the managed secret vault; configure production store/product/variant mapping and webhook URL. | Successful live-mode checkout/webhook verification; never use test credentials as production proof. Billing owner |
| `top_200_asset_registry` | Import the current provider-sourced top 200 asset metadata only after confirming source terms; deduplicate canonical slugs/symbols and review asset identity/risk before activation. | 200 active canonical assets with source provenance; no fabricated ranks or symbols. Data owner |
| `live_market_snapshots_and_history` | Enable only the approved licensed source, run ingestion and verify fresh snapshots plus 30 days of valid OHLCV history. | Non-zero recent snapshots and 30-day candles with source, timestamp, quality and delay provenance. Data owner |
| `evidence_backup_restore` | Perform a backup restore into an isolated target and verify schema, row counts, access controls and application smoke tests. | Restore log, timestamps, checksums/row-count comparison, reviewer sign-off. DBA + independent reviewer |
| `evidence_disaster_recovery` | Execute the DR plan against a separate recovery target; measure RTO/RPO and validate failover/rollback. | Exercise report, actual RTO/RPO, recovery validation and independent reviewer sign-off. Operations |
| `evidence_security_penetration_test` | Commission an authorized independent penetration test covering web/API, Auth, RLS, Edge Functions, storage, billing and abuse controls. | Dated report, scope, findings, remediation retest and independent acceptance. Security |
| `evidence_load_stress_test` | Run staged load, spike, soak and rate-limit tests against a production-like environment. | Test plan, workload profile, latency/error/resource results, thresholds and reviewer sign-off. QA/SRE |
| `evidence_slo_monitoring` | Define service-level indicators/objectives and configure alerting/dashboards for API availability, latency, ingestion freshness, worker success and billing webhook delivery. | Live dashboards, alert routing test, SLO window and owner/on-call policy. SRE |
| `evidence_legal_signoff` | Complete jurisdiction-specific legal review of product claims, subscriptions, disclaimers, privacy terms, user-generated content and financial/crypto regulatory obligations. | Signed legal approval from qualified counsel. Legal |
| `evidence_data_license_agreement` | Obtain and review the actual market/news/on-chain/FX data licences for commercial display, caching, derived data, attribution and redistribution. | Executed agreements and approved source-by-source rights matrix. Legal/data owner |
| `evidence_privacy_impact_assessment` | Complete a data-flow inventory, lawful-basis/purpose review, retention/deletion assessment, processor/vendor review, cross-border transfer analysis and risk mitigations. | Completed PIA/DPIA reviewed by privacy owner/counsel. Privacy |
| `evidence_incident_response_drill` | Run a tabletop and operational drill for account compromise, data exposure, provider outage and payment webhook compromise. | Timeline, participants, decisions, notification/escalation checks, lessons learned and independent sign-off. Security/Operations |

## Non-blocking but still required before a polished commercial launch

- Configure an OpenAI credential only if AI features are to be enabled; validate spend limits and retention settings.
- Configure Resend and a verified sender domain before enabling transactional email.
- Capture accessibility/cross-browser and user-acceptance evidence (currently warning-level gates).
- Review Supabase plan/backup/retention and compute capacity against the production SLO and restore requirements.

## Safe execution order

1. Project owner completes Auth leaked-password protection and admin MFA.
2. Legal/data owner selects and approves licensed providers; project owner adds provider credentials to Vault.
3. Data owner imports/validates the top-200 registry and starts licensed ingestion; verify history accumulates over 30 days.
4. Billing owner configures live Lemon Squeezy credentials and completes controlled live-mode verification.
5. Operations/security/QA execute restore, DR, pentest, load, SLO and incident-response exercises.
6. Legal/privacy owners sign off legal, data-license and PIA evidence.
7. Re-run `public.cx_worker_run_commercial_release_gates()`; only ship when all blocker gates pass and independent evidence is verified.

## Evidence integrity rules

- Never create synthetic market prices/candles or backdate data to satisfy freshness/history gates.
- Never mark an unexecuted licence, test, restore, drill or legal review as verified.
- Keep provider secrets in Supabase Vault/managed secrets; never commit or paste them into source control.
- Use least-privilege credentials and test in a non-production environment where possible.

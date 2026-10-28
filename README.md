# Pulso Campanhas 2.0 — Hotmart-first

This is the standalone, deployable **Pulso v2** dashboard and Supabase backend sources.

## Live backend status (25 Oct 2026)

- Supabase project: `nlrhtioxsbncpluchfcz`, São Paulo. It is not the charutaria project.
- Initial schema and two secure ingestion functions **deployed**.
- Webhook endpoint **deployed**: `https://nlrhtioxsbncpluchfcz.supabase.co/functions/v1/hotmart-webhook` (POST; Hotmart Webhook 2.0).
- User-initiated source registration endpoint **deployed**: `https://nlrhtioxsbncpluchfcz.supabase.co/functions/v1/hotmart-connect` (POST; authenticated user bearer token).
- Database test **passed**: purchase approved, duplicate rejected, refund, terminal status cannot regress, one notification, buyer email not persisted; transaction rolled back.
- No actual Hotmart account has been connected yet. No sales, integrations, or tracking data were added.

## Dashboard

The `dashboard/index.html` file is a standalone static authenticated dashboard built using Supabase JS. It displays *real records only* and supports:
- Email/password signup and login (email confirmation may be required).
- Creating an isolated workspace for the agency.
- Currency filtering and different time windows.
- Approved gross revenue, refunds, unattributed purchases, order history, tracking diagnostics.
- Securely registering your Hotmart account by typing the Hottok into the app, not ChatGPT.
- Checking pending vs connected Hotmart status.
- Explicit "not connected" indicators for Meta/Google, ROAS and profit.

The dashboard is **not** published over the original `pulso-campanhas.fersthome.chatgpt.site` address; that site is a different prototype and may still show demo data. Host the contents of `dashboard/` on a static HTTPS site to use this version. Use the existing Supabase publishable (public) key in this file; never include service/secret keys in the browser.

## Connecting Hotmart

1. Open the published v2 dashboard on HTTPS, sign up/sign in and create workspace.
2. Open **Integrações**, enter your Hotmart **Hottok** into the password field and save. The backend stores its SHA-256 digest, not plaintext.
3. In Hotmart's **Webhook**, add the webhook URL above, select **Webhook 2.0.0** with purchase-approved, complete, refunded, chargeback, cancelled, expired/delayed events.
4. Use the Hotmart Webhook settings' test action to POST a real test notification. Status becomes connected only after the first valid event. Hotmart sample notifications may have placeholder data; never treat a test as production revenue until verified.
5. Reconcile actual sales via API after OAuth credentials are available.

## SQL and security

`supabase/migrations/20261025_pulso_core.sql` is the initial migration; `20261025_hotmart_connection_status.sql` updates integration status logic. Schema-creating operations were applied to the backend in several live migration calls. Existing private tables from the earlier project have RLS warnings in the schema inspection: access to private schema was revoked from anon/authenticated; formal RLS policy review and testing is still advisable before broader production rollout.

Use server-side keys only in Supabase Edge Functions. The public frontend uses Supabase Auth session access tokens for `hotmart-connect`. No Facebook passwords are used.

## Remaining work

- Deploy the v2 dashboard to HTTPS and verify browser login/connection end-to-end.
- Configure Hotmart Hottok through the app and send a real Hotmart test event.
- Implement Hotmart API history reconciliation, tracking script + checkout propagation, exchange-rate ledger, Meta OAuth, Google Ads, app push and daily closing.
-- OBSERVED schema-only baseline, 2026-10-28. NOT a production migration.

-- Use only to bootstrap a new isolated database with Supabase auth.users and roles.

-- Never run beside legacy migrations; never insert old history rows automatically.

do $$ begin if to_regclass('public.workspaces') is not null then raise exception 'Baseline requires an empty isolated schema'; end if; end $$;

create schema if not exists extensions;

create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;

set search_path = public, private, extensions, pg_temp;

revoke all on schema private from public, anon, authenticated, service_role;

grant usage on schema public to anon, authenticated, service_role;

create table "public"."conversion_destinations" (
  "id" uuid default gen_random_uuid() not null,
  "workspace_id" uuid not null,
  "integration_id" uuid not null,
  "provider" text not null,
  "destination_id" text not null,
  "label" text not null,
  "is_active" boolean default false not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

create table "private"."visitor_match_context" (
  "id" uuid default gen_random_uuid() not null,
  "workspace_id" uuid not null,
  "tracking_session_id" uuid not null,
  "marketing_allowed" boolean default false not null,
  "legal_basis_record" text,
  "consent_captured_at" timestamp with time zone,
  "consent_policy_version" text,
  "fbp" text,
  "fbc" text,
  "client_ip" inet,
  "client_user_agent" text,
  "captured_at" timestamp with time zone default now() not null,
  "expires_at" timestamp with time zone default (now() + '30 days'::interval) not null
);

create table "private"."conversion_event_outbox" (
  "id" uuid default gen_random_uuid() not null,
  "workspace_id" uuid not null,
  "destination_ref" uuid not null,
  "sale_id" uuid not null,
  "provider" text not null,
  "event_name" text not null,
  "event_id" text not null,
  "event_time" timestamp with time zone not null,
  "event_source_url" text,
  "product_id" text,
  "value" numeric not null,
  "currency" text not null,
  "fbp" text,
  "fbc" text,
  "client_ip" inet,
  "client_user_agent" text,
  "marketing_allowed" boolean default true not null,
  "consent_basis" text not null,
  "consent_captured_at" timestamp with time zone not null,
  "status" text default 'pending'::text not null,
  "attempt_count" integer default 0 not null,
  "next_attempt_at" timestamp with time zone default now() not null,
  "last_error_code" text,
  "provider_response_id" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "email_sha256" text,
  "phone_sha256" text,
  "first_name_sha256" text,
  "last_name_sha256" text,
  "city_sha256" text,
  "state_sha256" text,
  "postcode_sha256" text,
  "country_sha256" text,
  "external_id_sha256" text
);

create table "private"."integration_credentials" (
  "integration_id" uuid not null,
  "access_token" text,
  "refresh_token" text,
  "token_type" text,
  "expires_at" timestamp with time zone,
  "provider_payload" jsonb default '{}'::jsonb not null,
  "updated_at" timestamp with time zone default now() not null
);

create table "private"."webhook_events" (
  "id" uuid default gen_random_uuid() not null,
  "provider" text not null,
  "external_event_id" text,
  "event_type" text,
  "payload" jsonb not null,
  "received_at" timestamp with time zone default now() not null,
  "processed_at" timestamp with time zone,
  "processing_error" text
);

create table "public"."sales" (
  "id" uuid default gen_random_uuid() not null,
  "workspace_id" uuid not null,
  "provider" text default 'hotmart'::text not null,
  "external_transaction_id" text not null,
  "product_id" text,
  "product_name" text,
  "buyer_country" text,
  "currency" text,
  "gross_amount" numeric(14,2) default 0 not null,
  "net_amount" numeric(14,2) default 0 not null,
  "status" text,
  "purchased_at" timestamp with time zone,
  "utm_source" text,
  "utm_medium" text,
  "utm_campaign" text,
  "utm_content" text,
  "src" text,
  "raw" jsonb default '{}'::jsonb not null,
  "created_at" timestamp with time zone default now() not null,
  "sck" text,
  "xcod" text,
  "last_event_at" timestamp with time zone,
  "net_amount_verified" boolean default false not null,
  "settlement_currency" text,
  "order_bump_parent" text,
  "payment_type" text
);

create table "private"."hotmart_sources" (
  "id" uuid default gen_random_uuid() not null,
  "workspace_id" uuid not null,
  "label" text default 'Hotmart'::text not null,
  "hottok_sha256" text not null,
  "active" boolean default true not null,
  "last_event_at" timestamp with time zone,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

create table "public"."order_events" (
  "id" uuid default gen_random_uuid() not null,
  "workspace_id" uuid not null,
  "provider" text default 'hotmart'::text not null,
  "external_event_id" text not null,
  "transaction_id" text not null,
  "event_type" text not null,
  "status" text,
  "occurred_at" timestamp with time zone not null,
  "accepted_for_state" boolean default false not null,
  "created_at" timestamp with time zone default now() not null
);

create table "public"."tracking_sessions" (
  "id" uuid default gen_random_uuid() not null,
  "workspace_id" uuid not null,
  "public_session_id" uuid not null,
  "landing_page" text,
  "utm_source" text,
  "utm_medium" text,
  "utm_campaign" text,
  "utm_content" text,
  "utm_term" text,
  "fbclid" text,
  "gclid" text,
  "src" text,
  "first_seen_at" timestamp with time zone default now() not null,
  "last_seen_at" timestamp with time zone default now() not null,
  "tblci" text,
  "gbraid" text,
  "wbraid" text
);

create table "public"."workspace_members" (
  "workspace_id" uuid not null,
  "user_id" uuid not null,
  "role" text not null,
  "created_at" timestamp with time zone default now() not null
);

create table "public"."daily_ad_metrics" (
  "workspace_id" uuid not null,
  "ad_account_id" uuid not null,
  "campaign_id" uuid not null,
  "metric_date" date not null,
  "spend" numeric(14,2) default 0 not null,
  "impressions" bigint default 0 not null,
  "clicks" bigint default 0 not null,
  "conversions" numeric(14,4) default 0 not null,
  "conversion_value" numeric(14,2) default 0 not null,
  "raw" jsonb default '{}'::jsonb not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

create table "public"."funnel_events" (
  "id" uuid default gen_random_uuid() not null,
  "workspace_id" uuid not null,
  "tracking_session_id" uuid,
  "event_name" text not null,
  "page_url" text,
  "occurred_at" timestamp with time zone default now() not null,
  "metadata" jsonb default '{}'::jsonb not null
);

create table "public"."attributions" (
  "id" uuid default gen_random_uuid() not null,
  "workspace_id" uuid not null,
  "sale_id" uuid not null,
  "tracking_session_id" uuid,
  "campaign_id" uuid,
  "method" text not null,
  "confidence" text not null,
  "evidence" jsonb default '{}'::jsonb not null,
  "created_at" timestamp with time zone default now() not null
);

create table "public"."financial_ledger" (
  "id" uuid default gen_random_uuid() not null,
  "workspace_id" uuid not null,
  "sale_id" uuid,
  "source" text not null,
  "external_id" text,
  "entry_type" text not null,
  "amount" numeric(14,2) not null,
  "currency" text not null,
  "occurred_at" timestamp with time zone not null,
  "verified" boolean default false not null,
  "created_at" timestamp with time zone default now() not null
);

create table "public"."tracking_health" (
  "id" uuid default gen_random_uuid() not null,
  "workspace_id" uuid not null,
  "severity" text not null,
  "code" text not null,
  "description" text not null,
  "evidence" jsonb default '{}'::jsonb not null,
  "detected_at" timestamp with time zone default now() not null,
  "resolved_at" timestamp with time zone
);

create table "public"."profiles" (
  "id" uuid not null,
  "full_name" text,
  "avatar_url" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

create table "public"."notifications" (
  "id" uuid default gen_random_uuid() not null,
  "workspace_id" uuid not null,
  "user_id" uuid,
  "type" text not null,
  "title" text not null,
  "body" text,
  "data" jsonb default '{}'::jsonb not null,
  "read_at" timestamp with time zone,
  "created_at" timestamp with time zone default now() not null
);

create table "public"."workspaces" (
  "id" uuid default gen_random_uuid() not null,
  "name" text not null,
  "slug" text,
  "owner_id" uuid not null,
  "timezone" text default 'America/Sao_Paulo'::text not null,
  "currency" text default 'BRL'::text not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

create table "public"."integrations" (
  "id" uuid default gen_random_uuid() not null,
  "workspace_id" uuid not null,
  "provider" text not null,
  "status" text default 'pending'::text not null,
  "provider_user_id" text,
  "provider_user_name" text,
  "scopes" text[] default '{}'::text[] not null,
  "connected_by" uuid,
  "connected_at" timestamp with time zone,
  "last_sync_at" timestamp with time zone,
  "error_message" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

create table "public"."ad_accounts" (
  "id" uuid default gen_random_uuid() not null,
  "integration_id" uuid not null,
  "workspace_id" uuid not null,
  "provider" text not null,
  "external_account_id" text not null,
  "name" text not null,
  "currency" text,
  "timezone_name" text,
  "business_name" text,
  "is_active" boolean default true not null,
  "selected" boolean default false not null,
  "metadata" jsonb default '{}'::jsonb not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

create table "public"."campaigns" (
  "id" uuid default gen_random_uuid() not null,
  "workspace_id" uuid not null,
  "ad_account_id" uuid not null,
  "provider" text not null,
  "external_campaign_id" text not null,
  "name" text not null,
  "status" text,
  "objective" text,
  "metadata" jsonb default '{}'::jsonb not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

alter table "public"."tracking_sessions" add constraint "tracking_sessions_workspace_id_public_session_id_key" UNIQUE (workspace_id, public_session_id);

alter table "public"."funnel_events" add constraint "funnel_events_event_name_check" CHECK ((event_name = ANY (ARRAY['page_view'::text, 'view_content'::text, 'checkout_click'::text, 'checkout_started'::text, 'purchase_return'::text, 'custom'::text])));

alter table "public"."funnel_events" add constraint "funnel_events_pkey" PRIMARY KEY (id);

alter table "private"."conversion_event_outbox" add constraint "delivery_one_event" UNIQUE (workspace_id, destination_ref, event_name, event_id);

alter table "public"."conversion_destinations" add constraint "conversion_destinations_tenant_provider_key" UNIQUE (workspace_id, id, provider);

alter table "public"."profiles" add constraint "profiles_pkey" PRIMARY KEY (id);

alter table "public"."workspaces" add constraint "workspaces_pkey" PRIMARY KEY (id);

alter table "public"."workspaces" add constraint "workspaces_slug_key" UNIQUE (slug);

alter table "public"."workspace_members" add constraint "workspace_members_role_check" CHECK ((role = ANY (ARRAY['owner'::text, 'admin'::text, 'analyst'::text, 'viewer'::text])));

alter table "public"."workspace_members" add constraint "workspace_members_pkey" PRIMARY KEY (workspace_id, user_id);

alter table "public"."integrations" add constraint "integrations_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'connected'::text, 'expired'::text, 'error'::text, 'revoked'::text])));

alter table "public"."integrations" add constraint "integrations_pkey" PRIMARY KEY (id);

alter table "private"."integration_credentials" add constraint "integration_credentials_pkey" PRIMARY KEY (integration_id);

alter table "public"."conversion_destinations" add constraint "conversion_destination_unique" UNIQUE (workspace_id, provider, destination_id);

alter table "public"."conversion_destinations" add constraint "conversion_destination_tenant_key" UNIQUE (workspace_id, id);

alter table "public"."ad_accounts" add constraint "ad_accounts_pkey" PRIMARY KEY (id);

alter table "public"."ad_accounts" add constraint "ad_accounts_provider_external_account_id_workspace_id_key" UNIQUE (provider, external_account_id, workspace_id);

alter table "public"."campaigns" add constraint "campaigns_pkey" PRIMARY KEY (id);

alter table "public"."campaigns" add constraint "campaigns_provider_external_campaign_id_workspace_id_key" UNIQUE (provider, external_campaign_id, workspace_id);

alter table "public"."daily_ad_metrics" add constraint "daily_ad_metrics_pkey" PRIMARY KEY (workspace_id, ad_account_id, campaign_id, metric_date);

alter table "public"."sales" add constraint "sales_pkey" PRIMARY KEY (id);

alter table "public"."sales" add constraint "sales_provider_external_transaction_id_workspace_id_key" UNIQUE (provider, external_transaction_id, workspace_id);

alter table "public"."notifications" add constraint "notifications_pkey" PRIMARY KEY (id);

alter table "private"."webhook_events" add constraint "webhook_events_pkey" PRIMARY KEY (id);

alter table "private"."hotmart_sources" add constraint "hotmart_sources_pkey" PRIMARY KEY (id);

alter table "private"."hotmart_sources" add constraint "hotmart_sources_hottok_sha256_key" UNIQUE (hottok_sha256);

alter table "public"."order_events" add constraint "order_events_provider_check" CHECK ((provider = 'hotmart'::text));

alter table "public"."order_events" add constraint "order_events_pkey" PRIMARY KEY (id);

alter table "public"."order_events" add constraint "order_events_workspace_id_provider_external_event_id_key" UNIQUE (workspace_id, provider, external_event_id);

alter table "public"."tracking_sessions" add constraint "tracking_sessions_pkey" PRIMARY KEY (id);

alter table "public"."attributions" add constraint "attributions_method_check" CHECK ((method = ANY (ARRAY['click_id'::text, 'session_id'::text, 'utm_match'::text, 'manual'::text, 'unknown'::text])));

alter table "public"."attributions" add constraint "attributions_confidence_check" CHECK ((confidence = ANY (ARRAY['high'::text, 'medium'::text, 'low'::text, 'none'::text])));

alter table "public"."attributions" add constraint "attributions_pkey" PRIMARY KEY (id);

alter table "public"."attributions" add constraint "attributions_sale_id_key" UNIQUE (sale_id);

alter table "public"."tracking_health" add constraint "tracking_health_severity_check" CHECK ((severity = ANY (ARRAY['info'::text, 'warning'::text, 'error'::text])));

alter table "public"."tracking_health" add constraint "tracking_health_pkey" PRIMARY KEY (id);

alter table "public"."financial_ledger" add constraint "financial_ledger_entry_type_check" CHECK ((entry_type = ANY (ARRAY['sale'::text, 'refund'::text, 'chargeback'::text, 'fee'::text, 'commission'::text, 'adjustment'::text, 'ad_spend'::text])));

alter table "public"."financial_ledger" add constraint "financial_ledger_pkey" PRIMARY KEY (id);

alter table "public"."financial_ledger" add constraint "financial_ledger_workspace_id_source_external_id_entry_type_key" UNIQUE (workspace_id, source, external_id, entry_type);

alter table "public"."integrations" add constraint "integrations_provider_check" CHECK ((provider = ANY (ARRAY['hotmart'::text, 'meta'::text, 'google_ads'::text, 'taboola'::text])));

alter table "public"."ad_accounts" add constraint "ad_accounts_provider_check" CHECK ((provider = ANY (ARRAY['meta'::text, 'google_ads'::text, 'taboola'::text])));

alter table "public"."campaigns" add constraint "campaigns_provider_check" CHECK ((provider = ANY (ARRAY['meta'::text, 'google_ads'::text, 'taboola'::text])));

alter table "public"."integrations" add constraint "integrations_tenant_provider_key" UNIQUE (workspace_id, id, provider);

alter table "public"."ad_accounts" add constraint "ad_accounts_tenant_provider_key" UNIQUE (workspace_id, id, provider);

alter table "public"."ad_accounts" add constraint "ad_accounts_tenant_key" UNIQUE (workspace_id, id);

alter table "public"."campaigns" add constraint "campaigns_tenant_key" UNIQUE (workspace_id, id);

alter table "public"."sales" add constraint "sales_tenant_key" UNIQUE (workspace_id, id);

alter table "public"."tracking_sessions" add constraint "tracking_sessions_tenant_key" UNIQUE (workspace_id, id);

alter table "public"."conversion_destinations" add constraint "conversion_destinations_provider_check" CHECK ((provider = ANY (ARRAY['meta'::text, 'google_ads'::text, 'taboola'::text])));

alter table "public"."conversion_destinations" add constraint "conversion_destinations_pkey" PRIMARY KEY (id);

alter table "private"."visitor_match_context" add constraint "visitor_context_consent_integrity" CHECK (((marketing_allowed AND (consent_captured_at IS NOT NULL) AND (legal_basis_record IS NOT NULL)) OR ((NOT marketing_allowed) AND (fbp IS NULL) AND (fbc IS NULL) AND (client_ip IS NULL) AND (client_user_agent IS NULL))));

alter table "private"."visitor_match_context" add constraint "visitor_context_retention" CHECK ((expires_at > captured_at));

alter table "private"."visitor_match_context" add constraint "visitor_match_context_pkey" PRIMARY KEY (id);

alter table "private"."visitor_match_context" add constraint "visitor_context_one_per_session" UNIQUE (workspace_id, tracking_session_id);

alter table "private"."conversion_event_outbox" add constraint "conversion_event_outbox_provider_check" CHECK ((provider = ANY (ARRAY['meta'::text, 'google_ads'::text, 'taboola'::text])));

alter table "private"."conversion_event_outbox" add constraint "conversion_event_outbox_value_check" CHECK ((value >= (0)::numeric));

alter table "private"."conversion_event_outbox" add constraint "conversion_event_outbox_currency_check" CHECK ((currency ~ '^[A-Z]{3}$'::text));

alter table "private"."conversion_event_outbox" add constraint "conversion_event_outbox_marketing_allowed_check" CHECK (marketing_allowed);

alter table "private"."conversion_event_outbox" add constraint "conversion_event_outbox_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'sending'::text, 'delivered'::text, 'failed'::text])));

alter table "private"."conversion_event_outbox" add constraint "conversion_event_outbox_attempt_count_check" CHECK ((attempt_count >= 0));

alter table "private"."conversion_event_outbox" add constraint "conversion_event_outbox_pkey" PRIMARY KEY (id);

alter table "private"."conversion_event_outbox" add constraint "conversion_event_outbox_email_sha256_check" CHECK ((email_sha256 ~ '^[0-9a-f]{64}$'::text));

alter table "private"."conversion_event_outbox" add constraint "conversion_event_outbox_phone_sha256_check" CHECK ((phone_sha256 ~ '^[0-9a-f]{64}$'::text));

alter table "private"."conversion_event_outbox" add constraint "conversion_event_outbox_first_name_sha256_check" CHECK ((first_name_sha256 ~ '^[0-9a-f]{64}$'::text));

alter table "private"."conversion_event_outbox" add constraint "conversion_event_outbox_last_name_sha256_check" CHECK ((last_name_sha256 ~ '^[0-9a-f]{64}$'::text));

alter table "private"."conversion_event_outbox" add constraint "conversion_event_outbox_city_sha256_check" CHECK ((city_sha256 ~ '^[0-9a-f]{64}$'::text));

alter table "private"."conversion_event_outbox" add constraint "conversion_event_outbox_state_sha256_check" CHECK ((state_sha256 ~ '^[0-9a-f]{64}$'::text));

alter table "private"."conversion_event_outbox" add constraint "conversion_event_outbox_postcode_sha256_check" CHECK ((postcode_sha256 ~ '^[0-9a-f]{64}$'::text));

alter table "private"."conversion_event_outbox" add constraint "conversion_event_outbox_country_sha256_check" CHECK ((country_sha256 ~ '^[0-9a-f]{64}$'::text));

alter table "private"."conversion_event_outbox" add constraint "conversion_event_outbox_external_id_sha256_check" CHECK ((external_id_sha256 ~ '^[0-9a-f]{64}$'::text));

alter table "public"."tracking_sessions" add constraint "tracking_sessions_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

alter table "public"."funnel_events" add constraint "funnel_events_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

alter table "public"."funnel_events" add constraint "funnel_events_tracking_session_id_fkey" FOREIGN KEY (tracking_session_id) REFERENCES tracking_sessions(id) ON DELETE SET NULL;

alter table "private"."conversion_event_outbox" add constraint "conversion_event_outbox_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id);

alter table "public"."profiles" add constraint "profiles_id_fkey" FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;

alter table "public"."workspaces" add constraint "workspaces_owner_id_fkey" FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;

alter table "public"."workspace_members" add constraint "workspace_members_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

alter table "public"."workspace_members" add constraint "workspace_members_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

alter table "public"."integrations" add constraint "integrations_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

alter table "public"."integrations" add constraint "integrations_connected_by_fkey" FOREIGN KEY (connected_by) REFERENCES auth.users(id) ON DELETE SET NULL;

alter table "private"."integration_credentials" add constraint "integration_credentials_integration_id_fkey" FOREIGN KEY (integration_id) REFERENCES integrations(id) ON DELETE CASCADE;

alter table "public"."conversion_destinations" add constraint "conversion_destinations_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id);

alter table "public"."conversion_destinations" add constraint "conversion_destination_same_tenant" FOREIGN KEY (workspace_id, integration_id, provider) REFERENCES integrations(workspace_id, id, provider);

alter table "private"."conversion_event_outbox" add constraint "delivery_same_destination" FOREIGN KEY (workspace_id, destination_ref) REFERENCES conversion_destinations(workspace_id, id);

alter table "private"."conversion_event_outbox" add constraint "delivery_same_sale" FOREIGN KEY (workspace_id, sale_id) REFERENCES sales(workspace_id, id);

alter table "public"."ad_accounts" add constraint "ad_accounts_integration_id_fkey" FOREIGN KEY (integration_id) REFERENCES integrations(id) ON DELETE CASCADE;

alter table "public"."ad_accounts" add constraint "ad_accounts_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

alter table "public"."campaigns" add constraint "campaigns_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

alter table "public"."campaigns" add constraint "campaigns_ad_account_id_fkey" FOREIGN KEY (ad_account_id) REFERENCES ad_accounts(id) ON DELETE CASCADE;

alter table "public"."daily_ad_metrics" add constraint "daily_ad_metrics_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

alter table "public"."daily_ad_metrics" add constraint "daily_ad_metrics_ad_account_id_fkey" FOREIGN KEY (ad_account_id) REFERENCES ad_accounts(id) ON DELETE CASCADE;

alter table "public"."daily_ad_metrics" add constraint "daily_ad_metrics_campaign_id_fkey" FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE;

alter table "public"."sales" add constraint "sales_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

alter table "public"."notifications" add constraint "notifications_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

alter table "public"."notifications" add constraint "notifications_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

alter table "private"."hotmart_sources" add constraint "hotmart_sources_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

alter table "public"."order_events" add constraint "order_events_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

alter table "public"."attributions" add constraint "attributions_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

alter table "public"."attributions" add constraint "attributions_sale_id_fkey" FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE;

alter table "public"."attributions" add constraint "attributions_tracking_session_id_fkey" FOREIGN KEY (tracking_session_id) REFERENCES tracking_sessions(id) ON DELETE SET NULL;

alter table "public"."attributions" add constraint "attributions_campaign_id_fkey" FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE SET NULL;

alter table "public"."tracking_health" add constraint "tracking_health_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

alter table "public"."financial_ledger" add constraint "financial_ledger_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

alter table "public"."financial_ledger" add constraint "financial_ledger_sale_id_fkey" FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE SET NULL;

alter table "public"."ad_accounts" add constraint "ad_accounts_matching_integration" FOREIGN KEY (workspace_id, integration_id, provider) REFERENCES integrations(workspace_id, id, provider);

alter table "public"."campaigns" add constraint "campaigns_matching_account" FOREIGN KEY (workspace_id, ad_account_id, provider) REFERENCES ad_accounts(workspace_id, id, provider);

alter table "public"."daily_ad_metrics" add constraint "daily_metrics_matching_account" FOREIGN KEY (workspace_id, ad_account_id) REFERENCES ad_accounts(workspace_id, id);

alter table "public"."daily_ad_metrics" add constraint "daily_metrics_matching_campaign" FOREIGN KEY (workspace_id, campaign_id) REFERENCES campaigns(workspace_id, id);

alter table "public"."attributions" add constraint "attributions_matching_sale" FOREIGN KEY (workspace_id, sale_id) REFERENCES sales(workspace_id, id);

alter table "public"."attributions" add constraint "attributions_matching_campaign" FOREIGN KEY (workspace_id, campaign_id) REFERENCES campaigns(workspace_id, id);

alter table "public"."attributions" add constraint "attributions_matching_session" FOREIGN KEY (workspace_id, tracking_session_id) REFERENCES tracking_sessions(workspace_id, id);

alter table "public"."financial_ledger" add constraint "financial_ledger_matching_sale" FOREIGN KEY (workspace_id, sale_id) REFERENCES sales(workspace_id, id);

alter table "public"."funnel_events" add constraint "funnel_events_matching_session" FOREIGN KEY (workspace_id, tracking_session_id) REFERENCES tracking_sessions(workspace_id, id);

alter table "private"."visitor_match_context" add constraint "visitor_match_context_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id);

alter table "private"."visitor_match_context" add constraint "visitor_context_same_tenant" FOREIGN KEY (workspace_id, tracking_session_id) REFERENCES tracking_sessions(workspace_id, id);

alter table "private"."conversion_event_outbox" add constraint "conversion_outbox_provider_matches_destination" FOREIGN KEY (workspace_id, destination_ref, provider) REFERENCES conversion_destinations(workspace_id, id, provider);

CREATE INDEX visitor_match_context_expiration_idx ON private.visitor_match_context USING btree (expires_at);

CREATE INDEX conversion_event_outbox_pending_idx ON private.conversion_event_outbox USING btree (next_attempt_at) WHERE (status = ANY (ARRAY['pending'::text, 'failed'::text]));

CREATE UNIQUE INDEX webhook_events_provider_event_idx ON private.webhook_events USING btree (provider, external_event_id) WHERE (external_event_id IS NOT NULL);

CREATE INDEX idx_sales_workspace ON public.sales USING btree (workspace_id);

CREATE INDEX ix_hotmart_sources_workspace ON private.hotmart_sources USING btree (workspace_id);

CREATE INDEX ix_order_events_workspace_created ON public.order_events USING btree (workspace_id, created_at DESC);

CREATE INDEX ix_order_events_transaction ON public.order_events USING btree (workspace_id, transaction_id);

CREATE INDEX ix_tracking_sessions_workspace_date ON public.tracking_sessions USING btree (workspace_id, first_seen_at DESC);

CREATE INDEX tracking_taboola_id_idx ON public.tracking_sessions USING btree (workspace_id, tblci) WHERE (tblci IS NOT NULL);

CREATE INDEX idx_workspace_members_user ON public.workspace_members USING btree (user_id);

CREATE INDEX idx_metrics_ad_account ON public.daily_ad_metrics USING btree (ad_account_id);

CREATE INDEX idx_metrics_campaign ON public.daily_ad_metrics USING btree (campaign_id);

CREATE INDEX ix_funnel_events_date ON public.funnel_events USING btree (workspace_id, occurred_at DESC);

CREATE INDEX ix_funnel_events_session ON public.funnel_events USING btree (tracking_session_id);

CREATE INDEX ix_attributions_workspace ON public.attributions USING btree (workspace_id);

CREATE INDEX ix_financial_ledger_workspace_date ON public.financial_ledger USING btree (workspace_id, occurred_at DESC);

CREATE INDEX ix_tracking_health_workspace ON public.tracking_health USING btree (workspace_id, detected_at DESC);

CREATE INDEX idx_notifications_workspace ON public.notifications USING btree (workspace_id);

CREATE INDEX idx_notifications_user ON public.notifications USING btree (user_id);

CREATE INDEX idx_workspaces_owner ON public.workspaces USING btree (owner_id);

CREATE UNIQUE INDEX integrations_workspace_provider_user_idx ON public.integrations USING btree (workspace_id, provider, COALESCE(provider_user_id, ''::text));

CREATE INDEX idx_integrations_connected_by ON public.integrations USING btree (connected_by);

CREATE INDEX idx_integrations_workspace ON public.integrations USING btree (workspace_id);

CREATE INDEX idx_ad_accounts_integration ON public.ad_accounts USING btree (integration_id);

CREATE INDEX idx_ad_accounts_workspace ON public.ad_accounts USING btree (workspace_id);

CREATE INDEX idx_campaigns_workspace ON public.campaigns USING btree (workspace_id);

CREATE INDEX idx_campaigns_ad_account ON public.campaigns USING btree (ad_account_id);

CREATE OR REPLACE FUNCTION private.add_workspace_owner()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  insert into public.workspace_members(workspace_id, user_id, role)
  values (new.id, new.owner_id, 'owner')
  on conflict do nothing;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
begin
  insert into public.profiles(id, full_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.ingest_hotmart_event(p_hottok text, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'extensions', 'pg_temp'
AS $function$
declare
 v_workspace uuid; v_source uuid; v_event_id text:=p_payload->>'id';
 v_tx text:=p_payload #>> '{data,purchase,transaction}'; v_type text:=p_payload->>'event';
 v_status text;v_event_at timestamptz;v_purchased_at timestamptz;v_product text;
 v_product_id text;v_country text;v_curr text;v_gross numeric;
 v_sid uuid;v_eid uuid;v_prev_status text;v_prev_time timestamptz;
 v_accepted boolean;v_old_final boolean;v_new_final boolean;
 v_origin jsonb:=coalesce(p_payload #> '{data,purchase,origin}','{}'::jsonb);
 v_bump text;v_payment_type text;
begin
 if coalesce(p_hottok,'')='' or v_event_id is null or v_tx is null
   or coalesce(p_payload->>'version','')<>'2.0.0'
   or coalesce(v_type,'') not like 'PURCHASE_%'
 then raise exception 'Invalid Hotmart event'; end if;
 select hs.id,hs.workspace_id into v_source,v_workspace
   from private.hotmart_sources hs where hs.active and hs.hottok_sha256=encode(digest(p_hottok,'sha256'),'hex');
 if v_source is null then raise exception 'Unauthorized Hotmart source'; end if;
 v_status:=upper(coalesce(p_payload #>> '{data,purchase,status}',substring(v_type from 10)));
 v_event_at:=to_timestamp((p_payload->>'creation_date')::numeric/1000);
 if v_event_at is null or v_event_at > now() + interval '1 day' then raise exception 'Invalid event timestamp'; end if;
 v_purchased_at:=coalesce(
   case when (p_payload #>> '{data,purchase,order_date}') ~ '^[0-9]{12,}$'
   then to_timestamp((p_payload #>> '{data,purchase,order_date}')::numeric/1000) end,
   case when (p_payload #>> '{data,purchase,approved_date}') ~ '^[0-9]{12,}$'
   then to_timestamp((p_payload #>> '{data,purchase,approved_date}')::numeric/1000) end,v_event_at);
 v_gross:=coalesce((p_payload #>> '{data,purchase,full_price,value}')::numeric,0);
 v_curr:=upper(coalesce(p_payload #>> '{data,purchase,full_price,currency_value}',''));
 if v_curr !~ '^[A-Z]{3}$' or v_gross<0 then raise exception 'Invalid money amount'; end if;
 v_product:=left(coalesce(p_payload #>> '{data,product,name}','Produto sem nome'),250);
 v_product_id:=coalesce(p_payload #>> '{data,product,ucode}',p_payload #>> '{data,product,id}');
 v_country:=coalesce(p_payload #>> '{data,purchase,checkout_country,iso}',p_payload #>> '{data,buyer,address,country}');
 v_bump:=p_payload #>> '{data,purchase,order_bump,parent_purchase_transaction}';
 v_payment_type:=p_payload #>> '{data,purchase,payment,type}';

 -- Serialize updates for each Hotmart transaction, including parallel different events.
 perform pg_advisory_xact_lock(hashtextextended(v_workspace::text || ':' || v_tx,0));

 insert into public.order_events(workspace_id,provider,external_event_id,transaction_id,event_type,status,occurred_at)
 values(v_workspace,'hotmart',v_event_id,v_tx,v_type,v_status,v_event_at)
 on conflict(workspace_id,provider,external_event_id) do nothing returning id into v_eid;
 if v_eid is null then return jsonb_build_object('ok',true,'duplicate',true); end if;

 select id,status,last_event_at into v_sid,v_prev_status,v_prev_time from public.sales
 where provider='hotmart' and external_transaction_id=v_tx and workspace_id=v_workspace for update;
 v_old_final:=v_prev_status in ('REFUNDED','CHARGEBACK');
 v_new_final:=v_status in ('REFUNDED','CHARGEBACK');
 v_accepted:=v_sid is null or (v_event_at >= coalesce(v_prev_time,'epoch'::timestamptz)
 and (not v_old_final or v_new_final));

 if v_sid is null then
  insert into public.sales(workspace_id,provider,external_transaction_id,product_id,product_name,buyer_country,
    currency,gross_amount,net_amount,net_amount_verified,status,purchased_at,src,sck,xcod,
    order_bump_parent,payment_type,last_event_at)
  values(v_workspace,'hotmart',v_tx,v_product_id,v_product,v_country,v_curr,v_gross,0,false,v_status,
    v_purchased_at,v_origin->>'src',v_origin->>'sck',v_origin->>'xcod',
    v_bump,v_payment_type,v_event_at) returning id into v_sid;
 elsif v_accepted then
  update public.sales set product_name=v_product,product_id=coalesce(v_product_id,product_id),
    buyer_country=coalesce(v_country,buyer_country),gross_amount=v_gross,currency=v_curr,status=v_status,
    purchased_at=coalesce(purchased_at,v_purchased_at),src=coalesce(v_origin->>'src',src),
    sck=coalesce(v_origin->>'sck',sck),xcod=coalesce(v_origin->>'xcod',xcod),
    order_bump_parent=coalesce(v_bump,order_bump_parent),
    payment_type=coalesce(v_payment_type,payment_type),last_event_at=v_event_at where id=v_sid;
 end if;

 update public.order_events set accepted_for_state=v_accepted where id=v_eid;
 update private.hotmart_sources set last_event_at=now() where id=v_source;
 if v_accepted and v_status in ('APPROVED','COMPLETE')
     and coalesce(v_prev_status,'') not in ('APPROVED','COMPLETE') then
  insert into public.notifications(workspace_id,user_id,type,title,body,data)
  values(v_workspace,null,'sale','Venda confirmada',v_product,
    jsonb_build_object('sale_id',v_sid,'amount',v_gross,'currency',v_curr));
 end if;
 return jsonb_build_object('ok',true,'duplicate',false,'accepted',v_accepted,'transaction',v_tx);
end; $function$
;

CREATE OR REPLACE FUNCTION public.register_hotmart_source(p_workspace_id uuid, p_user_id uuid, p_label text, p_hottok text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'extensions', 'pg_temp'
AS $function$
declare sid uuid; iid uuid; display_name text:=left(coalesce(nullif(trim(p_label),''),'Hotmart'),100);
begin
 if length(coalesce(p_hottok,''))<12 then raise exception 'Invalid token';end if;
 if not exists(select 1 from public.workspace_members where workspace_id=p_workspace_id
   and user_id=p_user_id and role in ('owner','admin')) then raise exception 'Workspace access denied';end if;
 insert into private.hotmart_sources(workspace_id,label,hottok_sha256)
 values(p_workspace_id,display_name,encode(digest(p_hottok,'sha256'),'hex'))
 on conflict(hottok_sha256) do update set updated_at=now() returning id into sid;
 if not exists(select 1 from private.hotmart_sources where id=sid and workspace_id=p_workspace_id)
 then raise exception 'Credential is assigned to another workspace';end if;
 select id into iid from public.integrations where workspace_id=p_workspace_id
  and provider='hotmart' and provider_user_id=sid::text for update;
 if iid is null then
  insert into public.integrations(workspace_id,provider,status,provider_user_id,provider_user_name,connected_by)
  values(p_workspace_id,'hotmart','pending',sid::text,display_name,p_user_id);
 else
  update public.integrations set provider_user_name=display_name,
   status=case when status='connected' then 'connected' else 'pending' end,
   updated_at=now() where id=iid;
 end if;
 return sid;
end; $function$
;

CREATE OR REPLACE FUNCTION private.mark_hotmart_connected()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
begin
 update public.integrations set status='connected',last_sync_at=new.last_event_at,
 connected_at=coalesce(connected_at,new.last_event_at),
 error_message=null,updated_at=now()
 where workspace_id=new.workspace_id and provider='hotmart' and provider_user_id=new.id::text;
 return new;
end; $function$
;

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION private.handle_new_user();

CREATE TRIGGER on_workspace_created AFTER INSERT ON public.workspaces FOR EACH ROW EXECUTE FUNCTION private.add_workspace_owner();

CREATE TRIGGER tr_hotmart_connected AFTER UPDATE OF last_event_at ON private.hotmart_sources FOR EACH ROW WHEN ((new.last_event_at IS NOT NULL)) EXECUTE FUNCTION private.mark_hotmart_connected();

alter table "public"."conversion_destinations" enable row level security;

alter table "private"."visitor_match_context" enable row level security;

alter table "private"."conversion_event_outbox" enable row level security;

alter table "private"."integration_credentials" enable row level security;

alter table "private"."webhook_events" enable row level security;

alter table "public"."sales" enable row level security;

alter table "private"."hotmart_sources" enable row level security;

alter table "public"."order_events" enable row level security;

alter table "public"."tracking_sessions" enable row level security;

alter table "public"."workspace_members" enable row level security;

alter table "public"."daily_ad_metrics" enable row level security;

alter table "public"."funnel_events" enable row level security;

alter table "public"."attributions" enable row level security;

alter table "public"."financial_ledger" enable row level security;

alter table "public"."tracking_health" enable row level security;

alter table "public"."profiles" enable row level security;

alter table "public"."notifications" enable row level security;

alter table "public"."workspaces" enable row level security;

alter table "public"."integrations" enable row level security;

alter table "public"."ad_accounts" enable row level security;

alter table "public"."campaigns" enable row level security;

create policy "profiles_self_select" on "public"."profiles" as PERMISSIVE for SELECT to "authenticated" using ((id = ( SELECT auth.uid() AS uid)));

create policy "profiles_self_update" on "public"."profiles" as PERMISSIVE for UPDATE to "authenticated" using ((id = ( SELECT auth.uid() AS uid))) with check ((id = ( SELECT auth.uid() AS uid)));

create policy "workspaces_member_select" on "public"."workspaces" as PERMISSIVE for SELECT to "authenticated" using (((owner_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM workspace_members wm
  WHERE ((wm.workspace_id = workspaces.id) AND (wm.user_id = ( SELECT auth.uid() AS uid)))))));

create policy "workspaces_owner_insert" on "public"."workspaces" as PERMISSIVE for INSERT to "authenticated" with check ((owner_id = ( SELECT auth.uid() AS uid)));

create policy "workspaces_owner_update" on "public"."workspaces" as PERMISSIVE for UPDATE to "authenticated" using ((owner_id = ( SELECT auth.uid() AS uid))) with check ((owner_id = ( SELECT auth.uid() AS uid)));

create policy "workspace_members_self_select" on "public"."workspace_members" as PERMISSIVE for SELECT to "authenticated" using ((user_id = ( SELECT auth.uid() AS uid)));

create policy "integrations_member_select" on "public"."integrations" as PERMISSIVE for SELECT to "authenticated" using ((EXISTS ( SELECT 1
   FROM workspace_members wm
  WHERE ((wm.workspace_id = integrations.workspace_id) AND (wm.user_id = ( SELECT auth.uid() AS uid))))));

create policy "ad_accounts_member_select" on "public"."ad_accounts" as PERMISSIVE for SELECT to "authenticated" using ((EXISTS ( SELECT 1
   FROM workspace_members wm
  WHERE ((wm.workspace_id = ad_accounts.workspace_id) AND (wm.user_id = ( SELECT auth.uid() AS uid))))));

create policy "campaigns_member_select" on "public"."campaigns" as PERMISSIVE for SELECT to "authenticated" using ((EXISTS ( SELECT 1
   FROM workspace_members wm
  WHERE ((wm.workspace_id = campaigns.workspace_id) AND (wm.user_id = ( SELECT auth.uid() AS uid))))));

create policy "daily_metrics_member_select" on "public"."daily_ad_metrics" as PERMISSIVE for SELECT to "authenticated" using ((EXISTS ( SELECT 1
   FROM workspace_members wm
  WHERE ((wm.workspace_id = daily_ad_metrics.workspace_id) AND (wm.user_id = ( SELECT auth.uid() AS uid))))));

create policy "sales_member_select" on "public"."sales" as PERMISSIVE for SELECT to "authenticated" using ((EXISTS ( SELECT 1
   FROM workspace_members wm
  WHERE ((wm.workspace_id = sales.workspace_id) AND (wm.user_id = ( SELECT auth.uid() AS uid))))));

create policy "notifications_self_select" on "public"."notifications" as PERMISSIVE for SELECT to "authenticated" using (((user_id = ( SELECT auth.uid() AS uid)) OR ((user_id IS NULL) AND (EXISTS ( SELECT 1
   FROM workspace_members wm
  WHERE ((wm.workspace_id = notifications.workspace_id) AND (wm.user_id = ( SELECT auth.uid() AS uid))))))));

create policy "notifications_self_update" on "public"."notifications" as PERMISSIVE for UPDATE to "authenticated" using ((user_id = ( SELECT auth.uid() AS uid))) with check ((user_id = ( SELECT auth.uid() AS uid)));

create policy "integrations_admin_insert" on "public"."integrations" as PERMISSIVE for INSERT to "authenticated" with check ((EXISTS ( SELECT 1
   FROM workspace_members wm
  WHERE ((wm.workspace_id = integrations.workspace_id) AND (wm.user_id = ( SELECT auth.uid() AS uid)) AND (wm.role = ANY (ARRAY['owner'::text, 'admin'::text]))))));

create policy "integrations_admin_update" on "public"."integrations" as PERMISSIVE for UPDATE to "authenticated" using ((EXISTS ( SELECT 1
   FROM workspace_members wm
  WHERE ((wm.workspace_id = integrations.workspace_id) AND (wm.user_id = ( SELECT auth.uid() AS uid)) AND (wm.role = ANY (ARRAY['owner'::text, 'admin'::text])))))) with check ((EXISTS ( SELECT 1
   FROM workspace_members wm
  WHERE ((wm.workspace_id = integrations.workspace_id) AND (wm.user_id = ( SELECT auth.uid() AS uid)) AND (wm.role = ANY (ARRAY['owner'::text, 'admin'::text]))))));

create policy "integrations_admin_delete" on "public"."integrations" as PERMISSIVE for DELETE to "authenticated" using ((EXISTS ( SELECT 1
   FROM workspace_members wm
  WHERE ((wm.workspace_id = integrations.workspace_id) AND (wm.user_id = ( SELECT auth.uid() AS uid)) AND (wm.role = ANY (ARRAY['owner'::text, 'admin'::text]))))));

create policy "ad_accounts_admin_insert" on "public"."ad_accounts" as PERMISSIVE for INSERT to "authenticated" with check ((EXISTS ( SELECT 1
   FROM workspace_members wm
  WHERE ((wm.workspace_id = ad_accounts.workspace_id) AND (wm.user_id = ( SELECT auth.uid() AS uid)) AND (wm.role = ANY (ARRAY['owner'::text, 'admin'::text]))))));

create policy "workspace_read" on "public"."attributions" as PERMISSIVE for SELECT to "authenticated" using ((EXISTS ( SELECT 1
   FROM workspace_members wm
  WHERE ((wm.workspace_id = attributions.workspace_id) AND (wm.user_id = ( SELECT auth.uid() AS uid))))));

create policy "ad_accounts_admin_update" on "public"."ad_accounts" as PERMISSIVE for UPDATE to "authenticated" using ((EXISTS ( SELECT 1
   FROM workspace_members wm
  WHERE ((wm.workspace_id = ad_accounts.workspace_id) AND (wm.user_id = ( SELECT auth.uid() AS uid)) AND (wm.role = ANY (ARRAY['owner'::text, 'admin'::text])))))) with check ((EXISTS ( SELECT 1
   FROM workspace_members wm
  WHERE ((wm.workspace_id = ad_accounts.workspace_id) AND (wm.user_id = ( SELECT auth.uid() AS uid)) AND (wm.role = ANY (ARRAY['owner'::text, 'admin'::text]))))));

create policy "ad_accounts_admin_delete" on "public"."ad_accounts" as PERMISSIVE for DELETE to "authenticated" using ((EXISTS ( SELECT 1
   FROM workspace_members wm
  WHERE ((wm.workspace_id = ad_accounts.workspace_id) AND (wm.user_id = ( SELECT auth.uid() AS uid)) AND (wm.role = ANY (ARRAY['owner'::text, 'admin'::text]))))));

create policy "workspace_read" on "public"."order_events" as PERMISSIVE for SELECT to "authenticated" using ((EXISTS ( SELECT 1
   FROM workspace_members wm
  WHERE ((wm.workspace_id = order_events.workspace_id) AND (wm.user_id = ( SELECT auth.uid() AS uid))))));

create policy "workspace_read" on "public"."tracking_sessions" as PERMISSIVE for SELECT to "authenticated" using ((EXISTS ( SELECT 1
   FROM workspace_members wm
  WHERE ((wm.workspace_id = tracking_sessions.workspace_id) AND (wm.user_id = ( SELECT auth.uid() AS uid))))));

create policy "workspace_read" on "public"."funnel_events" as PERMISSIVE for SELECT to "authenticated" using ((EXISTS ( SELECT 1
   FROM workspace_members wm
  WHERE ((wm.workspace_id = funnel_events.workspace_id) AND (wm.user_id = ( SELECT auth.uid() AS uid))))));

create policy "workspace_read" on "public"."tracking_health" as PERMISSIVE for SELECT to "authenticated" using ((EXISTS ( SELECT 1
   FROM workspace_members wm
  WHERE ((wm.workspace_id = tracking_health.workspace_id) AND (wm.user_id = ( SELECT auth.uid() AS uid))))));

create policy "workspace_read" on "public"."financial_ledger" as PERMISSIVE for SELECT to "authenticated" using ((EXISTS ( SELECT 1
   FROM workspace_members wm
  WHERE ((wm.workspace_id = financial_ledger.workspace_id) AND (wm.user_id = ( SELECT auth.uid() AS uid))))));

create policy "conversion_destinations_admin_select" on "public"."conversion_destinations" as PERMISSIVE for SELECT to "authenticated" using ((EXISTS ( SELECT 1
   FROM workspace_members m
  WHERE ((m.workspace_id = conversion_destinations.workspace_id) AND (m.user_id = ( SELECT auth.uid() AS uid)) AND (m.role = ANY (ARRAY['owner'::text, 'admin'::text]))))));

create policy "conversion_destinations_admin_insert" on "public"."conversion_destinations" as PERMISSIVE for INSERT to "authenticated" with check ((EXISTS ( SELECT 1
   FROM workspace_members m
  WHERE ((m.workspace_id = conversion_destinations.workspace_id) AND (m.user_id = ( SELECT auth.uid() AS uid)) AND (m.role = ANY (ARRAY['owner'::text, 'admin'::text]))))));

create policy "conversion_destinations_admin_update" on "public"."conversion_destinations" as PERMISSIVE for UPDATE to "authenticated" using ((EXISTS ( SELECT 1
   FROM workspace_members m
  WHERE ((m.workspace_id = conversion_destinations.workspace_id) AND (m.user_id = ( SELECT auth.uid() AS uid)) AND (m.role = ANY (ARRAY['owner'::text, 'admin'::text])))))) with check ((EXISTS ( SELECT 1
   FROM workspace_members m
  WHERE ((m.workspace_id = conversion_destinations.workspace_id) AND (m.user_id = ( SELECT auth.uid() AS uid)) AND (m.role = ANY (ARRAY['owner'::text, 'admin'::text]))))));

create policy "conversion_destinations_admin_delete" on "public"."conversion_destinations" as PERMISSIVE for DELETE to "authenticated" using ((EXISTS ( SELECT 1
   FROM workspace_members m
  WHERE ((m.workspace_id = conversion_destinations.workspace_id) AND (m.user_id = ( SELECT auth.uid() AS uid)) AND (m.role = ANY (ARRAY['owner'::text, 'admin'::text]))))));

create view "public"."dashboard_hotmart_summary" with (security_invoker=true) as  SELECT workspace_id,
    currency,
    count(*) FILTER (WHERE status = ANY (ARRAY['APPROVED'::text, 'COMPLETE'::text])) AS confirmed_orders,
    COALESCE(sum(gross_amount) FILTER (WHERE status = ANY (ARRAY['APPROVED'::text, 'COMPLETE'::text])), 0::numeric) AS confirmed_gross_revenue,
    count(*) FILTER (WHERE status = ANY (ARRAY['REFUNDED'::text, 'CHARGEBACK'::text])) AS reversed_orders,
    COALESCE(sum(net_amount) FILTER (WHERE (status = ANY (ARRAY['APPROVED'::text, 'COMPLETE'::text])) AND net_amount_verified), 0::numeric) AS verified_net_amount,
    count(*) FILTER (WHERE (status = ANY (ARRAY['APPROVED'::text, 'COMPLETE'::text])) AND net_amount_verified) AS verified_net_orders
   FROM sales
  WHERE provider = 'hotmart'::text
  GROUP BY workspace_id, currency;

revoke all on "public"."conversion_destinations" from public, anon, authenticated, service_role;

grant INSERT,SELECT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN on table "public"."conversion_destinations" to "service_role";

grant INSERT,SELECT,UPDATE,DELETE on table "public"."conversion_destinations" to "authenticated";

revoke all on "private"."visitor_match_context" from public, anon, authenticated, service_role;

revoke all on "private"."conversion_event_outbox" from public, anon, authenticated, service_role;

revoke all on "private"."integration_credentials" from public, anon, authenticated, service_role;

revoke all on "private"."webhook_events" from public, anon, authenticated, service_role;

revoke all on "public"."sales" from public, anon, authenticated, service_role;

grant INSERT,SELECT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN on table "public"."sales" to "service_role";

revoke all on "private"."hotmart_sources" from public, anon, authenticated, service_role;

revoke all on "public"."order_events" from public, anon, authenticated, service_role;

grant INSERT,SELECT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN on table "public"."order_events" to "service_role";

grant SELECT on table "public"."order_events" to "authenticated";

revoke all on "public"."tracking_sessions" from public, anon, authenticated, service_role;

grant INSERT,SELECT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN on table "public"."tracking_sessions" to "service_role";

grant SELECT on table "public"."tracking_sessions" to "authenticated";

revoke all on "public"."workspace_members" from public, anon, authenticated, service_role;

grant INSERT,SELECT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN on table "public"."workspace_members" to "service_role";

grant SELECT on table "public"."workspace_members" to "authenticated";

revoke all on "public"."daily_ad_metrics" from public, anon, authenticated, service_role;

grant INSERT,SELECT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN on table "public"."daily_ad_metrics" to "service_role";

grant SELECT on table "public"."daily_ad_metrics" to "authenticated";

revoke all on "public"."funnel_events" from public, anon, authenticated, service_role;

grant INSERT,SELECT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN on table "public"."funnel_events" to "service_role";

grant SELECT on table "public"."funnel_events" to "authenticated";

revoke all on "public"."attributions" from public, anon, authenticated, service_role;

grant INSERT,SELECT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN on table "public"."attributions" to "service_role";

grant SELECT on table "public"."attributions" to "authenticated";

revoke all on "public"."financial_ledger" from public, anon, authenticated, service_role;

grant INSERT,SELECT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN on table "public"."financial_ledger" to "service_role";

grant SELECT on table "public"."financial_ledger" to "authenticated";

revoke all on "public"."tracking_health" from public, anon, authenticated, service_role;

grant INSERT,SELECT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN on table "public"."tracking_health" to "service_role";

grant SELECT on table "public"."tracking_health" to "authenticated";

revoke all on "public"."profiles" from public, anon, authenticated, service_role;

grant INSERT,SELECT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN on table "public"."profiles" to "service_role";

grant SELECT,UPDATE on table "public"."profiles" to "authenticated";

revoke all on "public"."notifications" from public, anon, authenticated, service_role;

grant INSERT,SELECT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN on table "public"."notifications" to "service_role";

grant SELECT,UPDATE on table "public"."notifications" to "authenticated";

revoke all on "public"."workspaces" from public, anon, authenticated, service_role;

grant INSERT,SELECT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN on table "public"."workspaces" to "service_role";

grant INSERT,SELECT,UPDATE on table "public"."workspaces" to "authenticated";

revoke all on "public"."integrations" from public, anon, authenticated, service_role;

grant INSERT,SELECT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN on table "public"."integrations" to "service_role";

grant INSERT,SELECT,UPDATE,DELETE on table "public"."integrations" to "authenticated";

revoke all on "public"."ad_accounts" from public, anon, authenticated, service_role;

grant INSERT,SELECT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN on table "public"."ad_accounts" to "service_role";

grant INSERT,SELECT,UPDATE,DELETE on table "public"."ad_accounts" to "authenticated";

revoke all on "public"."campaigns" from public, anon, authenticated, service_role;

grant INSERT,SELECT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN on table "public"."campaigns" to "service_role";

grant SELECT on table "public"."campaigns" to "authenticated";

revoke all on "public"."dashboard_hotmart_summary" from public, anon, authenticated, service_role;

grant INSERT,SELECT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN on table "public"."dashboard_hotmart_summary" to "service_role";

grant SELECT on table "public"."dashboard_hotmart_summary" to "authenticated";

revoke all on function "private"."add_workspace_owner"() from public, anon, authenticated, service_role;

revoke all on function "private"."handle_new_user"() from public, anon, authenticated, service_role;

revoke all on function "public"."ingest_hotmart_event"(p_hottok text, p_payload jsonb) from public, anon, authenticated, service_role;

grant EXECUTE on function "public"."ingest_hotmart_event"(p_hottok text, p_payload jsonb) to "service_role";

revoke all on function "public"."register_hotmart_source"(p_workspace_id uuid, p_user_id uuid, p_label text, p_hottok text) from public, anon, authenticated, service_role;

grant EXECUTE on function "public"."register_hotmart_source"(p_workspace_id uuid, p_user_id uuid, p_label text, p_hottok text) to "service_role";

revoke all on function "private"."mark_hotmart_connected"() from public, anon, authenticated, service_role;

grant SELECT ("buyer_country") on "public"."sales" to authenticated;
grant SELECT ("created_at") on "public"."sales" to authenticated;
grant SELECT ("currency") on "public"."sales" to authenticated;
grant SELECT ("external_transaction_id") on "public"."sales" to authenticated;
grant SELECT ("gross_amount") on "public"."sales" to authenticated;
grant SELECT ("id") on "public"."sales" to authenticated;
grant SELECT ("last_event_at") on "public"."sales" to authenticated;
grant SELECT ("net_amount") on "public"."sales" to authenticated;
grant SELECT ("net_amount_verified") on "public"."sales" to authenticated;
grant SELECT ("order_bump_parent") on "public"."sales" to authenticated;
grant SELECT ("payment_type") on "public"."sales" to authenticated;
grant SELECT ("product_id") on "public"."sales" to authenticated;
grant SELECT ("product_name") on "public"."sales" to authenticated;
grant SELECT ("provider") on "public"."sales" to authenticated;
grant SELECT ("purchased_at") on "public"."sales" to authenticated;
grant SELECT ("sck") on "public"."sales" to authenticated;
grant SELECT ("settlement_currency") on "public"."sales" to authenticated;
grant SELECT ("src") on "public"."sales" to authenticated;
grant SELECT ("status") on "public"."sales" to authenticated;
grant SELECT ("utm_campaign") on "public"."sales" to authenticated;
grant SELECT ("utm_content") on "public"."sales" to authenticated;
grant SELECT ("utm_medium") on "public"."sales" to authenticated;
grant SELECT ("utm_source") on "public"."sales" to authenticated;
grant SELECT ("workspace_id") on "public"."sales" to authenticated;
grant SELECT ("xcod") on "public"."sales" to authenticated;
-- Additive P0 CAPI queue/credentials. Apply only after audited baseline, never replay legacy SQL.
-- Ciphertext is AES-256-GCM sealed in Edge with AAD workspace:dataset; master key is not in SQL.
alter table public.conversion_destinations add column if not exists mode text not null default 'test' check (mode in ('test','production'));
alter table public.conversion_destinations add column if not exists connection_status text not null default 'pending';
alter table public.conversion_destinations add column if not exists last_verified_at timestamptz;
alter table public.conversion_destinations add column if not exists last_error_code text;
revoke insert,update,delete on public.conversion_destinations from anon,authenticated;

create table if not exists private.meta_capi_credentials (
 workspace_id uuid not null,
 destination_ref uuid primary key,
 ciphertext text not null,
 key_version integer not null default 1,
 mode text not null default 'test' check(mode in ('test','production')),
 last_verified_at timestamptz not null default now(),
 revoked_at timestamptz,
 updated_at timestamptz not null default now(),
 foreign key(workspace_id,destination_ref) references public.conversion_destinations(workspace_id,id) on delete cascade
);
alter table private.meta_capi_credentials enable row level security;
revoke all on private.meta_capi_credentials from public,anon,authenticated;

alter table private.conversion_event_outbox add column if not exists tracking_session_id uuid;
alter table private.conversion_event_outbox add column if not exists test_mode boolean not null default true;
alter table private.conversion_event_outbox add column if not exists lease_token uuid;
alter table private.conversion_event_outbox add column if not exists lease_expires_at timestamptz;
alter table private.conversion_event_outbox add column if not exists http_status integer;
alter table private.conversion_event_outbox add column if not exists meta_error_code integer;
alter table private.conversion_event_outbox add column if not exists accepted_at timestamptz;
alter table private.conversion_event_outbox add constraint meta_outbox_same_session foreign key(workspace_id,tracking_session_id) references public.tracking_sessions(workspace_id,id);
create index if not exists meta_outbox_due on private.conversion_event_outbox(next_attempt_at) where provider='meta' and status in ('pending','sending');

create table if not exists public.capi_delivery_diagnostics (
 id uuid primary key, workspace_id uuid not null references public.workspaces(id) on delete cascade,
 destination_ref uuid not null, status text not null, attempt_count integer not null,
 last_error_code text, next_attempt_at timestamptz, updated_at timestamptz not null,
 test_mode boolean not null, http_status integer, meta_error_code integer, accepted_at timestamptz,
 foreign key(workspace_id,destination_ref) references public.conversion_destinations(workspace_id,id) on delete cascade
);
alter table public.capi_delivery_diagnostics enable row level security;
revoke all on public.capi_delivery_diagnostics from public,anon,authenticated;
grant select on public.capi_delivery_diagnostics to authenticated;
create policy capi_workspace_read on public.capi_delivery_diagnostics for select to authenticated using
 (exists(select 1 from public.workspace_members wm where wm.workspace_id=capi_delivery_diagnostics.workspace_id and wm.user_id=(select auth.uid())));
create or replace function private.pulso_sync_capi_diagnostics() returns trigger
language plpgsql security definer set search_path=pg_catalog,public,private,pg_temp as $$
begin
 if TG_OP='DELETE' then delete from public.capi_delivery_diagnostics where id=OLD.id; return OLD; end if;
 insert into public.capi_delivery_diagnostics(id,workspace_id,destination_ref,status,attempt_count,last_error_code,next_attempt_at,updated_at,test_mode,http_status,meta_error_code,accepted_at)
 values(NEW.id,NEW.workspace_id,NEW.destination_ref,NEW.status,NEW.attempt_count,NEW.last_error_code,NEW.next_attempt_at,NEW.updated_at,NEW.test_mode,NEW.http_status,NEW.meta_error_code,NEW.accepted_at)
 on conflict(id) do update set status=excluded.status,attempt_count=excluded.attempt_count,last_error_code=excluded.last_error_code,
 next_attempt_at=excluded.next_attempt_at,updated_at=excluded.updated_at,test_mode=excluded.test_mode,http_status=excluded.http_status,meta_error_code=excluded.meta_error_code,accepted_at=excluded.accepted_at;
 return NEW;
end $$;
revoke all on function private.pulso_sync_capi_diagnostics() from public,anon,authenticated;
create trigger pulso_capi_diagnostics after insert or update or delete on private.conversion_event_outbox for each row execute function private.pulso_sync_capi_diagnostics();
-- Populate only non-sensitive queue state from any pre-existing rows.
insert into public.capi_delivery_diagnostics(id,workspace_id,destination_ref,status,attempt_count,last_error_code,next_attempt_at,updated_at,test_mode,http_status,meta_error_code,accepted_at)
 select id,workspace_id,destination_ref,status,attempt_count,last_error_code,next_attempt_at,updated_at,test_mode,http_status,meta_error_code,accepted_at from private.conversion_event_outbox on conflict(id) do nothing;

create or replace function public.pulso_meta_authorize(p_workspace_id uuid,p_user_id uuid) returns boolean
language plpgsql security definer set search_path=pg_catalog,public,private,pg_temp as $$
begin
 if not exists(select 1 from public.workspace_members where workspace_id=p_workspace_id and user_id=p_user_id and role in ('owner','admin')) then raise exception 'Workspace access denied' using errcode='42501'; end if;
 return true;
end $$;

create or replace function public.pulso_meta_save(p_workspace_id uuid,p_user_id uuid,p_dataset_id text,p_ciphertext text,p_mode text default 'test') returns uuid
language plpgsql security definer set search_path=pg_catalog,public,private,pg_temp as $$
declare v_integration uuid; v_destination uuid;
begin
 perform public.pulso_meta_authorize(p_workspace_id,p_user_id);
 perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text || ':meta_configuration',0));
 if p_dataset_id !~ '^[0-9]{5,32}$' or p_ciphertext is null or length(p_ciphertext)>20000 or p_mode<>'test' then raise exception 'Invalid Meta configuration'; end if;
 -- A workspace has exactly one Meta integration, established by the existing unique key.
 select id into v_integration from public.integrations where workspace_id=p_workspace_id and provider='meta' for update;
 if v_integration is null then
  insert into public.integrations(workspace_id,provider,status,connected_by,connected_at) values(p_workspace_id,'meta','connected',p_user_id,now()) returning id into v_integration;
 else update public.integrations set status='connected',connected_by=p_user_id,connected_at=now(),error_message=null,updated_at=now() where id=v_integration; end if;
 insert into public.conversion_destinations(workspace_id,integration_id,provider,destination_id,label,is_active,mode,connection_status,last_verified_at)
 values(p_workspace_id,v_integration,'meta',p_dataset_id,'Meta CAPI',true,'test','connected',now())
 on conflict(workspace_id,provider,destination_id) do update set integration_id=excluded.integration_id,is_active=true,mode='test',connection_status='connected',last_verified_at=now(),last_error_code=null,updated_at=now() returning id into v_destination;
 insert into private.meta_capi_credentials(workspace_id,destination_ref,ciphertext,mode) values(p_workspace_id,v_destination,p_ciphertext,'test')
 on conflict(destination_ref) do update set ciphertext=excluded.ciphertext,mode='test',last_verified_at=now(),revoked_at=null,updated_at=now();
 -- A rotated credential fences all in-flight leases before the new token can be claimed.
 update private.conversion_event_outbox set status='pending',lease_token=null,lease_expires_at=null,next_attempt_at=now(),updated_at=now()
 where workspace_id=p_workspace_id and destination_ref=v_destination and status='sending';
 return v_destination;
end $$;

create or replace function public.pulso_meta_credential(p_workspace_id uuid,p_destination_ref uuid) returns jsonb
language sql security definer set search_path=pg_catalog,public,private,pg_temp as $$
 select jsonb_build_object('destination_ref',d.id,'dataset_id',d.destination_id,'ciphertext',c.ciphertext,'mode',c.mode)
 from public.conversion_destinations d join private.meta_capi_credentials c on c.workspace_id=d.workspace_id and c.destination_ref=d.id
 where d.workspace_id=p_workspace_id and d.id=p_destination_ref and d.provider='meta' and c.revoked_at is null;
$$;

create or replace function public.pulso_meta_control(p_workspace_id uuid,p_user_id uuid,p_destination_ref uuid,p_action text,p_outbox_id uuid default null) returns boolean
language plpgsql security definer set search_path=pg_catalog,public,private,pg_temp as $$
begin
 perform public.pulso_meta_authorize(p_workspace_id,p_user_id);
 if not exists(select 1 from public.conversion_destinations where workspace_id=p_workspace_id and id=p_destination_ref and provider='meta') then raise exception 'Destination not found'; end if;
 if p_action in ('disable','revoke') then
  update public.conversion_destinations set is_active=false,connection_status=case when p_action='revoke' then 'revoked' else 'disabled' end,updated_at=now() where id=p_destination_ref and workspace_id=p_workspace_id;
  if p_action='revoke' then delete from private.meta_capi_credentials where workspace_id=p_workspace_id and destination_ref=p_destination_ref; end if;
  update private.conversion_event_outbox set status='failed',last_error_code='destination_disabled',lease_token=null,lease_expires_at=null,updated_at=now()
  where workspace_id=p_workspace_id and destination_ref=p_destination_ref and status<>'delivered';
 elsif p_action='reprocess' then
  -- Reprocessing cannot resurrect a reversed purchase, expired event, revoked consent or removed credential.
  update private.conversion_event_outbox o set status='pending',next_attempt_at=now(),attempt_count=0,last_error_code=null,lease_token=null,lease_expires_at=null,updated_at=now()
  where o.workspace_id=p_workspace_id and o.destination_ref=p_destination_ref and o.id=p_outbox_id and o.status='failed' and o.event_time>now()-interval '6 days'
  and exists(select 1 from public.sales s where s.workspace_id=o.workspace_id and s.id=o.sale_id and s.status in ('APPROVED','COMPLETE'))
  and exists(select 1 from private.visitor_match_context v where v.workspace_id=o.workspace_id and v.tracking_session_id=o.tracking_session_id and v.marketing_allowed and v.expires_at>now())
  and exists(select 1 from public.conversion_destinations d join private.meta_capi_credentials c on c.destination_ref=d.id and c.workspace_id=d.workspace_id where d.id=o.destination_ref and d.workspace_id=o.workspace_id and d.is_active and c.revoked_at is null);
  return found;
 else raise exception 'Invalid operation'; end if;
 return true;
end $$;

create or replace function public.pulso_meta_claim(p_limit integer default 10) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,private,pg_temp as $$
declare v_result jsonb;
begin
 -- A crash on the final attempt must reach a terminal state rather than remain sending forever.
 update private.conversion_event_outbox set status='failed',last_error_code='attempts_exhausted',lease_token=null,lease_expires_at=null,updated_at=now()
 where provider='meta' and attempt_count>=8 and (status='pending' or (status='sending' and lease_expires_at<now()));
 -- Mark permanently ineligible jobs; do not leave them looking ready to send.
 update private.conversion_event_outbox o set status='failed',last_error_code='delivery_not_authorized',lease_token=null,lease_expires_at=null,updated_at=now()
 where o.provider='meta' and o.status in ('pending','sending') and (o.status='pending' or o.lease_expires_at<now()) and (
  o.event_time<now()-interval '6 days'
  or not exists(select 1 from public.sales s where s.workspace_id=o.workspace_id and s.id=o.sale_id and s.status in ('APPROVED','COMPLETE'))
  or not exists(select 1 from private.visitor_match_context v where v.workspace_id=o.workspace_id and v.tracking_session_id=o.tracking_session_id and v.marketing_allowed and v.expires_at>now())
 );
 with due as (
  select o.id from private.conversion_event_outbox o
  join public.conversion_destinations d on d.workspace_id=o.workspace_id and d.id=o.destination_ref and d.provider=o.provider
  join private.meta_capi_credentials c on c.workspace_id=o.workspace_id and c.destination_ref=d.id
  where o.provider='meta' and d.is_active and c.revoked_at is null and o.attempt_count<8 and o.next_attempt_at<=now()
    and (o.status='pending' or (o.status='sending' and o.lease_expires_at<now()))
  order by o.next_attempt_at for update of o skip locked limit greatest(1,least(p_limit,25))
 ), claimed as (
  update private.conversion_event_outbox o set status='sending',attempt_count=attempt_count+1,lease_token=gen_random_uuid(),lease_expires_at=now()+interval '60 seconds',updated_at=now()
  from due where o.id=due.id returning o.*
 ) select coalesce(jsonb_agg(to_jsonb(o)||jsonb_build_object('dataset_id',d.destination_id,'ciphertext',c.ciphertext,'credential_mode',c.mode)),'[]'::jsonb) into v_result
 from claimed o join public.conversion_destinations d on d.workspace_id=o.workspace_id and d.id=o.destination_ref
 join private.meta_capi_credentials c on c.workspace_id=o.workspace_id and c.destination_ref=o.destination_ref;
 return v_result;
end $$;

create or replace function public.pulso_meta_lease_valid(p_id uuid,p_lease_token uuid) returns boolean
language sql security definer set search_path=pg_catalog,public,private,pg_temp as $$
 select exists(select 1 from private.conversion_event_outbox o
 join public.sales s on s.workspace_id=o.workspace_id and s.id=o.sale_id
 join public.conversion_destinations d on d.workspace_id=o.workspace_id and d.id=o.destination_ref
 join private.meta_capi_credentials c on c.workspace_id=o.workspace_id and c.destination_ref=o.destination_ref
 where o.id=p_id and o.lease_token=p_lease_token and o.status='sending' and o.lease_expires_at>now() and d.is_active and c.revoked_at is null and s.status in ('APPROVED','COMPLETE')
 and exists(select 1 from private.visitor_match_context v where v.workspace_id=o.workspace_id and v.tracking_session_id=o.tracking_session_id and v.marketing_allowed and v.expires_at>now()));
$$;

create or replace function public.pulso_meta_finish(p_id uuid,p_lease_token uuid,p_accepted boolean,p_retryable boolean,p_http_status integer,p_meta_error_code integer,p_error_code text,p_response_id text) returns boolean
language plpgsql security definer set search_path=pg_catalog,public,private,pg_temp as $$
begin
 if p_error_code is not null and p_error_code !~ '^[a-z_]{1,50}$' then raise exception 'Invalid error code'; end if;
 update private.conversion_event_outbox set
 status=case when p_accepted then 'delivered' when p_retryable and attempt_count<8 then 'pending' else 'failed' end,
 next_attempt_at=now()+make_interval(secs=>least(3600,30*(2^least(attempt_count,7))::integer)),
 http_status=p_http_status,meta_error_code=p_meta_error_code,last_error_code=case when p_accepted then null else coalesce(p_error_code,'meta_rejected') end,
 provider_response_id=case when p_response_id ~ '^[A-Za-z0-9_-]{1,128}$' then p_response_id end,
 accepted_at=case when p_accepted then now() else null end,
 lease_token=null,lease_expires_at=null,updated_at=now()
 where id=p_id and lease_token=p_lease_token and status='sending' and lease_expires_at>now();
 return found;
end $$;

-- Called by the global retention job BEFORE deleting expired visitor contexts.
-- Hashes remain personal data; delivery is not permission for indefinite retention.
create or replace function private.pulso_scrub_expired_capi() returns void
language plpgsql security definer set search_path=pg_catalog,public,private,pg_temp as $$
begin
 update private.conversion_event_outbox o set
 fbp=null,fbc=null,client_ip=null,client_user_agent=null,email_sha256=null,phone_sha256=null,
 first_name_sha256=null,last_name_sha256=null,city_sha256=null,state_sha256=null,postcode_sha256=null,country_sha256=null,external_id_sha256=null,
 status=case when o.status='delivered' then o.status else 'failed' end,
 last_error_code=case when o.status='delivered' then o.last_error_code else 'matching_expired' end,
 lease_token=null,lease_expires_at=null,updated_at=now()
 where not exists(select 1 from private.visitor_match_context v
  where v.workspace_id=o.workspace_id and v.tracking_session_id=o.tracking_session_id and v.marketing_allowed and v.expires_at>now())
 and (o.fbp is not null or o.fbc is not null or o.client_ip is not null or o.client_user_agent is not null or o.email_sha256 is not null or o.phone_sha256 is not null
  or o.first_name_sha256 is not null or o.last_name_sha256 is not null or o.city_sha256 is not null or o.state_sha256 is not null
  or o.postcode_sha256 is not null or o.country_sha256 is not null or o.external_id_sha256 is not null);
end $$;
revoke all on function private.pulso_scrub_expired_capi() from public,anon,authenticated;

-- Only privileged Edge callers can invoke these helpers; never use user-supplied actor IDs without getUser.
DO $$ declare r record; begin
 for r in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'pulso_meta_%' loop
  execute format('revoke all on function %s from public, anon, authenticated',r.signature);
  execute format('grant execute on function %s to service_role',r.signature);
 end loop;
end $$;
-- Additive P0 collector on the audited 12-migration production baseline.
-- Review/apply ONLY in isolated staging first. Not automatically deployed.
create table private.tracking_sites (
 site_key text primary key check(site_key ~ '^[A-Za-z0-9_-]{8,128}$'),
 workspace_id uuid not null references public.workspaces(id),
 allowed_origins text[] not null check(cardinality(allowed_origins) between 1 and 20),
 consent_policy_version text not null check(length(consent_policy_version) between 1 and 100),
 active boolean not null default true,
 created_at timestamptz not null default now(),
 unique(workspace_id,site_key)
);
create table private.tracking_handoffs (
 token_sha256 text primary key check(token_sha256 ~ '^[0-9a-f]{64}$'),
 workspace_id uuid not null,
 site_key text not null,
 tracking_session_id uuid not null,
 expires_at timestamptz not null,
 revoked_at timestamptz,
 created_at timestamptz not null default now(),
 foreign key(workspace_id,site_key) references private.tracking_sites(workspace_id,site_key),
 foreign key(workspace_id,tracking_session_id) references public.tracking_sessions(workspace_id,id)
);
create index tracking_handoffs_session on private.tracking_handoffs(workspace_id,tracking_session_id);
create index tracking_handoffs_expiry on private.tracking_handoffs(expires_at);
create table private.collector_rate_limits (
 bucket text not null,
 window_at timestamptz not null,
 requests integer not null check(requests>0),
 primary key(bucket,window_at)
);
alter table private.visitor_match_context add column click_ids jsonb not null default '{}'::jsonb;
alter table public.funnel_events add column external_event_id uuid;
create unique index funnel_events_idempotency on public.funnel_events(workspace_id,external_event_id) where external_event_id is not null;
-- Close legacy read access to individual identifiers and arbitrary URL values.
revoke select on public.tracking_sessions from authenticated;
revoke select(public_session_id,landing_page,fbclid,gclid,gbraid,wbraid,tblci,src) on public.tracking_sessions from authenticated;
grant select(id,workspace_id,utm_source,utm_medium,utm_campaign,utm_content,utm_term,first_seen_at,last_seen_at) on public.tracking_sessions to authenticated;
revoke select on public.funnel_events from authenticated;
revoke select(id,workspace_id,tracking_session_id,event_name,page_url,occurred_at,metadata,external_event_id) on public.funnel_events from authenticated;
grant select(workspace_id,event_name,occurred_at) on public.funnel_events to authenticated;
-- funnel events hold only '/' + registered origin and no browser IDs in metadata.
-- Restrict identifier-bearing sales origin columns in addition to already restricted raw.
revoke select(src,sck,xcod) on public.sales from authenticated;

alter table private.tracking_sites enable row level security;
alter table private.tracking_handoffs enable row level security;
alter table private.collector_rate_limits enable row level security;
revoke all on private.tracking_sites,private.tracking_handoffs,private.collector_rate_limits from public,anon,authenticated;

create or replace function public.configure_tracking_site(p_workspace_id uuid,p_site_key text,p_allowed_origins text[],p_consent_policy_version text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare origin text;
begin
 if not exists(select 1 from public.workspace_members where workspace_id=p_workspace_id and user_id=auth.uid() and role in ('owner','admin')) then raise exception 'Workspace access denied';end if;
 if cardinality(p_allowed_origins) not between 1 and 20 or coalesce(length(p_consent_policy_version),0) not between 1 and 100 then raise exception 'Invalid site configuration';end if;
 foreach origin in array p_allowed_origins loop
  if origin !~ '^https://[a-z0-9][a-z0-9.-]*(:[0-9]{1,5})?$' then raise exception 'Invalid HTTPS origin';end if;
 end loop;
 if exists(select 1 from private.tracking_sites where site_key=p_site_key and workspace_id<>p_workspace_id) then raise exception 'Site key unavailable';end if;
 insert into private.tracking_sites(site_key,workspace_id,allowed_origins,consent_policy_version)
 values(p_site_key,p_workspace_id,p_allowed_origins,p_consent_policy_version)
 on conflict(site_key) do update set allowed_origins=excluded.allowed_origins,consent_policy_version=excluded.consent_policy_version,active=true;
 return jsonb_build_object('site_key',p_site_key,'active',true);
end $$;
revoke all on function public.configure_tracking_site(uuid,text,text[],text) from public,anon;
grant execute on function public.configure_tracking_site(uuid,text,text[],text) to authenticated;

create or replace function public.pulso_site_config(p_site_key text)
returns jsonb language sql security definer set search_path='' as $$
 select jsonb_build_object('active',active,'allowed_origins',allowed_origins,'consent_policy_version',consent_policy_version) from private.tracking_sites where site_key=p_site_key;
$$;
revoke all on function public.pulso_site_config(text) from public,anon,authenticated;
grant execute on function public.pulso_site_config(text) to service_role;

-- Both buckets are atomic across Edge isolates, without raw IP retention.
create or replace function private.collector_rate_limit(p_bucket text,p_limit integer)
returns void language plpgsql set search_path='' as $$
declare n integer;
begin
 insert into private.collector_rate_limits(bucket,window_at,requests) values(p_bucket,date_trunc('minute',now()),1)
 on conflict(bucket,window_at) do update set requests=private.collector_rate_limits.requests+1 returning requests into n;
 if n>p_limit then raise exception 'rate_limit';end if;
end $$;
revoke all on function private.collector_rate_limit(text,integer) from public,anon,authenticated;

create or replace function public.pulso_record_event(p_site_key text,p_origin text,p_input jsonb,p_handoff_hash text,p_handoff_expires_at timestamptz,p_ip_hash text,p_client_ip inet,p_user_agent text,p_resume_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare site private.tracking_sites;session_id uuid;expires timestamptz;inserted_id uuid;click jsonb;source text;medium text;campaign text;consent_at timestamptz;existing_event public.funnel_events;
begin
 select * into site from private.tracking_sites where site_key=p_site_key and active and p_origin=any(allowed_origins);
 if not found then raise exception 'origin_denied';end if;
 if p_input->>'site_key' is distinct from p_site_key or p_input->>'event_name' not in ('page_view','view_content','checkout_click','checkout_started')
 or p_input#>>'{consent,marketing}' is distinct from 'true' or p_input#>>'{consent,basis}' is distinct from 'consent'
 or p_input#>>'{consent,policy_version}' is distinct from site.consent_policy_version then raise exception 'consent_required';end if;
 consent_at:=(p_input#>>'{consent,captured_at}')::timestamptz;
 if consent_at is null or consent_at>now()+interval '1 minute' or consent_at<now()-interval '1 day' then raise exception 'consent_required';end if;
 perform private.collector_rate_limit('site:'||p_site_key,1000);
 if p_ip_hash is not null then
  if p_ip_hash !~ '^[0-9a-f]{64}$' then raise exception 'Invalid rate key';end if;
  perform private.collector_rate_limit('ip:'||p_site_key||':'||p_ip_hash,120);
 end if;
 perform pg_advisory_xact_lock(hashtextextended(site.workspace_id::text||':'||(p_input->>'event_id'),0));
 select * into existing_event from public.funnel_events where workspace_id=site.workspace_id and external_event_id=(p_input->>'event_id')::uuid;
 if existing_event.id is not null and existing_event.event_name<>p_input->>'event_name' then raise exception 'invalid_event';end if;
 if p_resume_hash is not null then
  select h.tracking_session_id,h.expires_at into session_id,expires from private.tracking_handoffs h
   join private.visitor_match_context c on c.workspace_id=h.workspace_id and c.tracking_session_id=h.tracking_session_id
   where h.token_sha256=p_resume_hash and h.workspace_id=site.workspace_id and h.site_key=p_site_key and h.expires_at>now() and h.revoked_at is null and c.marketing_allowed and c.expires_at>now() for update of h;
  if session_id is null then raise exception 'invalid_resume';end if;
 elsif existing_event.id is not null then
  select h.tracking_session_id,min(h.expires_at) into session_id,expires from private.tracking_handoffs h
   join private.visitor_match_context c on c.workspace_id=h.workspace_id and c.tracking_session_id=h.tracking_session_id
   where h.tracking_session_id=existing_event.tracking_session_id and h.workspace_id=site.workspace_id and h.site_key=p_site_key and h.expires_at>now() and h.revoked_at is null and c.marketing_allowed and c.expires_at>now() group by h.tracking_session_id;
  if session_id is null then raise exception 'invalid_resume';end if;
 else
  expires:=least(p_handoff_expires_at,now()+interval '1 day');
  if expires<=now() then raise exception 'invalid_expiry';end if;
  click:=coalesce(p_input->'click','{}'::jsonb);
  source:=case lower(click->>'utm_source') when 'facebook' then 'meta' when 'instagram' then 'meta' when 'meta' then 'meta' when 'google' then 'google' when 'taboola' then 'taboola' else null end;
  medium:=case when click->>'utm_medium' in ('cpc','paid_social','paid_search','organic','referral','email') then click->>'utm_medium' end;
  -- Only configured campaign names can become dashboard-visible labels.
  select name into campaign from public.campaigns where workspace_id=site.workspace_id and external_campaign_id=click->>'utm_campaign' limit 1;
  insert into public.tracking_sessions(workspace_id,public_session_id,landing_page,utm_source,utm_medium,utm_campaign)
   values(site.workspace_id,gen_random_uuid(),p_origin||'/',source,medium,campaign) returning id into session_id;
  insert into private.visitor_match_context(workspace_id,tracking_session_id,marketing_allowed,legal_basis_record,consent_captured_at,consent_policy_version,fbp,fbc,client_ip,client_user_agent,captured_at,expires_at,click_ids)
  values(site.workspace_id,session_id,true,'consent',consent_at,site.consent_policy_version,p_input#>>'{browser,fbp}',p_input#>>'{browser,fbc}',p_client_ip,left(p_user_agent,512),now(),expires,click);
 end if;
 if existing_event.id is not null and existing_event.tracking_session_id<>session_id then raise exception 'invalid_resume';end if;
 -- Retain first-touch attribution and fixed TTL; never refresh consent/TTL implicitly.
 update public.tracking_sessions set last_seen_at=now() where workspace_id=site.workspace_id and id=session_id;
 insert into public.funnel_events(workspace_id,tracking_session_id,event_name,page_url,external_event_id)
 values(site.workspace_id,session_id,p_input->>'event_name',p_origin||'/',(p_input->>'event_id')::uuid)
 on conflict(workspace_id,external_event_id) where external_event_id is not null do nothing returning id into inserted_id;
 insert into private.tracking_handoffs(token_sha256,workspace_id,site_key,tracking_session_id,expires_at)
 values(p_handoff_hash,site.workspace_id,p_site_key,session_id,expires);
 return jsonb_build_object('duplicate',inserted_id is null,'expires_at',expires);
end $$;
revoke all on function public.pulso_record_event(text,text,jsonb,text,timestamptz,text,inet,text,text) from public,anon,authenticated;
grant execute on function public.pulso_record_event(text,text,jsonb,text,timestamptz,text,inet,text,text) to service_role;

create or replace function public.pulso_revoke_session(p_site_key text,p_origin text,p_resume_hash text)
returns void language plpgsql security definer set search_path='' as $$
declare h private.tracking_handoffs;
begin
 select th.* into h from private.tracking_handoffs th join private.tracking_sites ts on ts.workspace_id=th.workspace_id and ts.site_key=th.site_key
 where th.token_sha256=p_resume_hash and th.site_key=p_site_key and p_origin=any(ts.allowed_origins);
 if not found then raise exception 'invalid_resume';end if;
 update private.tracking_handoffs set revoked_at=now() where workspace_id=h.workspace_id and tracking_session_id=h.tracking_session_id;
 update private.visitor_match_context set marketing_allowed=false,fbp=null,fbc=null,client_ip=null,client_user_agent=null,click_ids='{}'::jsonb
 where workspace_id=h.workspace_id and tracking_session_id=h.tracking_session_id;
 update private.conversion_event_outbox o set status=case when o.status='delivered' then 'delivered' else 'failed' end,last_error_code=case when o.status='delivered' then o.last_error_code else 'consent_revoked' end,updated_at=now(),fbp=null,fbc=null,client_ip=null,client_user_agent=null,email_sha256=null,phone_sha256=null,first_name_sha256=null,last_name_sha256=null,city_sha256=null,state_sha256=null,postcode_sha256=null,country_sha256=null,external_id_sha256=null
 where o.workspace_id=h.workspace_id and exists(select 1 from public.attributions a where a.workspace_id=o.workspace_id and a.sale_id=o.sale_id and a.tracking_session_id=h.tracking_session_id);
end $$;
revoke all on function public.pulso_revoke_session(text,text,text) from public,anon,authenticated;
grant execute on function public.pulso_revoke_session(text,text,text) to service_role;

create or replace function public.pulso_retention_cleanup()
returns void language plpgsql security definer set search_path='' as $$
begin
 delete from private.tracking_handoffs where expires_at<now()-interval '1 day';
 delete from private.collector_rate_limits where window_at<now()-interval '1 day';
 perform private.pulso_scrub_expired_capi();
 delete from private.visitor_match_context where expires_at<now();
 -- financial/aggregate records have a separate legal retention policy.
end $$;
revoke all on function public.pulso_retention_cleanup() from public,anon,authenticated;
grant execute on function public.pulso_retention_cleanup() to service_role;
-- Incremental patch against the audited 12-migration baseline. Never replay the
-- legacy 20261025_pulso_core.sql on an existing project. Review in staging first.
alter table public.sales add column if not exists approved_at timestamptz;

create table if not exists private.hotmart_order_context (
  sale_id uuid primary key,
  workspace_id uuid not null,
  origin_codes jsonb not null default '{}'::jsonb,
  recurrence_number integer,
  expires_at timestamptz not null default now()+interval '30 days',
  foreign key (workspace_id,sale_id) references public.sales(workspace_id,id) on delete cascade
);
alter table private.hotmart_order_context enable row level security;
revoke all on private.hotmart_order_context from public,anon,authenticated;

create or replace function public.ingest_hotmart_tracking_event(p_hottok text,p_payload jsonb,p_handoff_hash text default null)
returns jsonb language plpgsql security definer
set search_path=public,private,extensions,pg_temp
as $$
declare
 v_workspace uuid; v_source uuid;
 v_event_id text:=p_payload->>'id'; v_type text:=p_payload->>'event';
 v_tx text:=p_payload#>>'{data,purchase,transaction}';
 v_status text; v_declared text; v_event_at timestamptz; v_order_at timestamptz; v_approved_at timestamptz;
 v_product text:=p_payload#>>'{data,product,name}';
 v_product_id text:=coalesce(p_payload#>>'{data,product,ucode}',p_payload#>>'{data,product,id}');
 v_currency text:=p_payload#>>'{data,purchase,full_price,currency_value}';
 v_gross numeric; v_sale uuid; v_eid uuid; v_prior public.sales%rowtype;
 v_accepted boolean; v_session uuid; v_existing_session uuid; v_context private.visitor_match_context%rowtype;
 v_landing text; v_reason text:='missing_or_invalid_handoff'; v_count integer:=0;
 v_email text; v_phone text; v_country text; v_email_hash text; v_phone_hash text; v_country_hash text;
 v_origin jsonb:=coalesce(p_payload#>'{data,purchase,origin}','{}'::jsonb);
begin
 -- Authenticate first. No workspace, source, dataset, IP or session ID from the
 -- request body participates in tenant authorization.
 if length(coalesce(p_hottok,''))<12 or length(p_hottok)>512 then raise exception 'Unauthorized Hotmart source';end if;
 select hs.id,hs.workspace_id into v_source,v_workspace from private.hotmart_sources hs
 where hs.active and hs.hottok_sha256=encode(digest(p_hottok,'sha256'),'hex');
 if v_source is null then raise exception 'Unauthorized Hotmart source';end if;
 if jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>128000
 or p_payload->>'version'<>'2.0.0'
 or coalesce(v_event_id,'')!~'^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$'
 or coalesce(v_tx,'')!~'^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$'
 then raise exception 'Invalid Hotmart event';end if;
 v_status:=case v_type
 when 'PURCHASE_APPROVED' then 'APPROVED' when 'PURCHASE_COMPLETE' then 'COMPLETE'
 when 'PURCHASE_REFUNDED' then 'REFUNDED' when 'PURCHASE_CHARGEBACK' then 'CHARGEBACK'
 when 'PURCHASE_CANCELED' then 'CANCELLED' when 'PURCHASE_EXPIRED' then 'EXPIRED'
 when 'PURCHASE_DELAYED' then 'OVERDUE' when 'PURCHASE_PROTEST' then 'PROTESTED'
 when 'PURCHASE_BILLET_PRINTED' then 'PRINTED_BILLET' else null end;
 v_declared:=p_payload#>>'{data,purchase,status}';
 v_declared:=case v_declared when 'CANCELED' then 'CANCELLED' when 'DELAYED' then 'OVERDUE' else v_declared end;
 if v_status is null or (v_declared is not null and v_declared<>v_status) then raise exception 'Invalid event status';end if;
 if coalesce(p_payload->>'creation_date','')!~'^[0-9]{12,13}$' then raise exception 'Invalid event timestamp';end if;
 v_event_at:=to_timestamp((p_payload->>'creation_date')::numeric/1000);
 if v_event_at<'2000-01-01'::timestamptz or v_event_at>now()+interval '5 minutes' then raise exception 'Invalid event timestamp';end if;
 v_order_at:=v_event_at;
 if p_payload#>>'{data,purchase,order_date}'~'^[0-9]{12,13}$' then
 v_order_at:=to_timestamp((p_payload#>>'{data,purchase,order_date}')::numeric/1000);end if;
 if p_payload#>>'{data,purchase,approved_date}' is not null then
  if p_payload#>>'{data,purchase,approved_date}'!~'^[0-9]{12,13}$' then raise exception 'Invalid event timestamp';end if;
  v_approved_at:=to_timestamp((p_payload#>>'{data,purchase,approved_date}')::numeric/1000);
  if v_approved_at<'2000-01-01'::timestamptz or v_approved_at>now()+interval '5 minutes' then raise exception 'Invalid event timestamp';end if;
 end if;
 if jsonb_typeof(p_payload#>'{data,purchase,full_price,value}')<>'number'
 or coalesce(v_currency,'')!~'^[A-Z]{3}$' then raise exception 'Invalid money amount';end if;
 v_gross:=(p_payload#>>'{data,purchase,full_price,value}')::numeric;
 if v_gross is null or v_gross<0 or v_gross>9999999999.99 then raise exception 'Invalid money amount';end if;
 if coalesce(v_product_id,'')!~'^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$'
 or coalesce(trim(v_product),'')='' or length(v_product)>250 then raise exception 'Invalid product';end if;

 perform pg_advisory_xact_lock(hashtextextended(v_workspace::text||':hotmart:'||v_tx,0));
 insert into public.order_events(workspace_id,provider,external_event_id,transaction_id,event_type,status,occurred_at)
 values(v_workspace,'hotmart',v_event_id,v_tx,v_type,v_status,v_event_at)
 on conflict(workspace_id,provider,external_event_id) do nothing returning id into v_eid;
 if v_eid is null then return jsonb_build_object('ok',true,'duplicate',true,'accepted',false);end if;
 select * into v_prior from public.sales where workspace_id=v_workspace and provider='hotmart' and external_transaction_id=v_tx for update;
 v_sale:=v_prior.id;
 -- Terminal reversal is monotonic, even if the refund notification is delayed.
 -- COMPLETE cannot regress to APPROVED, and paid orders cannot become pending.
 v_accepted:=v_sale is null or case
  when v_prior.status='CHARGEBACK' then false
  when v_prior.status='REFUNDED' then v_status='CHARGEBACK'
  when v_status in ('REFUNDED','CHARGEBACK') then true
  when v_prior.status in ('APPROVED','COMPLETE') and v_status not in ('APPROVED','COMPLETE') then false
  when v_prior.status='COMPLETE' and v_status='APPROVED' then false
  else v_event_at>=coalesce(v_prior.last_event_at,'epoch'::timestamptz) end;
 if v_sale is not null and (v_prior.currency is distinct from v_currency or v_prior.gross_amount is distinct from v_gross
 or v_prior.product_id is distinct from v_product_id) then raise exception 'Transaction facts changed';end if;

 if v_sale is null then
  insert into public.sales(workspace_id,provider,external_transaction_id,product_id,product_name,buyer_country,
   currency,gross_amount,net_amount,net_amount_verified,status,purchased_at,approved_at,last_event_at,order_bump_parent,payment_type)
  values(v_workspace,'hotmart',v_tx,v_product_id,v_product,null,v_currency,v_gross,0,false,v_status,v_order_at,
   case when v_status in ('APPROVED','COMPLETE') then coalesce(v_approved_at,v_event_at) end,v_event_at,
   left(p_payload#>>'{data,purchase,order_bump,parent_purchase_transaction}',128),left(p_payload#>>'{data,purchase,payment,type}',50))
  returning id into v_sale;
 elsif v_accepted then
  update public.sales set status=v_status,last_event_at=greatest(v_event_at,last_event_at),
   approved_at=coalesce(approved_at,case when v_status in ('APPROVED','COMPLETE') then coalesce(v_approved_at,v_event_at) end)
  where workspace_id=v_workspace and id=v_sale;
 end if;
 update public.order_events set accepted_for_state=v_accepted where id=v_eid;
 update private.hotmart_sources set last_event_at=now() where id=v_source;
 -- The existing mark_hotmart_connected trigger updates integration status.
 -- Retain only allowlisted origin codes privately; never the full webhook/buyer.
 insert into private.hotmart_order_context(workspace_id,sale_id,origin_codes,recurrence_number)
 values(v_workspace,v_sale,jsonb_strip_nulls(jsonb_build_object('src',left(v_origin->>'src',250),'sck',left(v_origin->>'sck',250),'xcod',left(v_origin->>'xcod',250))),
 case when p_payload#>>'{data,purchase,recurrence_number}'~'^[0-9]{1,6}$' then (p_payload#>>'{data,purchase,recurrence_number}')::integer end)
 on conflict(sale_id) do nothing;
 if not v_accepted then return jsonb_build_object('ok',true,'duplicate',false,'accepted',false,'queued',0);end if;

 -- The Edge Function supplies a digest only after HMAC verification. This RPC is
 -- service-role only; a valid digest must also belong to this Hotmart workspace.
 if p_handoff_hash~'^[0-9a-f]{64}$' then
  select h.tracking_session_id into v_session from private.tracking_handoffs h
  where h.workspace_id=v_workspace and h.token_sha256=p_handoff_hash and h.expires_at>now() and h.revoked_at is null;
  if v_session is not null then
   select * into v_context from private.visitor_match_context c
   where c.workspace_id=v_workspace and c.tracking_session_id=v_session and c.expires_at>now()
   and c.marketing_allowed and c.consent_captured_at is not null and c.consent_policy_version is not null
   and c.legal_basis_record is not null for update;
   if v_context.id is null then v_session:=null;v_reason:='consent_missing_revoked_or_expired';
   else v_reason:='signed_session';end if;
  else v_reason:='handoff_unknown_cross_tenant_expired_or_revoked';end if;
 end if;
 -- Existing valid attribution is not lost when later status notifications omit
 -- the origin. Its consent is re-checked below before creating delivery work.
 if v_session is null then
  select a.tracking_session_id into v_session from public.attributions a
  join private.visitor_match_context c on c.workspace_id=a.workspace_id and c.tracking_session_id=a.tracking_session_id
  where a.workspace_id=v_workspace and a.sale_id=v_sale and c.marketing_allowed and c.expires_at>now()
  and c.consent_captured_at is not null and c.consent_policy_version is not null and c.legal_basis_record is not null;
  if v_session is not null then
   select * into v_context from private.visitor_match_context c where c.workspace_id=v_workspace and c.tracking_session_id=v_session for update;
  end if;
 end if;
 -- Attribution is first verified session, never last webhook wins. Even a
 -- different valid handoff cannot steal an already attributed transaction.
 select a.tracking_session_id into v_existing_session from public.attributions a
 where a.workspace_id=v_workspace and a.sale_id=v_sale;
 if v_existing_session is not null then
  v_session:=v_existing_session;
  select * into v_context from private.visitor_match_context c
  where c.workspace_id=v_workspace and c.tracking_session_id=v_session and c.marketing_allowed
  and c.expires_at>now() and c.consent_captured_at is not null and c.consent_policy_version is not null
  and c.legal_basis_record is not null for update;
  if v_context.id is null then v_session:=null;end if;
 end if;
 insert into public.attributions(workspace_id,sale_id,tracking_session_id,method,confidence,evidence)
 values(v_workspace,v_sale,v_session,case when v_session is null then 'unknown' else 'session_id' end,
 case when v_session is null then 'none' else 'high' end,jsonb_build_object('reason',v_reason))
 on conflict(sale_id) do update set tracking_session_id=coalesce(attributions.tracking_session_id,excluded.tracking_session_id),
 method=case when excluded.tracking_session_id is not null then 'session_id' else attributions.method end,
 confidence=case when excluded.tracking_session_id is not null then 'high' else attributions.confidence end,
 evidence=case when excluded.tracking_session_id is not null then excluded.evidence else attributions.evidence end;
 if v_session is not null then
  update public.sales s set utm_source=t.utm_source,utm_medium=t.utm_medium,utm_campaign=t.utm_campaign,utm_content=null
  from public.tracking_sessions t where s.workspace_id=v_workspace and s.id=v_sale and t.workspace_id=v_workspace and t.id=v_session;
  select landing_page into v_landing from public.tracking_sessions where workspace_id=v_workspace and id=v_session;
 end if;
 if v_accepted and v_status in ('REFUNDED','CHARGEBACK') then
  update private.conversion_event_outbox set status='failed',last_error_code='sale_reversed',updated_at=now()
  where workspace_id=v_workspace and sale_id=v_sale and status<>'delivered';
 end if;
 if v_accepted and v_status in ('APPROVED','COMPLETE') then
  insert into public.financial_ledger(workspace_id,sale_id,source,external_id,entry_type,amount,currency,occurred_at,verified)
  values(v_workspace,v_sale,'hotmart',v_tx,'sale',v_gross,v_currency,coalesce(v_approved_at,v_event_at),true)
  on conflict(workspace_id,source,external_id,entry_type) do nothing;
  if coalesce(v_prior.status,'') not in ('APPROVED','COMPLETE') then
   insert into public.notifications(workspace_id,user_id,type,title,body,data)
   values(v_workspace,null,'sale','Venda confirmada',v_product,jsonb_build_object('sale_id',v_sale,'amount',v_gross,'currency',v_currency));
  end if;
  if v_context.id is not null and v_session is not null then
   -- Only matching keys supported and normalized unambiguously are retained;
   -- no name, document, address or payment data is persisted. Hash != anonymous.
   v_email:=lower(trim(p_payload#>>'{data,buyer,email}'));
   if length(v_email)<=254 and v_email~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then v_email_hash:=encode(digest(v_email,'sha256'),'hex');end if;
   -- E.164 only. Never guess a country calling code for a local phone number.
   v_phone:=p_payload#>>'{data,buyer,checkout_phone}';
   if v_phone~'^\+[1-9][0-9]{7,14}$' then v_phone_hash:=encode(digest(substring(v_phone from 2),'sha256'),'hex');end if;
   v_country:=lower(p_payload#>>'{data,purchase,checkout_country,iso}');
   if v_country~'^[a-z]{2}$' then v_country_hash:=encode(digest(v_country,'sha256'),'hex');end if;
   insert into private.conversion_event_outbox(workspace_id,destination_ref,sale_id,provider,event_name,event_id,event_time,event_source_url,
    product_id,value,currency,fbp,fbc,client_ip,client_user_agent,marketing_allowed,consent_basis,consent_captured_at,
    email_sha256,phone_sha256,country_sha256,tracking_session_id,test_mode)
   select v_workspace,d.id,v_sale,'meta','Purchase',encode(digest(v_workspace::text||':hotmart:'||v_tx||':Purchase','sha256'),'hex'),
    coalesce(s.approved_at,v_approved_at,v_event_at),v_landing,v_product_id,v_gross,v_currency,v_context.fbp,v_context.fbc,
    v_context.client_ip,v_context.client_user_agent,true,v_context.legal_basis_record,v_context.consent_captured_at,
    v_email_hash,v_phone_hash,v_country_hash,v_session,true
   from public.conversion_destinations d join public.integrations i on i.workspace_id=d.workspace_id and i.id=d.integration_id and i.provider=d.provider
   join public.sales s on s.workspace_id=d.workspace_id and s.id=v_sale
   where d.workspace_id=v_workspace and d.provider='meta' and d.is_active and i.status='connected'
   and s.status in ('APPROVED','COMPLETE')
   on conflict(workspace_id,destination_ref,event_name,event_id) do nothing;
   get diagnostics v_count=row_count;
  end if;
  if v_session is null then
   insert into public.tracking_health(workspace_id,severity,code,description,evidence)
   values(v_workspace,'warning','purchase_unattributed','Compra sem sessão consentida verificável.',jsonb_build_object('reason',v_reason));
  end if;
 elsif v_accepted and v_status in ('REFUNDED','CHARGEBACK') then
  -- One reversal ledger entry per transaction; do not double debit a later
  -- chargeback for a purchase which was already fully refunded.
  insert into public.financial_ledger(workspace_id,sale_id,source,external_id,entry_type,amount,currency,occurred_at,verified)
  values(v_workspace,v_sale,'hotmart',v_tx,'refund',-v_gross,v_currency,v_event_at,true)
  on conflict(workspace_id,source,external_id,entry_type) do nothing;
 end if;
 return jsonb_build_object('ok',true,'duplicate',false,'accepted',v_accepted,'queued',v_count);
end;$$;
revoke all on function public.ingest_hotmart_tracking_event(text,jsonb,text) from public,anon,authenticated;
grant execute on function public.ingest_hotmart_tracking_event(text,jsonb,text) to service_role;

-- Compatibility for callers on the old endpoint: financial ingestion continues,
-- but no signed-handoff attribution is trusted without the new Edge verification.
create or replace function public.ingest_hotmart_event(p_hottok text,p_payload jsonb)
returns jsonb language sql security definer set search_path=public,private,extensions,pg_temp
as $$select public.ingest_hotmart_tracking_event(p_hottok,p_payload,null);$$;
revoke all on function public.ingest_hotmart_event(text,jsonb) from public,anon,authenticated;
grant execute on function public.ingest_hotmart_event(text,jsonb) to service_role;

create or replace function public.pulso_purge_hotmart_context()
returns bigint language plpgsql security definer set search_path=public,private,pg_temp as $$
declare v_count bigint;begin
 delete from private.hotmart_order_context where expires_at<now();get diagnostics v_count=row_count;return v_count;
end;$$;
revoke all on function public.pulso_purge_hotmart_context() from public,anon,authenticated;
grant execute on function public.pulso_purge_hotmart_context() to service_role;

-- Remove both table-wide and historical column grants before granting the
-- dashboard's minimum safe financial fields. RLS still controls workspace rows.
revoke select on public.sales,public.attributions from anon,authenticated;
do $$declare columns text;table_name text;begin
 foreach table_name in array array['sales','attributions'] loop
  select string_agg(quote_ident(attname),',') into columns from pg_attribute
  where attrelid=format('public.%I',table_name)::regclass and attnum>0 and not attisdropped;
  execute format('revoke select(%s) on public.%I from anon,authenticated',columns,table_name);
 end loop;
end;$$;
grant select(id,workspace_id,provider,product_id,product_name,currency,gross_amount,net_amount,net_amount_verified,status,purchased_at,approved_at,last_event_at,created_at,settlement_currency)
 on public.sales to authenticated;
grant select(id,workspace_id,sale_id,tracking_session_id,campaign_id,method,confidence,created_at)
 on public.attributions to authenticated;
-- Original order/webhook identifiers remain backend-only as well, including
-- legacy records, while dashboard counts/financial amounts stay tenant scoped.
revoke select on public.order_events,public.financial_ledger from anon,authenticated;
do $$declare columns text;table_name text;begin
 foreach table_name in array array['order_events','financial_ledger'] loop
  select string_agg(quote_ident(attname),',') into columns from pg_attribute
  where attrelid=format('public.%I',table_name)::regclass and attnum>0 and not attisdropped;
  execute format('revoke select(%s) on public.%I from anon,authenticated',columns,table_name);
 end loop;
end;$$;
grant select(id,workspace_id,provider,event_type,status,occurred_at,accepted_for_state,created_at) on public.order_events to authenticated;
grant select(id,workspace_id,sale_id,source,entry_type,amount,currency,occurred_at,verified,created_at) on public.financial_ledger to authenticated;
-- Read-only aggregates. Invoker privileges + existing RLS remain in force.
-- No buyer, raw URL, click ID, handoff, token or matching hash is returned.
create or replace function public.pulso_dashboard_metrics(p_workspace_id uuid, p_since timestamptz)
returns jsonb language plpgsql stable security invoker
set search_path = ''
as $$
declare v_result jsonb; v_timezone text;
begin
  if auth.uid() is null or not exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = p_workspace_id and wm.user_id = auth.uid()
  ) then raise exception 'Workspace access denied' using errcode = '42501'; end if;
  if p_since is null or p_since > now() or p_since < now() - interval '366 days' then
    raise exception 'Invalid reporting window' using errcode = '22023';
  end if;
  select timezone into v_timezone from public.workspaces where id = p_workspace_id;
  v_timezone := coalesce(v_timezone, 'America/Sao_Paulo');
  with sales as materialized (
    select s.id,s.workspace_id,s.status,s.currency,s.gross_amount,s.purchased_at,
      a.tracking_session_id,
      (a.method in ('session_id','click_id') and a.tracking_session_id is not null) as attributed
    from public.sales s left join public.attributions a on a.sale_id=s.id and a.workspace_id=s.workspace_id
    where s.workspace_id=p_workspace_id and s.purchased_at >= p_since
  ), summary as (
    select currency,
      count(*) filter(where status in ('APPROVED','COMPLETE')) as approved_orders,
      coalesce(sum(gross_amount) filter(where status in ('APPROVED','COMPLETE')),0) as approved_revenue,
      count(*) filter(where status in ('REFUNDED','CHARGEBACK')) as reversed_orders,
      count(*) filter(where status in ('APPROVED','COMPLETE') and coalesce(attributed,false)) as attributed_orders,
      count(*) filter(where status in ('APPROVED','COMPLETE') and not coalesce(attributed,false)) as unattributed_orders
    from sales group by currency
  ), source_rows as (
    select s.currency,
      case when s.attributed then t.utm_source end as utm_source,
      case when s.attributed then t.utm_medium end as utm_medium,
      case when s.attributed then t.utm_campaign end as utm_campaign,
      case when s.attributed then t.utm_content end as utm_content,
      case when s.attributed then t.utm_term end as utm_term,
      count(*) as orders, sum(s.gross_amount) as revenue
    from sales s left join public.tracking_sessions t on t.id=s.tracking_session_id and t.workspace_id=s.workspace_id
    where s.status in ('APPROVED','COMPLETE')
    group by s.currency,
      case when s.attributed then t.utm_source end,
      case when s.attributed then t.utm_medium end,
      case when s.attributed then t.utm_campaign end,
      case when s.attributed then t.utm_content end,
      case when s.attributed then t.utm_term end
  ), ranked_sources as (
    select source_rows.*, row_number() over(partition by currency order by revenue desc,orders desc,utm_source nulls last) as position
    from source_rows
  ), daily as (
    select to_char(purchased_at at time zone v_timezone,'YYYY-MM-DD') as day,currency,sum(gross_amount) as revenue
    from sales where status in ('APPROVED','COMPLETE') group by 1,2
  ), health as (
    select code,count(*) as events from public.tracking_health
    where workspace_id=p_workspace_id and detected_at >= p_since and resolved_at is null
    group by code
  ), capi as (
    select status,test_mode,count(*) as events,sum(attempt_count) as attempts,max(last_error_code) as last_error_code
    from public.capi_delivery_diagnostics where workspace_id=p_workspace_id and updated_at >= p_since
    group by status,test_mode
  )
  select jsonb_build_object(
    'currency_summary',coalesce((select jsonb_agg(to_jsonb(summary) order by currency) from summary),'[]'::jsonb),
    'sources',coalesce((select jsonb_agg(to_jsonb(ranked_sources)-'position' order by currency,position) from ranked_sources where position<=50),'[]'::jsonb),
    'daily_revenue',coalesce((select jsonb_agg(to_jsonb(daily) order by day,currency) from daily),'[]'::jsonb),
    'health',coalesce((select jsonb_agg(to_jsonb(health) order by code) from health),'[]'::jsonb),
    'capi',coalesce((select jsonb_agg(to_jsonb(capi) order by status,test_mode) from capi),'[]'::jsonb),
    'funnel',jsonb_build_object(
      'visits',(select count(*) from public.tracking_sessions where workspace_id=p_workspace_id and first_seen_at>=p_since),
      'page_view',(select count(*) from public.funnel_events where workspace_id=p_workspace_id and occurred_at>=p_since and event_name='page_view'),
      'view_content',(select count(*) from public.funnel_events where workspace_id=p_workspace_id and occurred_at>=p_since and event_name='view_content'),
      'checkout_click',(select count(*) from public.funnel_events where workspace_id=p_workspace_id and occurred_at>=p_since and event_name='checkout_click'),
      'checkout_started',(select count(*) from public.funnel_events where workspace_id=p_workspace_id and occurred_at>=p_since and event_name='checkout_started')
    )
  ) into v_result;
  return v_result;
end;
$$;
revoke all on function public.pulso_dashboard_metrics(uuid,timestamptz) from public,anon;
grant execute on function public.pulso_dashboard_metrics(uuid,timestamptz) to authenticated;
-- Supported Supabase Vault integration. No secrets or environment-specific values.
-- New staging only for this release; production requires its own reviewed deployment.
create table private.pulso_runtime_secret_refs (
 setting_name text primary key check(setting_name in (
  'PULSO_HANDOFF_HMAC_KEY','PULSO_RATE_HASH_KEY','PULSO_DASHBOARD_ORIGINS',
  'PULSO_ADMIN_ORIGINS','PULSO_META_CREDENTIAL_KEY_V1','META_GRAPH_VERSION','PULSO_META_WORKER_SECRET'
 )),
 vault_secret_id uuid not null,
 created_at timestamptz not null default now()
);
alter table private.pulso_runtime_secret_refs enable row level security;
revoke all on private.pulso_runtime_secret_refs from public,anon,authenticated,service_role;

create or replace function public.pulso_runtime_config(p_component text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_names text[]; v_result jsonb;
begin
 -- Fixed component mappings: callers cannot request an arbitrary Vault secret.
 v_names:=case p_component
 when 'collector' then array['PULSO_HANDOFF_HMAC_KEY','PULSO_RATE_HASH_KEY']
 when 'webhook' then array['PULSO_HANDOFF_HMAC_KEY']
 when 'hotmart_connect' then array['PULSO_DASHBOARD_ORIGINS']
 when 'meta_connect' then array['PULSO_ADMIN_ORIGINS','PULSO_META_CREDENTIAL_KEY_V1','META_GRAPH_VERSION']
 when 'meta_worker' then array['PULSO_META_WORKER_SECRET','PULSO_META_CREDENTIAL_KEY_V1','META_GRAPH_VERSION']
 else null end;
 if v_names is null or to_regclass('vault.decrypted_secrets') is null then
  raise exception 'Runtime configuration unavailable' using errcode='55000';
 end if;
 -- Dynamic constant SQL lets migration apply on local PostgreSQL without Vault.
 -- The decrypted view is accessed only by this owner's narrowly scoped helper.
 execute 'select jsonb_object_agg(r.setting_name,s.decrypted_secret)
   from private.pulso_runtime_secret_refs r
   join vault.decrypted_secrets s on s.id=r.vault_secret_id
   where r.setting_name=any($1)' into v_result using v_names;
 if v_result is null or (select count(*) from jsonb_object_keys(v_result))<>cardinality(v_names)
   or exists(select 1 from jsonb_each_text(v_result) where value is null or value='') then
  raise exception 'Runtime configuration unavailable' using errcode='55000';
 end if;
 return v_result;
end;$$;
revoke all on function public.pulso_runtime_config(text) from public,anon,authenticated;
grant execute on function public.pulso_runtime_config(text) to service_role;
-- Read-only, session-cohort funnel. Apply to isolated staging first.
-- Keep session identifiers backend-only: no new table/column grants are needed.
create index if not exists funnel_events_ordered_session
  on public.funnel_events(workspace_id,tracking_session_id,event_name,occurred_at);

create or replace function private.pulso_dashboard_funnel_counts(p_workspace_id uuid,p_since timestamptz)
returns jsonb language plpgsql stable security definer
set search_path = ''
as $$
declare v_user uuid:=auth.uid(); v_until timestamptz:=now(); v_result jsonb;
begin
  -- The privileged helper can only return aggregate counts for an actual member.
  -- Never accept an actor ID or rely on user-editable JWT metadata.
  if v_user is null or not exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id=p_workspace_id and wm.user_id=v_user
  ) then raise exception 'Workspace access denied' using errcode='42501'; end if;
  if p_since is null or not isfinite(p_since) or p_since>v_until
    or p_since<v_until-interval '366 days' then
    raise exception 'Invalid reporting window' using errcode='22023';
  end if;

  with cohort as materialized (
    select s.id,min(e.occurred_at) as entered_at
    from public.tracking_sessions s
    join public.funnel_events e
      on e.workspace_id=s.workspace_id and e.tracking_session_id=s.id
    where s.workspace_id=p_workspace_id
      and s.first_seen_at between p_since and v_until
      and e.workspace_id=p_workspace_id and e.event_name='page_view'
      and e.occurred_at between greatest(p_since,s.first_seen_at) and v_until
    group by s.id
  ), paths as (
    select c.id,content.content_at,click.click_at,checkout.checkout_at,
      content.click_observed,content.checkout_observed
    from cohort c
    left join lateral (
      select min(e.occurred_at) filter(where e.event_name='view_content') as content_at,
        coalesce(bool_or(e.event_name='checkout_click'),false) as click_observed,
        coalesce(bool_or(e.event_name='checkout_started'),false) as checkout_observed
      from public.funnel_events e
      where e.workspace_id=p_workspace_id and e.tracking_session_id=c.id
        and e.event_name in ('view_content','checkout_click','checkout_started')
        and e.occurred_at between c.entered_at and v_until
    ) content on true
    left join lateral (
      select min(e.occurred_at) as click_at
      from public.funnel_events e
      where e.workspace_id=p_workspace_id and e.tracking_session_id=c.id
        and e.event_name='checkout_click'
        and e.occurred_at between content.content_at and v_until
    ) click on true
    left join lateral (
      select min(e.occurred_at) as checkout_at
      from public.funnel_events e
      where e.workspace_id=p_workspace_id and e.tracking_session_id=c.id
        and e.event_name='checkout_started'
        and e.occurred_at between click.click_at and v_until
    ) checkout on true
  )
  select jsonb_build_object(
    'version',1,'basis','ordered_sessions','since',p_since,'until',v_until,
    'stages',jsonb_build_array(
      jsonb_build_object('key','page_view','sessions',count(*)),
      jsonb_build_object('key','view_content','sessions',count(content_at)),
      jsonb_build_object('key','checkout_click','sessions',count(click_at)),
      jsonb_build_object('key','checkout_started','sessions',count(checkout_at))
    ),
    'observed_checkout_sessions',count(*) filter(where checkout_observed),
    'incomplete_path_sessions',count(*) filter(where
      (click_observed and click_at is null) or (checkout_observed and checkout_at is null))
  ) into v_result from paths;
  return v_result;
end;
$$;
revoke all on function private.pulso_dashboard_funnel_counts(uuid,timestamptz) from public,anon,authenticated,service_role;
grant execute on function private.pulso_dashboard_funnel_counts(uuid,timestamptz) to authenticated;

-- SQL-standard body binds the private helper at definition time. The wrapper
-- remains INVOKER without granting schema USAGE or any private table access.
-- The private helper repeats membership validation on every call.
create or replace function public.pulso_dashboard_funnel(p_workspace_id uuid,p_since timestamptz)
returns jsonb language sql stable security invoker
set search_path = ''
begin atomic;
  select private.pulso_dashboard_funnel_counts(p_workspace_id,p_since);
end;
revoke all on function public.pulso_dashboard_funnel(uuid,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.pulso_dashboard_funnel(uuid,timestamptz) to authenticated;
-- Read-only Meta Marketing API cache. Apply to isolated staging first.
-- Private spend is authoritative; legacy client-editable metadata is not billing evidence.
create table public.meta_ads_accounts (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 ad_account_id uuid not null,
 external_account_id text not null check(external_account_id ~ '^[1-9][0-9]{0,31}$'),
 name text not null check(length(name) between 1 and 250),
 currency text not null check(currency ~ '^[A-Z]{3}$'),
 timezone_name text not null,
 account_status integer not null,
 status text not null default 'connected' check(status in ('connected','error','revoked')),
 last_sync_at timestamptz,
 last_error_code text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(workspace_id,id), unique(workspace_id,external_account_id),
 foreign key(workspace_id,ad_account_id) references public.ad_accounts(workspace_id,id)
);
alter table public.meta_ads_accounts enable row level security;
create policy meta_ads_accounts_member_read on public.meta_ads_accounts for select to authenticated
 using(exists(select 1 from public.workspace_members m where m.workspace_id=meta_ads_accounts.workspace_id and m.user_id=(select auth.uid())));
revoke all on public.meta_ads_accounts from public,anon,authenticated,service_role;
grant select on public.meta_ads_accounts to authenticated;

create table private.meta_ads_credentials (
 connection_id uuid primary key,
 workspace_id uuid not null,
 sealed_credential text not null,
 lease_id uuid,
 lease_until timestamptz,
 updated_at timestamptz not null default now(),
 foreign key(workspace_id,connection_id) references public.meta_ads_accounts(workspace_id,id) on delete cascade
);
create table private.meta_ads_campaigns (
 workspace_id uuid not null,
 connection_id uuid not null,
 external_campaign_id text not null check(external_campaign_id ~ '^[1-9][0-9]{0,31}$'),
 campaign_id uuid not null,
 name text not null,
 status text not null,
 effective_status text not null,
 objective text,
 primary key(workspace_id,connection_id,external_campaign_id),
 foreign key(workspace_id,connection_id) references public.meta_ads_accounts(workspace_id,id) on delete cascade,
 foreign key(workspace_id,campaign_id) references public.campaigns(workspace_id,id)
);
create table private.meta_ads_account_daily (
 workspace_id uuid not null,
 connection_id uuid not null,
 metric_date date not null,
 spend numeric(24,6) not null check(spend>=0),
 fetched_at timestamptz not null default now(),
 primary key(workspace_id,connection_id,metric_date),
 foreign key(workspace_id,connection_id) references public.meta_ads_accounts(workspace_id,id) on delete cascade
);
create table private.meta_ads_campaign_daily (
 workspace_id uuid not null,
 connection_id uuid not null,
 external_campaign_id text not null,
 metric_date date not null,
 spend numeric(24,6) not null check(spend>=0),
 impressions bigint not null check(impressions>=0),
 clicks bigint not null check(clicks>=0),
 primary key(workspace_id,connection_id,external_campaign_id,metric_date),
 foreign key(workspace_id,connection_id,external_campaign_id) references private.meta_ads_campaigns(workspace_id,connection_id,external_campaign_id) on delete cascade
);
alter table private.meta_ads_credentials enable row level security;
alter table private.meta_ads_campaigns enable row level security;
alter table private.meta_ads_account_daily enable row level security;
alter table private.meta_ads_campaign_daily enable row level security;
revoke all on private.meta_ads_credentials,private.meta_ads_campaigns,private.meta_ads_account_daily,private.meta_ads_campaign_daily from public,anon,authenticated,service_role;

create function private.pulso_ads_assert_admin(p_workspace_id uuid,p_user_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
 if p_user_id is null or not exists(select 1 from public.workspace_members where workspace_id=p_workspace_id and user_id=p_user_id and role in ('owner','admin')) then
  raise exception 'Workspace access denied' using errcode='42501';
 end if;
end $$;
revoke all on function private.pulso_ads_assert_admin(uuid,uuid) from public,anon,authenticated,service_role;

create function private.pulso_ads_check_window(p_since date,p_until date)
returns void language plpgsql set search_path='' as $$
begin
 if p_since is null or p_until is null or not isfinite(p_since) or not isfinite(p_until)
 or p_until<p_since or p_until-p_since>30 or p_until>current_date+1 or p_since<current_date-366 then
  raise exception 'Invalid reporting window' using errcode='22023';
 end if;
end $$;
revoke all on function private.pulso_ads_check_window(date,date) from public,anon,authenticated,service_role;

create function private.pulso_ads_check_account(p_account jsonb)
returns void language plpgsql set search_path='' as $$
begin
 if jsonb_typeof(p_account) is distinct from 'object' or coalesce(p_account->>'id','')!~'^[1-9][0-9]{0,31}$'
 or coalesce(p_account->>'currency','')!~'^[A-Z]{3}$'
 or coalesce(length(p_account->>'name'),0) not between 1 and 250
 or coalesce(p_account->>'account_status','')!~'^[0-9]{1,6}$'
 or not exists(select 1 from pg_catalog.pg_timezone_names where name=p_account->>'timezone_name') then
  raise exception 'Invalid Meta Ads account' using errcode='22023';
 end if;
end $$;
revoke all on function private.pulso_ads_check_account(jsonb) from public,anon,authenticated,service_role;

create function public.pulso_ads_save(p_workspace_id uuid,p_user_id uuid,p_account jsonb,p_sealed_credential text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_box jsonb;v_existing public.meta_ads_accounts;v_integration uuid;v_ad_account uuid;v_id uuid;
begin
 perform private.pulso_ads_assert_admin(p_workspace_id,p_user_id);
 perform private.pulso_ads_check_account(p_account);
 begin
  v_box:=p_sealed_credential::jsonb;
  if p_sealed_credential is null or length(p_sealed_credential)>20000 or jsonb_typeof(v_box) is distinct from 'object'
  or not (v_box ?& array['v','iv','data']) or v_box->'v' is distinct from '1'::jsonb
  or jsonb_typeof(v_box->'iv') is distinct from 'string' or jsonb_typeof(v_box->'data') is distinct from 'string'
  or (select count(*) from jsonb_object_keys(v_box))<>3 or octet_length(decode(v_box->>'iv','base64')) is distinct from 12
  or coalesce(octet_length(decode(v_box->>'data','base64')),0)<16 then raise exception 'invalid';end if;
 exception when others then raise exception 'Invalid sealed credential' using errcode='22023';end;
 perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text||':ads:'||(p_account->>'id'),0));
 select * into v_existing from public.meta_ads_accounts where workspace_id=p_workspace_id and external_account_id=p_account->>'id' for update;
 if v_existing.id is not null and (v_existing.currency<>p_account->>'currency' or v_existing.timezone_name<>p_account->>'timezone_name') then
  raise exception 'Account facts changed' using errcode='22023';
 end if;
 select id into v_integration from public.integrations where workspace_id=p_workspace_id and provider='meta' and provider_user_id='ads:'||(p_account->>'id') limit 1;
 if v_integration is null then
  insert into public.integrations(workspace_id,provider,provider_user_id,provider_user_name,status,connected_by,connected_at,scopes)
  values(p_workspace_id,'meta','ads:'||(p_account->>'id'),p_account->>'name','connected',p_user_id,now(),array['ads_read']) returning id into v_integration;
 else update public.integrations set status='connected',error_message=null,updated_at=now() where id=v_integration;end if;
 insert into public.ad_accounts(workspace_id,integration_id,provider,external_account_id,name,currency,timezone_name,selected)
 values(p_workspace_id,v_integration,'meta',p_account->>'id',p_account->>'name',p_account->>'currency',p_account->>'timezone_name',true)
 on conflict(provider,external_account_id,workspace_id) do update set integration_id=excluded.integration_id,name=excluded.name,
 currency=excluded.currency,timezone_name=excluded.timezone_name,selected=true returning id into v_ad_account;
 insert into public.meta_ads_accounts(workspace_id,ad_account_id,external_account_id,name,currency,timezone_name,account_status)
 values(p_workspace_id,v_ad_account,p_account->>'id',p_account->>'name',p_account->>'currency',p_account->>'timezone_name',(p_account->>'account_status')::integer)
 on conflict(workspace_id,external_account_id) do update set name=excluded.name,account_status=excluded.account_status,status='connected',last_error_code=null,updated_at=now()
 returning id into v_id;
 insert into private.meta_ads_credentials(connection_id,workspace_id,sealed_credential)
 values(v_id,p_workspace_id,p_sealed_credential)
 on conflict(connection_id) do update set sealed_credential=excluded.sealed_credential,lease_id=null,lease_until=null,updated_at=now();
 return v_id;
end $$;
revoke all on function public.pulso_ads_save(uuid,uuid,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function public.pulso_ads_save(uuid,uuid,jsonb,text) to service_role;

create function public.pulso_ads_begin_sync(p_workspace_id uuid,p_user_id uuid,p_connection_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_account public.meta_ads_accounts;v_credential private.meta_ads_credentials;v_lease uuid:=gen_random_uuid();
begin
 perform private.pulso_ads_assert_admin(p_workspace_id,p_user_id);
 select * into v_account from public.meta_ads_accounts where workspace_id=p_workspace_id and id=p_connection_id for update;
 if v_account.id is null or v_account.status='revoked' then raise exception 'Connection unavailable' using errcode='42501';end if;
 select * into v_credential from private.meta_ads_credentials where workspace_id=p_workspace_id and connection_id=p_connection_id for update;
 if v_credential.connection_id is null then raise exception 'Connection unavailable' using errcode='42501';end if;
 if v_credential.lease_until>now() then raise exception 'Synchronization busy' using errcode='40001';end if;
 update private.meta_ads_credentials set lease_id=v_lease,lease_until=now()+interval '120 seconds' where connection_id=p_connection_id;
 return jsonb_build_object('connection_id',v_account.id,'external_account_id',v_account.external_account_id,'sealed_credential',v_credential.sealed_credential,'lease_id',v_lease);
end $$;
revoke all on function public.pulso_ads_begin_sync(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.pulso_ads_begin_sync(uuid,uuid,uuid) to service_role;

create function public.pulso_ads_complete_sync(p_workspace_id uuid,p_connection_id uuid,p_lease_id uuid,p_since date,p_until date,p_snapshot jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_account public.meta_ads_accounts;v_credential private.meta_ads_credentials;r jsonb;v_campaign uuid;v_day date;
begin
 perform private.pulso_ads_check_window(p_since,p_until);
 select * into v_account from public.meta_ads_accounts where workspace_id=p_workspace_id and id=p_connection_id for update;
 select * into v_credential from private.meta_ads_credentials where workspace_id=p_workspace_id and connection_id=p_connection_id for update;
 if v_account.id is null or v_account.status='revoked' or v_credential.connection_id is null
 or v_credential.lease_id is distinct from p_lease_id or p_lease_id is null or v_credential.lease_until<=now() then
  raise exception 'Stale synchronization lease' using errcode='40001';end if;
 if p_until>(now() at time zone v_account.timezone_name)::date then raise exception 'Invalid account reporting window' using errcode='22023';end if;
 perform private.pulso_ads_check_account(p_snapshot->'account');
 if p_snapshot#>>'{account,id}'<>v_account.external_account_id or p_snapshot#>>'{account,currency}'<>v_account.currency
 or p_snapshot#>>'{account,timezone_name}'<>v_account.timezone_name then raise exception 'Account facts changed' using errcode='22023';end if;
 if jsonb_typeof(p_snapshot->'campaigns') is distinct from 'array' or jsonb_typeof(p_snapshot->'daily') is distinct from 'array'
 or jsonb_typeof(p_snapshot->'account_daily') is distinct from 'array' or octet_length(p_snapshot::text)>8000000
 or jsonb_array_length(p_snapshot->'campaigns')>10000 or jsonb_array_length(p_snapshot->'daily')>20000 then
  raise exception 'Invalid Meta Ads snapshot' using errcode='22023';end if;
 -- Validation precedes cache replacement. Any failure rolls back the entire import.
 if exists(select 1 from jsonb_array_elements(p_snapshot->'campaigns') x where jsonb_typeof(x) is distinct from 'object'
 or coalesce(x->>'id','')!~'^[1-9][0-9]{0,31}$' or coalesce(length(x->>'name'),0) not between 1 and 250
 or coalesce(x->>'status','')!~'^[A-Z_]{1,40}$' or coalesce(x->>'effective_status','')!~'^[A-Z_]{1,40}$')
 or (select count(*)<>count(distinct x->>'id') from jsonb_array_elements(p_snapshot->'campaigns') x) then
  raise exception 'Invalid Meta Ads campaigns' using errcode='22023';end if;
 for r in select value from jsonb_array_elements(p_snapshot->'account_daily') loop
  if jsonb_typeof(r) is distinct from 'object' or coalesce(r->>'date','')!~'^\d{4}-\d{2}-\d{2}$'
  or coalesce(r->>'spend','')!~'^[0-9]{1,14}(\.[0-9]{1,6})?$' then raise exception 'Invalid spend' using errcode='22023';end if;
  v_day:=(r->>'date')::date;
  if v_day not between p_since and p_until then raise exception 'Invalid spend date' using errcode='22023';end if;
 end loop;
 if (select count(*)<>count(distinct x->>'date') from jsonb_array_elements(p_snapshot->'account_daily') x) then raise exception 'Duplicate spend day' using errcode='22023';end if;
 for r in select value from jsonb_array_elements(p_snapshot->'daily') loop
  if jsonb_typeof(r) is distinct from 'object' or coalesce(r->>'date','')!~'^\d{4}-\d{2}-\d{2}$'
  or coalesce(r->>'spend','')!~'^[0-9]{1,14}(\.[0-9]{1,6})?$'
  or coalesce(r->>'impressions','')!~'^[0-9]{1,15}$' or coalesce(r->>'clicks','')!~'^[0-9]{1,15}$'
  or not exists(select 1 from jsonb_array_elements(p_snapshot->'campaigns') c where c->>'id'=r->>'campaign_id') then
   raise exception 'Invalid campaign spend' using errcode='22023';end if;
  v_day:=(r->>'date')::date;
  if v_day not between p_since and p_until then raise exception 'Invalid spend date' using errcode='22023';end if;
 end loop;
 if (select count(*)<>count(distinct (x->>'campaign_id',x->>'date')) from jsonb_array_elements(p_snapshot->'daily') x) then raise exception 'Duplicate campaign day' using errcode='22023';end if;
 -- Account totals are authoritative. Refuse materially inconsistent snapshots.
 if exists(with c as(select (x->>'date')::date as day,sum((x->>'spend')::numeric) as spend from jsonb_array_elements(p_snapshot->'daily') x group by 1),
 a as(select (x->>'date')::date as day,(x->>'spend')::numeric as spend from jsonb_array_elements(p_snapshot->'account_daily') x)
 select 1 from c full join a using(day) where abs(coalesce(c.spend,0)-coalesce(a.spend,0))>0.01) then
  raise exception 'Inconsistent spend totals' using errcode='22023';end if;
 update private.meta_ads_campaigns set status='UNKNOWN',effective_status='UNKNOWN' where workspace_id=p_workspace_id and connection_id=p_connection_id;
 for r in select value from jsonb_array_elements(p_snapshot->'campaigns') loop
  if exists(select 1 from public.campaigns where workspace_id=p_workspace_id and provider='meta' and external_campaign_id=r->>'id' and ad_account_id<>v_account.ad_account_id) then
   raise exception 'Campaign account mismatch' using errcode='22023';end if;
  insert into public.campaigns(workspace_id,ad_account_id,provider,external_campaign_id,name,status,objective)
  values(p_workspace_id,v_account.ad_account_id,'meta',r->>'id',r->>'name',r->>'effective_status',r->>'objective')
  on conflict(provider,external_campaign_id,workspace_id) do update set name=excluded.name,status=excluded.status,objective=excluded.objective,updated_at=now() returning id into v_campaign;
  insert into private.meta_ads_campaigns(workspace_id,connection_id,external_campaign_id,campaign_id,name,status,effective_status,objective)
  values(p_workspace_id,p_connection_id,r->>'id',v_campaign,r->>'name',r->>'status',r->>'effective_status',r->>'objective')
  on conflict(workspace_id,connection_id,external_campaign_id) do update set name=excluded.name,status=excluded.status,effective_status=excluded.effective_status,objective=excluded.objective;
 end loop;
 delete from private.meta_ads_campaign_daily where workspace_id=p_workspace_id and connection_id=p_connection_id and metric_date between p_since and p_until;
 delete from private.meta_ads_account_daily where workspace_id=p_workspace_id and connection_id=p_connection_id and metric_date between p_since and p_until;
 insert into private.meta_ads_account_daily(workspace_id,connection_id,metric_date,spend)
 select p_workspace_id,p_connection_id,d::date,coalesce((select (x->>'spend')::numeric from jsonb_array_elements(p_snapshot->'account_daily') x where (x->>'date')::date=d::date),0)
 from pg_catalog.generate_series(p_since::timestamp,p_until::timestamp,interval '1 day') d;
 insert into private.meta_ads_campaign_daily(workspace_id,connection_id,external_campaign_id,metric_date,spend,impressions,clicks)
 select p_workspace_id,p_connection_id,x->>'campaign_id',(x->>'date')::date,(x->>'spend')::numeric,(x->>'impressions')::bigint,(x->>'clicks')::bigint from jsonb_array_elements(p_snapshot->'daily') x;
 update public.meta_ads_accounts set name=p_snapshot#>>'{account,name}',account_status=(p_snapshot#>>'{account,account_status}')::integer,status='connected',last_error_code=null,last_sync_at=now(),updated_at=now() where id=p_connection_id;
 update public.integrations set last_sync_at=now(),status='connected',error_message=null,updated_at=now()
 where workspace_id=p_workspace_id and provider='meta' and provider_user_id='ads:'||v_account.external_account_id;
 update private.meta_ads_credentials set lease_id=null,lease_until=null where connection_id=p_connection_id;
 return jsonb_build_object('ok',true);
end $$;
revoke all on function public.pulso_ads_complete_sync(uuid,uuid,uuid,date,date,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.pulso_ads_complete_sync(uuid,uuid,uuid,date,date,jsonb) to service_role;

create function public.pulso_ads_fail_sync(p_workspace_id uuid,p_connection_id uuid,p_lease_id uuid,p_error_code text)
returns void language plpgsql security definer set search_path='' as $$
declare v_code text;
begin
 if p_lease_id is null then raise exception 'Stale synchronization lease' using errcode='40001';end if;
 perform 1 from public.meta_ads_accounts where workspace_id=p_workspace_id and id=p_connection_id for update;
 perform 1 from private.meta_ads_credentials where workspace_id=p_workspace_id and connection_id=p_connection_id and lease_id=p_lease_id and lease_until>now() for update;
 if not found then raise exception 'Stale synchronization lease' using errcode='40001';end if;
 v_code:=case when p_error_code in ('meta_ads_auth','meta_ads_permission','meta_ads_transient','meta_ads_network','meta_ads_invalid_response','meta_ads_pagination_limit','meta_ads_rejected') then p_error_code else 'meta_ads_sync_failed' end;
 update public.meta_ads_accounts set status='error',last_error_code=v_code,updated_at=now() where workspace_id=p_workspace_id and id=p_connection_id;
 update public.integrations set status='error',error_message=v_code,updated_at=now()
 where workspace_id=p_workspace_id and provider='meta' and provider_user_id='ads:'||
  (select external_account_id from public.meta_ads_accounts where workspace_id=p_workspace_id and id=p_connection_id);
 update private.meta_ads_credentials set lease_id=null,lease_until=null where workspace_id=p_workspace_id and connection_id=p_connection_id;
end $$;
revoke all on function public.pulso_ads_fail_sync(uuid,uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.pulso_ads_fail_sync(uuid,uuid,uuid,text) to service_role;

create function public.pulso_ads_revoke(p_workspace_id uuid,p_user_id uuid,p_connection_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
 perform private.pulso_ads_assert_admin(p_workspace_id,p_user_id);
 perform 1 from public.meta_ads_accounts where workspace_id=p_workspace_id and id=p_connection_id for update;
 if not found then raise exception 'Connection unavailable' using errcode='42501';end if;
 delete from private.meta_ads_credentials where workspace_id=p_workspace_id and connection_id=p_connection_id;
 update public.meta_ads_accounts set status='revoked',last_error_code=null,updated_at=now() where workspace_id=p_workspace_id and id=p_connection_id;
 update public.integrations set status='revoked',error_message=null,updated_at=now()
 where workspace_id=p_workspace_id and provider='meta' and provider_user_id='ads:'||
  (select external_account_id from public.meta_ads_accounts where workspace_id=p_workspace_id and id=p_connection_id);
end $$;
revoke all on function public.pulso_ads_revoke(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.pulso_ads_revoke(uuid,uuid,uuid) to service_role;

create function private.pulso_ads_metrics_counts(p_workspace_id uuid,p_from date,p_until date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_timezone text;v_result jsonb;
begin
 if auth.uid() is null or not exists(select 1 from public.workspace_members where workspace_id=p_workspace_id and user_id=auth.uid()) then raise exception 'Workspace access denied' using errcode='42501';end if;
 perform private.pulso_ads_check_window(p_from,p_until);
 select timezone into v_timezone from public.workspaces where id=p_workspace_id;
 if p_until>(now() at time zone v_timezone)::date then raise exception 'Invalid workspace reporting window' using errcode='22023';end if;
 with accounts as materialized (
  select a.*, coalesce((a.status='connected' and count(d.metric_date)=p_until-p_from+1
   and (p_until<(now() at time zone a.timezone_name)::date or min(d.fetched_at) filter(where d.metric_date=(now() at time zone a.timezone_name)::date)>now()-interval '1 hour')),false) as complete,
   coalesce(sum(d.spend),0) as observed_spend
  from public.meta_ads_accounts a left join private.meta_ads_account_daily d on d.workspace_id=a.workspace_id and d.connection_id=a.id and d.metric_date between p_from and p_until
  where a.workspace_id=p_workspace_id group by a.id
 ), account_rows as(
  select id,external_account_id,name,currency,timezone_name,status,last_sync_at,last_error_code,complete,case when complete then observed_spend end as spend from accounts
 ), campaign_rows as(
  select c.campaign_id as id,c.name,c.status,c.effective_status,a.currency,
   case when a.complete then coalesce(sum(d.spend),0) end as spend,a.name as account_name,a.id as account_id
  from private.meta_ads_campaigns c join accounts a on a.id=c.connection_id and a.workspace_id=c.workspace_id
  left join private.meta_ads_campaign_daily d on d.workspace_id=c.workspace_id and d.connection_id=c.connection_id and d.external_campaign_id=c.external_campaign_id and d.metric_date between p_from and p_until
  where c.workspace_id=p_workspace_id group by c.campaign_id,c.name,c.status,c.effective_status,a.currency,a.complete,a.name,a.id
 ), sales as materialized(
  -- Revenue is provider-independent: every recorded sales platform contributes.
  -- Spend coverage below is explicitly limited to the Meta Ads adapter.
  select s.* from public.sales s where s.workspace_id=p_workspace_id and (s.purchased_at at time zone v_timezone)::date between p_from and p_until
 ), currencies as(select currency from accounts union select currency from sales), financial as(
  select c.currency,
   coalesce((select sum(s.gross_amount) from sales s where s.currency=c.currency and s.status in ('APPROVED','COMPLETE')),0) as approved_revenue,
   case when not exists(select 1 from sales s where s.currency=c.currency and s.status in ('APPROVED','COMPLETE') and (not s.net_amount_verified or s.settlement_currency is distinct from s.currency))
    then coalesce((select sum(s.net_amount) from sales s where s.currency=c.currency and s.status in ('APPROVED','COMPLETE')),0) end as verified_net_revenue,
   (select count(*) from sales s where s.currency=c.currency and s.status in ('REFUNDED','CHARGEBACK')) as refunded_orders,
   (exists(select 1 from accounts a where a.currency=c.currency) and not exists(select 1 from accounts a where a.currency=c.currency and (not a.complete or a.timezone_name<>v_timezone))) as complete,
   case when not exists(select 1 from accounts a where a.currency=c.currency) then 'no_accounts'
    when exists(select 1 from accounts a where a.currency=c.currency and a.timezone_name<>v_timezone) then 'timezone_mismatch'
    when exists(select 1 from accounts a where a.currency=c.currency and not a.complete) then 'missing_coverage' else null end as coverage_reason,
   (select sum(a.observed_spend) from accounts a where a.currency=c.currency) as observed_spend
  from currencies c
 ), financial_rows as(
  select currency,approved_revenue,verified_net_revenue,refunded_orders,complete,coverage_reason,
   case when complete then observed_spend end as media_spend,
   case when complete then approved_revenue-observed_spend end as revenue_after_media,
   case when complete and observed_spend>0 then (approved_revenue-observed_spend)/observed_spend*100 end as media_roi_percent,
   null::numeric as profit,null::numeric as roi_percent from financial
 )
 select jsonb_build_object('version',1,'from',p_from,'until',p_until,
  'media_providers',jsonb_build_array('meta'),'revenue_scope','all_recorded_sales',
  'accounts',coalesce((select jsonb_agg(to_jsonb(a) order by name,id) from account_rows a),'[]'::jsonb),
  'campaigns',coalesce((select jsonb_agg(to_jsonb(c) order by name,id) from campaign_rows c),'[]'::jsonb),
  'financial',coalesce((select jsonb_agg(to_jsonb(f) order by currency) from financial_rows f),'[]'::jsonb)) into v_result;
 return v_result;
end $$;
revoke all on function private.pulso_ads_metrics_counts(uuid,date,date) from public,anon,authenticated,service_role;
grant execute on function private.pulso_ads_metrics_counts(uuid,date,date) to authenticated;
create function public.pulso_ads_metrics(p_workspace_id uuid,p_from date,p_until date)
returns jsonb language sql stable security invoker set search_path='' begin atomic;
 select private.pulso_ads_metrics_counts(p_workspace_id,p_from,p_until);
end;
revoke all on function public.pulso_ads_metrics(uuid,date,date) from public,anon,authenticated,service_role;
grant execute on function public.pulso_ads_metrics(uuid,date,date) to authenticated;

-- Ads and CAPI share the provider but never the integration identity. Retain the
-- existing CAPI identity (NULL provider_user_id) independently from ads:ACCOUNT.
-- Replace the current function here; previously applied migrations stay intact.
create or replace function public.pulso_meta_save(p_workspace_id uuid,p_user_id uuid,p_dataset_id text,p_ciphertext text,p_mode text default 'test') returns uuid
language plpgsql security definer set search_path=pg_catalog,public,private,pg_temp as $$
declare v_integration uuid; v_destination uuid;
begin
 perform public.pulso_meta_authorize(p_workspace_id,p_user_id);
 perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text || ':meta_configuration',0));
 if p_dataset_id is null or p_dataset_id !~ '^[0-9]{5,32}$' or p_ciphertext is null or length(p_ciphertext)>20000 or p_mode is distinct from 'test' then raise exception 'Invalid Meta configuration'; end if;
 select id into v_integration from public.integrations where workspace_id=p_workspace_id and provider='meta' and provider_user_id is null for update;
 if v_integration is null then
  insert into public.integrations(workspace_id,provider,status,connected_by,connected_at) values(p_workspace_id,'meta','connected',p_user_id,now()) returning id into v_integration;
 else update public.integrations set status='connected',connected_by=p_user_id,connected_at=now(),error_message=null,updated_at=now() where id=v_integration; end if;
 insert into public.conversion_destinations(workspace_id,integration_id,provider,destination_id,label,is_active,mode,connection_status,last_verified_at)
 values(p_workspace_id,v_integration,'meta',p_dataset_id,'Meta CAPI',true,'test','connected',now())
 on conflict(workspace_id,provider,destination_id) do update set integration_id=excluded.integration_id,is_active=true,mode='test',connection_status='connected',last_verified_at=now(),last_error_code=null,updated_at=now() returning id into v_destination;
 insert into private.meta_capi_credentials(workspace_id,destination_ref,ciphertext,mode) values(p_workspace_id,v_destination,p_ciphertext,'test')
 on conflict(destination_ref) do update set ciphertext=excluded.ciphertext,mode='test',last_verified_at=now(),revoked_at=null,updated_at=now();
 update private.conversion_event_outbox set status='pending',lease_token=null,lease_expires_at=null,next_attempt_at=now(),updated_at=now()
 where workspace_id=p_workspace_id and destination_ref=v_destination and status='sending';
 return v_destination;
end $$;
revoke all on function public.pulso_meta_save(uuid,uuid,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.pulso_meta_save(uuid,uuid,text,text,text) to service_role;

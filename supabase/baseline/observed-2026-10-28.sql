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

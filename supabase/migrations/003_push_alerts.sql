-- Sama Yoon — push alerts (Web Push subscriptions + dispatch log)
-- Run once in the Supabase SQL editor.
--
-- Both tables have RLS enabled and NO policy: anonymous and authenticated
-- clients cannot read or write them. Only the Netlify functions reach them,
-- with the service_role key stored in Netlify environment variables.

create table if not exists public.push_subscriptions (
    id           uuid primary key default gen_random_uuid(),
    endpoint     text not null unique check (endpoint like 'https://%' and char_length(endpoint) <= 1000),
    p256dh       text not null check (char_length(p256dh) <= 200),
    auth         text not null check (char_length(auth) <= 100),
    zones        text[] not null default '{}',
    triggers     text[] not null default '{official,citizen}',
    created_at   timestamptz not null default now(),
    last_seen_at timestamptz not null default now(),
    fail_count   int not null default 0
);
create index if not exists push_subscriptions_zones_idx on public.push_subscriptions using gin (zones);

create table if not exists public.alert_log (
    id         bigint generated always as identity primary key,
    key        text not null unique,
    zone_id    text not null,
    kind       text not null,
    title      text not null,
    body       text not null,
    sent_at    timestamptz not null default now(),
    recipients int not null default 0
);
create index if not exists alert_log_sent_at_idx on public.alert_log (sent_at desc);

alter table public.push_subscriptions enable row level security;
alter table public.alert_log enable row level security;
revoke all on public.push_subscriptions from anon, authenticated;
revoke all on public.alert_log from anon, authenticated;

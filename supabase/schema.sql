-- Sama Yoon — Supabase schema
-- Run once in the Supabase SQL editor (or `supabase db push`).
-- Anonymous visitors can read live reports, add one, and confirm one via RPC.
-- They cannot update, delete or read the hashed client fingerprint.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Citizen traffic reports (expire after 2 h, extended by confirmations)
-- ---------------------------------------------------------------------------
create table if not exists public.user_reports (
    id          uuid primary key default gen_random_uuid(),
    created_at  timestamptz not null default now(),
    latitude    double precision not null check (latitude between 12.0 and 17.0),   -- Senegal bbox
    longitude   double precision not null check (longitude between -17.8 and -11.0),
    report_type varchar(50) not null check (report_type in ('BOUCHON', 'ROUTE_BLOQUEE', 'BARRAGE_POLICE')),
    description text check (char_length(description) <= 280),
    upvotes     int not null default 1,
    expires_at  timestamptz not null default (now() + interval '2 hours'),
    client_hash text                                                         -- sha256(ip), for rate limiting only
);

create index if not exists user_reports_expires_at_idx on public.user_reports (expires_at);
create index if not exists user_reports_client_recent_idx on public.user_reports (client_hash, created_at desc);

-- Server-controlled fields: whatever the client sends, force sane values and
-- apply a per-client rate limit (1 report / 2 min).
create or replace function public.user_reports_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    fwd text := coalesce(current_setting('request.headers', true)::json ->> 'x-forwarded-for', '');
begin
    new.id := gen_random_uuid();
    new.created_at := now();
    new.upvotes := 1;
    new.expires_at := now() + interval '2 hours';
    new.client_hash := encode(digest(split_part(fwd, ',', 1), 'sha256'), 'hex');
    if fwd <> '' and exists (
        select 1 from public.user_reports
        where client_hash = new.client_hash and created_at > now() - interval '2 minutes'
    ) then
        raise exception 'rate_limited' using errcode = 'P0001';
    end if;
    return new;
end;
$$;

drop trigger if exists user_reports_before_insert on public.user_reports;
create trigger user_reports_before_insert
    before insert on public.user_reports
    for each row execute function public.user_reports_before_insert();

alter table public.user_reports enable row level security;

drop policy if exists "read live reports" on public.user_reports;
create policy "read live reports" on public.user_reports
    for select to anon, authenticated
    using (expires_at > now());

drop policy if exists "add a report" on public.user_reports;
create policy "add a report" on public.user_reports
    for insert to anon, authenticated
    with check (true);

-- Hide the fingerprint column from API clients.
revoke select on public.user_reports from anon, authenticated;
grant select (id, created_at, latitude, longitude, report_type, description, upvotes, expires_at)
    on public.user_reports to anon, authenticated;
revoke insert on public.user_reports from anon, authenticated;
grant insert (latitude, longitude, report_type, description) on public.user_reports to anon, authenticated;

-- Confirmation ("toujours vrai"): +1 and keep the report alive >= 30 min.
create or replace function public.increment_upvote(report_id uuid)
returns public.user_reports
language sql
security definer
set search_path = public
as $$
    update public.user_reports
       set upvotes = upvotes + 1,
           expires_at = greatest(expires_at, now() + interval '30 minutes')
     where id = report_id and expires_at > now()
    returning id, created_at, latitude, longitude, report_type, description, upvotes, expires_at, null::text;
$$;
revoke all on function public.increment_upvote(uuid) from public;
grant execute on function public.increment_upvote(uuid) to anon, authenticated;

-- Realtime feed
do $$
begin
    alter publication supabase_realtime add table public.user_reports;
exception when duplicate_object then null;
end $$;

-- Optional housekeeping (enable pg_cron in the dashboard first):
-- select cron.schedule('purge-expired-reports', '*/30 * * * *',
--   $$delete from public.user_reports where expires_at < now() - interval '1 day'$$);

-- ---------------------------------------------------------------------------
-- Voies fluides & points relais (seeded from public/data/.../quiet_spots.json)
-- ---------------------------------------------------------------------------
create table if not exists public.quiet_spots (
    id          uuid primary key default gen_random_uuid(),
    name        varchar(255) not null,
    category    varchar(50) check (category in ('PARC', 'CAFE_TRAVAIL', 'PLAGE_CALME')),
    latitude    double precision not null,
    longitude   double precision not null,
    description text
);

alter table public.quiet_spots enable row level security;
drop policy if exists "read spots" on public.quiet_spots;
create policy "read spots" on public.quiet_spots for select to anon, authenticated using (true);

-- Sama Yoon — official weather vigilance (ANACIM bulletins) + weather push trigger.
-- Run once in the Supabase SQL editor.

create table if not exists public.weather_notices (
    id          uuid primary key default gen_random_uuid(),
    level       text not null check (level in ('jaune', 'orange', 'rouge')),
    title       text not null check (char_length(title) <= 140),
    summary     text not null check (char_length(summary) <= 600),
    areas       text[] not null default '{all}',   -- alert zone ids, or 'all'
    source_name text not null check (char_length(source_name) <= 80),
    source_url  text check (source_url is null or source_url like 'https://%'),
    issued_at   timestamptz not null,
    valid_until timestamptz not null,
    created_at  timestamptz not null default now(),
    check (valid_until > issued_at)
);
create index if not exists weather_notices_valid_idx on public.weather_notices (valid_until desc);

-- Anyone can read notices that are still valid; only service_role writes.
alter table public.weather_notices enable row level security;
drop policy if exists "read valid weather notices" on public.weather_notices;
create policy "read valid weather notices" on public.weather_notices
    for select to anon, authenticated
    using (valid_until > now());
revoke insert, update, delete on public.weather_notices from anon, authenticated;
grant select on public.weather_notices to anon, authenticated;

do $$
begin
    alter publication supabase_realtime add table public.weather_notices;
exception when duplicate_object then null;
end $$;

-- Push subscriptions: weather alerts on by default, also for existing subscribers.
alter table public.push_subscriptions alter column triggers set default '{official,citizen,weather}';
update public.push_subscriptions
   set triggers = array_append(triggers, 'weather')
 where not ('weather' = any(triggers));

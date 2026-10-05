-- Sama Yoon — relayed reports (traffic info picked up from social networks by
-- the team and entered with the /info-trafic command).
-- They are ordinary user_reports (same display, 3 h expiry, push alerts);
-- `origin` is internal bookkeeping, never exposed to anonymous clients.

alter table public.user_reports
    add column if not exists origin text not null default 'app'
    check (origin in ('app', 'relay'));

-- Anonymous clients still cannot read or set origin (column grants from
-- schema.sql only list the public columns), so app inserts are always 'app'.

-- The per-IP rate limit protects the public API; the team's relay script
-- uses the service_role key and is not throttled.
create or replace function public.user_reports_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
    fwd text := coalesce(current_setting('request.headers', true)::json ->> 'x-forwarded-for', '');
    role text := coalesce(current_setting('request.jwt.claims', true)::json ->> 'role', '');
begin
    new.id := gen_random_uuid();
    new.created_at := now();
    new.upvotes := 1;
    new.expires_at := now() + interval '3 hours';
    new.client_hash := encode(extensions.digest(split_part(fwd, ',', 1), 'sha256'), 'hex');
    if role = 'service_role' then
        return new;
    end if;
    new.origin := 'app';
    if fwd <> '' and exists (
        select 1 from public.user_reports
        where client_hash = new.client_hash and created_at > now() - interval '2 minutes'
    ) then
        raise exception 'rate_limited' using errcode = 'P0001';
    end if;
    return new;
end;
$$;

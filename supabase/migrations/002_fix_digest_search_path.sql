-- Fix: pgcrypto's digest() lives in the "extensions" schema on Supabase.
-- Run in the SQL editor if schema.sql was applied before 2026-10-05.

create or replace function public.user_reports_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
    fwd text := coalesce(current_setting('request.headers', true)::json ->> 'x-forwarded-for', '');
begin
    new.id := gen_random_uuid();
    new.created_at := now();
    new.upvotes := 1;
    new.expires_at := now() + interval '2 hours';
    new.client_hash := encode(extensions.digest(split_part(fwd, ',', 1), 'sha256'), 'hex');
    if fwd <> '' and exists (
        select 1 from public.user_reports
        where client_hash = new.client_hash and created_at > now() - interval '2 minutes'
    ) then
        raise exception 'rate_limited' using errcode = 'P0001';
    end if;
    return new;
end;
$$;

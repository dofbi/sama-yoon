-- Sama Yoon — flood reports ("Route inondée / impraticable") + 3 h expiry.
-- Run in the Supabase SQL editor BEFORE deploying the app version that sends
-- report_type = 'INONDATION' (otherwise inserts are rejected).

-- 1. Accept the new report type.
alter table public.user_reports drop constraint if exists user_reports_report_type_check;
alter table public.user_reports
    add constraint user_reports_report_type_check
    check (report_type in ('INONDATION', 'BOUCHON', 'ROUTE_BLOQUEE', 'BARRAGE_POLICE'));

-- 2. Reports live 3 hours unless re-confirmed.
alter table public.user_reports alter column expires_at set default (now() + interval '3 hours');

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
    new.expires_at := now() + interval '3 hours';
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

-- 3. A confirmation ("👍 Confirmer") keeps the report visible 3 more hours.
create or replace function public.increment_upvote(report_id uuid)
returns public.user_reports
language sql
security definer
set search_path = public
as $$
    update public.user_reports
       set upvotes = upvotes + 1,
           expires_at = greatest(expires_at, now() + interval '3 hours')
     where id = report_id and expires_at > now()
    returning id, created_at, latitude, longitude, report_type, description, upvotes, expires_at, null::text;
$$;

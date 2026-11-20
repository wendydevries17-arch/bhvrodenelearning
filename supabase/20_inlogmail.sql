-- =====================================================================
--  20. Inlogmails via eigen Resend-koppeling (20 nov 2026)
--  Supabase Auth stuurt zijn mails (inlogcode, wachtwoord herstellen)
--  via deze hook. De rij leeft een paar seconden: de functie inlogmail
--  verstuurt hem en verwijdert hem direct.
--  In Supabase: Auth > Hooks > Send Email = pg-functions://postgres/public/stuur_inlogmail
-- =====================================================================
create table if not exists public.inlogmail_wachtrij (
  id          uuid primary key default gen_random_uuid(),
  email       text not null,
  soort       text,
  code        text,
  token_hash  text,
  terug       text,
  aangemaakt  timestamptz not null default now()
);
alter table public.inlogmail_wachtrij enable row level security;
-- Geen policies: alleen de hook (supabase_auth_admin) en de dienstsleutel komen erbij.
revoke all on public.inlogmail_wachtrij from anon, authenticated;
grant insert, select, delete on public.inlogmail_wachtrij to supabase_auth_admin;

create or replace function public.stuur_inlogmail(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_id uuid;
begin
  -- Oude rijen die om wat voor reden ook bleven staan opruimen.
  delete from public.inlogmail_wachtrij where aangemaakt < now() - interval '15 minutes';

  insert into public.inlogmail_wachtrij (email, soort, code, token_hash, terug)
  values (
    coalesce(event->'user'->>'email', ''),
    event->'email_data'->>'email_action_type',
    event->'email_data'->>'token',
    event->'email_data'->>'token_hash',
    event->'email_data'->>'redirect_to'
  ) returning id into v_id;

  perform net.http_post(
    url := 'https://lckiqubbdcgsalkovscg.supabase.co/functions/v1/inlogmail',
    body := jsonb_build_object('id', v_id),
    headers := '{"Content-Type":"application/json"}'::jsonb
  );
  return '{}'::jsonb;
exception when others then
  return jsonb_build_object('error', jsonb_build_object('http_code', 500, 'message', 'De mail kon niet worden verstuurd'));
end;
$$;
revoke execute on function public.stuur_inlogmail(jsonb) from public, anon, authenticated;
grant execute on function public.stuur_inlogmail(jsonb) to supabase_auth_admin;
grant usage on schema public to supabase_auth_admin;

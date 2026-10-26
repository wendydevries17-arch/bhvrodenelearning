-- =====================================================================
--  13_app_push.sql
--  Pushmeldingen voor de app van BHV Roden.
--
--  De app geeft na het inloggen een pushtoken door (via de website in de
--  app). Eén keer per dag kijkt de database wie een herinnering kan
--  gebruiken en stuurt die via de pushdienst van Expo. Geen sleutels nodig.
--
--  Regels, zodat niemand wordt platgebeld:
--    - maximaal één herinnering per vier dagen per persoon
--    - een certificaat-herinnering hooguit één keer per 20 dagen
--    - de taak draait één keer per dag, rond etenstijd
-- =====================================================================

create extension if not exists pg_net;
create extension if not exists pg_cron;

-- ---------- tokens ----------
create table if not exists push_tokens (
  token         text primary key,
  profiel_id    uuid not null references profielen(id) on delete cascade,
  platform      text,
  aangemaakt_op timestamptz not null default now(),
  bijgewerkt_op timestamptz not null default now()
);
create index if not exists push_tokens_profiel on push_tokens(profiel_id);
alter table push_tokens enable row level security;
-- Geen policies: alleen de functies hieronder komen erbij.

create table if not exists push_log (
  id          bigint generated always as identity primary key,
  profiel_id  uuid not null references profielen(id) on delete cascade,
  soort       text not null,
  titel       text,
  tekst       text,
  verstuurd_op timestamptz not null default now()
);
create index if not exists push_log_profiel on push_log(profiel_id, verstuurd_op desc);
alter table push_log enable row level security;

-- Een beheerder mag het logboek lezen.
drop policy if exists push_log_lezen on push_log;
create policy push_log_lezen on push_log for select using (is_beheerder());

-- ---------- token bewaren en vergeten (vanuit de app) ----------
create or replace function bewaar_pushtoken(p_token text, p_platform text default null)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if auth.uid() is null then raise exception 'Niet ingelogd'; end if;
  if p_token is null or p_token !~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]+\]$' then
    raise exception 'Ongeldige pushtoken';
  end if;
  insert into push_tokens (token, profiel_id, platform)
  values (p_token, auth.uid(), left(coalesce(p_platform, ''), 20))
  on conflict (token) do update
    set profiel_id = excluded.profiel_id, platform = excluded.platform, bijgewerkt_op = now();
  -- Hooguit vijf toestellen per persoon, de oudste gaan eruit.
  delete from push_tokens where profiel_id = auth.uid() and token in (
    select token from push_tokens where profiel_id = auth.uid()
    order by bijgewerkt_op desc offset 5);
end $$;

create or replace function vergeet_pushtoken(p_token text)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if auth.uid() is null then return; end if;
  delete from push_tokens where token = p_token and profiel_id = auth.uid();
end $$;

revoke all on function bewaar_pushtoken(text, text) from public, anon;
revoke all on function vergeet_pushtoken(text) from public, anon;
grant execute on function bewaar_pushtoken(text, text) to authenticated;
grant execute on function vergeet_pushtoken(text) to authenticated;

-- ---------- wie krijgt vandaag welke herinnering ----------
create or replace function push_kandidaten()
returns table (profiel_id uuid, soort text, titel text, tekst text, pad text)
language sql stable security definer set search_path to 'public' as $$
  with ins as (
    select i.id, i.profiel_id, i.cursus_id, i.organisatie_id, i.status, i.deadline,
           i.aangemaakt_op, i.gestart_op,
           p.voornaam,
           lessen_voor(i.cursus_id, i.organisatie_id) as totaal,
           (select count(*) from voortgang v where v.inschrijving_id = i.id and v.afgerond_op is not null) as af,
           (select max(v.bijgewerkt_op) from voortgang v where v.inschrijving_id = i.id) as laatst
    from inschrijvingen i
    join profielen p on p.id = i.profiel_id
    where p.actief and p.geanonimiseerd_op is null
      and i.status in ('uitgenodigd', 'bezig', 'gezakt')
      and exists (select 1 from push_tokens t where t.profiel_id = i.profiel_id)
  ),
  keuze as (
    select ins.profiel_id,
      case
        when deadline is not null and deadline between current_date and current_date + 7 and af < totaal
          then 'deadline'
        when totaal > 0 and af >= totaal then 'examen'
        when af = 0 and aangemaakt_op < now() - interval '2 days' then 'start'
        when af > 0 and coalesce(laatst, gestart_op, aangemaakt_op) < now() - interval '4 days' then 'verder'
      end as soort,
      voornaam, totaal, af, deadline
    from ins
  )
  select k.profiel_id, k.soort,
    case k.soort
      when 'deadline' then 'Je deadline komt eraan'
      when 'examen'   then 'Bijna klaar!'
      when 'start'    then 'Je BHV-cursus staat klaar'
      when 'verder'   then 'Ga je verder?'
    end,
    case k.soort
      when 'deadline' then 'Rond je cursus af voor ' || to_char(k.deadline, 'DD-MM') || '. Je hebt nog ' || (k.totaal - k.af) || ' lessen te gaan.'
      when 'examen'   then 'Alle lessen zijn af. Maak je kennistoetsen en het eindexamen, dan heb je je certificaat.'
      when 'start'    then coalesce(nullif(k.voornaam, '') || ', je', 'Je') || ' kunt beginnen met de eerste les. Een les duurt een paar minuten.'
      when 'verder'   then 'Je bent op ' || round(k.af * 100.0 / greatest(k.totaal, 1)) || '%. Nog ' || (k.totaal - k.af) || ' lessen te gaan, je gaat verder waar je was.'
    end,
    '/'
  from keuze k
  where k.soort is not null
    and not exists (select 1 from push_log l where l.profiel_id = k.profiel_id
                    and l.verstuurd_op > now() - interval '4 days')

  union all

  -- Certificaat verloopt binnen 30 dagen.
  select c.profiel_id, 'certificaat',
    'Je BHV-certificaat verloopt bijna',
    'Je certificaat is geldig tot ' || to_char(c.geldig_tot, 'DD-MM-YYYY') || '. Plan op tijd je herhaling in.',
    '/'
  from certificaten c
  join profielen p on p.id = c.profiel_id
  where c.ingetrokken_op is null and p.actief and p.geanonimiseerd_op is null
    and c.geldig_tot between current_date and current_date + 30
    and exists (select 1 from push_tokens t where t.profiel_id = c.profiel_id)
    and not exists (select 1 from certificaten c2 where c2.profiel_id = c.profiel_id
                    and c2.ingetrokken_op is null and c2.geldig_tot > c.geldig_tot)
    and not exists (select 1 from push_log l where l.profiel_id = c.profiel_id
                    and l.soort = 'certificaat' and l.verstuurd_op > now() - interval '20 days')
    and not exists (select 1 from push_log l where l.profiel_id = c.profiel_id
                    and l.verstuurd_op > now() - interval '4 days');
$$;

-- ---------- versturen ----------
create or replace function stuur_herinneringen()
returns integer language plpgsql security definer set search_path to 'public' as $$
declare
  r record;
  berichten jsonb := '[]'::jsonb;
  n int := 0;
  gehad uuid[] := '{}';
begin
  for r in select * from push_kandidaten() loop
    -- Eén melding per persoon per ronde.
    continue when r.profiel_id = any(gehad);
    gehad := gehad || r.profiel_id;

    select berichten || coalesce(jsonb_agg(jsonb_build_object(
             'to', t.token, 'title', r.titel, 'body', r.tekst, 'sound', 'default',
             'channelId', 'herinneringen', 'data', jsonb_build_object('pad', r.pad))), '[]'::jsonb)
      into berichten
      from push_tokens t where t.profiel_id = r.profiel_id;

    insert into push_log (profiel_id, soort, titel, tekst) values (r.profiel_id, r.soort, r.titel, r.tekst);
    n := n + 1;

    -- Expo neemt maximaal 100 berichten per keer.
    if jsonb_array_length(berichten) >= 90 then
      perform net.http_post(url := 'https://exp.host/--/api/v2/push/send',
        body := berichten, headers := '{"Content-Type":"application/json","Accept":"application/json"}'::jsonb);
      berichten := '[]'::jsonb;
    end if;
  end loop;

  if jsonb_array_length(berichten) > 0 then
    perform net.http_post(url := 'https://exp.host/--/api/v2/push/send',
      body := berichten, headers := '{"Content-Type":"application/json","Accept":"application/json"}'::jsonb);
  end if;

  -- Toestellen die al een half jaar niet meer in de app zijn geweest: weg.
  delete from push_tokens where bijgewerkt_op < now() - interval '180 days';
  delete from push_log where verstuurd_op < now() - interval '365 days';
  return n;
end $$;

revoke all on function push_kandidaten() from public, anon, authenticated;
revoke all on function stuur_herinneringen() from public, anon, authenticated;

-- Elke dag om 16:30 UTC: 17:30 in de winter, 18:30 in de zomer.
select cron.unschedule('bhv-herinneringen') where exists (select 1 from cron.job where jobname = 'bhv-herinneringen');
select cron.schedule('bhv-herinneringen', '30 16 * * *', $$select public.stuur_herinneringen()$$);

notify pgrst, 'reload schema';

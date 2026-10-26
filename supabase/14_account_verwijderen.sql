-- =====================================================================
--  14_account_verwijderen.sql
--  Een cursist of contactpersoon kan zelf zijn account verwijderen,
--  in de app en op de website. Apple eist dat voor apps met accounts.
--
--  Wat er gebeurt:
--    - certificaten blijven bestaan met alleen nummer en datums
--      (naam en geboortedatum gaan eruit, net als bij ruim_op)
--    - uitnodigingen op dit mailadres gaan weg
--    - in het maillogboek komt geen adres meer te staan
--    - het inlogaccount wordt verwijderd; profiel, inschrijvingen,
--      voortgang en pushtokens gaan daardoor mee
--  Een beheerder kan dit niet zelf, zodat het beheer nooit wegvalt.
--
--  Daarnaast: rustiger herinneringen en opruimen van dode toestellen.
-- =====================================================================

create or replace function verwijder_mijn_account()
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id    uuid := auth.uid();
  v_rol   text;
  v_email text;
begin
  if v_id is null then raise exception 'Niet ingelogd'; end if;
  select rol, email into v_rol, v_email from profielen where id = v_id;
  if v_rol = 'beheerder' then
    raise exception 'Een beheerder kan zijn account niet zelf verwijderen';
  end if;

  update certificaten
     set naam_op_certificaat = 'Verwijderd op verzoek van de deelnemer',
         geboortedatum       = date '1900-01-01',
         profiel_id          = null,
         inschrijving_id     = null
   where profiel_id = v_id
      or inschrijving_id in (select id from inschrijvingen where profiel_id = v_id);

  update mail_log set aan = 'verwijderd', profiel_id = null where profiel_id = v_id;
  if v_email is not null then
    delete from uitnodigingen where lower(email) = lower(v_email);
    update mail_log set aan = 'verwijderd' where lower(aan) = lower(v_email);
  end if;

  delete from push_tokens where profiel_id = v_id;
  delete from push_log    where profiel_id = v_id;

  delete from auth.users where id = v_id;
end $$;

revoke all on function verwijder_mijn_account() from public, anon;
grant execute on function verwijder_mijn_account() to authenticated;

-- ---------- herinneringen: niet eindeloos ----------
-- "start" en "verder" hooguit drie keer per twee maanden, en tekst klopt
-- ook bij één les.
create or replace function push_kandidaten()
returns table (profiel_id uuid, soort text, titel text, tekst text, pad text)
language sql stable security definer set search_path = public, pg_temp as $$
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
        when totaal > 0 and af > 0 and af < totaal
             and coalesce(laatst, gestart_op, aangemaakt_op) < now() - interval '4 days' then 'verder'
      end as soort,
      voornaam, totaal, af, deadline,
      (totaal - af) as rest
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
      when 'deadline' then 'Rond je cursus af voor ' || to_char(k.deadline, 'DD-MM') || '. Je hebt nog '
                           || k.rest || case when k.rest = 1 then ' les' else ' lessen' end || ' te gaan.'
      when 'examen'   then 'Alle lessen zijn af. Maak je kennistoetsen en het eindexamen, dan heb je je certificaat.'
      when 'start'    then coalesce(nullif(k.voornaam, '') || ', je', 'Je') || ' kunt beginnen met de eerste les. Een les duurt een paar minuten.'
      when 'verder'   then 'Je bent op ' || round(k.af * 100.0 / k.totaal) || '%. Nog '
                           || k.rest || case when k.rest = 1 then ' les' else ' lessen' end
                           || ' te gaan, je gaat verder waar je was.'
    end,
    '/'
  from keuze k
  where k.soort is not null
    and not exists (select 1 from push_log l where l.profiel_id = k.profiel_id
                    and l.verstuurd_op > now() - interval '4 days')
    and (k.soort not in ('start', 'verder')
         or (select count(*) from push_log l where l.profiel_id = k.profiel_id
             and l.soort = k.soort and l.verstuurd_op > now() - interval '60 days') < 3)

  union all

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
revoke all on function push_kandidaten() from public, anon, authenticated;

-- ---------- dode toestellen opruimen ----------
-- Expo meldt "DeviceNotRegistered" als de app verwijderd is. Die antwoorden
-- bewaart pg_net een paar uur; een half uur na het versturen kijken we ze na.
-- Ook tokens van uitgeschakelde of geanonimiseerde accounts gaan weg.
create or replace function ruim_pushtokens_op()
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare n int := 0; m int := 0;
begin
  delete from push_tokens t
   using net._http_response r,
         lateral jsonb_array_elements(case when jsonb_typeof(r.content::jsonb -> 'data') = 'array'
                                           then r.content::jsonb -> 'data' else '[]'::jsonb end) e
   where r.created > now() - interval '6 hours'
     and r.content like '%DeviceNotRegistered%'
     and e ->> 'status' = 'error'
     and e -> 'details' ->> 'error' = 'DeviceNotRegistered'
     and e -> 'details' ->> 'expoPushToken' = t.token;
  get diagnostics n = row_count;

  delete from push_tokens t using profielen p
   where p.id = t.profiel_id and (not p.actief or p.geanonimiseerd_op is not null);
  get diagnostics m = row_count;
  return n + m;
exception when others then
  return -1;  -- opruimen mag de rest nooit in de weg zitten
end $$;
revoke all on function ruim_pushtokens_op() from public, anon, authenticated;

select cron.unschedule('bhv-pushtokens-opruimen') where exists (select 1 from cron.job where jobname = 'bhv-pushtokens-opruimen');
select cron.schedule('bhv-pushtokens-opruimen', '0 17 * * *', $$select public.ruim_pushtokens_op()$$);

-- Zoekpad ook strak zetten op de eerdere functies.
alter function bewaar_pushtoken(text, text) set search_path = public, pg_temp;
alter function vergeet_pushtoken(text)      set search_path = public, pg_temp;
alter function stuur_herinneringen()        set search_path = public, pg_temp;

notify pgrst, 'reload schema';

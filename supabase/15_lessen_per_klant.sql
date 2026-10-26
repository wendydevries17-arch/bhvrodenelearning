-- =====================================================================
--  15_lessen_per_klant.sql
--  Per klant kiezen welke lessen aan of uit staan.
--
--  Standaard staat alles aan. Zet je een les uit voor een bedrijf, dan
--  komt er een regel in klant_les_uit. Een les met een slotje (verplicht)
--  kan nergens uit. Cursisten van dat bedrijf zien de les dan niet, de
--  voortgang telt hem niet mee, en staat een heel hoofdstuk uit, dan
--  komen de examenvragen van dat hoofdstuk ook niet in het examen.
-- =====================================================================

alter table lessen add column if not exists verplicht boolean not null default false;

create table if not exists klant_les_uit (
  organisatie_id uuid not null references organisaties(id) on delete cascade,
  les_id         uuid not null references lessen(id) on delete cascade,
  aangemaakt_op  timestamptz not null default now(),
  primary key (organisatie_id, les_id)
);
alter table klant_les_uit enable row level security;
drop policy if exists klant_les_uit_lezen on klant_les_uit;
create policy klant_les_uit_lezen on klant_les_uit for select
  using (is_beheerder() or organisatie_id = mijn_organisatie());

-- ---------- aan of uit zetten (alleen beheerder) ----------
create or replace function zet_les_voor_klant(p_org uuid, p_les uuid, p_aan boolean)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not is_beheerder() then raise exception 'Alleen een beheerder mag dit aanpassen'; end if;
  if p_aan then
    delete from klant_les_uit where organisatie_id = p_org and les_id = p_les;
  else
    if exists (select 1 from lessen where id = p_les and verplicht) then
      raise exception 'Deze les is verplicht en kan niet uit';
    end if;
    insert into klant_les_uit (organisatie_id, les_id) values (p_org, p_les)
    on conflict do nothing;
  end if;
end $$;

create or replace function zet_les_verplicht(p_les uuid, p_verplicht boolean)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not is_beheerder() then raise exception 'Alleen een beheerder mag dit aanpassen'; end if;
  update lessen set verplicht = p_verplicht where id = p_les;
  if p_verplicht then delete from klant_les_uit where les_id = p_les; end if;
end $$;

revoke all on function zet_les_voor_klant(uuid, uuid, boolean) from public, anon;
revoke all on function zet_les_verplicht(uuid, boolean) from public, anon;
grant execute on function zet_les_voor_klant(uuid, uuid, boolean) to authenticated;
grant execute on function zet_les_verplicht(uuid, boolean) to authenticated;

-- ---------- cursisten zien alleen wat aan staat ----------
drop policy if exists les_lezen on lessen;
create policy les_lezen on lessen for select using (
  exists (
    select 1 from modules m
    where m.id = lessen.module_id
      and mag_cursus_zien(m.cursus_id)
      and (
        is_beheerder()
        or (m.status = 'live'
            and (m.organisatie_id is null or m.organisatie_id = mijn_organisatie())
            and not exists (select 1 from klant_les_uit u
                            where u.les_id = lessen.id and u.organisatie_id = mijn_organisatie()))
      )
  )
);

-- ---------- de voortgang telt alleen wat aan staat ----------
create or replace function lessen_voor(p_cursus uuid, p_org uuid)
returns bigint language sql stable security definer set search_path to 'public' as $$
  select count(*)
  from lessen l
  join modules m on m.id = l.module_id
  where m.cursus_id = p_cursus
    and m.status = 'live'
    and (m.organisatie_id is null or m.organisatie_id = p_org)
    and not exists (select 1 from klant_les_uit u where u.les_id = l.id and u.organisatie_id = p_org);
$$;

-- ---------- het examen: hoofdstukken die uit staan doen niet mee ----------
CREATE OR REPLACE FUNCTION public.start_toets(p_inschrijving uuid, p_soort vraag_soort, p_module uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_cursus   uuid;
  v_aantal   int;
  v_drempel  int;
  v_max      int;
  v_gedaan   int;
  v_ids      uuid[];
  v_poging   uuid;
  v_org      uuid;
begin
  if p_soort = 'evaluatie' then
    raise exception 'Evaluatievragen worden per vraag nagekeken';
  end if;

  select i.cursus_id, c.aantal_examenvragen, c.slaagcriterium, c.max_examenpogingen, i.organisatie_id
    into v_cursus, v_aantal, v_drempel, v_max, v_org
  from inschrijvingen i
  join cursussen c on c.id = i.cursus_id
  where i.id = p_inschrijving and i.profiel_id = auth.uid();

  if v_cursus is null then
    raise exception 'Deze inschrijving is niet van jou';
  end if;

  if p_soort = 'examen' then
    if not exists (select 1 from pogingen pg
                   where pg.inschrijving_id = p_inschrijving
                     and pg.soort = 'examen' and pg.geslaagd) then
      select count(*) into v_gedaan
      from pogingen pg
      where pg.inschrijving_id = p_inschrijving
        and pg.soort = 'examen'
        and pg.ingeleverd_op is not null;

      if v_max > 0 and v_gedaan >= v_max then
        raise exception 'Je hebt het examen % keer gemaakt. Neem contact op met BHV Roden via info@bhvroden.nl, dan kijken we samen hoe je verder kunt.', v_gedaan;
      end if;
    end if;

    select array_agg(id) into v_ids from (
      select id from vragen
       where cursus_id = v_cursus and soort = 'examen' and actief
         -- Examenvragen horen bij een hoofdstuk. Staan er live hoofdstukken met examenvragen, dan alleen die; anders de oude losse examenbank.
         and (case when exists (select 1 from vragen x join modules mx on mx.id = x.module_id where x.cursus_id = v_cursus and x.soort = 'examen' and x.actief and mx.status = 'live') then module_id in (select id from modules where status = 'live') else module_id is null end)
         -- Hoofdstukken die voor dit bedrijf helemaal uit staan, tellen niet mee.
         and (module_id is null or exists (
               select 1 from lessen l where l.module_id = vragen.module_id
                 and not exists (select 1 from klant_les_uit u where u.les_id = l.id and u.organisatie_id = v_org)))
       order by random()
       limit v_aantal
    ) t;
  else
    v_drempel := 70;
    select array_agg(id) into v_ids from (
      select id from vragen
       where cursus_id = v_cursus and soort = 'toets' and module_id = p_module and actief
       order by random()
    ) t;
  end if;

  if v_ids is null or array_length(v_ids,1) = 0 then
    raise exception 'Er staan geen vragen klaar voor dit onderdeel';
  end if;

  insert into pogingen (inschrijving_id, soort, module_id, vraag_ids)
  values (p_inschrijving, p_soort, p_module, v_ids)
  returning id into v_poging;

  return jsonb_build_object(
    'poging',   v_poging,
    'drempel',  v_drempel,
    'vragen',   (select jsonb_agg(jsonb_build_object('id', v.id, 'vraag', v.vraag, 'opties', v.opties)
                          order by array_position(v_ids, v.id))
                 from vragen v where v.id = any(v_ids)),
    'pogingen_over', case when v_max > 0 then greatest(0, v_max - coalesce(v_gedaan, 0)) else null end
  );
end;
$function$;

notify pgrst, 'reload schema';

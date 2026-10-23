-- 12_inhoud.sql
-- Archief: is al uitgevoerd op de database (23-10-2026).
-- 1. vragen_beheer: beheerders lezen alle vragen inclusief juist antwoord (voor het Inhoud-tabblad).
-- 2. start_toets: examenvragen komen uit de live hoofdstukken. Zijn er nog geen live hoofdstukken
--    met examenvragen, dan uit de oude losse examenbank (module_id is null).
-- De complete e-learning (13 hoofdstukken, 52 lessen, 248 vragen) is als concept geladen
-- via een apart script. Bekijken en live zetten gaat via Beheer > Presentatie.

create or replace function public.vragen_beheer(p_cursus uuid)
 returns setof vragen
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
begin
  if not is_beheerder() then raise exception 'Alleen een beheerder mag de vragen bekijken'; end if;
  return query select * from vragen where cursus_id = p_cursus order by soort, volgorde;
end $function$;

grant execute on function public.vragen_beheer(uuid) to authenticated;

create or replace function public.start_toets(p_inschrijving uuid, p_soort vraag_soort, p_module uuid default null::uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_cursus   uuid;
  v_aantal   int;
  v_drempel  int;
  v_max      int;
  v_gedaan   int;
  v_ids      uuid[];
  v_poging   uuid;
begin
  if p_soort = 'evaluatie' then
    raise exception 'Evaluatievragen worden per vraag nagekeken';
  end if;

  select i.cursus_id, c.aantal_examenvragen, c.slaagcriterium, c.max_examenpogingen
    into v_cursus, v_aantal, v_drempel, v_max
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

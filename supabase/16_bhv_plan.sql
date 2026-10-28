-- =====================================================================
-- 16. Ons BHV-plan: per bedrijf de praktische gegevens voor een noodgeval
--
-- Het bedrijf (de contactpersoon) vult dit zelf in. Iedereen van dat
-- bedrijf kan het lezen, in de app ook zonder internet.
-- =====================================================================

create table if not exists public.bhv_plan (
  organisatie_id   uuid primary key references public.organisaties(id) on delete cascade,
  adres            text,          -- adres voor 112, met eventuele toegangsweg
  verzamelplaats   text,
  aed              text,          -- waar hangen de AED's
  ehbo             text,          -- waar staan de EHBO-koffers
  blusmiddelen     text,          -- blussers, haspels, blusdekens
  ontruimingsplan  text,          -- waar hangt het plan, wie neemt wat mee
  alarm            text,          -- hoe gaat het alarm, hoe herken je het
  contacten        jsonb not null default '[]'::jsonb,  -- [{rol, naam, tel}]
  extra            text,
  bijgewerkt_op    timestamptz not null default now(),
  bijgewerkt_door  uuid
);

alter table public.bhv_plan enable row level security;

drop policy if exists bhv_plan_lezen on public.bhv_plan;
create policy bhv_plan_lezen on public.bhv_plan
  for select using (is_beheerder() or organisatie_id = mijn_organisatie());

-- Schrijven gaat alleen via de functie hieronder.
revoke insert, update, delete on public.bhv_plan from anon, authenticated;
grant select on public.bhv_plan to authenticated;

create or replace function public.zet_bhv_plan(p_plan jsonb, p_org uuid default null)
returns public.bhv_plan
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_rol text := mijn_rol();
  v_uit public.bhv_plan;
  v_contacten jsonb := coalesce(p_plan->'contacten', '[]'::jsonb);
begin
  if v_rol = 'beheerder' then
    v_org := coalesce(p_org, mijn_organisatie());
  elsif v_rol = 'contactpersoon' then
    v_org := mijn_organisatie();
  else
    raise exception 'Alleen de contactpersoon van het bedrijf kan het BHV-plan aanpassen';
  end if;
  if v_org is null then raise exception 'Geen bedrijf gevonden'; end if;
  if jsonb_typeof(v_contacten) <> 'array' or jsonb_array_length(v_contacten) > 30 then
    raise exception 'Ongeldige lijst met contacten';
  end if;

  insert into public.bhv_plan as b (organisatie_id, adres, verzamelplaats, aed, ehbo, blusmiddelen,
                                    ontruimingsplan, alarm, contacten, extra, bijgewerkt_op, bijgewerkt_door)
  values (v_org,
          left(nullif(trim(p_plan->>'adres'), ''), 500),
          left(nullif(trim(p_plan->>'verzamelplaats'), ''), 500),
          left(nullif(trim(p_plan->>'aed'), ''), 1000),
          left(nullif(trim(p_plan->>'ehbo'), ''), 1000),
          left(nullif(trim(p_plan->>'blusmiddelen'), ''), 1000),
          left(nullif(trim(p_plan->>'ontruimingsplan'), ''), 1000),
          left(nullif(trim(p_plan->>'alarm'), ''), 1000),
          v_contacten,
          left(nullif(trim(p_plan->>'extra'), ''), 2000),
          now(), auth.uid())
  on conflict (organisatie_id) do update set
    adres = excluded.adres, verzamelplaats = excluded.verzamelplaats, aed = excluded.aed,
    ehbo = excluded.ehbo, blusmiddelen = excluded.blusmiddelen,
    ontruimingsplan = excluded.ontruimingsplan, alarm = excluded.alarm,
    contacten = excluded.contacten, extra = excluded.extra,
    bijgewerkt_op = now(), bijgewerkt_door = auth.uid()
  returning * into v_uit;
  return v_uit;
end $$;

revoke all on function public.zet_bhv_plan(jsonb, uuid) from public, anon;
grant execute on function public.zet_bhv_plan(jsonb, uuid) to authenticated;

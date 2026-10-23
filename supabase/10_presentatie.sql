-- =====================================================================
--  10_presentatie.sql
--  Hoofdstukken uit een PowerPoint, met per dia een greenscreen-video.
--
--  Niets wordt weggegooid. Een import komt eerst als concept in de
--  database. Pas bij publiceren gaan de oude basishoofdstukken naar het
--  archief en worden de nieuwe zichtbaar. De klanthoofdstukken (met een
--  organisatie_id) blijven altijd staan.
-- =====================================================================

-- ---------- kolommen ----------
alter table modules add column if not exists status text not null default 'live';
alter table modules add column if not exists gearchiveerd_op timestamptz;
alter table modules drop constraint if exists modules_status_check;
alter table modules add constraint modules_status_check
  check (status in ('live', 'concept', 'archief'));

-- dias: [{nr, beeld, titel, tekst, notities, video:{url, pad, x, y, schaal, kleur, sim, zacht, spill, duur}}]
alter table lessen add column if not exists dias jsonb not null default '[]'::jsonb;

-- ---------- wie ziet wat ----------
-- Een cursist ziet alleen wat live staat. Een beheerder ziet alles,
-- ook het concept en het archief, om te kunnen controleren.
drop policy if exists module_lezen on modules;
create policy module_lezen on modules for select using (
  mag_cursus_zien(cursus_id) and (
    is_beheerder()
    or (status = 'live' and (organisatie_id is null or organisatie_id = mijn_organisatie()))
  )
);

drop policy if exists les_lezen on lessen;
create policy les_lezen on lessen for select using (
  exists (
    select 1 from modules m
    where m.id = lessen.module_id
      and mag_cursus_zien(m.cursus_id)
      and (
        is_beheerder()
        or (m.status = 'live' and (m.organisatie_id is null or m.organisatie_id = mijn_organisatie()))
      )
  )
);

-- Het aantal lessen in de voortgang telt alleen wat live staat.
create or replace function lessen_voor(p_cursus uuid, p_org uuid)
returns bigint language sql stable security definer set search_path to 'public' as $$
  select count(*)
  from lessen l
  join modules m on m.id = l.module_id
  where m.cursus_id = p_cursus
    and m.status = 'live'
    and (m.organisatie_id is null or m.organisatie_id = p_org);
$$;

-- ---------- opslag voor dia's en video's ----------
insert into storage.buckets (id, name, public, allowed_mime_types)
values ('presentaties', 'presentaties', true,
        array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime', 'video/webm'])
on conflict (id) do update set public = true, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists presentaties_lezen on storage.objects;
create policy presentaties_lezen on storage.objects for select
  using (bucket_id = 'presentaties' and public.is_beheerder());
drop policy if exists presentaties_erin on storage.objects;
create policy presentaties_erin on storage.objects for insert
  with check (bucket_id = 'presentaties' and public.is_beheerder());
drop policy if exists presentaties_wijzig on storage.objects;
create policy presentaties_wijzig on storage.objects for update
  using (bucket_id = 'presentaties' and public.is_beheerder());
drop policy if exists presentaties_weg on storage.objects;
create policy presentaties_weg on storage.objects for delete
  using (bucket_id = 'presentaties' and public.is_beheerder());

-- ---------- importeren als concept ----------
-- p_plan: {bestand, klant_na, hoofdstukken:[{titel, lessen:[{titel, dias:[...]}]}]}
create or replace function importeer_presentatie(p_cursus uuid, p_plan jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  h jsonb; l jsonb;
  i int := 0; j int;
  v_mod uuid;
  n_les int := 0; n_dia int := 0;
begin
  if not is_beheerder() then raise exception 'Alleen een beheerder mag een presentatie importeren'; end if;
  if jsonb_array_length(coalesce(p_plan->'hoofdstukken', '[]')) = 0 then
    raise exception 'Er staan geen hoofdstukken in de import';
  end if;

  -- Een eerder concept maakt plaats voor dit nieuwe.
  delete from modules where cursus_id = p_cursus and status = 'concept';

  for h in select * from jsonb_array_elements(p_plan->'hoofdstukken') loop
    i := i + 1;
    insert into modules (cursus_id, titel, volgorde, status)
    values (p_cursus, coalesce(nullif(trim(h->>'titel'), ''), 'Hoofdstuk ' || i), i * 10, 'concept')
    returning id into v_mod;
    j := 0;
    for l in select * from jsonb_array_elements(coalesce(h->'lessen', '[]')) loop
      j := j + 1;
      insert into lessen (module_id, titel, volgorde, dias, tekst, markeringen, videos)
      values (v_mod, coalesce(nullif(trim(l->>'titel'), ''), 'Les ' || j), j,
              coalesce(l->'dias', '[]'), '[]', '[]', '[]');
      n_les := n_les + 1;
      n_dia := n_dia + jsonb_array_length(coalesce(l->'dias', '[]'));
    end loop;
  end loop;

  insert into instellingen (sleutel, waarde, omschrijving)
  values ('presentatie_concept',
          jsonb_build_object('bestand', p_plan->>'bestand',
                             'klant_na', coalesce((p_plan->>'klant_na')::int, 1),
                             'op', now()),
          'Laatste PowerPoint-import die als concept klaarstaat')
  on conflict (sleutel) do update set waarde = excluded.waarde;

  return jsonb_build_object('hoofdstukken', i, 'lessen', n_les, 'dias', n_dia);
end $$;

-- ---------- de dia's van een les bijwerken (video's koppelen) ----------
create or replace function zet_dias(p_les uuid, p_dias jsonb, p_duur int default null)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if not is_beheerder() then raise exception 'Alleen een beheerder mag dia''s aanpassen'; end if;
  update lessen set dias = coalesce(p_dias, '[]'), duur_seconden = coalesce(p_duur, duur_seconden)
  where id = p_les;
  if not found then raise exception 'Deze les bestaat niet'; end if;
end $$;

-- ---------- publiceren ----------
create or replace function publiceer_presentatie(p_cursus uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_na int;
  n int;
begin
  if not is_beheerder() then raise exception 'Alleen een beheerder mag publiceren'; end if;
  select count(*) into n from modules where cursus_id = p_cursus and status = 'concept';
  if n = 0 then raise exception 'Er staat geen concept klaar om te publiceren'; end if;

  select coalesce((waarde->>'klant_na')::int, 1) into v_na
  from instellingen where sleutel = 'presentatie_concept';
  v_na := coalesce(v_na, 1);

  update modules set status = 'archief', gearchiveerd_op = now()
  where cursus_id = p_cursus and status = 'live' and organisatie_id is null;

  -- Concept op volgorde 10, 20, 30. Klanthoofdstukken daartussen.
  with r as (
    select id, row_number() over (order by volgorde) rn
    from modules where cursus_id = p_cursus and status = 'concept'
  )
  update modules m set status = 'live', volgorde = r.rn * 10
  from r where m.id = r.id;

  update modules set volgorde = v_na * 10 + 5
  where cursus_id = p_cursus and organisatie_id is not null and status = 'live';

  delete from instellingen where sleutel = 'presentatie_concept';
  return jsonb_build_object('gepubliceerd', n);
end $$;

-- ---------- concept weggooien ----------
create or replace function verwijder_concept(p_cursus uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if not is_beheerder() then raise exception 'Alleen een beheerder mag het concept weggooien'; end if;
  delete from modules where cursus_id = p_cursus and status = 'concept';
  delete from instellingen where sleutel = 'presentatie_concept';
end $$;

-- ---------- terug naar de vorige versie ----------
-- De huidige basishoofdstukken gaan terug naar concept, de laatst
-- gearchiveerde komen weer live.
create or replace function zet_vorige_versie_terug(p_cursus uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_op timestamptz;
  n int;
begin
  if not is_beheerder() then raise exception 'Alleen een beheerder mag dit doen'; end if;
  select max(gearchiveerd_op) into v_op from modules where cursus_id = p_cursus and status = 'archief';
  if v_op is null then raise exception 'Er staat geen vorige versie in het archief'; end if;

  delete from modules where cursus_id = p_cursus and status = 'concept';
  update modules set status = 'concept'
  where cursus_id = p_cursus and status = 'live' and organisatie_id is null;
  update modules set status = 'live', gearchiveerd_op = null
  where cursus_id = p_cursus and status = 'archief' and gearchiveerd_op = v_op;
  get diagnostics n = row_count;
  return jsonb_build_object('teruggezet', n);
end $$;

grant execute on function importeer_presentatie(uuid, jsonb) to authenticated;
grant execute on function zet_dias(uuid, jsonb, int) to authenticated;
grant execute on function publiceer_presentatie(uuid) to authenticated;
grant execute on function verwijder_concept(uuid) to authenticated;
grant execute on function zet_vorige_versie_terug(uuid) to authenticated;

notify pgrst, 'reload schema';

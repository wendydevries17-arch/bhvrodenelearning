-- =====================================================================
--  21. Optionele hoofdstukken (20 nov 2026)
--  Een optioneel hoofdstuk staat standaard UIT. In Beheer > Lessen per
--  klant zet je het per bedrijf aan. Eerste: "Risico's per branche".
--  Ook: het examen en het examenslot kijken alleen naar hoofdstukken die
--  dit bedrijf echt heeft (geen klanthoofdstukken van anderen, geen
--  hoofdstukken waarvan alles uit staat, geen optionele die uit staan).
-- =====================================================================
alter table public.modules add column if not exists optioneel boolean not null default false;

create table if not exists public.klant_module_aan (
  organisatie_id uuid not null references public.organisaties(id) on delete cascade,
  module_id      uuid not null references public.modules(id) on delete cascade,
  primary key (organisatie_id, module_id)
);
alter table public.klant_module_aan enable row level security;
drop policy if exists klant_module_aan_lezen on public.klant_module_aan;
create policy klant_module_aan_lezen on public.klant_module_aan for select
  using (is_beheerder() or organisatie_id = mijn_organisatie());
grant select on public.klant_module_aan to authenticated;

create or replace function public.module_voor_bedrijf(p_module uuid, p_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from modules m
     where m.id = p_module and m.status = 'live'
       and (m.organisatie_id is null or m.organisatie_id = p_org)
       and (not m.optioneel or exists (select 1 from klant_module_aan a where a.module_id = m.id and a.organisatie_id = p_org))
       and exists (select 1 from lessen l where l.module_id = m.id
                    and not exists (select 1 from klant_les_uit u where u.les_id = l.id and u.organisatie_id = p_org))
  );
$$;

create or replace function public.zet_module_voor_klant(p_org uuid, p_module uuid, p_aan boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_beheerder() then raise exception 'Alleen een beheerder mag dit aanpassen'; end if;
  if p_aan then
    insert into klant_module_aan (organisatie_id, module_id) values (p_org, p_module) on conflict do nothing;
  else
    delete from klant_module_aan where organisatie_id = p_org and module_id = p_module;
  end if;
end;
$$;
revoke execute on function public.zet_module_voor_klant(uuid, uuid, boolean) from public, anon;
grant execute on function public.zet_module_voor_klant(uuid, uuid, boolean) to authenticated;

update public.modules set optioneel = true where titel = 'Risico''s per branche';

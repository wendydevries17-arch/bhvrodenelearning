-- =====================================================================
-- 17. Verwerkersovereenkomst online laten accorderen
--
-- Per klantbedrijf een persoonlijke link. De contactpersoon leest de
-- overeenkomst en geeft akkoord. Daarna kunnen de medewerkers beginnen.
-- Mails en herinneringen gaan via de functie "verwerkers".
--
-- De tabel heeft geen leesregel voor cursisten of contactpersonen: de
-- persoonlijke link mag alleen in de mail en bij de beheerder staan.
-- =====================================================================

create table if not exists public.verwerkersovereenkomst (
  organisatie_id   uuid primary key references public.organisaties(id) on delete cascade,
  token            uuid not null default gen_random_uuid() unique,
  verstuurd_op     timestamptz,
  laatst_gemaild_op timestamptz,
  herinneringen    int not null default 0,
  gemeld_op        timestamptz,          -- melding aan BHV Roden dat het blijft liggen
  akkoord_op       timestamptz,
  akkoord_naam     text,
  akkoord_functie  text,
  akkoord_email    text,
  akkoord_versie   text,
  akkoord_ip       text,
  akkoord_browser  text
);

alter table public.verwerkersovereenkomst enable row level security;
revoke all on public.verwerkersovereenkomst from anon, authenticated;
grant select on public.verwerkersovereenkomst to authenticated;

drop policy if exists vwo_beheer on public.verwerkersovereenkomst;
create policy vwo_beheer on public.verwerkersovereenkomst
  for select using (is_beheerder());

-- Alles wat er met de overeenkomst gebeurt, voor het dossier.
create table if not exists public.verwerkersovereenkomst_log (
  id              bigint generated always as identity primary key,
  organisatie_id  uuid references public.organisaties(id) on delete set null,
  gebeurtenis     text not null,
  details         jsonb,
  op              timestamptz not null default now()
);
alter table public.verwerkersovereenkomst_log enable row level security;
revoke all on public.verwerkersovereenkomst_log from anon, authenticated;
grant select on public.verwerkersovereenkomst_log to authenticated;
drop policy if exists vwo_log_beheer on public.verwerkersovereenkomst_log;
create policy vwo_log_beheer on public.verwerkersovereenkomst_log
  for select using (is_beheerder());

-- Mag dit bedrijf al beginnen? Het eigen bedrijf (BHV Roden) altijd.
create or replace function public.akkoord_voor_mijn_bedrijf()
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce((
    select o.is_eigenaar or o.dpa_getekend_op is not null
    from profielen p join organisaties o on o.id = p.organisatie_id
    where p.id = auth.uid()
  ), true);
$$;
revoke all on function public.akkoord_voor_mijn_bedrijf() from public, anon;
grant execute on function public.akkoord_voor_mijn_bedrijf() to authenticated;

notify pgrst, 'reload schema';

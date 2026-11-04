-- =====================================================================
-- 18. Praktijkcertificaten: alleen een logboek van wat er gemaild is.
-- Namen en geboortedata worden niet opgeslagen.
-- =====================================================================
create table if not exists public.praktijkcertificaten_log (
  id             bigint generated always as identity primary key,
  soort          text not null,
  cursusdatum    text,
  aantal         int not null,
  verstuurd_naar text not null,
  door           uuid,
  op             timestamptz not null default now()
);
alter table public.praktijkcertificaten_log enable row level security;
revoke all on public.praktijkcertificaten_log from anon, authenticated;
grant select on public.praktijkcertificaten_log to authenticated;
drop policy if exists pcl_beheer on public.praktijkcertificaten_log;
create policy pcl_beheer on public.praktijkcertificaten_log for select using (is_beheerder());

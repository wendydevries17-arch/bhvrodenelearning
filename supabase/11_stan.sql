-- =====================================================================
--  11_stan.sql
--  BHV-Stan, de assistent van Dirk Jan. Zijn uitspraken staan hier,
--  zodat ze in het beheer aan te passen zijn zonder nieuwe code.
--
--  moment:    start, start_module, quiz, goed, fout, afronden, geslaagd, gezakt
--  onderwerp: leeg (altijd), ehbo, brand, reanimatie, ontruiming
--  pose:      standaard, zwaait, tip, duim
-- =====================================================================

create table if not exists stan_uitspraken (
  id uuid primary key default gen_random_uuid(),
  moment text not null,
  onderwerp text,
  tekst text not null,
  pose text not null default 'standaard',
  actief boolean not null default true,
  aangemaakt_op timestamptz not null default now()
);

alter table stan_uitspraken drop constraint if exists stan_pose_check;
alter table stan_uitspraken add constraint stan_pose_check
  check (pose in ('standaard', 'zwaait', 'tip', 'duim'));

alter table stan_uitspraken enable row level security;

drop policy if exists stan_lezen on stan_uitspraken;
create policy stan_lezen on stan_uitspraken for select
  using (auth.role() = 'authenticated');

drop policy if exists stan_beheren on stan_uitspraken;
create policy stan_beheren on stan_uitspraken for all
  using (is_beheerder()) with check (is_beheerder());

grant select on stan_uitspraken to authenticated;
grant insert, update, delete on stan_uitspraken to authenticated;

-- De teksten van Wendy. Alleen als de tabel nog leeg is.
insert into stan_uitspraken (moment, onderwerp, tekst, pose)
select * from (values
  ('start', null, 'Hoi, ik ben Stan! De rechterhand van Dirk Jan. Ik leer je alles wat ik kan, zodat jij straks levens redden kan!', 'zwaait'),
  ('start_module', null, 'Daar gaan we dan! Groetjes, Stan!', 'zwaait'),
  ('start_module', null, 'Helm op? Grapje. Je mag gewoon blijven zitten.', 'standaard'),
  ('start_module', null, 'Dirk Jan heeft de kennis, ik zorg dat je wakker blijft!', 'duim'),
  ('start_module', 'ehbo', 'Geen paniek, daar hebben we een plan voor!', 'tip'),
  ('start_module', 'ehbo', 'Een pleister plakken kan iedereen. Maar weet jij ook wat je verder moet doen?', 'standaard'),
  ('start_module', 'ehbo', 'Even opletten, dit kan echt het verschil maken!', 'tip'),
  ('start_module', 'brand', 'Ik ben Stan, geen pyromaan!', 'standaard'),
  ('start_module', 'brand', 'Brand meester? Eerst maar eens de theorie meester worden!', 'tip'),
  ('start_module', 'brand', 'Dit onderwerp is behoorlijk heet!', 'duim'),
  ('start_module', 'reanimatie', 'Hier klopt iets niet... tijd om te handelen!', 'tip'),
  ('start_module', 'reanimatie', 'Een onderwerp dat je echt aan het hart gaat.', 'standaard'),
  ('start_module', 'reanimatie', 'Alle gekheid op een stokje, dit moet je goed weten.', 'tip'),
  ('start_module', 'ontruiming', 'Geen polonaise, wel netjes naar buiten!', 'zwaait'),
  ('start_module', 'ontruiming', 'De uitgang is geen geheim. Zorg dat je hem kent!', 'tip'),
  ('start_module', 'ontruiming', 'Rustig blijven, doorlopen en vooral niet de held uithangen.', 'standaard'),
  ('quiz', null, 'Even kijken of jij er wat van bakken kan!', 'tip'),
  ('quiz', null, 'Dirk Jan kijkt niet mee. Denk ik...', 'standaard'),
  ('quiz', null, 'Ik weet het antwoord al, maar jij mag eerst!', 'duim'),
  ('goed', null, 'Lekker bezig! Hier wordt zelfs Dirk Jan blij van!', 'duim'),
  ('goed', null, 'Kijk jou eens! Straks neem je mijn baan nog over!', 'duim'),
  ('goed', null, 'Bam! Die zit!', 'duim'),
  ('goed', null, 'Stan is fan!', 'duim'),
  ('fout', null, 'Oeps! Zelfs mijn helm zakte ervan af!', 'standaard'),
  ('fout', null, 'Bijna! Gelukkig oefenen we hier.', 'tip'),
  ('fout', null, 'Geen stress, Stan helpt je wel even.', 'standaard'),
  ('fout', null, 'Niet helemaal! Maar daar leer je juist van.', 'tip'),
  ('afronden', null, 'Kijk eens aan, jij kunt er wat van! Groetjes van Stan en Dirk Jan!', 'duim'),
  ('afronden', null, 'Missie geslaagd! Stan is trots!', 'duim'),
  ('afronden', null, 'Je hebt het geflikt! Tijd voor een digitaal schouderklopje.', 'zwaait'),
  ('geslaagd', null, 'Missie geslaagd! Stan is trots!', 'duim'),
  ('geslaagd', null, 'Kijk eens aan, jij kunt er wat van! Groetjes van Stan en Dirk Jan!', 'duim'),
  ('gezakt', null, 'Net niet! Lees het nog even door, dan haal je hem de volgende keer.', 'tip'),
  ('gezakt', null, 'Geen stress, Stan helpt je wel even. Nog een keer?', 'standaard')
) v(moment, onderwerp, tekst, pose)
where not exists (select 1 from stan_uitspraken);

notify pgrst, 'reload schema';

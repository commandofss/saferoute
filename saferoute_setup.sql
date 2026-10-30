-- SafeRoute: community hazard map (HERHACK 2026)
-- Paste this whole file once into a NEW Supabase project: SQL Editor > New query > Run.
-- No names, emails or accounts are stored. Reports are anonymous.

create extension if not exists pgcrypto;

-- 1. Table -------------------------------------------------------------
create table if not exists public.hazard_reports (
  id             uuid primary key default gen_random_uuid(),
  category       text not null check (category in
                   ('poor_lighting','isolated_road','harassment','theft',
                    'unsafe_transport','blocked_path','other')),
  severity       smallint not null check (severity between 1 and 3),
  time_of_day    text not null check (time_of_day in ('day','evening','night')),
  description    text check (char_length(description) <= 280),
  lat            double precision not null check (lat between -90 and 90),
  lng            double precision not null check (lng between -180 and 180),
  reporter_token text check (char_length(reporter_token) <= 64),  -- random per device, only for rate limiting
  status         text not null default 'visible' check (status in ('visible','hidden')),
  is_demo        boolean not null default false,
  created_at     timestamptz not null default now()
);

create index if not exists hazard_reports_geo_idx  on public.hazard_reports (lat, lng);
create index if not exists hazard_reports_time_idx on public.hazard_reports (created_at desc);

-- 2. Access rules (row level security) ----------------------------------
alter table public.hazard_reports enable row level security;

revoke all on public.hazard_reports from anon, authenticated;

-- Public can read only these columns (never reporter_token or status)
grant select (id, category, severity, time_of_day, description, lat, lng, created_at, is_demo)
  on public.hazard_reports to anon, authenticated;

-- Public can submit only these columns
grant insert (category, severity, time_of_day, description, lat, lng, reporter_token)
  on public.hazard_reports to anon, authenticated;

drop policy if exists "read visible reports" on public.hazard_reports;
create policy "read visible reports" on public.hazard_reports
  for select to anon, authenticated using (status = 'visible');

drop policy if exists "anyone can report" on public.hazard_reports;
create policy "anyone can report" on public.hazard_reports
  for insert to anon, authenticated
  with check (status = 'visible' and is_demo = false);

-- 3. Spam limit: max 5 reports per device per hour ------------------------
create or replace function public.limit_reports()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.is_demo then
    return new;
  end if;
  if new.reporter_token is null or length(new.reporter_token) < 16 then
    raise exception 'Missing device token';
  end if;
  if (select count(*) from public.hazard_reports
        where reporter_token = new.reporter_token
          and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'Too many reports. Please try again later.';
  end if;
  return new;
end $$;

drop trigger if exists trg_limit_reports on public.hazard_reports;
create trigger trg_limit_reports before insert on public.hazard_reports
  for each row execute function public.limit_reports();

-- 4. Risk map function (RUQAYAH: tune the weights here) --------------------
-- Splits the map into square cells and scores each one.
-- score = severity x time-of-day weight x recency (halves roughly every 21 days)
create or replace function public.risk_cells(
  min_lat double precision, min_lng double precision,
  max_lat double precision, max_lng double precision,
  cell_deg double precision default 0.002,   -- about 220 m
  only_evening_night boolean default false
)
returns table (cell_lat double precision, cell_lng double precision,
               report_count bigint, risk_score double precision)
language sql stable security invoker set search_path = public as $$
  select
    floor(lat / cell_deg) * cell_deg + cell_deg / 2,
    floor(lng / cell_deg) * cell_deg + cell_deg / 2,
    count(*),
    (sum(
       severity
       * case time_of_day when 'night' then 1.5 when 'evening' then 1.2 else 1.0 end
       * exp(-extract(epoch from (now() - created_at)) / 86400.0 / 30.0)
    ))::double precision
  from public.hazard_reports
  where lat between min_lat and max_lat
    and lng between min_lng and max_lng
    and (not only_evening_night or time_of_day in ('evening','night'))
  group by 1, 2
$$;

grant execute on function public.risk_cells(double precision, double precision,
  double precision, double precision, double precision, boolean) to anon, authenticated;

-- 5. Demo data: made-up points, clearly marked as demo ---------------------
insert into public.hazard_reports (category, severity, time_of_day, description, lat, lng, is_demo)
values
 ('poor_lighting',   3,'night',  'DEMO: streetlights off along this stretch', 8.4966, 4.5421, true),
 ('poor_lighting',   2,'night',  'DEMO: dim lighting near junction',          8.4975, 4.5432, true),
 ('isolated_road',   3,'night',  'DEMO: empty road, few people after 8pm',    8.4990, 4.5450, true),
 ('isolated_road',   2,'evening','DEMO: long quiet path',                     8.4982, 4.5440, true),
 ('harassment',      3,'evening','DEMO: repeated catcalling reported',        8.4950, 4.5405, true),
 ('theft',           2,'evening','DEMO: phone snatching reported',            8.4958, 4.5412, true),
 ('unsafe_transport',2,'night',  'DEMO: no official taxi stand',              8.5005, 4.5470, true),
 ('blocked_path',    1,'day',    'DEMO: footpath blocked by construction',    8.4940, 4.5390, true),
 ('poor_lighting',   2,'night',  'DEMO: broken lamp',                         8.4968, 4.5424, true),
 ('isolated_road',   1,'day',    'DEMO: quiet side street',                   8.5012, 4.5480, true),
 ('theft',           3,'night',  'DEMO: bag theft reported',                  8.4972, 4.5428, true),
 ('other',           1,'day',    'DEMO: stray dogs near gate',                8.4930, 4.5380, true)
on conflict do nothing;

-- Quick check: select * from risk_cells(8.48, 4.53, 8.51, 4.56);

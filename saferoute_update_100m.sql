-- SafeRoute UPDATE: reports within 100 m of each other count as ONE point.
-- Run once in the Supabase SQL Editor (same project). Safe to run on top of saferoute_setup.sql.

-- 1. New column: which point (cluster) a report belongs to
alter table public.hazard_reports add column if not exists point_id uuid;
create index if not exists hazard_reports_point_idx on public.hazard_reports (point_id);

grant select (point_id) on public.hazard_reports to anon, authenticated;

-- 2. Find the existing point within 100 m (or make this report a new point)
--    Distance is the real distance on the Earth's surface (haversine), in metres.
create or replace function public.assign_point(p_lat double precision, p_lng double precision, p_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select coalesce(
    (select t.id from (
        select a.id,
               6371000 * 2 * asin(sqrt(
                 power(sin(radians(a.lat - p_lat) / 2), 2)
                 + cos(radians(p_lat)) * cos(radians(a.lat))
                   * power(sin(radians(a.lng - p_lng) / 2), 2))) as d
        from public.hazard_reports a
        where a.id = a.point_id            -- only the first report of each point acts as its centre
          and a.id <> p_id
          and abs(a.lat - p_lat) < 0.0011
          and abs(a.lng - p_lng) < 0.0011 / greatest(cos(radians(p_lat)), 0.01)
     ) t
     where t.d <= 100
     order by t.d
     limit 1),
    p_id)
$$;

revoke execute on function public.assign_point(double precision, double precision, uuid) from public, anon, authenticated;

-- 3. Every new report is assigned automatically
create or replace function public.set_point()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.point_id := public.assign_point(new.lat, new.lng, new.id);
  return new;
end $$;

drop trigger if exists trg_set_point on public.hazard_reports;
create trigger trg_set_point before insert on public.hazard_reports
  for each row execute function public.set_point();

-- 4. Group the reports that already exist (oldest first)
do $$
declare r record;
begin
  update public.hazard_reports set point_id = null;
  for r in select id, lat, lng from public.hazard_reports order by created_at, id loop
    update public.hazard_reports set point_id = public.assign_point(r.lat, r.lng, r.id) where id = r.id;
  end loop;
end $$;

-- 5. New map function: one row per 100 m point
--    RUQAYAH: the scoring weights live here (severity x time of day x recency)
create or replace function public.risk_points(
  min_lat double precision, min_lng double precision,
  max_lat double precision, max_lng double precision,
  only_evening_night boolean default false
)
returns table (pt_id uuid, pt_lat double precision, pt_lng double precision,
               report_count bigint, risk_score double precision, top_category text)
language sql stable security invoker set search_path = public as $$
  select
    point_id,
    avg(lat),
    avg(lng),
    count(*),
    (sum(
       severity
       * case time_of_day when 'night' then 1.5 when 'evening' then 1.2 else 1.0 end
       * exp(-extract(epoch from (now() - created_at)) / 86400.0 / 30.0)
    ))::double precision,
    (array_agg(category order by severity desc, created_at desc))[1]
  from public.hazard_reports
  where lat between min_lat and max_lat
    and lng between min_lng and max_lng
    and point_id is not null
    and (not only_evening_night or time_of_day in ('evening','night'))
  group by point_id
$$;

grant execute on function public.risk_points(double precision, double precision,
  double precision, double precision, boolean) to anon, authenticated;

-- Check: select * from risk_points(8.48, 4.53, 8.51, 4.56);

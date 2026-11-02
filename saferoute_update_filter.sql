-- SafeRoute UPDATE: show only chosen report types. Run once in the Supabase SQL Editor.
-- Replaces risk_points with a version that accepts an optional list of categories.
drop function if exists public.risk_points(double precision, double precision, double precision, double precision, boolean);

create or replace function public.risk_points(
  min_lat double precision, min_lng double precision,
  max_lat double precision, max_lng double precision,
  only_evening_night boolean default false,
  only_categories text[] default null          -- null = all types
)
returns table (pt_id uuid, pt_lat double precision, pt_lng double precision,
               report_count bigint, risk_score double precision, top_category text)
language sql stable security invoker set search_path = public as $$
  select
    point_id, avg(lat), avg(lng), count(*),
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
    and (only_categories is null or category = any(only_categories))
  group by point_id
$$;

grant execute on function public.risk_points(double precision, double precision,
  double precision, double precision, boolean, text[]) to anon, authenticated;

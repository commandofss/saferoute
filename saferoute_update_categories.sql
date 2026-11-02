-- SafeRoute UPDATE: new report categories. Run once in the Supabase SQL Editor.
-- Existing reports stay valid (all old categories are kept).
alter table public.hazard_reports drop constraint if exists hazard_reports_category_check;
alter table public.hazard_reports add constraint hazard_reports_category_check
  check (category in (
    'sexual_assault','kidnapping','physical_assault','robbery','theft',
    'harassment','stalking','gang_activity','unsafe_transport',
    'poor_lighting','isolated_road','blocked_path','other'));

-- Verification for the 2026-10 security and storage migration.
-- Safe to run as often as you like. Reads only, changes nothing.
--
-- Every row should read ok. Anything else tells you exactly which step is missing.

-- 1. The email leak is closed. Expect one row: email column gone.
select 'email column removed' as item, case
  when not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'email'
  ) then 'ok' else 'STILL PRESENT - leak is open'
end as result;

-- 2. The helper functions exist and the signed-in role may run them.
-- Without the grants every profiles read fails with "permission denied".
select 'function grants' as item, fn.proname as function,
  case when has_function_privilege('authenticated', fn.oid, 'execute') then 'ok'
       else 'MISSING GRANT - run supabase-fix-function-permissions.sql' end as result
from pg_proc fn
where fn.pronamespace = 'public'::regnamespace
  and fn.proname in ('is_friend', 'shares_group_with', 'owns_shared_reviewer_with',
                     'find_people', 'mark_study_day')
order by fn.proname;

-- 3. The streak is one row per account, and the old day table is gone.
select 'streak table' as item, case
  when to_regclass('public.reviewer_study_streak') is not null then 'ok'
  else 'MISSING - run the migration' end as result;

select 'old day table removed' as item, case
  when to_regclass('public.reviewer_study_days') is null then 'ok'
  else 'still there, wasting space' end as result;

-- 4. The profiles policy is the tightened one, not the open using (true).
select 'profiles read policy' as item, polic.qual as using_clause,
  case when polic.qual <> 'true' then 'ok' else 'STILL OPEN to every account' end as result
from pg_policies polic
where polic.schemaname = 'public' and polic.tablename = 'profiles' and polic.policyname = 'Users can read profiles';

-- 5. Your own profile row survived the column drop, with a name and picture.
select 'profile row intact' as item, count(*) as rows,
  count(display_name) as with_name, count(avatar_url) as with_avatar
from public.profiles;

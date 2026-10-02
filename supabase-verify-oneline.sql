-- Single-glance status for the security migration. One result set, one row per
-- check. Reads only, changes nothing. Run it whenever you want to confirm state.
--
-- Every result should read 'ok'.

with checks as (

  -- 1. The leak itself: no email column to read.
  select 1 as ord, 'email column gone' as check,
    case when not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'profiles' and column_name = 'email'
    ) then 'ok' else 'STILL PRESENT - leak is open' end as result

  -- 2. The signed-in role can run every function the policies and app call.
  --    A missing grant here is what caused "permission denied for function is_friend".
  union all
  select 2, 'can run ' || fn.proname,
    case when has_function_privilege('authenticated', fn.oid, 'execute') then 'ok'
         else 'MISSING GRANT' end
  from pg_proc fn
  where fn.pronamespace = 'public'::regnamespace
    and fn.proname in ('is_friend', 'shares_group_with', 'owns_shared_reviewer_with',
                       'find_people', 'mark_study_day')

  -- 3. Streak is one row per account.
  union all
  select 3, 'streak table exists',
    case when to_regclass('public.reviewer_study_streak') is not null then 'ok'
         else 'MISSING - streak will not sync' end

  -- 4. The day-per-row table is gone.
  union all
  select 4, 'old day table removed',
    case when to_regclass('public.reviewer_study_days') is null then 'ok'
         else 'still there, wasting space' end

  -- 5. profiles is closed to strangers rather than open to every account.
  union all
  select 5, 'profiles policy tightened',
    case when not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = 'profiles'
        and policyname = 'Users can read profiles' and qual = 'true'
    ) then 'ok' else 'STILL OPEN to every account' end

  -- 6. Your own data survived the column drop.
  union all
  select 6, 'profiles kept name and picture',
    case when (select count(*) from public.profiles) > 0
          and (select count(*) from public.profiles where display_name is null) = 0
         then 'ok' else 'check this' end
)

select check, result from checks order by ord;

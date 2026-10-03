-- Owner-only usage statistics for the site.
--
-- Run this once in the Supabase SQL editor, after supabase-schema.sql. It is
-- safe to run again. Nothing here is readable by any other account: the single
-- function below returns null unless private.is_admin() is true, which is the
-- same gate admin_database_usage already uses.
--
-- The numbers describe accounts, not people. An email address is deliberately
-- not returned anywhere, so the page cannot be used to walk the user list, and
-- no per-user rows are exposed at all: everything below is an aggregate.

begin;

-- Aggregates for the statistics page, in one round trip.
--
-- Counting is done here rather than in the client because auth.users is not
-- readable by any client, and because a count taken by the browser would have
-- to pull every row down to count it.
--
-- activeUsers7d and activeUsers30d are counted from the study streak's
-- last_study_day rather than from auth.users.last_sign_in_at, because a user
-- who signs in but never opens a reviewer is still using the site, and because
-- last_sign_in_at is an auth column that changes on every refresh token.
--
-- security definer is required: the caller's own role cannot read auth.users at
-- all, and cannot read the other users' reviewer rows. The function is only ever
-- entered after the is_admin check below, so it widens nothing for anyone else.
create or replace function public.admin_user_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_total bigint;
  v_new_7d bigint;
  v_new_30d bigint;
  v_active_7d bigint;
  v_active_30d bigint;
  v_confirmed bigint;
  v_online integer;
  v_reviewers bigint;
  v_attempts bigint;
  v_attempts_7d bigint;
  v_friendships bigint;
  v_groups bigint;
  v_shares bigint;
  v_avg_attempts numeric;
begin
  if not private.is_admin() then
    return null;
  end if;

  select count(*),
         count(*) filter (where created_at >= now() - interval '7 days'),
         count(*) filter (where created_at >= now() - interval '30 days'),
         count(*) filter (where email_confirmed_at is not null)
  into v_total, v_new_7d, v_new_30d, v_confirmed
  from auth.users;

  -- A user counts as active on their last study day, which is the last day
  -- they actually answered something rather than merely opened the app.
  select count(*) filter (where last_study_day >= current_date - 6),
         count(*) filter (where last_study_day >= current_date - 29)
  into v_active_7d, v_active_30d
  from public.reviewer_study_streak;

  select count(*)::integer into v_online
  from public.presence_pings
  where last_seen > now() - interval '150 seconds';

  select count(*) into v_reviewers from public.reviewers;

  select count(*),
         count(*) filter (where created_at >= now() - interval '7 days')
  into v_attempts, v_attempts_7d
  from public.reviewer_attempts;

  select avg(attempt_count) into v_avg_attempts
  from (
    select count(*) as attempt_count
    from public.reviewer_attempts
    group by owner_id
  ) per_user;

  select count(*) into v_friendships
  from public.friendships
  where status = 'accepted';

  select count(*) into v_groups from public.study_groups;
  select count(*) into v_shares from public.reviewer_shares;

  return jsonb_build_object(
    'totalUsers', v_total,
    'newUsers7d', v_new_7d,
    'newUsers30d', v_new_30d,
    'activeUsers7d', v_active_7d,
    'activeUsers30d', v_active_30d,
    'confirmedUsers', v_confirmed,
    'onlineNow', coalesce(v_online, 0),
    'reviewerCount', v_reviewers,
    'attemptCount', v_attempts,
    'attempts7d', v_attempts_7d,
    'avgAttemptsPerUser', round(coalesce(v_avg_attempts, 0), 1),
    'friendshipCount', v_friendships,
    'groupCount', v_groups,
    'shareCount', v_shares
  );
end;
$$;

revoke execute on function public.admin_user_stats() from public, anon;
grant execute on function public.admin_user_stats() to authenticated;

-- Signups per day for the last 30 days, oldest first, so the page can draw a
-- sparkline. generate_series supplies the days with no signups, otherwise a gap
-- in the series would silently compress the chart instead of showing a zero.
--
-- Only the date comes back, never an address or an id.
create or replace function public.admin_signup_series(p_days integer default 30)
returns table (day date, signups bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_days integer := least(greatest(coalesce(p_days, 30), 1), 90);
begin
  if not private.is_admin() then
    return;
  end if;

  return query
  with days as (
    select generate_series(
      (current_date - make_interval(days => v_days - 1)),
      current_date,
      interval '1 day'
    )::date as day
  ),
  counts as (
    select created_at::date as day, count(*) as signups
    from auth.users
    where created_at >= current_date - make_interval(days => v_days - 1)
    group by 1
  )
  select days.day, coalesce(counts.signups, 0)
  from days
  left join counts on counts.day = days.day
  order by days.day;
end;
$$;

revoke execute on function public.admin_signup_series(integer) from public, anon;
grant execute on function public.admin_signup_series(integer) to authenticated;

commit;

-- After running, both of these should fail or return nothing for a non-admin
-- signed-in session, which is the check that matters:
--   select public.admin_user_stats();      -- null
--   select * from public.admin_signup_series();  -- no rows
-- As the admin both return data.

-- First-party page views, so "how many people visited" is answerable from this
-- database instead of from a Vercel dashboard.
--
-- Run this once in the Supabase SQL editor. It is safe to run again. The app
-- degrades to "no traffic recorded" until it has been applied, so it can be
-- deployed first: the statistics page reports the missing function on the Visits
-- section and the rest of the page is unaffected.
--
-- What is deliberately not here. No ip address, no user agent, no referrer, no
-- user id, no query string, no reviewer id, no group id and no invite code. A
-- row is a random per-tab key, one of the fixed route names below, and a
-- timestamp. That is the whole record, and it is why nothing per-account or
-- per-device can be read back even by the owner.
--
-- The route name is checked against a fixed list rather than stored as sent,
-- which is the part that matters. A client could otherwise put anything in
-- p_path, and a route with an identifier in it would be one careless change away
-- from writing that identifier into a table the owner can read. The list below
-- must stay identical to the one in src/utils/analyticsRoutes.js, which
-- scripts/question-style-check.mjs asserts.

begin;

-- One row per counted page view. The primary key is a surrogate because the
-- natural key is (session_key, path, viewed_at) and two views of the same route
-- in the same tab have to be distinguishable once the dedupe window has passed.
create table if not exists public.page_views (
  id uuid primary key default gen_random_uuid(),
  session_key text not null,
  path text not null,
  viewed_at timestamptz not null default now()
);

-- The retention sweep and the daily chart both read by time.
create index if not exists page_views_viewed_at_idx
  on public.page_views (viewed_at desc);

-- The dedupe check. Without this the window scan is a sequential pass over every
-- view the site has ever recorded.
create index if not exists page_views_key_path_idx
  on public.page_views (session_key, path, viewed_at desc);

alter table public.page_views enable row level security;

-- Reachable only through the two functions below. RLS with no policy already
-- refuses reads to anon and authenticated, and the revoke states it outright so
-- a later `alter table ... enable row level security` or a policy added by hand
-- cannot quietly open the table.
revoke all on table public.page_views from anon, authenticated;

-- Records one page view.
--
-- Best effort by design: a caller that is offline, or on a database without this
-- migration, simply loses the count, and nothing in the app waits on the answer.
-- The function returns void so there is nothing to leak back to the caller.
--
-- security definer because the table is deliberately unreadable to clients. It is
-- only ever entered through the allowlist below, so it widens nothing: the caller
-- chooses a key and a route name, and both are checked before anything is
-- written.
create or replace function public.record_page_view(p_key text, p_path text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_key is null or p_key !~ '^[A-Za-z0-9_-]{8,64}$' then
    return;
  end if;

  -- The allowlist. A path outside it is dropped rather than trimmed, so a route
  -- that has not been thought about cannot be recorded at all. This is the
  -- reason /groups/join/<invite code> cannot land in the table: the code is
  -- collapsed to /groups/join in the browser, and /groups/join/<anything> is not
  -- on this list.
  if p_path is null or not (p_path = any (array[
    '/', '/home', '/history', '/library', '/friends', '/groups', '/group',
    '/groups/join', '/generator', '/reviewer', '/quiz', '/results', '/review',
    '/account', '/admin/stats', '/about', '/contact', '/privacy', '/terms',
    '/features', '/faq', '/guides', '/guide'
  ])) then
    return;
  end if;

  -- Two pings from one tab can overlap: the effect fires again on a fast
  -- navigation, and a retry is possible on a flaky connection. Without a lock
  -- both calls can see the window as empty and write two views. Serialising on
  -- the key is enough; a hash collision between two different tabs costs
  -- nothing but a moment of waiting.
  perform pg_advisory_xact_lock(hashtext(p_key));

  -- A page view is one tab looking at one route, counted once every thirty
  -- minutes. The same tab reloading the same route is the same view, which is
  -- the difference between "how many pages were looked at" and "how many times
  -- somebody pressed refresh". A tab moving to a different route is a new view
  -- immediately, because that is what the route chart is for.
  if exists (
    select 1
    from public.page_views
    where session_key = p_key
      and path = p_path
      and viewed_at > now() - interval '30 minutes'
  ) then
    return;
  end if;

  insert into public.page_views (session_key, path) values (p_key, p_path);

  -- Retention. Sampled rather than run on every ping: the table is small and the
  -- sweep is a full pass over the oldest rows, so doing it every time would
  -- charge every visitor for it. A visit older than this cannot appear in any
  -- figure the page shows, since the series is capped at 90 days.
  if random() < 0.02 then
    delete from public.page_views where viewed_at < now() - interval '180 days';
  end if;
end;
$$;

revoke execute on function public.record_page_view(text, text) from public;
grant execute on function public.record_page_view(text, text) to anon, authenticated;

-- Traffic for the statistics page, in one round trip.
--
-- Gated by the same private.is_admin() as admin_user_stats, and the gate is
-- checked before anything is read rather than relying on the caller to ask
-- nicely. Everything below is an aggregate: a count, a distinct count over a
-- random key, a route name from the allowlist, and a date. There is no select
-- of a row and no column that came from a person.
--
-- security definer is required because no client may read public.page_views at
-- all, which is the point of it. The function widens nothing for a non-admin: it
-- returns null and reads nothing.
create or replace function public.admin_traffic_stats(p_days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_days integer := least(greatest(coalesce(p_days, 30), 1), 90);
  v_first_day date := current_date - make_interval(days => v_days - 1);
  v_previous_first_day date := current_date - make_interval(days => (v_days * 2) - 1);
  v_views_today bigint;
  v_visitors_today bigint;
  v_views_yesterday bigint;
  v_visitors_yesterday bigint;
  v_views_period bigint;
  v_visitors_period bigint;
  v_views_previous bigint;
  v_visitors_previous bigint;
begin
  if not private.is_admin() then
    return null;
  end if;

  -- A visitor is a distinct session key, which is a per-tab random value held in
  -- session storage. It is not a person and cannot be joined to an account: a
  -- signed-in visitor is counted by that key like anybody else, because reading
  -- auth.uid() here would make the traffic numbers a second account list.
  --
  -- Everything below is one pass. Each figure is the same two expressions over
  -- the same rows, and this is the only table here worth not scanning more than
  -- once to get eight numbers.
  --
  -- Yesterday is counted because today on its own is a number with nothing to be
  -- read against. The previous period is counted for the same reason at a larger
  -- scale, and it is a genuinely separate window rather than a subtraction, so
  -- the retention sweep cannot quietly change what a comparison says.
  select
    count(*) filter (where viewed_at::date = current_date),
    count(distinct session_key) filter (where viewed_at::date = current_date),
    count(*) filter (where viewed_at::date = current_date - 1),
    count(distinct session_key) filter (where viewed_at::date = current_date - 1),
    count(*) filter (where viewed_at::date >= v_first_day),
    count(distinct session_key) filter (where viewed_at::date >= v_first_day),
    count(*) filter (where viewed_at::date >= v_previous_first_day and viewed_at::date < v_first_day),
    count(distinct session_key) filter (where viewed_at::date >= v_previous_first_day and viewed_at::date < v_first_day)
  into v_views_today, v_visitors_today,
       v_views_yesterday, v_visitors_yesterday,
       v_views_period, v_visitors_period,
       v_views_previous, v_visitors_previous
  from public.page_views;

  return jsonb_build_object(
    'days', v_days,
    'viewsToday', coalesce(v_views_today, 0),
    'visitorsToday', coalesce(v_visitors_today, 0),
    'viewsYesterday', coalesce(v_views_yesterday, 0),
    'visitorsYesterday', coalesce(v_visitors_yesterday, 0),
    'viewsPeriod', coalesce(v_views_period, 0),
    'visitorsPeriod', coalesce(v_visitors_period, 0),
    'viewsPrevious', coalesce(v_views_previous, 0),
    'visitorsPrevious', coalesce(v_visitors_previous, 0),
    'series', (
      select coalesce(jsonb_agg(to_jsonb(day_row) order by day_row.day), '[]'::jsonb)
      from (
        with days as (
          select generate_series(v_first_day, current_date, interval '1 day')::date as day
        ),
        counts as (
          select viewed_at::date as day, count(*) as views, count(distinct session_key) as visitors
          from public.page_views
          where viewed_at::date >= v_first_day
          group by 1
        )
        select days.day, coalesce(counts.views, 0) as views, coalesce(counts.visitors, 0) as visitors
        from days
        left join counts on counts.day = days.day
      ) day_row
    ),
    'topRoutes', (
      select coalesce(jsonb_agg(to_jsonb(route_row) order by route_row.views desc, route_row.path), '[]'::jsonb)
      from (
        select path, count(*) as views
        from public.page_views
        where viewed_at::date >= v_first_day
        group by path
        order by views desc
        limit 12
      ) route_row
    )
  );
end;
$$;

revoke execute on function public.admin_traffic_stats(integer) from public, anon;
grant execute on function public.admin_traffic_stats(integer) to authenticated;

commit;

-- After running, these are the checks that matter:
--   select public.record_page_view('tab-abcdefgh', '/library');   -- one row
--   select public.record_page_view('tab-abcdefgh', '/library');   -- still one row
--   select public.record_page_view('tab-abcdefgh', '/quiz/x');     -- dropped
--   select * from public.page_views;                               -- owner session only
--   select public.admin_traffic_stats();                           -- null unless admin
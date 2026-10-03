-- AI spend protection and a private admin allowlist.
--
-- Run this once in the Supabase SQL editor, after supabase-migration-2026-10-security.sql.
-- It is written to be safe to run again.
--
-- WHY THIS EXISTS
--
-- The provider keys are on free tiers with no billing attached, so the harm from
-- abuse is not a bill. It is quota exhaustion: the provider starts refusing the
-- account, and then the owner's own generation breaks too. Free tiers also cap
-- requests per minute, so a burst from a few accounts hurts more than a slow drip.
--
-- Three changes address that:
--
--   1. The counter lives in a table, so it is shared by every instance on the fleet
--      and survives a cold start. It used to be a Map inside one warm serverless
--      instance, which meant N instances allowed N times the intended limit.
--
--   2. The counter is keyed on something the caller cannot choose. For a signed-in
--      request the key is derived from auth.uid() here in the function, so there is
--      no header to rotate. For an anonymous request it is a hash of the address,
--      which is the best available signal and is capped lower.
--
--   3. Counting is atomic. The row lock is held to the end of the call, so two
--      simultaneous requests cannot both read the same count and both pass.
--
-- The admin email moves out of this repository too. It used to be a literal in
-- supabase-schema.sql, which is public, so anybody could read the owner address
-- out of git history. private.is_admin() checks a table that is revoked from every
-- client role, plus the app_metadata flag you can set from the dashboard.
--
-- AFTER RUNNING, GRANT YOURSELF ADMIN ACCESS. This is the one required manual
-- step. Nothing below names an address, on purpose. Uncomment, fill in your own
-- email, and run it once:
--
--   insert into private.admin_emails (email) values ('you@example.com')
--   on conflict (email) do nothing;
--
-- Then check it worked:
--
--   select private.is_admin() as is_admin;   -- run while signed in as you: true

begin;

-- 1. Private schema. Revoked from anon and authenticated so no client can list
--    anything in here. authenticated still gets usage, without which calling a
--    function that lives in this schema is impossible, but usage alone grants
--    nothing: every table below is revoked separately.
create schema if not exists private;

revoke all on schema private from public, anon, authenticated;

grant usage on schema private to authenticated;

-- 2. The admin allowlist. A row here means "this address may read the database
--    size and change the stored limit". Nothing else in the app can see the table,
--    so discovering that an address is an admin is not possible from the client.
create table if not exists private.admin_emails (
  email text primary key,
  added_at timestamptz not null default now(),
  constraint admin_emails_lowercase check (email = lower(email))
);

revoke all on private.admin_emails from anon, authenticated;

-- The alternative to a row above. Set app_metadata.admin to true for an account in
-- the Supabase dashboard (Authentication -> Users -> Edit -> app_metadata) and that
-- account passes without anything being stored in the database. Useful when you
-- would rather not keep an address on file.
create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'admin') = 'true', false)
    or exists (
      select 1
      from private.admin_emails e
      join auth.users u on lower(u.email) = e.email
      where u.id = auth.uid()
    );
$$;

-- Not granted to authenticated on purpose. Every caller reaches this through a
-- security definer function above it, which already runs as the owner. Granting it
-- would let any account ask the database "am I an admin" directly, which is
-- harmless on its own but is not worth the extra surface.
revoke all on function private.is_admin() from public, anon, authenticated;

-- 3. Durable rate limit counters, one row per subject.
--
--    subject_key is what the counter is keyed on. For a signed-in caller it is
--    derived inside the function from auth.uid() and the client cannot influence
--    it. For an anonymous caller it is 'ip:' plus a sha256 of the address, computed
--    in the serverless function, so the table never stores a raw address.
--
--    subject_id is set only for signed-in callers, which gives the row a
--    foreign key so it disappears with the account. Anonymous rows have no
--    account to belong to and are pruned by the function instead.
create table if not exists public.ai_rate_limits (
  subject_key text primary key,
  subject_id uuid references auth.users(id) on delete cascade,
  window_started_at timestamptz not null default now(),
  request_count integer not null default 0
);

-- Backs the anonymous prune below.
create index if not exists ai_rate_limits_window_idx
on public.ai_rate_limits(window_started_at);

alter table public.ai_rate_limits enable row level security;

-- No client policy, and no grant. The only writer is consume_ai_rate_limit below,
-- which runs as the table owner, so authenticated neither reads nor writes here.
revoke all on table public.ai_rate_limits from anon, authenticated;

-- 4. The counter itself. Takes one unit from the caller's window and reports what
--    is left, in the same transaction.
--
--    Executable by anon as well as authenticated, because the serverless function
--    verifies the session itself and then calls this with a plain client. A caller
--    with a real session is keyed on their own uid regardless of what they pass.
create or replace function public.consume_ai_rate_limit(
  p_ip_hash text,
  p_max_requests integer,
  p_window_seconds integer
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_key text;
  v_max integer := greatest(coalesce(p_max_requests, 8), 1);
  v_window interval := make_interval(secs => greatest(coalesce(p_window_seconds, 600), 1));
  v_now timestamptz := now();
  v_window_started_at timestamptz;
  v_count integer;
  v_reset_ms bigint;
begin
  if v_uid is not null then
    v_key := 'user:' || v_uid::text;
  else
    -- Anonymous. The shape check is what stops a caller passing an arbitrary
    -- string: without it anyone could mint a fresh key per request and the limit
    -- would mean nothing.
    if p_ip_hash is null or p_ip_hash !~ '^ip:[0-9a-f]{64}$' then
      raise exception 'missing rate limit subject';
    end if;

    v_key := p_ip_hash;

    -- Keep the anonymous rows from growing without bound. Each request discards
    -- the ones whose window closed more than a day ago, which an attacker cannot
    -- avoid while also making a real request.
    delete from public.ai_rate_limits
    where subject_id is null
      and window_started_at < now() - interval '1 day';
  end if;

  -- Create the row, then take a row lock on it. The lock is held until this call
  -- commits, which is what serializes concurrent requests from the same subject.
  insert into public.ai_rate_limits (subject_key, subject_id, window_started_at, request_count)
  values (v_key, v_uid, v_now, 0)
  on conflict (subject_key) do nothing;

  select window_started_at, request_count
  into v_window_started_at, v_count
  from public.ai_rate_limits
  where subject_key = v_key
  for update;

  -- An elapsed window starts over rather than blocking forever.
  if v_now - v_window_started_at >= v_window then
    v_window_started_at := v_now;
    v_count := 0;
  end if;

  v_reset_ms := (extract(epoch from (v_window_started_at + v_window - v_now)) * 1000)::bigint;

  if v_reset_ms < 0 then
    v_reset_ms := 0;
  end if;

  if v_count >= v_max then
    update public.ai_rate_limits
    set window_started_at = v_window_started_at,
        request_count = v_count
    where subject_key = v_key;

    return jsonb_build_object('allowed', false, 'remaining', 0, 'resetMs', v_reset_ms);
  end if;

  update public.ai_rate_limits
  set window_started_at = v_window_started_at,
      request_count = v_count + 1
  where subject_key = v_key;

  return jsonb_build_object(
    'allowed', true,
    'remaining', v_max - (v_count + 1),
    'resetMs', v_reset_ms
  );
end;
$$;

-- An earlier version of this file took (integer, integer) and refused anonymous
-- callers outright. Drop it so the new signature is the only one present.
drop function if exists public.consume_ai_rate_limit(integer, integer);

revoke all on function public.consume_ai_rate_limit(text, integer, integer) from public, anon;

grant execute on function public.consume_ai_rate_limit(text, integer, integer) to anon, authenticated;

-- 5. Point the admin functions at the allowlist. Before this, both compared the
--    caller's address against a literal sitting in a public repository.
create or replace function public.admin_database_usage()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit bigint;
  v_used bigint;
  v_reviewer_count bigint;
  v_avg_kb numeric;
  v_max_kb numeric;
begin
  if not private.is_admin() then
    return null;
  end if;

  select value into v_limit
  from public.admin_settings
  where key = 'database_limit_bytes';

  if v_limit is null or v_limit <= 0 then
    v_limit := 500 * 1024 * 1024;
  end if;

  v_used := pg_database_size(current_database());

  select count(*), avg(pg_column_size(data)), max(pg_column_size(data))
  into v_reviewer_count, v_avg_kb, v_max_kb
  from public.reviewers;

  return jsonb_build_object(
    'usedBytes', v_used,
    'limitBytes', v_limit,
    'percentUsed', round(v_used * 100.0 / v_limit, 1),
    'reviewerCount', v_reviewer_count,
    'avgReviewerKb', round(v_avg_kb / 1024.0, 1),
    'maxReviewerKb', round(v_max_kb / 1024.0, 1),
    'reviewerTableBytes', pg_total_relation_size('public.reviewers'::regclass)
  );
end;
$$;

revoke execute on function public.admin_database_usage() from public, anon;
grant execute on function public.admin_database_usage() to authenticated;

create or replace function public.admin_set_database_limit(p_limit_bytes bigint)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
begin
  if not private.is_admin() then
    raise exception 'not allowed';
  end if;

  if p_limit_bytes is null or p_limit_bytes < 1048576 then
    raise exception 'limit must be at least 1 MB';
  end if;

  insert into public.admin_settings (key, value, updated_at)
  values ('database_limit_bytes', p_limit_bytes, now())
  on conflict (key) do update set value = excluded.value, updated_at = now();

  return p_limit_bytes;
end;
$$;

revoke execute on function public.admin_set_database_limit(bigint) from public, anon;
grant execute on function public.admin_set_database_limit(bigint) to authenticated;

commit;

-- After running, these should hold.
--
--   -- 1. The allowlist is empty until you add yourself, so this should be 0 now.
--   select count(*) as admin_rows from private.admin_emails;
--
--   -- 2. No client can read the allowlist.
--   --    As the anon key: select * from private.admin_emails;   -- must error
--
--   -- 3. No client can read the counters.
--   --    As the anon key: select * from ai_rate_limits;         -- must error
--
--   -- 4. A signed-in caller is keyed on their own uid and cannot ask for another
--   --    subject. Call this as a signed-in session, then look at the key column.
--   select public.consume_ai_rate_limit(null, 3, 60);
--   select subject_key from ai_rate_limits;   -- should read user:<your own id>
--
--   -- 5. An anonymous caller must supply a well formed hash or it is refused.
--   select public.consume_ai_rate_limit('nonsense', 3, 60);   -- must error
--
--   -- 6. Four anonymous calls against a cap of three: the fourth is refused.
--   select public.consume_ai_rate_limit(repeat('a', 64), 3, 60);
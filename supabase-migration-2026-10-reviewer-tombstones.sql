-- Make a reviewer deleted on one device stay deleted on the others.
--
-- Run this once in the Supabase SQL editor. Safe to run again.
--
-- THE PROBLEM
--
-- Deleting a reviewer removes its cloud row. Every other device still holds a
-- copy in localStorage, and pushUnsyncedLocalData uploads anything it has
-- locally that is missing from the cloud, so the reviewer comes straight back on
-- the next sign-in. Deletion was never durable across devices, and a stale read
-- cache made it worse: the card kept rendering from the cache even before that.
--
-- Absence cannot carry this. "Not in the cloud" means deleted on another device,
-- or not uploaded yet, or taken offline while signed out, and the first two must
-- not be confused with the third. So a delete is recorded explicitly.
--
-- THE MECHANISM
--
-- A tombstone row per deleted reviewer, written by a trigger rather than by the
-- app. A trigger is used on purpose: deletes that never go through the client,
-- including one run by hand in the SQL editor, still leave a tombstone. A client
-- that forgot to write one would resurrect the reviewer exactly as before.
--
-- Re-creating a reviewer with the same id clears its tombstone, so the same
-- reviewer can be generated again and will sync normally.

begin;

create table if not exists public.reviewer_tombstones (
  owner_id uuid not null references auth.users(id) on delete cascade,
  reviewer_id text not null,
  deleted_at timestamptz not null default now(),
  primary key (owner_id, reviewer_id)
);

alter table public.reviewer_tombstones enable row level security;

-- Clients only ever read their own tombstones. Writes happen in the trigger
-- below, which runs as the table owner.
drop policy if exists "Users can read own tombstones" on public.reviewer_tombstones;
create policy "Users can read own tombstones"
on public.reviewer_tombstones
for select
to authenticated
using (auth.uid() = owner_id);

revoke all on public.reviewer_tombstones from anon;
grant select on public.reviewer_tombstones to authenticated;

-- Writing and clearing go through triggers rather than client calls, so a delete
-- cannot skip the record. SECURITY DEFINER because the trigger fires as the
-- deleting role, which has no insert privilege here.
create or replace function private.record_reviewer_tombstone()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.reviewer_tombstones (owner_id, reviewer_id)
  values (old.owner_id, old.reviewer_id)
  on conflict (owner_id, reviewer_id) do update set deleted_at = now();

  return old;
end;
$$;

create or replace function private.clear_reviewer_tombstone()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.reviewer_tombstones
  where owner_id = new.owner_id and reviewer_id = new.reviewer_id;

  return new;
end;
$$;

revoke all on function private.record_reviewer_tombstone() from public, anon, authenticated;
revoke all on function private.clear_reviewer_tombstone() from public, anon, authenticated;

drop trigger if exists reviewers_record_tombstone on public.reviewers;
create trigger reviewers_record_tombstone
after delete on public.reviewers
for each row execute function private.record_reviewer_tombstone();

drop trigger if exists reviewers_clear_tombstone on public.reviewers;
create trigger reviewers_clear_tombstone
after insert on public.reviewers
for each row execute function private.clear_reviewer_tombstone();

-- Tombstones are only useful while the other devices might still hold a copy, so
-- they are pruned rather than kept forever. This runs from the same place the
-- attempts table is already trimmed, which keeps it to one indexed delete on a
-- timer instead of a scheduled job.
create or replace function public.prune_reviewer_tombstones(p_older_than_days integer default 30)
returns integer
language sql
volatile
security definer
set search_path = public
as $$
  with removed as (
    delete from public.reviewer_tombstones
    where deleted_at < now() - make_interval(days => greatest(coalesce(p_older_than_days, 30), 1))
    returning 1
  )
  select count(*)::integer from removed;
$$;

revoke execute on function public.prune_reviewer_tombstones(integer) from public, anon;
grant execute on function public.prune_reviewer_tombstones(integer) to authenticated;

commit;

-- After running:
--
--   -- 1. Both triggers exist.
--   select tgname from pg_trigger where tgrelid = 'public.reviewers'::regclass and not tgisinternal;
--
--   -- 2. Prove a delete leaves a tombstone, using a reviewer you do not care about:
--   --    delete from reviewers where reviewer_id = '<some id>';
--   --    select * from reviewer_tombstones where reviewer_id = '<some id>';   -- one row
--
--   -- 3. And that re-creating it clears the tombstone:
--   --    insert into reviewers (owner_id, reviewer_id, title, subject, data)
--   --    values ('<owner>', '<some id>', 'x', 'x', '{}'::jsonb);
--   --    select * from reviewer_tombstones where reviewer_id = '<some id>';   -- no rows
--   --    delete from reviewers where reviewer_id = '<some id>';               -- tidy up
--
--   -- 4. Clients can read their own and nothing else.
--   --    As a signed-in key: select * from reviewer_tombstones;
--   --    As the anon key:    select * from reviewer_tombstones;   -- must error
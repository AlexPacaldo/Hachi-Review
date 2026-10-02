-- Both group tables are created before any policy is defined. PostgreSQL
-- resolves relation references inside a policy expression the moment the
-- policy is created, so a policy that mentions public.group_members fails with
-- 42P01 unless that table already exists.
create table if not exists public.study_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 60),
  description text check (char_length(coalesce(description, '')) <= 240),
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.group_members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.study_groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  added_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(group_id, user_id),
  check (user_id is not null)
);

-- added_by records who put a member in a group, so the "you were added"
-- notification can name them instead of saying "someone".
alter table public.group_members add column if not exists added_by uuid references auth.users(id) on delete set null;

alter table public.study_groups enable row level security;

alter table public.group_members enable row level security;

grant select, insert, update, delete on public.study_groups to authenticated;

grant select, insert, update, delete on public.group_members to authenticated;

create index if not exists study_groups_owner_idx
on public.study_groups(owner_id, updated_at desc);

create index if not exists group_members_group_idx
on public.group_members(group_id, created_at);

create index if not exists group_members_user_idx
on public.group_members(user_id, created_at desc);

-- Row level security helpers.
--
-- A policy on public.group_members cannot query public.group_members directly:
-- the subquery is subject to the same policies, so it self-references and
-- PostgreSQL aborts the statement with "infinite recursion detected in policy
-- for relation group_members". These SECURITY DEFINER functions read the table
-- as the table owner, which bypasses RLS and keeps the policies flat.
create or replace function public.is_group_member(target_group_id uuid, target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.group_members
    where group_id = target_group_id
      and user_id = target_user_id
  );
$$;

create or replace function public.is_group_owner_or_admin(target_group_id uuid, target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.group_members
    where group_id = target_group_id
      and user_id = target_user_id
      and role in ('owner', 'admin')
  );
$$;

-- Kicking someone else is stricter than changing roles, so it needs its own
-- owner-only check rather than reusing is_group_owner_or_admin.
create or replace function public.is_group_owner(target_group_id uuid, target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.group_members
    where group_id = target_group_id
      and user_id = target_user_id
      and role = 'owner'
  );
$$;

revoke all on function public.is_group_member(uuid, uuid) from public;
revoke all on function public.is_group_owner_or_admin(uuid, uuid) from public;
revoke all on function public.is_group_owner(uuid, uuid) from public;
grant execute on function public.is_group_member(uuid, uuid) to authenticated;
grant execute on function public.is_group_owner_or_admin(uuid, uuid) to authenticated;
grant execute on function public.is_group_owner(uuid, uuid) to authenticated;

-- A group is readable by its members. Membership is checked through
-- public.is_group_member so non-members can never discover a group.
drop policy if exists "Members can read own groups" on public.study_groups;
create policy "Members can read own groups"
on public.study_groups
for select
to authenticated
using (
  auth.uid() = owner_id
  or public.is_group_member(id, auth.uid())
);

drop policy if exists "Users can create own groups" on public.study_groups;
create policy "Users can create own groups"
on public.study_groups
for insert
to authenticated
with check (auth.uid() = owner_id);

-- Owners and admins can rename a group; owners can also transfer or clear it.
drop policy if exists "Owners and admins can update groups" on public.study_groups;
create policy "Owners and admins can update groups"
on public.study_groups
for update
to authenticated
using (auth.uid() = owner_id or public.is_group_owner_or_admin(id, auth.uid()))
with check (auth.uid() = owner_id or public.is_group_owner_or_admin(id, auth.uid()));

drop policy if exists "Owners can delete groups" on public.study_groups;
create policy "Owners can delete groups"
on public.study_groups
for delete
to authenticated
using (auth.uid() = owner_id);

drop policy if exists "Members can read group members" on public.group_members;
create policy "Members can read group members"
on public.group_members
for select
to authenticated
using (public.is_group_member(group_id, auth.uid()));

-- Only owners and admins can add or remove people. The group's creator is
-- allowed to insert their own owner row, otherwise a brand new group would
-- never get its first member. Members can always remove themselves, which is
-- how leaving a group works.
drop policy if exists "Owners and admins can add members" on public.group_members;
create policy "Owners and admins can add members"
on public.group_members
for insert
to authenticated
with check (
  -- added_by must equal the session user, otherwise a member could be inserted
  -- with a forged attribution and the "added you to a group" notification would
  -- name the wrong person.
  added_by = auth.uid()
  and (
    (
      user_id = auth.uid()
      and role = 'owner'
      and exists (
        select 1
        from public.study_groups
        where study_groups.id = group_members.group_id
          and study_groups.owner_id = auth.uid()
      )
    )
    or public.is_group_owner_or_admin(group_members.group_id, auth.uid())
  )
);

drop policy if exists "Owners and admins can change member roles" on public.group_members;
create policy "Owners and admins can change member roles"
on public.group_members
for update
to authenticated
-- using sees the old row, with check sees the new one, so together they stop an
-- admin demoting the owner (old role is owner) or promoting themselves to owner
-- (new role would be owner).
using (
  public.is_group_owner_or_admin(group_members.group_id, auth.uid())
  and (
    group_members.role <> 'owner'
    or public.is_group_owner(group_members.group_id, auth.uid())
  )
)
with check (
  public.is_group_owner_or_admin(group_members.group_id, auth.uid())
  and (
    group_members.role <> 'owner'
    or public.is_group_owner(group_members.group_id, auth.uid())
  )
);

-- Removing someone else is a kick, and only the owner may kick. Everyone can
-- still delete their own membership to leave.
drop policy if exists "Owners and admins can remove members" on public.group_members;
drop policy if exists "Owners, admins, or members leaving can remove members" on public.group_members;
create policy "Owners, admins, or members leaving can remove members"
on public.group_members
for delete
to authenticated
using (
  auth.uid() = user_id
  or public.is_group_owner(group_members.group_id, auth.uid())
);

-- public.friendships is created before public.reviewers because the reviewer
-- read policy below looks at friendships to decide who can see a shared
-- reviewer, and a policy cannot reference a table that does not exist yet.
create table if not exists public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references auth.users(id) on delete cascade,
  addressee_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(requester_id, addressee_id),
  check (requester_id <> addressee_id)
);

alter table public.friendships enable row level security;

grant select, insert, update, delete on public.friendships to authenticated;

create table if not exists public.reviewers (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  reviewer_id text not null,
  title text not null,
  subject text not null,
  data jsonb not null,
  visibility text not null default 'friends',
  shared_with jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, reviewer_id)
);

alter table public.reviewers add column if not exists visibility text not null default 'friends';
alter table public.reviewers add column if not exists shared_with jsonb;

-- Group sharing reuses the same row as the reviewer. shared_groups holds the
-- study_groups ids this reviewer is shared with, and visibility = 'group'
-- means "no friends, groups only".
alter table public.reviewers add column if not exists shared_groups jsonb;

create index if not exists reviewers_visibility_owner_idx
on public.reviewers(visibility, owner_id, updated_at desc);

-- Group lookups filter with shared_groups @> '["<group id>"]', which is what
-- jsonb_path_ops indexes. Without it the database still answers correctly, it
-- just has to scan the group rows instead of going straight to the matches.
create index if not exists reviewers_shared_groups_idx
on public.reviewers using gin (shared_groups jsonb_path_ops);

-- The same group shares, one row per group, so a group can be answered from an
-- index and a per group count is a plain grouped count. shared_groups stays the
-- source of truth the reviewer policies read, and the trigger below keeps this
-- table in step with it, so the two can never drift.
create table if not exists public.reviewer_group_shares (
  reviewer_id uuid not null references public.reviewers(id) on delete cascade,
  group_id uuid not null references public.study_groups(id) on delete cascade,
  shared_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (reviewer_id, group_id)
);

create index if not exists reviewer_group_shares_group_idx
  on public.reviewer_group_shares(group_id, reviewer_id);

alter table public.reviewer_group_shares enable row level security;

grant select, insert, update, delete on public.reviewer_group_shares to authenticated;

-- Any member of a group can see which reviewers are shared into it, which is
-- the same audience the reviewers policy already gives those reviewers.
drop policy if exists "Group members can read group shares" on public.reviewer_group_shares;
create policy "Group members can read group shares"
  on public.reviewer_group_shares
  for select
  to authenticated
  using (public.is_group_member(group_id, auth.uid()) or shared_by = auth.uid());

-- Only the owner of the reviewer can change where it is shared.
drop policy if exists "Reviewer owners can manage group shares" on public.reviewer_group_shares;
create policy "Reviewer owners can manage group shares"
  on public.reviewer_group_shares
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.reviewers
      where reviewers.id = reviewer_group_shares.reviewer_id
        and reviewers.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.reviewers
      where reviewers.id = reviewer_group_shares.reviewer_id
        and reviewers.owner_id = auth.uid()
    )
  );

-- Ids are validated before they are cast, and groups that no longer exist are
-- skipped, so one stale value in shared_groups cannot fail the reviewer write.
create or replace function public.reviewer_group_id_list(raw_value jsonb)
returns text[]
language sql
stable
as $$
  select coalesce(array(
    select listed.group_id
    from jsonb_array_elements_text(coalesce(raw_value, '[]'::jsonb)) as listed(group_id)
    where listed.group_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  ), '{}'::text[]);
$$;

-- Mirrors shared_groups into the share table. Only the difference is written,
-- so an update that does not touch sharing does no work here. It runs as the
-- table owner so a stricter policy on the share table can never fail the
-- reviewer write that triggered it.
create or replace function public.sync_reviewer_group_shares()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  previous_ids text[];
  next_ids text[];
  added_ids text[];
  removed_ids text[];
begin
  if tg_op = 'INSERT' then
    previous_ids := '{}'::text[];
  else
    previous_ids := public.reviewer_group_id_list(old.shared_groups);
  end if;

  next_ids := public.reviewer_group_id_list(new.shared_groups);
  added_ids := array(
    select listed.group_id
    from unnest(next_ids) as listed(group_id)
    where not (listed.group_id = any (previous_ids))
  );
  removed_ids := array(
    select listed.group_id
    from unnest(previous_ids) as listed(group_id)
    where not (listed.group_id = any (next_ids))
  );

  if removed_ids <> '{}'::text[] then
    delete from public.reviewer_group_shares
    where reviewer_id = new.id
      and group_id = any (removed_ids::uuid[]);
  end if;

  if added_ids <> '{}'::text[] then
    insert into public.reviewer_group_shares (reviewer_id, group_id, shared_by)
    select new.id, study_groups.id, new.owner_id
    from unnest(added_ids) as listed(group_id)
    join public.study_groups on study_groups.id = listed.group_id::uuid
    on conflict (reviewer_id, group_id) do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists reviewers_sync_group_shares on public.reviewers;
create trigger reviewers_sync_group_shares
  after insert or update on public.reviewers
  for each row
  execute function public.sync_reviewer_group_shares();

-- Backfills the table for reviewers that were shared into groups before it
-- existed. Idempotent, so re-running the schema file is safe.
insert into public.reviewer_group_shares (reviewer_id, group_id, shared_by)
select reviewers.id, study_groups.id, reviewers.owner_id
from public.reviewers
cross join lateral unnest(public.reviewer_group_id_list(reviewers.shared_groups)) as listed(group_id)
join public.study_groups on study_groups.id = listed.group_id::uuid
on conflict (reviewer_id, group_id) do nothing;

alter table public.reviewers enable row level security;

grant select, insert, update, delete on public.reviewers to authenticated;

-- Anyone can see their own reviewers, plus reviewers that their accepted friends
-- chose to share. A shared reviewer is visible when visibility = 'friends' and it
-- was shared with all friends (shared_with is null/empty) or with this user
-- specifically (shared_with contains the current user id). Reviewers shared to a
-- group are visible to every member of a group listed in shared_groups, as long
-- as the owner is still in that group.
drop policy if exists "Users can read own or friends' shared reviewers" on public.reviewers;
create policy "Users can read own or friends' shared reviewers"
on public.reviewers
for select
to authenticated
using (
  auth.uid() = owner_id
  or (
    visibility = 'friends'
    and exists (
      select 1
      from public.friendships
      where status = 'accepted'
        and (
          (requester_id = auth.uid() and addressee_id = owner_id)
          or (addressee_id = auth.uid() and requester_id = owner_id)
        )
    )
    and (
      shared_with is null
      or shared_with = '[]'::jsonb
      or shared_with ? auth.uid()::text
    )
  )
  or (
    visibility = 'group'
    and shared_groups is not null
    and shared_groups <> '[]'::jsonb
    -- Each id is validated before it is cast, so one malformed value in
    -- shared_groups cannot break the read for every other user.
    and exists (
      select 1
      from (
        select listed.group_id::uuid as group_id
        from jsonb_array_elements_text(shared_groups) as listed(group_id)
        where listed.group_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      ) as valid_group_ids
      where public.is_group_member(valid_group_ids.group_id, auth.uid())
    )
    and exists (
      select 1
      from (
        select listed.group_id::uuid as group_id
        from jsonb_array_elements_text(shared_groups) as listed(group_id)
        where listed.group_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      ) as valid_group_ids
      where public.is_group_member(valid_group_ids.group_id, reviewers.owner_id)
    )
  )
);

drop policy if exists "Users can insert own reviewers" on public.reviewers;
create policy "Users can insert own reviewers"
on public.reviewers
for insert
to authenticated
with check (auth.uid() = owner_id);

drop policy if exists "Users can update own reviewers" on public.reviewers;
create policy "Users can update own reviewers"
on public.reviewers
for update
to authenticated
using (auth.uid() = owner_id)
with check (auth.uid() = owner_id);

drop policy if exists "Users can delete own reviewers" on public.reviewers;
create policy "Users can delete own reviewers"
on public.reviewers
for delete
to authenticated
using (auth.uid() = owner_id);

create index if not exists reviewers_owner_updated_idx
on public.reviewers(owner_id, updated_at desc);

-- Quiz progress and attempt history are personal records, so they stay private
-- to their owner: no friend or share policies here, unlike public.reviewers.
create table if not exists public.reviewer_progress (
  owner_id uuid not null references auth.users(id) on delete cascade,
  reviewer_id text not null,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (owner_id, reviewer_id)
);

alter table public.reviewer_progress enable row level security;

grant select, insert, update, delete on public.reviewer_progress to authenticated;

drop policy if exists "Users can read own progress" on public.reviewer_progress;
create policy "Users can read own progress"
on public.reviewer_progress
for select
to authenticated
using (auth.uid() = owner_id);

drop policy if exists "Users can insert own progress" on public.reviewer_progress;
create policy "Users can insert own progress"
on public.reviewer_progress
for insert
to authenticated
with check (auth.uid() = owner_id);

drop policy if exists "Users can update own progress" on public.reviewer_progress;
create policy "Users can update own progress"
on public.reviewer_progress
for update
to authenticated
using (auth.uid() = owner_id)
with check (auth.uid() = owner_id);

drop policy if exists "Users can delete own progress" on public.reviewer_progress;
create policy "Users can delete own progress"
on public.reviewer_progress
for delete
to authenticated
using (auth.uid() = owner_id);

create table if not exists public.reviewer_attempts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  attempt_id text not null,
  reviewer_id text not null,
  data jsonb not null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique(owner_id, attempt_id)
);

alter table public.reviewer_attempts enable row level security;

grant select, insert, update, delete on public.reviewer_attempts to authenticated;

drop policy if exists "Users can read own attempts" on public.reviewer_attempts;
create policy "Users can read own attempts"
on public.reviewer_attempts
for select
to authenticated
using (auth.uid() = owner_id);

drop policy if exists "Users can insert own attempts" on public.reviewer_attempts;
create policy "Users can insert own attempts"
on public.reviewer_attempts
for insert
to authenticated
with check (auth.uid() = owner_id);

drop policy if exists "Users can update own attempts" on public.reviewer_attempts;
create policy "Users can update own attempts"
on public.reviewer_attempts
for update
to authenticated
using (auth.uid() = owner_id)
with check (auth.uid() = owner_id);

drop policy if exists "Users can delete own attempts" on public.reviewer_attempts;
create policy "Users can delete own attempts"
on public.reviewer_attempts
for delete
to authenticated
using (auth.uid() = owner_id);

create index if not exists reviewer_attempts_owner_completed_idx
on public.reviewer_attempts(owner_id, completed_at desc);

create index if not exists reviewer_attempts_owner_reviewer_idx
on public.reviewer_attempts(owner_id, reviewer_id);

-- An attempt row is by far the heaviest record a user accumulates, and nothing
-- reads one once it drops out of the synced history window. The app calls this on
-- its own sync, so trimming needs no scheduled job and stays off every other
-- user's query path. Security invoker keeps the delete under the owner's own
-- delete policy.
create or replace function public.prune_reviewer_attempts(p_owner uuid, p_older_than_days integer default 180)
returns integer
language sql
security invoker
set search_path = public
as $$
  with removed as (
    delete from public.reviewer_attempts
    where owner_id = p_owner
      and completed_at is not null
      and completed_at < now() - make_interval(days => greatest(p_older_than_days, 1))
    returning 1
  )
  select count(*)::integer from removed;
$$;

revoke execute on function public.prune_reviewer_attempts(uuid, integer) from public, anon;

grant execute on function public.prune_reviewer_attempts(uuid, integer) to authenticated;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  display_name text,
  avatar_url text,
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

grant select, insert, update, delete on public.profiles to authenticated;

drop policy if exists "Users can read profiles" on public.profiles;
create policy "Users can read profiles"
on public.profiles
for select
to authenticated
using (true);

drop policy if exists "Users can insert own profile" on public.profiles;
create policy "Users can insert own profile"
on public.profiles
for insert
to authenticated
with check (auth.uid() = id);

drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile"
on public.profiles
for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

drop policy if exists "Users can delete own profile" on public.profiles;
create policy "Users can delete own profile"
on public.profiles
for delete
to authenticated
using (auth.uid() = id);

create index if not exists profiles_email_idx
on public.profiles(lower(email));

drop policy if exists "Users can read own friendships" on public.friendships;
create policy "Users can read own friendships"
on public.friendships
for select
to authenticated
using (auth.uid() = requester_id or auth.uid() = addressee_id);

drop policy if exists "Users can send friend requests" on public.friendships;
create policy "Users can send friend requests"
on public.friendships
for insert
to authenticated
with check (auth.uid() = requester_id and status = 'pending');

drop policy if exists "Users can accept friend requests" on public.friendships;
create policy "Users can accept friend requests"
on public.friendships
for update
to authenticated
using (auth.uid() = addressee_id)
with check (auth.uid() = addressee_id and status = 'accepted');

drop policy if exists "Users can remove own friendships" on public.friendships;
create policy "Users can remove own friendships"
on public.friendships
for delete
to authenticated
using (auth.uid() = requester_id or auth.uid() = addressee_id);

create index if not exists friendships_requester_idx
on public.friendships(requester_id, status);

create index if not exists friendships_addressee_idx
on public.friendships(addressee_id, status);

create table if not exists public.reviewer_shares (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  reviewer_id text not null,
  title text not null,
  subject text not null,
  data jsonb not null,
  message text,
  created_at timestamptz not null default now(),
  check (owner_id <> recipient_id)
);

alter table public.reviewer_shares enable row level security;

grant select, insert, delete on public.reviewer_shares to authenticated;

drop policy if exists "Users can read sent or received shares" on public.reviewer_shares;
create policy "Users can read sent or received shares"
on public.reviewer_shares
for select
to authenticated
using (auth.uid() = owner_id or auth.uid() = recipient_id);

drop policy if exists "Users can send reviewer shares" on public.reviewer_shares;
create policy "Users can send reviewer shares"
on public.reviewer_shares
for insert
to authenticated
with check (
  auth.uid() = owner_id
  and exists (
    select 1
    from public.friendships
    where status = 'accepted'
      and (
        (requester_id = auth.uid() and addressee_id = recipient_id)
        or (addressee_id = auth.uid() and requester_id = recipient_id)
      )
  )
);

drop policy if exists "Users can delete own reviewer shares" on public.reviewer_shares;
create policy "Users can delete own reviewer shares"
on public.reviewer_shares
for delete
to authenticated
using (auth.uid() = owner_id or auth.uid() = recipient_id);

create index if not exists reviewer_shares_recipient_idx
on public.reviewer_shares(recipient_id, created_at desc);

create index if not exists reviewer_shares_owner_idx
on public.reviewer_shares(owner_id, created_at desc);

-- Landing page presence. This used to be a Realtime presence channel, where every
-- visitor on the site held a connection and the free tier capped that at 200
-- peak connections, so a busy landing page could exhaust the whole project's
-- Realtime allowance on its own. A heartbeat row costs one short call instead,
-- so the count no longer competes for connections.
--
-- The table is reachable only through the two functions below. They are
-- SECURITY DEFINER because the rows are deliberately not readable by clients,
-- and the key is shape checked so a caller cannot inflate the count with junk
-- keys or grow the table without bound.
create table if not exists public.presence_pings (
  session_key text primary key,
  last_seen timestamptz not null default now()
);

alter table public.presence_pings enable row level security;

create index if not exists presence_pings_last_seen_idx
on public.presence_pings(last_seen);

revoke all on table public.presence_pings from anon, authenticated;

-- Records the visit, expires rows nobody has pinged in a while, and returns the
-- live total in one round trip.
create or replace function public.touch_presence(p_key text, p_window_seconds integer default 150)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if p_key is null or p_key !~ '^[A-Za-z0-9_-]{8,64}$' then
    return 0;
  end if;

  insert into public.presence_pings (session_key, last_seen)
  values (p_key, now())
  on conflict (session_key) do update set last_seen = now();

  -- Expired rows are collected here rather than on a timer, and last_seen is
  -- indexed, so this stays a cheap scan of a small recent window.
  delete from public.presence_pings where last_seen < now() - interval '10 minutes';

  select count(*)::integer into v_count
  from public.presence_pings
  where last_seen > now() - make_interval(secs => greatest(p_window_seconds, 30));

  return v_count;
end;
$$;

-- Called when a visitor leaves, so the count drops immediately instead of waiting
-- out the window.
create or replace function public.release_presence(p_key text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.presence_pings where session_key = p_key;
$$;

revoke execute on function public.touch_presence(text, integer) from public;
revoke execute on function public.release_presence(text) from public;

grant execute on function public.touch_presence(text, integer) to anon, authenticated;
grant execute on function public.release_presence(text) to anon, authenticated;

-- Reviewer list view. The reviewer list is drawn on nearly every page, and data
-- holds every question, so selecting it for the list moved roughly 100 KB per
-- reviewer per page load and was the main thing pushing the project past its
-- egress allowance. The list only needs the headline fields, which live in
-- columns or can be lifted out of data without reading the questions, so the
-- view carries those and the app fetches data for a reviewer only once it is
-- actually opened.
--
-- security_invoker matters here. A Postgres view runs with its owner's rights
-- by default, which would bypass the reviewer read policies and hand every
-- reviewer to every caller, so the policies have to be applied instead.
create or replace view public.reviewer_summaries with (security_invoker = true) as
select
  r.id,
  r.owner_id,
  r.reviewer_id,
  r.title,
  r.subject,
  r.visibility,
  r.shared_with,
  r.shared_groups,
  r.created_at,
  r.updated_at,
  jsonb_build_object(
    'reviewerId', r.reviewer_id,
    'title', r.title,
    'subject', r.subject,
    'coverage', r.data->'coverage',
    'questionCount', case
      when (r.data->>'questionCount') ~ '^[0-9]+$' then (r.data->>'questionCount')::int
      when jsonb_typeof(r.data->'questions') = 'array' then jsonb_array_length(r.data->'questions')
      else 0
    end,
    'questionType', r.data->'questionType',
    'questionTypes', r.data->'questionTypes',
    'choicesPerQuestion', r.data->'choicesPerQuestion',
    'instructions', r.data->'instructions',
    'visibility', r.visibility,
    'sharedWith', r.shared_with,
    'sharedGroups', r.shared_groups,
    'updatedAt', r.updated_at
  ) as summary
from public.reviewers r;

grant select on public.reviewer_summaries to authenticated;

-- Owner-only database usage readout. The size is checked inside the function
-- rather than in the client, so the number is not available to any other
-- account even by calling the function directly.
--
-- v_limit is the Free plan allowance. Raising it to 8 GB is the first thing to
-- change when this project moves to the Pro plan, otherwise the warning will
-- keep firing at 500 MB on a project that has room to spare.
create or replace function public.admin_database_usage()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_limit bigint := 500 * 1024 * 1024;
  v_used bigint;
begin
  select lower(u.email) into v_email
  from auth.users u
  where u.id = auth.uid();

  if v_email is distinct from '[redacted]' then
    return null;
  end if;

  v_used := pg_database_size(current_database());

  return jsonb_build_object(
    'usedBytes', v_used,
    'limitBytes', v_limit,
    'percentUsed', round(v_used * 100.0 / v_limit, 1)
  );
end;
$$;

revoke execute on function public.admin_database_usage() from public, anon;
grant execute on function public.admin_database_usage() to authenticated;

-- Realtime: instantly push friendship and share changes to signed-in clients.
-- Requires re-apply of this file (or running this block) in the Supabase dashboard.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'friendships'
  ) then
    alter publication supabase_realtime add table public.friendships;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'reviewer_shares'
  ) then
    alter publication supabase_realtime add table public.reviewer_shares;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'reviewers'
  ) then
    alter publication supabase_realtime add table public.reviewers;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'group_members'
  ) then
    alter publication supabase_realtime add table public.group_members;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'study_groups'
  ) then
    alter publication supabase_realtime add table public.study_groups;
  end if;
end $$;

alter table public.friendships replica identity full;
alter table public.reviewer_shares replica identity full;
alter table public.group_members replica identity full;
alter table public.study_groups replica identity full;

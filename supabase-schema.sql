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

revoke all on function public.is_group_member(uuid, uuid) from public;
revoke all on function public.is_group_owner_or_admin(uuid, uuid) from public;
grant execute on function public.is_group_member(uuid, uuid) to authenticated;
grant execute on function public.is_group_owner_or_admin(uuid, uuid) to authenticated;

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
using (public.is_group_owner_or_admin(group_members.group_id, auth.uid()))
with check (public.is_group_owner_or_admin(group_members.group_id, auth.uid()));

drop policy if exists "Owners, admins, or members leaving can remove members" on public.group_members;
create policy "Owners, admins, or members leaving can remove members"
on public.group_members
for delete
to authenticated
using (
  auth.uid() = user_id
  or public.is_group_owner_or_admin(group_members.group_id, auth.uid())
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

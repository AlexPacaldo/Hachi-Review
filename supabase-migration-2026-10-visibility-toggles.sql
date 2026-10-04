-- Let a reviewer be shared with friends and with groups at the same time.
--
-- Run this once in the Supabase SQL editor. Safe to run again.
--
-- This is the whole of the change to supabase-schema.sql for independent friend
-- and group sharing. It is split out because the schema file is long and a single
-- unrelated statement in it can stop a full re-run before this reaches the
-- database, which leaves the policy below unapplied.
--
-- THE PROBLEM
--
-- visibility was one column choosing between three exclusive states: 'private',
-- 'friends', or 'group'. Turning on groups therefore took friends away, and a
-- reviewer could never be both. The row already carried both audiences in
-- separate columns, shared_with and shared_groups, so the only thing missing was
-- a value that names both at once.
--
-- THE MECHANISM
--
-- A fourth value, 'friends+groups'. The column stays the single thing every
-- reader already looks at, and each audience is independent: either one on its
-- own is enough to see the reviewer, and both together means both. No column is
-- added and no row is rewritten, so a reviewer already shared one way keeps the
-- audience it had.
--
-- The policy is replaced rather than altered because Postgres has no alter
-- policy for the using expression. Everything below is the same rule as before,
-- except that each branch accepts the combined value as well as its own.

begin;

drop policy if exists "Users can read own or friends' shared reviewers" on public.reviewers;

-- Anyone can see their own reviewers, plus reviewers their accepted friends or
-- their groups chose to share. Those are two independent audiences, so visibility
-- names either or both: 'friends', 'group', or 'friends+groups'. A friend sees
-- the reviewer when shared_with is null/empty or contains the current user id,
-- and a group member sees it when it is shared into a group the owner is still in.
-- Either audience on its own is enough.
create policy "Users can read own or friends' shared reviewers"
on public.reviewers
for select
to authenticated
using (
  auth.uid() = owner_id
  or (
    visibility in ('friends', 'friends+groups')
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
    visibility in ('group', 'friends+groups')
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

commit;
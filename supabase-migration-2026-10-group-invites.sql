-- Share a group through an invite link.
--
-- Run this once in the Supabase SQL editor. Safe to run again.
--
-- This is the whole of the change to supabase-schema.sql for this feature. It is
-- split out because the schema file is long and a single unrelated statement in it can
-- stop a full re-run before this reaches the database, which leaves the functions
-- below unapplied and every invite link simply fails.
--
-- THE PROBLEM
--
-- The only way into a group used to be an owner or admin typing a name into the
-- add-member search. That works for ten people, not for a class. A group member
-- needs to be able to paste a link somewhere and have the other person land in the
-- group.
--
-- THE MECHANISM
--
-- Every group carries a random invite_code. The link is /groups/join/<code>, and
-- joining is a function call, not a table insert, because the group_members policy
-- deliberately lets only owners and admins add rows.
--
-- THE SAFETY, WHICH IS THE WHOLE POINT
--
-- A security definer function is the easiest way in a schema like this to hand out
-- the account directory by accident, so the following are deliberate and should not be
-- "simplified" away:
--
--   * The joiner is auth.uid() and there is no parameter for it. A function taking a
--     user id would join whoever was named, so there is deliberately no argument the
--     caller could get wrong.
--   * set search_path is pinned to public. Without it, anyone able to create objects on
--     the path can shadow friendships or profiles and read anything at all.
--   * The preview returns the columns one by one. A select * would begin leaking the
--     moment a column is added to study_groups.
--   * An invalid code raises a plain error and the preview returns no row, so the code
--     is a bearer secret: 72 bits of it, regenerated if it leaks.
--   * The grant is not optional. Revoking from PUBLIC removes the execute privilege
--     every function has by default, and the grant below puts it back for signed in
--     accounts only. Revoke without regranting and the functions are unreachable,
--     which fails closed but silently hides the feature.

alter table public.study_groups add column if not exists invite_code text;

update public.study_groups
set invite_code = encode(gen_random_bytes(9), 'hex')
where invite_code is null;

alter table public.study_groups alter column invite_code set not null;
alter table public.study_groups alter column invite_code set default encode(gen_random_bytes(9), 'hex');

create unique index if not exists study_groups_invite_code_idx
  on public.study_groups(invite_code);

create or replace function public.get_group_invite_preview(p_code text)
returns table (group_id uuid, group_name text, description text, member_count bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_code text := lower(trim(coalesce(p_code, '')));
begin
  if v_uid is null or v_code = '' then
    return;
  end if;

  return query
    select g.id, g.name, g.description,
           (select count(*)::bigint from public.group_members gm where gm.group_id = g.id)
    from public.study_groups g
    where g.invite_code = v_code
    limit 1;
end;
$$;

create or replace function public.join_group_by_invite(p_code text)
returns table (group_id uuid, group_name text, already_member boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_code text := lower(trim(coalesce(p_code, '')));
  v_group public.study_groups%rowtype;
begin
  if v_uid is null then
    raise exception 'Sign in to join a group.';
  end if;

  select * into v_group
  from public.study_groups
  where study_groups.invite_code = v_code
  limit 1;

  if v_group.id is null then
    raise exception 'That invite link is not valid.';
  end if;

  if exists (
    select 1
    from public.group_members gm
    where gm.group_id = v_group.id
      and gm.user_id = v_uid
  ) then
    return query select v_group.id, v_group.name, true;
    return;
  end if;

  begin
    insert into public.group_members (group_id, user_id, role, added_by)
    values (v_group.id, v_uid, 'member', v_uid);
  exception when unique_violation then
    return query select v_group.id, v_group.name, true;
    return;
  end;

  return query select v_group.id, v_group.name, false;
end;
$$;

revoke all on function public.get_group_invite_preview(text) from public, anon;
revoke all on function public.join_group_by_invite(text) from public, anon;

grant execute on function public.get_group_invite_preview(text) to authenticated;
grant execute on function public.join_group_by_invite(text) to authenticated;

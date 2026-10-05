-- Suggest friends of friends on the Friends page.
--
-- Run this once in the Supabase SQL editor. Safe to run again.
--
-- This is the whole of the change to supabase-schema.sql for this feature. It is
-- split out because the schema file is long and a single unrelated statement in it can
-- stop a full re-run before this reaches the database, which leaves the function
-- below unapplied and the section simply does not appear.
--
-- THE PROBLEM
--
-- "People you may know" could only suggest people you already shared a group or a
-- reviewer with, because those are the only two relationships the profiles policy
-- permits reading. Friends of friends is the obvious third and it is not available
-- from the client, because the friendships policy only lets a caller read rows they
-- are a party to. The middle step of the walk, one of your own friends'
-- friendships, is exactly the row you may not see.
--
-- THE MECHANISM
--
-- One security definer function, find_friends_of_friends, that walks two accepted
-- friendship hops and returns at most twelve people with a count of how many friends
-- you share with each. The interface shows that count as the reason and never the
-- names behind it.
--
-- THE SAFETY, WHICH IS THE WHOLE POINT
--
-- A security definer function is the easiest way in a schema like this to hand out the
-- account directory by accident, so the following are deliberate and should not be
-- "simplified" away:
--
--   * The subject is auth.uid() and there is no parameter for it. A function taking a
--     user id would answer for whoever was named, so there is deliberately no argument
--     the caller could get wrong.
--   * set search_path is pinned to public. Without it, anyone able to create objects in
--     a schema on the path can shadow friendships or profiles and read anything at all.
--   * Only id, display_name and avatar_url are returned, named one by one. A select *
--     would begin leaking the moment a column is added to profiles.
--   * Only accepted friendships are walked. is_friend does not check status, so without
--     this a pending request would put somebody in a suggestions list.
--   * Existing friends and open requests are excluded in SQL, not only in the
--     interface, so this cannot be used to re-read a profile the policy already
--     permits.
--   * The limit is clamped to twelve, so the result cannot be paged through.
--   * Only a count of mutual friends comes back, never their names. Naming them would
--     tell the caller facts about the suggested person's own friendships.
--   * The grant is not optional. Revoking from PUBLIC removes the execute privilege
--     every function has by default, and the grant below puts it back for signed in
--     accounts only. Revoke without regranting and the function is unreachable, which
--     fails closed but silently hides the section.
--
-- WHAT THIS STILL EXPOSES
--
-- The existence, display name and picture of anyone within two accepted friendships of
-- you. That is inherent to the feature rather than an oversight. It is a much larger
-- surface than find_people, which only answers to a term the caller already supplied,
-- so it is worth being deliberate about it. If the two-hop neighbourhood is too much
-- for this app, drop the call in listSuggestedPeople and the rest of the suggestions
-- section keeps working unchanged.

create or replace function public.find_friends_of_friends(p_limit integer default 6)
returns table (id uuid, display_name text, avatar_url text, mutual_count integer)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_capped integer := least(greatest(coalesce(p_limit, 6), 1), 12);
begin
  if v_uid is null then
    return;
  end if;

  return query
    with my_friends as (
      select case
               when f.requester_id = v_uid then f.addressee_id
               else f.requester_id
             end as friend_id
      from public.friendships f
      where f.status = 'accepted'
        and (f.requester_id = v_uid or f.addressee_id = v_uid)
    ),
    mutual as (
      select f2.other_id as other_id, count(distinct f2.via_id)::integer as mutual_count
      from my_friends mine
      join lateral (
        select
          case
            when f3.requester_id = mine.friend_id then f3.addressee_id
            else f3.requester_id
          end as other_id,
          mine.friend_id as via_id
        from public.friendships f3
        where f3.status = 'accepted'
          and (f3.requester_id = mine.friend_id or f3.addressee_id = mine.friend_id)
      ) f2 on true
      where f2.other_id <> v_uid
        and not exists (select 1 from my_friends known where known.friend_id = f2.other_id)
        and not exists (
          select 1 from public.friendships f4
          where f4.status = 'pending'
            and (
              (f4.requester_id = v_uid and f4.addressee_id = f2.other_id)
              or (f4.addressee_id = v_uid and f4.requester_id = f2.other_id)
            )
        )
      group by f2.other_id
      having count(distinct f2.via_id) >= 1
    )
    select p.id, p.display_name, p.avatar_url, m.mutual_count
    from mutual m
    join public.profiles p on p.id = m.other_id
    order by m.mutual_count desc, p.display_name nulls last
    limit v_capped;
end;
$$;

revoke all on function public.find_friends_of_friends(integer) from public, anon;

grant execute on function public.find_friends_of_friends(integer) to authenticated;

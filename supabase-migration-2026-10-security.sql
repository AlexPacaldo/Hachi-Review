-- Security and storage corrections.
--
-- Run this once in the Supabase SQL editor. It is written to be safe to run
-- again. Take a backup first, and read the notes below, because step 3 changes
-- who can read the profiles table.
--
-- 1. profiles no longer stores email. Any signed-in account could previously run
--    "select email from profiles" and enumerate every registered address, and the
--    friend search did the same with a substring match. Supabase keeps the address
--    in auth.users, where no client can read it, so nothing is lost by dropping
--    the copy here.
--
-- 2. The streak becomes one row per account instead of one row per day. A streak is
--    a single number, so the day-per-row version cost roughly 400 times more than
--    the interface can use and grew without limit.
--
-- 3. The profiles select policy changes from "any signed-in account" to "you, plus
--    people you share a relationship with". This is the change most likely to
--    affect how the app behaves, so test it: open Friends, a group, and a reviewer
--    somebody shared with you. Finding a user you have not met now goes through the
--    find_people function, which the app already calls.

begin;

-- 1. Streak: drop the day-per-row table, create the single row table.
drop table if exists public.reviewer_study_days;

create table if not exists public.reviewer_study_streak (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  current_streak integer not null default 0,
  longest_streak integer not null default 0,
  total_days integer not null default 0,
  last_study_day date,
  recent_days date[] not null default '{}',
  updated_at timestamptz not null default now()
);

alter table public.reviewer_study_streak enable row level security;

grant select, insert, update, delete on public.reviewer_study_streak to authenticated;

drop policy if exists "Users can read own study streak" on public.reviewer_study_streak;
create policy "Users can read own study streak"
on public.reviewer_study_streak
for select
to authenticated
using (auth.uid() = owner_id);

drop policy if exists "Users can insert own study streak" on public.reviewer_study_streak;
create policy "Users can insert own study streak"
on public.reviewer_study_streak
for insert
to authenticated
with check (auth.uid() = owner_id);

drop policy if exists "Users can update own study streak" on public.reviewer_study_streak;
create policy "Users can update own study streak"
on public.reviewer_study_streak
for update
to authenticated
using (auth.uid() = owner_id)
with check (auth.uid() = owner_id);

drop policy if exists "Users can delete own study streak" on public.reviewer_study_streak;
create policy "Users can delete own study streak"
on public.reviewer_study_streak
for delete
to authenticated
using (auth.uid() = owner_id);

-- 2. Relationship helpers the tightened profiles policy needs. SECURITY DEFINER
--    because a policy cannot query its own table, and these need to see rows the
--    caller cannot otherwise list.
create or replace function public.is_friend(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.friendships
    where (requester_id = a and addressee_id = b)
       or (requester_id = b and addressee_id = a)
  );
$$;

create or replace function public.shares_group_with(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.group_members mine
    join public.group_members theirs on theirs.group_id = mine.group_id
    where mine.user_id = a and theirs.user_id = b
  );
$$;

create or replace function public.owns_shared_reviewer_with(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.reviewer_shares
    where (owner_id = a and recipient_id = b)
       or (owner_id = b and recipient_id = a)
  );
$$;

revoke all on function public.is_friend(uuid, uuid) from public;
revoke all on function public.shares_group_with(uuid, uuid) from public;
revoke all on function public.owns_shared_reviewer_with(uuid, uuid) from public;

-- Needed. Revoking from PUBLIC removes the execute privilege a function has by
-- default, and a policy expression runs as the querying user, so omitting these
-- grants makes every profiles read fail with "permission denied for function
-- is_friend".
grant execute on function public.is_friend(uuid, uuid) to authenticated;
grant execute on function public.shares_group_with(uuid, uuid) to authenticated;
grant execute on function public.owns_shared_reviewer_with(uuid, uuid) to authenticated;

-- 3. Finding somebody you have not met. An address matches exactly, never as a
--    substring, so this cannot be used to walk the user list. Names match by
--    prefix and are capped.
create or replace function public.find_people(p_term text, p_limit integer default 10)
returns table (id uuid, display_name text, avatar_url text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_term text := btrim(coalesce(p_term, ''));
  v_capped integer := least(greatest(coalesce(p_limit, 10), 1), 10);
  v_uid uuid := auth.uid();
begin
  if v_uid is null or length(v_term) < 2 then
    return;
  end if;

  if v_term ilike '%@%' then
    return query
      select p.id, p.display_name, p.avatar_url
      from auth.users u
      join public.profiles p on p.id = u.id
      where lower(u.email) = lower(v_term)
        and u.id <> v_uid
      limit 1;
    return;
  end if;

  return query
    select p.id, p.display_name, p.avatar_url
    from public.profiles p
    where lower(p.display_name) like lower(v_term) || '%'
      and p.id <> v_uid
    order by p.display_name
    limit v_capped;
end;
$$;

revoke all on function public.find_people(text, integer) from public, anon;

grant execute on function public.find_people(text, integer) to authenticated;

-- 4. Close the profiles table. Readable when you are the person, or when you
--    already share a relationship that means you have met.
drop policy if exists "Users can read profiles" on public.profiles;
create policy "Users can read profiles"
on public.profiles
for select
to authenticated
using (
  auth.uid() = id
  or public.is_friend(auth.uid(), id)
  or public.shares_group_with(auth.uid(), id)
  or public.owns_shared_reviewer_with(auth.uid(), id)
);

-- 5. Drop the email column. This is what removes the enumeration surface, so it
--    happens after find_people exists and can still look an address up.
alter table public.profiles drop column if exists email;

drop index if exists public.profiles_email_idx;

create index if not exists profiles_display_name_idx
on public.profiles(lower(display_name));

commit;

-- After running, check that the leak is closed. Both should return no rows:
--   select * from profiles limit 5;
--   select email from profiles limit 5;   -- should error: column does not exist

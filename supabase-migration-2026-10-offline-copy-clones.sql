-- Remove the duplicate reviewers that the offline sync bug created.
--
-- Run this once in the Supabase SQL editor. Safe to run again: once the rows are
-- gone there is nothing left to match.
--
-- THE PROBLEM
--
-- Saving somebody else's reviewer for offline is a cache, not a copy you own.
-- pushUnsyncedLocalData compared local copies against listMyCloudReviewers, which
-- only ever returns rows owned by the account itself, so another member's
-- reviewer was never in that set and was always treated as a device-only reviewer
-- waiting to be uploaded. It was then inserted with owner_id set to the recipient
-- and with the original's visibility, shared_groups and shared_with copied out of
-- the offline payload.
--
-- Two things followed. The group page listed the reviewer twice, once under the
-- owner and once under whoever saved it offline, because the insert trigger
-- announced the copy to the same group the original was already in. And the copy
-- sat in the saver's own library and feed, where it read as a reviewer somebody had
-- shared with them.
--
-- The client fix stops new copies being written. This removes the existing ones.
--
-- HOW A COPY IS IDENTIFIED
--
-- A row written by the bug carries the real owner's id inside its own data blob,
-- because the offline copy was fetched with getCloudReviewerById, which records
-- ownerId on the object. On a genuine row that value equals owner_id. So a row
-- whose data->>'ownerId' names a different account than its own owner_id is a copy,
-- and the row that agrees with itself is the original that has to survive.
--
-- Delete is on reviewers, so reviewer_group_shares, reviewer_progress and
-- reviewer_attempts go with it by cascade: the copy's progress is not the
-- learner's history of the real reviewer, and the group share row is exactly the
-- duplicate announcement. The original keeps its own share, progress and attempts.

begin;

do $$
declare
  removed integer;
begin
  with copies as (
    select id
    from public.reviewers
    -- The cast below only holds for a uuid, and an older row can hold anything
    -- at all in that key, so it is checked rather than trusted.
    where data is not null
      and coalesce(data->>'ownerId', '') ~
        '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      and (data->>'ownerId')::uuid is distinct from owner_id
  )
  delete from public.reviewers r
  using copies
  where r.id = copies.id;

  get diagnostics removed = row_count;
  raise notice 'Removed % duplicated reviewer row(s).', removed;
end;
$$;

commit;

-- After running:
--
--   -- 1. Nothing is left claiming an owner other than its own. Expect no rows.
--   select reviewer_id, owner_id, data->>'ownerId' as claimed_owner
--   from public.reviewers
--   where coalesce(data->>'ownerId', '') ~
--     '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
--     and (data->>'ownerId')::uuid is distinct from owner_id;
--
--   -- 2. One row per reviewer per owner, which is the uniqueness the app assumes.
--   select owner_id, reviewer_id, count(*)
--   from public.reviewers
--   group by owner_id, reviewer_id
--   having count(*) > 1;
--
--   -- 3. No group announces the same reviewer twice through two different rows.
--   select s.group_id, r.reviewer_id, count(*)
--   from public.reviewer_group_shares s
--   join public.reviewers r on r.id = s.reviewer_id
--   group by s.group_id, r.reviewer_id
--   having count(*) > 1;
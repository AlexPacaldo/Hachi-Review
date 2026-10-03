-- Stop quiz progress and attempts outliving the reviewer they belong to.
--
-- Run this once in the Supabase SQL editor. Safe to run again.
--
-- THE PROBLEM
--
-- reviewer_progress and reviewer_attempts key on reviewer_id as a plain text
-- column, with no foreign key to public.reviewers. The reviewers table has a
-- unique(owner_id, reviewer_id) pair, so the link was available and simply was
-- never declared.
--
-- The consequence: deleting a reviewer leaves its progress and attempts in the
-- database permanently. deleteCloudReviewer only removes the reviewers row, and
-- nothing cascades.
--
-- The visible symptom is two signed-in devices disagreeing about the same
-- reviewer's status. The device that created it still holds the reviewer and the
-- session in localStorage, so it shows "In progress". The other device pulls the
-- orphaned progress, cannot resolve a reviewer to rebuild the questions from,
-- and mergeCloudProgress drops the record without a word, so it shows "Not
-- started" forever. Nothing errors, which is why it looks like a sync bug rather
-- than a deletion bug.
--
-- The fix is real referential integrity. The orphans have to go first, because a
-- foreign key cannot be added while rows violate it.

begin;

-- 1. What is currently orphaned. Run this before and after to see the change.
select 'progress' as table_name, count(*) as orphaned
from public.reviewer_progress p
where not exists (
  select 1 from public.reviewers r
  where r.owner_id = p.owner_id and r.reviewer_id = p.reviewer_id
)
union all
select 'attempts', count(*)
from public.reviewer_attempts a
where not exists (
  select 1 from public.reviewers r
  where r.owner_id = a.owner_id and r.reviewer_id = a.reviewer_id
);

-- 2. Remove the orphans. These records cannot be displayed on any device: the
--    questions a session stores are only the ids it used, and rebuilding them
--    needs the reviewer, which is gone. There is nothing to salvage.
--
--    This is not data loss in practice. Any device that still holds the reviewer
--    in localStorage re-uploads it on its next sign-in, and pushUnsyncedLocalData
--    pushes reviewers before progress, so the session follows the reviewer back
--    up in the same pass.
delete from public.reviewer_attempts a
where not exists (
  select 1 from public.reviewers r
  where r.owner_id = a.owner_id and r.reviewer_id = a.reviewer_id
);

delete from public.reviewer_progress p
where not exists (
  select 1 from public.reviewers r
  where r.owner_id = p.owner_id and r.reviewer_id = p.reviewer_id
);

-- 3. Declare the link so this cannot happen again. Both tables go through
--    public.reviewers(owner_id, reviewer_id), which is already unique, so one
--    composite foreign key per table covers the ownership question too. Without
--    owner_id in the key a row could point at another account's reviewer.
--
--    on delete cascade is the behaviour the UI already assumes: deleting a
--    reviewer takes its quiz history with it, because a quiz against a reviewer
--    that no longer exists cannot be resumed or reviewed.
--
--    These are validated, so if step 2 somehow missed a row this fails loudly
--    rather than silently leaving the hole open.
alter table public.reviewer_progress
  drop constraint if exists reviewer_progress_reviewer_fkey;

alter table public.reviewer_progress
  add constraint reviewer_progress_reviewer_fkey
  foreign key (owner_id, reviewer_id)
  references public.reviewers(owner_id, reviewer_id)
  on delete cascade;

alter table public.reviewer_attempts
  drop constraint if exists reviewer_attempts_reviewer_fkey;

alter table public.reviewer_attempts
  add constraint reviewer_attempts_reviewer_fkey
  foreign key (owner_id, reviewer_id)
  references public.reviewers(owner_id, reviewer_id)
  on delete cascade;

commit;

-- After running:
--
--   -- 1. No orphans left, both should be 0.
--   select 'progress' as t, count(*) from public.reviewer_progress p
--   where not exists (select 1 from public.reviewers r
--     where r.owner_id = p.owner_id and r.reviewer_id = p.reviewer_id)
--   union all
--   select 'attempts', count(*) from public.reviewer_attempts a
--   where not exists (select 1 from public.reviewers r
--     where r.owner_id = a.owner_id and r.reviewer_id = a.reviewer_id);
--
--   -- 2. Both constraints exist.
--   select conname, confdeltype
--   from pg_constraint
--   where conname in ('reviewer_progress_reviewer_fkey', 'reviewer_attempts_reviewer_fkey');
--   -- confdeltype 'c' means cascade.
--
--   -- 3. Prove it. Delete one reviewer you do not care about, then confirm its
--   --    progress went with it:
--   --    select count(*) from reviewer_progress where reviewer_id = '<the id you deleted>';
--   --    should return 0.
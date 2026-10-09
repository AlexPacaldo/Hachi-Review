-- Let readers be told when the questions of a reviewer they can see were edited.
--
-- Run this once in the Supabase SQL editor. Safe to run again.
--
-- This is the whole of the change to supabase-schema.sql for edit
-- notifications. It is split out for the same reason the visibility toggles are:
-- the schema file is long, and a single unrelated statement failing in it stops
-- a full re-run before this reaches the database, which would leave the column
-- and the view change below unapplied with nothing on screen to say so.
--
-- THE PROBLEM
--
-- There is no notifications table. Every notification the app shows is derived
-- on the reader's own device by polling the social state and diffing it against
-- what that device already knew, which is why an edit is announceable at all
-- without any write reaching the readers.
--
-- But nothing in the row distinguished "the questions changed" from "the title
-- changed" or "the audience changed". updated_at moves on all of those, since
-- rename, visibility and group share all rewrite the row. Diffing it would fire
-- an edit notification every time a reviewer was renamed or unshared, which is
-- how a reader learns to ignore the notification entirely.
--
-- THE MECHANISM
--
-- One more timestamp, questions_updated_at, that moves only when the questions
-- themselves differ. It is set by a trigger rather than by the client so that
-- the signal cannot be missed by a code path that forgets to send it, and cannot
-- be forged by one that sets it on a row whose questions did not change. Readers
-- see it through reviewer_summaries, so detecting an edit costs no extra request
-- and reads no questions.
--
-- Backfilled from updated_at rather than left null, so the first poll after this
-- runs compares against something instead of treating every existing reviewer as
-- newly edited. That is belt and braces: a device already watching records a
-- stamp it has never seen as a first sighting and stays quiet, but a device that
-- has never polled at all would otherwise have no baseline to compare to.

begin;

alter table public.reviewers
  add column if not exists questions_updated_at timestamptz;

update public.reviewers
set questions_updated_at = updated_at
where questions_updated_at is null;

-- before, not after: the value has to be part of the row that is written, since
-- an after trigger would set it too late to be returned or observed.
--
-- Runs as the invoking user rather than as the table owner. It only assigns to
-- NEW, which needs no privilege the caller does not already have, so there is no
-- reason to widen its rights here.
create or replace function public.stamp_reviewer_question_edit()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- jsonb equality is structural, so a row rewritten with its questions
  -- unchanged, which every rename and every share does, compares equal and is
  -- left alone.
  if new.data->'questions' is distinct from old.data->'questions' then
    new.questions_updated_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists reviewers_stamp_question_edit on public.reviewers;
create trigger reviewers_stamp_question_edit
  before update on public.reviewers
  for each row
  execute function public.stamp_reviewer_question_edit();

-- The summary view is what the reader polls, so the stamp has to be on it.
-- Recreated rather than altered, because there is no alter view. security_invoker
-- is carried over from the original: a view runs with its owner's rights by
-- default, which would hand every reviewer to every caller.
--
-- The new column goes last, after summary, and that is not cosmetic.
-- create or replace view can only append columns; one inserted before an
-- existing one renames it and Postgres refuses the whole statement, which would
-- leave the trigger installed and the view unchanged.
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
    'updatedAt', r.updated_at,
    'questionsUpdatedAt', r.questions_updated_at
  ) as summary,
  r.questions_updated_at
from public.reviewers r;

commit;

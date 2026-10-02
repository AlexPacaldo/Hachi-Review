-- Fixes "permission denied for function is_friend".
--
-- Run this if Friends or Library shows that error. It is safe to run repeatedly
-- and changes nothing else. It only grants the execute privilege the tightened
-- profiles policy needs; the policy itself is already in place.
--
-- Cause: revoking execute from PUBLIC removes the privilege every function has by
-- default, and a row level security policy is evaluated as the signed-in user, so
-- the user needs execute on every function the policy calls.

grant execute on function public.is_friend(uuid, uuid) to authenticated;
grant execute on function public.shares_group_with(uuid, uuid) to authenticated;
grant execute on function public.owns_shared_reviewer_with(uuid, uuid) to authenticated;

-- Check it worked. All three should show granted for authenticated.
--   select proname, has_function_privilege('authenticated', oid, 'execute') as can_call
--   from pg_proc
--   where proname in ('is_friend', 'shares_group_with', 'owns_shared_reviewer_with');

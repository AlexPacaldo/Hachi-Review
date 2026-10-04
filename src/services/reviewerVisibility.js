// Who a reviewer is shared with. Friends and groups are two independent
// audiences, so a reviewer can be visible to either or to both, but the value
// stays a single column because the read policies, the summary view, and every
// caller already look at one column. Four values cover every combination.
export const VISIBILITY_PRIVATE = "private";
export const VISIBILITY_FRIENDS = "friends";
export const VISIBILITY_GROUP = "group";
export const VISIBILITY_FRIENDS_AND_GROUPS = "friends+groups";

export const FRIEND_VISIBILITIES = [VISIBILITY_FRIENDS, VISIBILITY_FRIENDS_AND_GROUPS];
export const GROUP_VISIBILITIES = [VISIBILITY_GROUP, VISIBILITY_FRIENDS_AND_GROUPS];

const KNOWN_VISIBILITIES = [VISIBILITY_PRIVATE, ...FRIEND_VISIBILITIES, ...GROUP_VISIBILITIES];

// A value this build does not recognise is read as the column default, which is
// friends, so a row written before the combined value existed keeps the audience
// it was saved with instead of silently going private.
export function normalizeVisibility(visibility) {
  return KNOWN_VISIBILITIES.includes(visibility) ? visibility : VISIBILITY_FRIENDS;
}

export function isFriendVisible(visibility) {
  return FRIEND_VISIBILITIES.includes(normalizeVisibility(visibility));
}

export function isGroupVisible(visibility) {
  return GROUP_VISIBILITIES.includes(normalizeVisibility(visibility));
}

// The audiences a stored value names, for deciding what to write next. Unlike the
// readers above, an unrecognised value names neither audience: this is only ever
// used for a write the owner asked for, and that has to fail closed.
export function readVisibilityToggles(visibility) {
  return {
    friends: FRIEND_VISIBILITIES.includes(visibility),
    groups: GROUP_VISIBILITIES.includes(visibility)
  };
}

export function resolveVisibility({ friends, groups }) {
  if (friends && groups) return VISIBILITY_FRIENDS_AND_GROUPS;
  if (groups) return VISIBILITY_GROUP;
  if (friends) return VISIBILITY_FRIENDS;
  return VISIBILITY_PRIVATE;
}
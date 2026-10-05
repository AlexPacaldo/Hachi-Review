// The bits of another person's profile that every row needs, kept out of the
// components so the rules are in one place and can be tested without a browser.

// A Google account is the only way an avatar is ever set, and those links go stale
// when somebody changes or removes their Google photo. A row that renders a dead
// link as a broken image looks broken, so callers have to be able to notice the
// failure; this only reads, it cannot.
export function getProfileAvatarUrl(profile) {
  return String(profile?.avatar_url || "").trim();
}

export function getProfileName(profile) {
  const name = String(profile?.display_name || "").trim();
  return name || "Hachi user";
}

// Suffixes are not surnames, and a name is very likely to carry one. Filipino and
// Spanish names in particular run to a middle name and a suffix, so taking the last
// space-separated word gives the wrong initial for a lot of real people.
const NAME_SUFFIXES = new Set(["jr", "sr", "jnr", "snr", "ii", "iii", "iv", "v", "phd", "md"]);

// First letter of the first name and of the last real name. Not every word, because
// "Maria Cristina Dela Cruz Santos" should read MS, not MC or MCDS.
//
// Deliberately does not fall back to getProfileName. A row RLS has hidden has no name
// we are entitled to show, and "Hachi user" beside it is a placeholder rather than an
// identity. Returning nothing lets the caller draw a person icon, which says "no
// picture here" instead of inventing initials for someone we cannot name.
export function getProfileInitials(profileOrName) {
  const source = typeof profileOrName === "string"
    ? profileOrName
    : String(profileOrName?.display_name || "").trim();
  let words = source.trim().split(/\s+/).filter(Boolean);

  // Trailing punctuation, so "Santos," and "Santos" are the same word.
  words = words.map((word) => word.replace(/[.,]/g, ""));

  // Peel suffixes off the end, longest first so "iii" is not left as "ii".
  while (words.length > 1 && NAME_SUFFIXES.has(words[words.length - 1].toLowerCase())) {
    words = words.slice(0, -1);
  }

  if (!words.length) return "";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();

  return `${words[0][0]}${words[words.length - 1][0]}`.toUpperCase();
}

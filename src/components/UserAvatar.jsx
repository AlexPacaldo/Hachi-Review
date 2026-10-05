import { useState } from "react";
import { UserRound } from "lucide-react";
import { getProfileAvatarUrl, getProfileInitials } from "../utils/userProfile.js";

const ICON_SIZES = { sm: 14, md: 17, lg: 22, cover: 30 };

// A profile picture for another person. Takes the profile row itself, or a name and
// a url for the two callers that have already resolved them.
//
// size="cover" drops the circle and fills its container instead, for a card that
// leads with the picture. The fallback still has to work there, so a person with no
// picture gets a large monogram rather than a 30px circle floating in a wide gap.
//
// The failed url is remembered rather than a boolean, so a row that swaps in a
// different person is not left showing the previous person's initials. This matters
// because the url is copied out of the person's Google account: those links do go
// stale when someone changes or removes their Google photo, and without this a single
// dead link would paint a broken image down the whole list.
export default function UserAvatar({ profile, name, src, size = "md" }) {
  const [failedUrl, setFailedUrl] = useState("");
  const url = src || getProfileAvatarUrl(profile);
  // The raw name, not getProfileName. Passing the placeholder through would make a
  // row RLS has hidden draw "HU", which claims an identity the app does not have.
  const label = name ?? profile?.display_name ?? "";
  const showImage = Boolean(url) && failedUrl !== url;
  const initials = getProfileInitials(label);

  return (
    <span className={`user-avatar user-avatar-${size}`} aria-hidden="true">
      {showImage ? (
        <img src={url} alt="" loading="lazy" onError={() => setFailedUrl(url)} />
      ) : initials ? (
        <span className="user-avatar-initials">{initials}</span>
      ) : (
        <UserRound size={ICON_SIZES[size] || ICON_SIZES.md} />
      )}
    </span>
  );
}

import { NavLink } from "react-router-dom";
import { UserRound } from "lucide-react";
import { useAuth } from "../contexts/AuthContext.jsx";
import { NotificationCenter } from "./NotificationCenter.jsx";

export default function TopActions() {
  // The account's own name and picture come from its profile row through the auth
  // context, so a rename shows here straight away. Reading the sign-in provider's
  // metadata instead showed the name the account had already changed away from,
  // and reverted to the provider's own whenever OAuth rewrote that metadata.
  const { user, displayName, avatarUrl } = useAuth();
  const name = user ? displayName : "Sign In";

  return (
    <div className="app-top-actions" aria-label="Account and notifications">
      <NotificationCenter />
      <span className="top-cluster-divider" aria-hidden="true" />
      <NavLink className="top-account-link" to="/account" aria-label={user ? `Account for ${name}` : "Sign in"}>
        <span className="top-account-avatar" aria-hidden="true">
          {user && avatarUrl ? <img src={avatarUrl} alt="" /> : <UserRound size={18} />}
        </span>
        <span className="top-account-name">{name}</span>
      </NavLink>
    </div>
  );
}
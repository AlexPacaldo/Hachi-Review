const KEY_STORAGE = "hachi_presence_key";

function newKey() {
  const id = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  return `tab-${id}`;
}

// One identity per tab that survives a refresh. A fresh key per page load would
// leave the previous row behind on every reload, because a request made while
// the tab is closing does not reliably finish, and the count would climb by one
// per refresh until the old rows aged out of the window.
export function getPresenceKey() {
  try {
    const stored = window.sessionStorage.getItem(KEY_STORAGE);
    if (stored) return stored;

    const key = newKey();
    window.sessionStorage.setItem(KEY_STORAGE, key);
    return key;
  } catch {
    // Storage can be unavailable. A per mount key is still better than none.
    return newKey();
  }
}
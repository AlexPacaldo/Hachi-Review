// Reloading throws away whatever is only in memory, so the update reload waits
// while something the user would have to start again is running. A page holds a
// reason for as long as that is true and releases it when it is not, and the
// update notice only appears if a hold is still in place when the new version
// lands. Persisted work, like a saved quiz session or a saved draft, is not a
// hold: it survives the reload on its own.
const holds = new Set();
const listeners = new Set();

function emit() {
  const busy = holds.size > 0;
  listeners.forEach((listener) => listener(busy));
}

export function holdBusyWork(reason) {
  // The token is what makes a hold its own holder. Keying on the reason string
  // would let two overlapping holds share one entry, and the first release would
  // then drop both.
  const token = Symbol(reason);
  holds.add(token);
  emit();

  let released = false;
  return () => {
    if (released) return;
    released = true;
    holds.delete(token);
    emit();
  };
}

// The current state is delivered on subscribe, not only on change. Child effects
// run before parent effects, so a page that holds on mount does so before the
// app shell has subscribed, and a listener that only heard about changes would
// sit at false and reload the page out from under the hold it never saw. That is
// the ordinary case of resuming a paused quiz by opening its link directly.
export function subscribeBusyWork(listener) {
  listeners.add(listener);
  listener(holds.size > 0);
  return () => {
    listeners.delete(listener);
  };
}
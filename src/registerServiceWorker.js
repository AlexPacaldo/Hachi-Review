export function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || import.meta.env.DEV) return;

  window.addEventListener("load", () => {
    const serviceWorkerUrl = `${import.meta.env.BASE_URL}service-worker.js`;

    // A first claim is not an update. When nothing controlled the page, the
    // worker that installs here claims it and fires controllerchange, and
    // reloading on that would throw away the page the user just waited for.
    // Only the first claim is exempt, so the flag has to be consumed rather than
    // sampled: read once at load it stays false for the life of a tab that
    // happened to open before its worker existed, and every real update after
    // that is swallowed, leaving the tab on a stale version indefinitely.
    let claimed = Boolean(navigator.serviceWorker.controller);

    const announceUpdate = () => {
      if (claimed) {
        window.dispatchEvent(new Event("reviewhub:update-ready"));
        return;
      }
      claimed = true;
    };

    navigator.serviceWorker
      .register(serviceWorkerUrl)
      .then((registration) => {
        if (registration.waiting) {
          announceUpdate();
        }

        registration.addEventListener("updatefound", () => {
          const newWorker = registration.installing;
          if (!newWorker) return;

          newWorker.addEventListener("statechange", () => {
            if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
              announceUpdate();
            }
          });
        });
      })
      .catch((error) => {
        console.warn("Service worker registration failed.", error);
      });

    navigator.serviceWorker.addEventListener("controllerchange", announceUpdate);
  });
}

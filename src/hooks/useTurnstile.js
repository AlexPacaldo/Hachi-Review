import { useCallback, useEffect, useRef, useState } from "react";

// Cloudflare Turnstile is optional. Without a site key the widget never renders
// and getToken resolves to an empty string, and the endpoint skips verification
// too, so the generator keeps working for someone who has not set it up.
//
// The token is single use and short lived, so it is fetched immediately before
// each request rather than held onto. A widget that has already been solved is
// reset through execute() after every read.
const SCRIPT_ID = "cf-turnstile-script";
const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

function readSiteKey() {
  return String(import.meta.env.VITE_TURNSTILE_SITE_KEY || "").trim();
}

export function useTurnstile() {
  const siteKey = readSiteKey();
  const enabled = Boolean(siteKey);
  const containerRef = useRef(null);
  const widgetIdRef = useRef(null);
  const resolverRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");

  const settle = useCallback((token) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;

    if (resolve) resolve(token || "");
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;

    let isMounted = true;

    const mountWidget = () => {
      if (!isMounted || !containerRef.current || widgetIdRef.current !== null) return;

      try {
        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          theme: "light",
          size: "normal",
          // The generator form is the only place this is used, and a request
          // arriving from somewhere else should not inherit a solved token.
          action: "generate-reviewer",
          callback: (token) => settle(token),
          "expired-callback": () => settle(""),
          "error-callback": () => {
            setError("The bot check could not load. Reload the page and try again.");
            settle("");
          }
        });
        setReady(true);
      } catch {
        setError("The bot check could not load. Reload the page and try again.");
      }
    };

    if (window.turnstile) {
      mountWidget();
      return undefined;
    }

    const existingScript = document.getElementById(SCRIPT_ID);

    if (existingScript) {
      existingScript.addEventListener("load", mountWidget, { once: true });
      return () => existingScript.removeEventListener("load", mountWidget);
    }

    const script = document.createElement("script");
    script.id = SCRIPT_ID;
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.addEventListener("load", mountWidget, { once: true });
    document.head.appendChild(script);

    return () => {
      script.removeEventListener("load", mountWidget);
    };
  }, [enabled, siteKey, settle]);

  // Drop the widget on unmount so a second render does not stack two on the page.
  useEffect(() => {
    return () => {
      if (widgetIdRef.current !== null) {
        try {
          window.turnstile?.remove(widgetIdRef.current);
        } catch {
          // Nothing useful to do while tearing down.
        }
        widgetIdRef.current = null;
      }
    };
  }, []);

  const getToken = useCallback(() => {
    if (!enabled) return Promise.resolve("");

    const widget = widgetIdRef.current;

    if (!window.turnstile || widget === null) {
      return Promise.resolve("");
    }

    return new Promise((resolve) => {
      resolverRef.current = resolve;

      try {
        window.turnstile.execute(widget);
      } catch {
        settle("");
      }

      // Turnstile calls back quickly when it has an answer and has nothing to say
      // when it cannot, so this keeps a stuck widget from hanging the request.
      window.setTimeout(() => settle(""), 15000);
    });
  }, [enabled, settle]);

  // A token is spent the moment it is sent, so ask for a fresh one next time.
  const reset = useCallback(() => {
    if (!enabled || widgetIdRef.current === null || !window.turnstile) return;

    try {
      window.turnstile.reset(widgetIdRef.current);
    } catch {
      // A widget that cannot reset will simply be executed again on the next run.
    }
  }, [enabled]);

  return { enabled, ready, error, containerRef, getToken, reset };
}
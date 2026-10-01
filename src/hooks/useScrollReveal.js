import { useEffect } from "react";

const DEFAULT_SELECTOR = "[data-reveal]";

function prefersReducedMotion() {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Watches every `[data-reveal]` element inside the scope and adds `.is-revealed`
 * once it scrolls into view, so entrance animations stay pure CSS. Falls back to
 * revealing everything when IntersectionObserver is missing or the visitor asked
 * for reduced motion, which keeps the content readable either way.
 */
export default function useScrollReveal(scopeRef, options = {}) {
  const { selector = DEFAULT_SELECTOR, threshold = 0.14, rootMargin = "0px 0px -6% 0px" } = options;

  useEffect(() => {
    const scope = scopeRef.current;
    if (!scope) return undefined;

    const targets = Array.from(scope.querySelectorAll(selector));
    if (!targets.length) return undefined;

    if (!("IntersectionObserver" in window) || prefersReducedMotion()) {
      targets.forEach((target) => target.classList.add("is-revealed"));
      return undefined;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-revealed");
          observer.unobserve(entry.target);
        });
      },
      { threshold, rootMargin }
    );

    targets.forEach((target) => observer.observe(target));
    return () => observer.disconnect();
  }, [scopeRef, selector, threshold, rootMargin]);
}
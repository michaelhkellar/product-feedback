"use client";

import { useEffect } from "react";

/**
 * Global window-level error handlers for diagnosing the kind of error that surfaces
 * in Next's dev overlay as the unhelpful message "[object Event]".
 *
 * That message means an `Event` object (not an `Error`) ended up as the rejection
 * reason of an unhandled promise. Without intervention, Next's overlay calls
 * `String(reason)` which produces the toString of the Event, with no context.
 *
 * What this does:
 *   - Logs every uncaught error and unhandled rejection with stable, readable detail
 *     (type, target, src, message, stack).
 *   - For Event-typed rejections, converts the rejection into a real Error that
 *     carries useful context — so the dev overlay shows something actionable.
 *
 * Mounted once at app root via a hidden client component.
 */
export function ErrorHandlers() {
  useEffect(() => {
    function describeEvent(ev: Event): string {
      const tgt = ev.target as
        | (HTMLElement & { src?: string; href?: string; tagName?: string })
        | null;
      const tag = tgt?.tagName ? tgt.tagName.toLowerCase() : "?";
      const src = tgt?.src || tgt?.href || "";
      return `Event(type=${ev.type}, target=<${tag}>${src ? ` src=${src}` : ""})`;
    }

    function onUnhandledRejection(e: PromiseRejectionEvent): void {
      const reason = e.reason;
      if (reason instanceof Event) {
        const detail = describeEvent(reason);
        console.error("[unhandledrejection] Event object as promise rejection — usually a media/script load failure or third-party library bug:", detail, reason);
        // Replace with a real Error so Next's overlay shows something useful.
        // preventDefault stops the original "[object Event]" overlay; we throw a
        // proper Error in a microtask so the overlay can catch THAT instead.
        e.preventDefault();
        Promise.reject(new Error(`Unhandled promise rejection with Event reason: ${detail}`));
      } else if (reason && typeof reason === "object" && !(reason instanceof Error)) {
        console.error("[unhandledrejection] Non-Error rejection:", reason);
      }
    }

    function onError(e: ErrorEvent): void {
      // Skip uninteresting noise (e.g. browser extension errors with no source)
      if (!e.error && !e.message) return;
      if (e.error instanceof Event) {
        console.error("[error] Event object thrown:", describeEvent(e.error), e.error);
      }
    }

    window.addEventListener("unhandledrejection", onUnhandledRejection);
    window.addEventListener("error", onError);
    return () => {
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
      window.removeEventListener("error", onError);
    };
  }, []);

  return null;
}

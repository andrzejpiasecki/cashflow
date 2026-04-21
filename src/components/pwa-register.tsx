"use client";

import { useEffect } from "react";

export function PwaRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    // In development, service worker causes stale chunks/styles after refresh.
    // Keep dev mode deterministic by fully disabling SW.
    if (process.env.NODE_ENV !== "production") {
      void navigator.serviceWorker.getRegistrations().then((registrations) => {
        registrations.forEach((registration) => {
          void registration.unregister();
        });
      });
      return;
    }

    let reloading = false;

    const activateWaitingWorker = (registration: ServiceWorkerRegistration) => {
      if (registration.waiting) {
        registration.waiting.postMessage({ type: "SKIP_WAITING" });
      }
    };

    const wireRegistration = (registration: ServiceWorkerRegistration) => {
      activateWaitingWorker(registration);

      registration.addEventListener("updatefound", () => {
        const worker = registration.installing;
        if (!worker) return;
        worker.addEventListener("statechange", () => {
          if (worker.state === "installed" && navigator.serviceWorker.controller) {
            activateWaitingWorker(registration);
          }
        });
      });
    };

    const reloadOnControllerChange = () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    };

    const register = async () => {
      try {
        const registration = await navigator.serviceWorker.register("/sw.js", {
          scope: "/",
          updateViaCache: "none",
        });
        wireRegistration(registration);
        void registration.update();

        const refreshRegistration = () => {
          void registration.update();
        };
        const handleVisibilityChange = () => {
          if (document.visibilityState === "visible") {
            refreshRegistration();
          }
        };

        window.addEventListener("focus", refreshRegistration);
        document.addEventListener("visibilitychange", handleVisibilityChange);

        return () => {
          window.removeEventListener("focus", refreshRegistration);
          document.removeEventListener("visibilitychange", handleVisibilityChange);
        };
      } catch {
        // ignore registration failures in non-supported contexts
      }
      return undefined;
    };

    navigator.serviceWorker.addEventListener("controllerchange", reloadOnControllerChange);

    let cleanupRegistrationListeners: (() => void) | undefined;
    void register().then((cleanup) => {
      cleanupRegistrationListeners = cleanup;
    });

    return () => {
      navigator.serviceWorker.removeEventListener("controllerchange", reloadOnControllerChange);
      cleanupRegistrationListeners?.();
    };
  }, []);

  return null;
}

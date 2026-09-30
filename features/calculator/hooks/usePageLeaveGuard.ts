"use client";

import { useEffect } from "react";

export function usePageLeaveGuard(hasPendingChanges: boolean) {
  useEffect(() => {
    if (!hasPendingChanges) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [hasPendingChanges]);
}

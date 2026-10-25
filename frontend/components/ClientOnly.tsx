"use client";

import { useEffect, useState } from "react";

/**
 * Renders children only in the browser. Used for form-heavy pages: browser extensions and
 * autofill (e.g. `fdprocessedid` attributes) edit form fields before React hydrates, which
 * triggers hydration-mismatch errors. With no server HTML there is nothing to mismatch.
 */
export function ClientOnly({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted ? <>{children}</> : null;
}

import { lazy, Suspense } from "react";
import type { CreditsProps } from "./CreditsSection";

const CreditsSection = lazy(() => import("./CreditsSection"));

/** The rail's Credits section; the content loads on first show. */
export function CreditsSlot(props: CreditsProps) {
  return (
    <Suspense fallback={null}>
      <CreditsSection {...props} />
    </Suspense>
  );
}

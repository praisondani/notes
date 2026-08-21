import { Suspense } from "react";
import { AuthGate } from "@/components/auth-gate";
import { WorkspaceLoading } from "@/components/workspace-loading";

export const instant = true;

export default function HomePage() {
  return (
    <Suspense fallback={<WorkspaceLoading />}><AuthGate /></Suspense>
  );
}

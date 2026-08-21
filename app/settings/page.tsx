import { Suspense } from "react";
import { SettingsScreen } from "@/components/settings-screen";
import { WorkspaceLoading } from "@/components/workspace-loading";

export const instant = true;

export default function SettingsPage() {
  return <Suspense fallback={<WorkspaceLoading />}><SettingsScreen /></Suspense>;
}

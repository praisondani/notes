"use client";

import { useEffect, useState } from "react";
import { LoginScreen } from "@/components/login-screen";
import { NotesApp } from "@/components/notes-app";
import { SetupScreen } from "@/components/setup-screen";
import { WorkspaceLoading } from "@/components/workspace-loading";

type GateState = "loading" | "setup" | "login" | "ready" | "error";

export function AuthGate() {
  const [state, setState] = useState<GateState>("loading");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/session", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Session could not be loaded");
        return response.json() as Promise<{ setupRequired: boolean; authenticated: boolean }>;
      })
      .then((session) => {
        if (cancelled) return;
        setState(session.setupRequired ? "setup" : session.authenticated ? "ready" : "login");
      })
      .catch(() => {
        if (!cancelled) setState("error");
      });
    return () => { cancelled = true; };
  }, []);

  if (state === "setup") return <SetupScreen />;
  if (state === "login") return <LoginScreen />;
  if (state === "ready") return <NotesApp />;
  if (state === "error") return <main className="loading-shell"><div className="empty-state"><div><strong>Could not open Notes</strong><p>Refresh the page and try again.</p></div></div></main>;
  return <WorkspaceLoading />;
}

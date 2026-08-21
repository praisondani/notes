"use client";

import { useState, type FormEvent } from "react";
import { KeyRound, Layers3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function SetupScreen() {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (password !== confirmation) {
      setError("Passwords do not match.");
      return;
    }
    setLoading(true);
    try {
      const response = await fetch("/api/auth/setup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, email, password }) });
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        setError(payload.error ?? "Account setup failed.");
        return;
      }
      window.location.reload();
    } catch {
      setError("The setup request failed. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  return <main className="login-shell"><div className="login-panel"><div className="brand-lockup"><span className="brand-mark" aria-hidden="true"><Layers3 className="h-4 w-4" /></span><span>Notes</span></div><div className="login-copy"><KeyRound className="h-5 w-5 text-primary" /><div><h1>Create your owner account</h1><p>This account protects the workspace and controls its settings.</p></div></div><form className="dialog-form" onSubmit={submit}><label className="dialog-field"><span className="text-xs font-semibold">Username</span><Input autoFocus required minLength={3} maxLength={32} autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} /><small className="text-xs text-muted-foreground">3–32 letters, numbers, dots, underscores, or hyphens.</small></label><label className="dialog-field"><span className="text-xs font-semibold">Email</span><Input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label><label className="dialog-field"><span className="text-xs font-semibold">Password</span><Input required minLength={12} autoComplete="new-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} /><small className="text-xs text-muted-foreground">Use at least 12 characters.</small></label><label className="dialog-field"><span className="text-xs font-semibold">Confirm password</span><Input required minLength={12} autoComplete="new-password" type="password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label>{error && <p className="text-sm text-destructive" role="alert">{error}</p>}<Button type="submit" disabled={loading}>{loading ? "Creating account…" : "Create account"}</Button></form></div></main>;
}

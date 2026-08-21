"use client";

import { useState, type FormEvent } from "react";
import { Layers3, LockKeyhole } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function LoginScreen() {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ identifier, password }) });
      const payload = await response.json().catch(() => ({})) as { error?: string; setupRequired?: boolean };
      if (!response.ok) {
        setError(payload.setupRequired ? "Create the owner account before signing in." : payload.error ?? "Invalid username, email, or password.");
        return;
      }
      window.location.reload();
    } catch {
      setError("The sign-in request failed. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  return <main className="login-shell"><div className="login-panel"><div className="brand-lockup"><span className="brand-mark" aria-hidden="true"><Layers3 className="h-4 w-4" /></span><span>Notes</span></div><div className="login-copy"><LockKeyhole className="h-5 w-5 text-primary" /><div><h1>Private workspace</h1><p>Sign in with your username or email address.</p></div></div><form className="dialog-form" onSubmit={submit}><label className="dialog-field"><span className="text-xs font-semibold">Username or email</span><Input autoFocus required autoComplete="username" value={identifier} onChange={(event) => setIdentifier(event.target.value)} /></label><label className="dialog-field"><span className="text-xs font-semibold">Password</span><Input required autoComplete="current-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>{error && <p className="text-sm text-destructive" role="alert">{error}</p>}<Button type="submit" disabled={loading}><LockKeyhole className="h-4 w-4" />{loading ? "Signing in…" : "Sign in"}</Button></form></div></main>;
}

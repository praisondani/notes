"use client";

import { useState, type FormEvent } from "react";
import { Layers3, LockKeyhole } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function LoginScreen() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    const response = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
    if (!response.ok) {
      setError("That password did not work.");
      setLoading(false);
      return;
    }
    window.location.reload();
  }

  return <main className="login-shell"><div className="login-panel"><div className="brand-lockup"><span className="brand-mark" aria-hidden="true"><Layers3 className="h-4 w-4" /></span><span>Notes</span></div><div className="login-copy"><LockKeyhole className="h-5 w-5 text-primary" /><div><h1>Private workspace</h1><p>Enter your workspace password to continue.</p></div></div><form className="dialog-form" onSubmit={submit}><label className="dialog-field"><span className="text-xs font-semibold">Password</span><Input autoFocus required type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>{error && <p className="text-sm text-destructive" role="alert">{error}</p>}<Button type="submit" disabled={loading}><LockKeyhole className="h-4 w-4" />{loading ? "Unlocking…" : "Unlock workspace"}</Button></form></div></main>;
}

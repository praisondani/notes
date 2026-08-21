"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { Check, Layers3, LockKeyhole, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type ConsentPayload = {
  authenticated: boolean;
  setupRequired: boolean;
  transaction: string;
  client: { name: string; uri?: string };
  redirectUri: string;
  scopes: string[];
  expiresAt: number;
};

function scopeLabel(scope: string): string {
  return scope === "notes:write" ? "Create, edit, move, or delete notes" : "Read notes, folders, groups, and search results";
}

function redirectHost(value: string): string {
  try {
    return new URL(value).host;
  } catch {
    return value;
  }
}

export function OAuthConsentScreen() {
  const [payload, setPayload] = useState<ConsentPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [loginError, setLoginError] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/oauth/authorize${window.location.search}`, { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json().catch(() => ({})) as ConsentPayload & { error?: string };
        if (!response.ok) throw new Error(body.error ?? "The authorization request could not be loaded.");
        return body;
      })
      .then((nextPayload) => {
        if (!cancelled) setPayload(nextPayload);
      })
      .catch((reason) => {
        if (!cancelled) setLoadError(reason instanceof Error ? reason.message : "The authorization request could not be loaded.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  async function submitLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoginLoading(true);
    setLoginError("");
    try {
      const response = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ identifier, password }) });
      const body = await response.json().catch(() => ({})) as { error?: string; setupRequired?: boolean };
      if (!response.ok) throw new Error(body.setupRequired ? "Create the owner account before connecting an agent." : body.error ?? "Invalid username, email, or password.");
      if (payload) {
        const nextResponse = await fetch(`/api/oauth/authorize?transaction=${encodeURIComponent(payload.transaction)}`, { cache: "no-store" });
        const nextPayload = await nextResponse.json().catch(() => ({})) as ConsentPayload & { error?: string };
        if (!nextResponse.ok) throw new Error(nextPayload.error ?? "The authorization request could not be loaded.");
        setPayload(nextPayload);
      }
    } catch (reason) {
      setLoginError(reason instanceof Error ? reason.message : "Sign-in failed.");
    } finally {
      setLoginLoading(false);
    }
  }

  if (loading) return <main className="login-shell"><div className="login-panel oauth-panel"><div className="brand-lockup"><span className="brand-mark" aria-hidden="true"><Layers3 className="h-4 w-4" /></span><span>Notes</span></div><p className="oauth-loading">Preparing secure agent connection…</p></div></main>;
  if (loadError) return <main className="login-shell"><div className="login-panel oauth-panel"><div className="brand-lockup"><span className="brand-mark" aria-hidden="true"><Layers3 className="h-4 w-4" /></span><span>Notes</span></div><div className="login-copy"><ShieldCheck className="h-5 w-5 text-destructive" /><div><h1>Connection could not start</h1><p>{loadError}</p></div></div><Button asChild variant="outline"><Link href="/">Return to Notes</Link></Button></div></main>;
  if (!payload) return null;
  if (payload.setupRequired) return <main className="login-shell"><div className="login-panel oauth-panel"><div className="brand-lockup"><span className="brand-mark" aria-hidden="true"><Layers3 className="h-4 w-4" /></span><span>Notes</span></div><div className="login-copy"><LockKeyhole className="h-5 w-5 text-primary" /><div><h1>Set up Notes first</h1><p>Create the owner account before connecting an agent.</p></div></div><Button asChild><Link href="/">Create owner account</Link></Button></div></main>;
  if (!payload.authenticated) return <main className="login-shell"><div className="login-panel oauth-panel"><div className="brand-lockup"><span className="brand-mark" aria-hidden="true"><Layers3 className="h-4 w-4" /></span><span>Notes</span></div><div className="login-copy"><LockKeyhole className="h-5 w-5 text-primary" /><div><h1>Sign in to connect</h1><p>Sign in before granting this agent access to your private workspace.</p></div></div><form className="dialog-form" onSubmit={submitLogin}><label className="dialog-field"><span className="text-xs font-semibold">Username or email</span><Input autoFocus required autoComplete="username" value={identifier} onChange={(event) => setIdentifier(event.target.value)} /></label><label className="dialog-field"><span className="text-xs font-semibold">Password</span><Input required autoComplete="current-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>{loginError && <p className="text-sm text-destructive" role="alert">{loginError}</p>}<Button type="submit" disabled={loginLoading}><LockKeyhole className="h-4 w-4" />{loginLoading ? "Signing in…" : "Sign in and continue"}</Button></form></div></main>;

  return <main className="login-shell"><div className="login-panel oauth-panel"><div className="brand-lockup"><span className="brand-mark" aria-hidden="true"><Layers3 className="h-4 w-4" /></span><span>Notes</span></div><div className="login-copy"><ShieldCheck className="h-5 w-5 text-primary" /><div><h1>Connect {payload.client.name}</h1><p>This agent is requesting access to your private Notes workspace.</p></div></div><div className="oauth-client-summary"><strong>{payload.client.name}</strong><span>{redirectHost(payload.redirectUri)}</span></div><div className="oauth-scope-list" aria-label="Requested permissions">{payload.scopes.map((scope) => <div className="oauth-scope" key={scope}><Check className="h-4 w-4 text-primary" /><span>{scopeLabel(scope)}</span></div>)}</div>{payload.scopes.includes("notes:write") && <p className="oauth-warning" role="note">This connection can change or delete notes. Grant write access only if you trust this agent.</p>}<form method="post" action="/api/oauth/authorize" className="oauth-actions"><input type="hidden" name="transaction" value={payload.transaction} /><Button type="submit" name="decision" value="approve">Approve connection</Button><Button type="submit" name="decision" value="deny" variant="outline">Deny</Button></form><p className="oauth-footnote">You can revoke this connection later in Settings → Data and connections.</p></div></main>;
}

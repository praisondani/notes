"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, Clipboard, Download, KeyRound, LogOut, Monitor, Moon, ShieldCheck, Sun, Trash2, UserRound, UsersRound } from "lucide-react";
import { LoginScreen } from "@/components/login-screen";
import { SetupScreen } from "@/components/setup-screen";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { WorkspaceLoading } from "@/components/workspace-loading";
import { applyTheme, readThemePreference, resolveDarkTheme, setThemePreference as saveThemePreference, type ThemePreference } from "@/lib/theme";
import type { AuthUser } from "@/lib/auth-store";

type Session = { setupRequired: boolean; authenticated: boolean; user?: AuthUser };
type ConnectedClient = { clientId: string; clientName: string; clientUri?: string; scopes?: string[]; createdAt: string; activeTokenCount: number };

function statusClass(message: string): string {
  return message.startsWith("Error:") ? "text-destructive" : "text-primary";
}

export function SettingsScreen() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [sessionError, setSessionError] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [profileMessage, setProfileMessage] = useState("");
  const [passwordMessage, setPasswordMessage] = useState("");
  const [dataMessage, setDataMessage] = useState("");
  const [connectedClients, setConnectedClients] = useState<ConnectedClient[]>([]);
  const [clientsLoading, setClientsLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(false);
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [dataLoading, setDataLoading] = useState(false);
  const [themePreference, setThemePreferenceState] = useState<ThemePreference>(() => readThemePreference());
  const [darkMode, setDarkMode] = useState(() => resolveDarkTheme(readThemePreference()));
  const [copied, setCopied] = useState(false);
  const mcpEndpoint = "/api/mcp";

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/session", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Session could not be loaded");
        return response.json() as Promise<Session>;
      })
      .then((nextSession) => {
        if (cancelled) return;
        setSession(nextSession);
        setUsername(nextSession.user?.username ?? "");
        setEmail(nextSession.user?.email ?? "");
      })
      .catch(() => {
        if (!cancelled) setSessionError("Could not load settings. Refresh the page and try again.");
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!session?.authenticated) return;
    let cancelled = false;
    fetch("/api/oauth/clients", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json().catch(() => ({})) as { clients?: ConnectedClient[]; error?: string };
        if (!response.ok) throw new Error(body.error ?? "Connected agents could not be loaded.");
        return body.clients ?? [];
      })
      .then((clients) => {
        if (!cancelled) setConnectedClients(clients);
      })
      .catch((error) => {
        if (!cancelled) setDataMessage(`Error: ${error instanceof Error ? error.message : "Connected agents could not be loaded."}`);
      })
      .finally(() => {
        if (!cancelled) setClientsLoading(false);
      });
    return () => { cancelled = true; };
  }, [session?.authenticated]);

  useEffect(() => {
    applyTheme(themePreference);
    const media = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)") : null;
    const updateSystemTheme = () => {
      setDarkMode(resolveDarkTheme(themePreference, media?.matches ?? false));
      if (themePreference === "system") applyTheme(themePreference);
    };
    if (themePreference !== "system" || !media) return;
    media.addEventListener("change", updateSystemTheme);
    return () => media.removeEventListener("change", updateSystemTheme);
  }, [themePreference]);

  function changeTheme(nextPreference: ThemePreference) {
    setThemePreferenceState(nextPreference);
    setDarkMode(saveThemePreference(nextPreference));
  }

  async function submitProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setProfileLoading(true);
    setProfileMessage("");
    try {
      const response = await fetch("/api/auth/profile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, email }) });
      const payload = await response.json().catch(() => ({})) as { error?: string; user?: AuthUser };
      if (response.status === 401) {
        window.location.reload();
        return;
      }
      if (!response.ok) throw new Error(payload.error ?? "Profile update failed.");
      if (payload.user) setSession((current) => current ? { ...current, user: payload.user } : current);
      setProfileMessage("Profile saved.");
    } catch (error) {
      setProfileMessage(`Error: ${error instanceof Error ? error.message : "Profile update failed."}`);
    } finally {
      setProfileLoading(false);
    }
  }

  async function submitPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPasswordMessage("");
    if (newPassword !== passwordConfirmation) {
      setPasswordMessage("Error: New passwords do not match.");
      return;
    }
    setPasswordLoading(true);
    try {
      const response = await fetch("/api/auth/password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ currentPassword, newPassword }) });
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (response.status === 401) {
        setPasswordMessage(`Error: ${payload.error ?? "Authentication required."}`);
        return;
      }
      if (!response.ok) throw new Error(payload.error ?? "Password update failed.");
      setCurrentPassword("");
      setNewPassword("");
      setPasswordConfirmation("");
      setPasswordMessage("Password rotated. Your current session remains active.");
    } catch (error) {
      setPasswordMessage(`Error: ${error instanceof Error ? error.message : "Password update failed."}`);
    } finally {
      setPasswordLoading(false);
    }
  }

  async function exportWorkspace() {
    setDataLoading(true);
    setDataMessage("");
    try {
      const response = await fetch("/api/workspace", { cache: "no-store" });
      if (!response.ok) throw new Error(response.status === 401 ? "Authentication required." : "Workspace export failed.");
      const blob = new Blob([JSON.stringify(await response.json(), null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `notes-export-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      setDataMessage("Workspace export downloaded.");
    } catch (error) {
      setDataMessage(`Error: ${error instanceof Error ? error.message : "Workspace export failed."}`);
    } finally {
      setDataLoading(false);
    }
  }

  async function copyMcpEndpoint() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${mcpEndpoint}`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setDataMessage("Error: Your browser did not allow copying the endpoint.");
    }
  }

  async function revokeClient(clientId: string, clientName: string) {
    setDataMessage("");
    try {
      const response = await fetch("/api/oauth/clients", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId }) });
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Connection could not be revoked.");
      setConnectedClients((clients) => clients.filter((client) => client.clientId !== clientId));
      setDataMessage(`${clientName} was disconnected. Existing access tokens were revoked.`);
    } catch (error) {
      setDataMessage(`Error: ${error instanceof Error ? error.message : "Connection could not be revoked."}`);
    }
  }

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/");
  }

  if (sessionError) return <main className="settings-shell"><div className="empty-state"><div><strong>Could not open settings</strong><p>{sessionError}</p></div></div></main>;
  if (!session) return <WorkspaceLoading />;
  if (session.setupRequired) return <SetupScreen />;
  if (!session.authenticated) return <LoginScreen />;

  return (
    <main className="settings-shell">
      <header className="settings-topbar">
        <Button asChild variant="ghost" size="sm"><Link href="/"><ArrowLeft className="h-4 w-4" />Back to notes</Link></Button>
        <div className="brand-lockup"><span className="brand-mark" aria-hidden="true"><UserRound className="h-4 w-4" /></span><span>Settings</span></div>
        <Button variant="ghost" size="sm" onClick={signOut}><LogOut className="h-4 w-4" />Sign out</Button>
      </header>

      <div className="settings-layout">
        <aside className="settings-nav" aria-label="Settings sections">
          <p className="settings-nav-label">Your workspace</p>
          <a href="#account">Account</a>
          <a href="#appearance">Appearance</a>
          <a href="#security">Security</a>
          <a href="#data">Data and connections</a>
        </aside>

        <div className="settings-content">
          <div className="settings-intro"><p className="eyebrow">Workspace settings</p><h1>Control your private Notes workspace.</h1><p>Manage the account that protects this deployment, how it looks, and how trusted agents connect to it.</p></div>

          <section className="settings-section" id="account" aria-labelledby="account-heading">
            <div className="settings-section-heading"><div><h2 id="account-heading">Account</h2><p>Your username and email are used for sign-in.</p></div><UserRound className="h-5 w-5 text-muted-foreground" /></div>
            <form className="settings-form" onSubmit={submitProfile}>
              <div className="settings-field"><label htmlFor="settings-username">Username</label><Input id="settings-username" autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} /></div>
              <div className="settings-field"><label htmlFor="settings-email">Email</label><Input id="settings-email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></div>
              <div className="settings-actions"><Button type="submit" disabled={profileLoading}>{profileLoading ? "Saving…" : "Save profile"}</Button>{profileMessage && <span className={statusClass(profileMessage)} role="status">{profileMessage}</span>}</div>
            </form>
          </section>

          <section className="settings-section" id="appearance" aria-labelledby="appearance-heading">
            <div className="settings-section-heading"><div><h2 id="appearance-heading">Appearance</h2><p>Choose the color scheme for this browser. {darkMode ? "Dark theme is active." : "Light theme is active."}</p></div><Sun className="h-5 w-5 text-muted-foreground" /></div>
            <div className="settings-option-grid" role="radiogroup" aria-label="Theme preference">
              {(["light", "dark", "system"] as ThemePreference[]).map((preference) => <button type="button" role="radio" aria-checked={themePreference === preference} className="settings-option" data-active={themePreference === preference} key={preference} onClick={() => changeTheme(preference)}><span className="settings-option-icon">{preference === "light" ? <Sun className="h-4 w-4" /> : preference === "dark" ? <Moon className="h-4 w-4" /> : <Monitor className="h-4 w-4" />}</span><span><strong>{preference[0].toUpperCase() + preference.slice(1)}</strong><small>{preference === "system" ? "Follow device" : `Always ${preference}`}</small></span>{themePreference === preference && <Check className="ml-auto h-4 w-4 text-primary" />}</button>)}
            </div>
          </section>

          <section className="settings-section" id="security" aria-labelledby="security-heading">
            <div className="settings-section-heading"><div><h2 id="security-heading">Security</h2><p>Rotate the password used by your browser and invalidate older sessions.</p></div><ShieldCheck className="h-5 w-5 text-muted-foreground" /></div>
            <form className="settings-form" onSubmit={submitPassword}>
              <div className="settings-field"><label htmlFor="current-password">Current password</label><Input id="current-password" type="password" autoComplete="current-password" required value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></div>
              <div className="settings-field"><label htmlFor="new-password">New password</label><Input id="new-password" type="password" autoComplete="new-password" minLength={12} required value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /><small>Use at least 12 characters.</small></div>
              <div className="settings-field"><label htmlFor="confirm-password">Confirm new password</label><Input id="confirm-password" type="password" autoComplete="new-password" minLength={12} required value={passwordConfirmation} onChange={(event) => setPasswordConfirmation(event.target.value)} /></div>
              <div className="settings-actions"><Button type="submit" disabled={passwordLoading}><KeyRound className="h-4 w-4" />{passwordLoading ? "Rotating…" : "Rotate password"}</Button>{passwordMessage && <span className={statusClass(passwordMessage)} role="status">{passwordMessage}</span>}</div>
            </form>
            <p className="settings-note">Forgot the current password? Use the server-side recovery procedure in the repository’s <code>SECURITY.md</code> or ask the server administrator to reset the account.</p>
          </section>

          <section className="settings-section" id="data" aria-labelledby="data-heading">
            <div className="settings-section-heading"><div><h2 id="data-heading">Data and connections</h2><p>Keep a portable backup and connect trusted coding or chat agents.</p></div><Download className="h-5 w-5 text-muted-foreground" /></div>
            <div className="settings-data-row"><div><strong>Export workspace</strong><p>Download notes, folders, groups, tags, and attachment metadata as JSON.</p></div><Button variant="outline" onClick={exportWorkspace} disabled={dataLoading}><Download className="h-4 w-4" />{dataLoading ? "Preparing…" : "Export"}</Button></div>
            <div className="settings-data-row"><div><strong>Remote MCP endpoint</strong><p>Add this URL to Codex, Cursor, or another MCP client. The client will open a browser sign-in and consent screen.</p><code className="settings-code">{mcpEndpoint}</code></div><Button variant="outline" onClick={copyMcpEndpoint}>{copied ? <Check className="h-4 w-4" /> : <Clipboard className="h-4 w-4" />}{copied ? "Copied" : "Copy URL"}</Button></div>
            <div className="settings-mcp-help"><strong>Browser-based connection</strong><p>Use the endpoint above with OAuth. Approve only the permissions you need. Notes uses PKCE, exact redirect URI checks, resource-bound access tokens, refresh-token rotation, and revocation.</p><p>For scripts or clients without OAuth, run <code>npm run mcp:token -- create --label coding-agent --scopes notes:read</code> on the server and store the one-time bearer token in the client’s secret manager. Add <code>notes:write</code> only for agents that need to change notes.</p></div>
            <div className="settings-connected-agents"><div className="settings-connected-heading"><div><strong>Connected agents</strong><p>Revoke an agent here to invalidate its OAuth client and all of its tokens.</p></div><UsersRound className="h-4 w-4 text-muted-foreground" /></div>{clientsLoading ? <p className="settings-empty-note">Loading connected agents…</p> : connectedClients.length === 0 ? <p className="settings-empty-note">No browser-connected agents yet.</p> : <div className="settings-client-list">{connectedClients.map((client) => <div className="settings-client" key={client.clientId}><div><strong>{client.clientName}</strong><p>{client.scopes?.join(", ") || "notes:read"} · connected {new Date(client.createdAt).toLocaleDateString()}</p></div><Button variant="outline" size="sm" onClick={() => revokeClient(client.clientId, client.clientName)}><Trash2 className="h-3.5 w-3.5" />Revoke</Button></div>)}</div>}</div>
            {dataMessage && <p className={statusClass(dataMessage)} role="status">{dataMessage}</p>}
          </section>

          <section className="settings-section settings-danger" aria-labelledby="session-heading">
            <div className="settings-section-heading"><div><h2 id="session-heading">Session</h2><p>Signing out removes this browser’s session cookie.</p></div><LogOut className="h-5 w-5 text-muted-foreground" /></div>
            <Button variant="outline" onClick={signOut}><LogOut className="h-4 w-4" />Sign out of this browser</Button>
          </section>
        </div>
      </div>
    </main>
  );
}

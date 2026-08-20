import { NotesApp } from "@/components/notes-app";
import { LoginScreen } from "@/components/login-screen";
import { authEnabled, isAuthenticated } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  if (authEnabled() && !(await isAuthenticated())) return <LoginScreen />;
  return <NotesApp />;
}

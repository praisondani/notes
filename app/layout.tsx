import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Notes — private notes",
  description: "A minimal, self-hostable private note workspace.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

const themeInitScript = `try {
  const stored = localStorage.getItem("notes-theme");
  const preference = stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
  const dark = preference === "dark" || (preference === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = preference;
  document.documentElement.classList.toggle("dark", dark);
} catch {}`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body><script dangerouslySetInnerHTML={{ __html: themeInitScript }} />{children}</body>
    </html>
  );
}

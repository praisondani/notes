import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cinder — private notes",
  description: "A minimal, self-hostable private note workspace.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

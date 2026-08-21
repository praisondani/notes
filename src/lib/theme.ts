export type ThemePreference = "light" | "dark" | "system";

export const THEME_STORAGE_KEY = "notes-theme";

export function normalizeThemePreference(value: string | null | undefined): ThemePreference {
  return value === "light" || value === "dark" || value === "system" ? value : "system";
}

export function readThemePreference(): ThemePreference {
  if (typeof document !== "undefined") {
    const documentPreference = document.documentElement.dataset.theme;
    if (documentPreference) return normalizeThemePreference(documentPreference);
  }
  if (typeof window === "undefined") return "system";
  try {
    return normalizeThemePreference(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return "system";
  }
}

export function resolveDarkTheme(preference: ThemePreference, systemDark = typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches): boolean {
  return preference === "dark" || (preference === "system" && systemDark);
}

export function applyTheme(preference: ThemePreference): boolean {
  if (typeof document === "undefined") return false;
  const dark = resolveDarkTheme(preference);
  document.documentElement.dataset.theme = preference;
  document.documentElement.classList.toggle("dark", dark);
  return dark;
}

export function persistThemePreference(preference: ThemePreference): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // The theme still applies when storage is unavailable.
  }
}

export function setThemePreference(preference: ThemePreference): boolean {
  persistThemePreference(preference);
  if (typeof document === "undefined") return false;
  document.documentElement.classList.add("theme-switching");
  const dark = applyTheme(preference);
  if (typeof window.requestAnimationFrame === "function") window.requestAnimationFrame(() => document.documentElement.classList.remove("theme-switching"));
  else document.documentElement.classList.remove("theme-switching");
  return dark;
}

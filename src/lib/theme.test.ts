import { describe, expect, it } from "vitest";
import { normalizeThemePreference, resolveDarkTheme } from "@/lib/theme";

describe("theme preferences", () => {
  it("normalizes unsupported values to system", () => {
    expect(normalizeThemePreference("dark")).toBe("dark");
    expect(normalizeThemePreference("light")).toBe("light");
    expect(normalizeThemePreference("solarized")).toBe("system");
    expect(normalizeThemePreference(null)).toBe("system");
  });

  it("resolves explicit and system themes", () => {
    expect(resolveDarkTheme("dark", false)).toBe(true);
    expect(resolveDarkTheme("light", true)).toBe(false);
    expect(resolveDarkTheme("system", true)).toBe(true);
    expect(resolveDarkTheme("system", false)).toBe(false);
  });
});

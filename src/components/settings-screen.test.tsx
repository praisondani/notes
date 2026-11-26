import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsScreen } from "@/components/settings-screen";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

describe("SettingsScreen keyboard access", () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => Promise.resolve({
      ok: true,
      json: async () => url === "/api/auth/session"
        ? { setupRequired: false, authenticated: true, user: { id: "owner", username: "owner", email: "owner@example.test" } }
        : { clients: [] },
    })));
  });

  it("moves theme selection with arrow keys and keeps one tab stop in the radio group", async () => {
    render(<SettingsScreen />);
    const group = await screen.findByRole("radiogroup", { name: "Theme preference" });
    const radios = within(group).getAllByRole("radio");
    const light = radios[0]!;
    const dark = radios[1]!;
    const system = radios[2]!;

    expect(system).toHaveAttribute("aria-checked", "true");
    expect(system).toHaveAttribute("tabindex", "0");
    fireEvent.keyDown(system, { key: "ArrowLeft" });

    expect(dark).toHaveFocus();
    expect(dark).toHaveAttribute("aria-checked", "true");
    expect(dark).toHaveAttribute("tabindex", "0");
    expect(light).toHaveAttribute("tabindex", "-1");

    const tabEvent = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    dark.dispatchEvent(tabEvent);
    expect(tabEvent.defaultPrevented).toBe(false);
  });
});

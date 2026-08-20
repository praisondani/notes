import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NotesApp } from "@/components/notes-app";
import { seedWorkspace } from "@/lib/seed";

function cloneSeed() {
  return JSON.parse(JSON.stringify(seedWorkspace));
}

describe("NotesApp keyboard parity", () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => cloneSeed() }));
    window.localStorage.clear();
  });

  it("creates a note with Ctrl+N", async () => {
    render(<NotesApp />);
    await screen.findByDisplayValue("A quieter place for your notes");
    fireEvent.keyDown(window, { key: "n", ctrlKey: true });
    expect(screen.getByDisplayValue("Untitled note")).toBeInTheDocument();
  });

  it("opens command palette with Ctrl+K", async () => {
    render(<NotesApp />);
    await screen.findByDisplayValue("A quieter place for your notes");
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Command palette")).toBeInTheDocument();
  });

  it("focuses search with Ctrl+Shift+F", async () => {
    render(<NotesApp />);
    const search = await screen.findByPlaceholderText("Search notes");
    fireEvent.keyDown(window, { key: "f", ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(search).toHaveFocus());
  });

  it("opens shortcuts with question mark", async () => {
    render(<NotesApp />);
    await screen.findByDisplayValue("A quieter place for your notes");
    fireEvent.keyDown(window, { key: "?" });
    expect(await screen.findByText("Keyboard shortcuts")).toBeInTheDocument();
  });

  it("moves to the next note with ArrowDown", async () => {
    render(<NotesApp />);
    const firstNote = await screen.findByRole("option", { name: /A quieter place for your notes/ });
    fireEvent.keyDown(firstNote, { key: "ArrowDown" });
    expect(await screen.findByDisplayValue("Weekly review")).toBeInTheDocument();
  });
});

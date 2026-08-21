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

  it("removes an untouched draft and derives its title when leaving it", async () => {
    render(<NotesApp />);
    await screen.findByDisplayValue("A quieter place for your notes");
    fireEvent.keyDown(window, { key: "n", ctrlKey: true });
    const editor = screen.getByLabelText("Note content");
    fireEvent.change(editor, { target: { value: "A useful thought. A second thought." } });
    fireEvent.click(screen.getByRole("option", { name: /A quieter place for your notes/ }));
    await waitFor(() => expect(screen.getByRole("option", { name: /A useful thought/ })).toBeInTheDocument());

    fireEvent.keyDown(window, { key: "n", ctrlKey: true });
    expect(screen.getByDisplayValue("Untitled note")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: /Weekly review/ }));
    await waitFor(() => expect(screen.queryByDisplayValue("Untitled note")).not.toBeInTheDocument());
  });

  it("supports keyboard checklist reordering", async () => {
    render(<NotesApp />);
    await screen.findByDisplayValue("A quieter place for your notes");
    const moveDown = screen.getByRole("button", { name: /Move Press ⌘ K for the command palette down/ });
    fireEvent.click(moveDown);
    const items = screen.getAllByLabelText("Checklist item text") as HTMLInputElement[];
    expect(items.map((item) => item.value)).toEqual(["Drag this note into another folder", "Press ⌘ K for the command palette"]);
  });

  it("renders navigation lists without React key warnings", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      render(<NotesApp />);
      await screen.findByDisplayValue("A quieter place for your notes");
      expect(consoleError.mock.calls.flat().some(([message]) => String(message).includes("Each child in a list should have a unique"))).toBe(false);
    } finally {
      consoleError.mockRestore();
    }
  });

  it("shows the login screen without rendering workspace content when authentication is required", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401 }));
    render(<NotesApp />);
    expect(await screen.findByText("Private workspace")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("A quieter place for your notes")).not.toBeInTheDocument();
  });
});

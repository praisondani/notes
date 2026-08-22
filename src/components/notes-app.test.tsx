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

  it("renames a folder from its sidebar title and center-column title", async () => {
    render(<NotesApp />);
    const folder = await screen.findByRole("button", { name: /Projects, folder/ });
    fireEvent.doubleClick(folder);
    const renameInput = await screen.findByRole("textbox", { name: "Rename folder" });
    fireEvent.change(renameInput, { target: { value: "Client work" } });
    fireEvent.blur(renameInput);
    expect(screen.getByRole("button", { name: /Client work, folder/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Client work, folder/ }));
    const listTitle = document.querySelector<HTMLButtonElement>(".list-title-button");
    expect(listTitle).toBeInTheDocument();
    fireEvent.doubleClick(listTitle!);
    const centerRenameInput = await screen.findByRole("textbox", { name: "Rename folder" });
    fireEvent.change(centerRenameInput, { target: { value: "Client projects" } });
    fireEvent.blur(centerRenameInput);
    expect(screen.getAllByRole("button", { name: /Client projects, folder/ })).toHaveLength(2);
  });

  it("deletes a folder and detaches its notes after confirmation", async () => {
    render(<NotesApp />);
    await screen.findByDisplayValue("A quieter place for your notes");
    fireEvent.click(screen.getByRole("button", { name: "Delete folder Projects" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete folder" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: /Projects, folder/ })).not.toBeInTheDocument());
    expect(screen.getByDisplayValue("A quieter place for your notes")).toBeInTheDocument();
  });

  it("supports collapsed sidebar and collection label editing", async () => {
    render(<NotesApp />);
    await screen.findByDisplayValue("A quieter place for your notes");
    const appShell = document.querySelector<HTMLElement>(".app-shell");
    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    expect(appShell).toHaveAttribute("data-sidebar-collapsed", "true");
    fireEvent.keyDown(window, { key: "b", ctrlKey: true, shiftKey: true });
    expect(appShell).toHaveAttribute("data-sidebar-collapsed", "false");

    fireEvent.click(screen.getAllByRole("button", { name: "Edit folder label" })[0]);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Blue label" }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(screen.getByRole("button", { name: /Projects, folder/ }).querySelector("svg")).toHaveClass("blue");
  });

  it("uses the entire editor column as one scroll surface", async () => {
    render(<NotesApp />);
    await screen.findByDisplayValue("A quieter place for your notes");
    const editor = document.querySelector<HTMLElement>(".editor");
    expect(editor).toBeInTheDocument();
    expect(editor?.querySelector(".editor-scroll")).not.toBeInTheDocument();
    expect(editor?.querySelector(":scope > .editor-header")).toBeInTheDocument();
    expect(editor?.querySelector(":scope > .editor-content")).toBeInTheDocument();
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

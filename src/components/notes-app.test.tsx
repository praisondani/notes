import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
    expect(renameInput).toHaveClass("collection-rename-input");
    expect(screen.queryByRole("button", { name: "Save folder name" })).not.toBeInTheDocument();
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

  it("creates a new note inside the active folder from the list header", async () => {
    render(<NotesApp />);
    await screen.findByDisplayValue("A quieter place for your notes");
    fireEvent.click(screen.getByRole("button", { name: /Projects, folder/ }));
    fireEvent.click(screen.getByRole("button", { name: "Create note in Projects" }));
    expect(await screen.findByDisplayValue("Untitled note")).toBeInTheDocument();
    expect(screen.getByLabelText("Move note to folder")).toHaveValue("folder-projects");
    expect(screen.getByLabelText("Assign note to group")).toHaveValue("group-work");
  });

  it("keeps collection counts in the sidebar instead of the middle-column title", async () => {
    render(<NotesApp />);
    await screen.findByDisplayValue("A quieter place for your notes");
    const allNotesNavItem = within(document.querySelector(".nav-list") as HTMLElement).getByRole("button", { name: /All notes/ });
    expect(allNotesNavItem.querySelector(".count")).toHaveTextContent("3");
    expect(document.querySelector(".list-title-count")).not.toBeInTheDocument();
    expect(document.querySelector(".list-title-row")?.textContent).toBe("All notes");
  });

  it("keeps folder names available without a persistent edit action", async () => {
    render(<NotesApp />);
    await screen.findByDisplayValue("A quieter place for your notes");
    const folderLabels = document.querySelectorAll(".collection-nav-item .collection-name");
    expect(folderLabels.length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Edit folder label" })).not.toBeInTheDocument();
  });

  it("renders groups as hubs with nested folders and direct notes", async () => {
    render(<NotesApp />);
    await screen.findByDisplayValue("A quieter place for your notes");

    expect(screen.getByRole("button", { name: /Projects, folder/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Work, group/ }));
    expect(screen.getByRole("button", { name: /Projects, folder/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Weekly review/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Create note in Work" }));
    expect(screen.getByLabelText("Move note to folder")).toHaveValue("inbox");
    expect(screen.getByLabelText("Assign note to group")).toHaveValue("group-work");
  });

  it("creates a folder inside the selected group hub", async () => {
    render(<NotesApp />);
    await screen.findByDisplayValue("A quieter place for your notes");
    fireEvent.click(screen.getByRole("button", { name: "Add folder to group Work" }));
    const input = screen.getByRole("textbox", { name: "New folder name" });
    expect(screen.queryByRole("combobox", { name: "Folder label" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create folder" })).not.toBeInTheDocument();
    fireEvent.change(input, { target: { value: "Client work" } });
    fireEvent.keyDown(input, { key: "Enter" });
    const createdFolder = await screen.findByRole("button", { name: /Client work, folder/ });
    expect(createdFolder).toBeInTheDocument();
    expect(within(createdFolder.closest(".collection-nav-row") as HTMLElement).getByRole("button", { name: "Choose folder color for Client work" }).querySelector("svg")).toHaveClass("blue");
  });

  it("creates, collapses, and navigates nested folders with breadcrumbs", async () => {
    render(<NotesApp />);
    await screen.findByDisplayValue("A quieter place for your notes");

    fireEvent.click(screen.getByRole("button", { name: "Add subfolder to Projects" }));
    const input = screen.getByRole("textbox", { name: "New subfolder name" });
    fireEvent.change(input, { target: { value: "Client work" } });
    fireEvent.keyDown(input, { key: "Enter" });

    const child = await screen.findByRole("button", { name: /Client work, folder/ });
    expect(child.closest(".folder-tree-node")?.parentElement).toHaveClass("folder-tree-node");
    expect(screen.getByRole("button", { name: "Collapse folder Projects" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Collapse folder Projects" }));
    expect(screen.queryByRole("button", { name: /Client work, folder/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Expand folder Projects" }));
    const expandedChild = screen.getByRole("button", { name: /Client work, folder/ });
    expect(expandedChild).toBeInTheDocument();

    fireEvent.click(expandedChild);
    const breadcrumbs = screen.getByRole("navigation", { name: "Folder breadcrumbs" });
    expect(breadcrumbs).toHaveTextContent("All notes");
    expect(breadcrumbs).toHaveTextContent("Work");
    expect(breadcrumbs).toHaveTextContent("Projects");
    expect(breadcrumbs).toHaveTextContent("Client work");
  });

  it("creates a group from its name field when focus leaves it", async () => {
    render(<NotesApp />);
    await screen.findByDisplayValue("A quieter place for your notes");
    fireEvent.click(screen.getByRole("button", { name: "Add group" }));
    const input = screen.getByRole("textbox", { name: "New group name" });
    expect(screen.queryByRole("combobox", { name: "Group label" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create group" })).not.toBeInTheDocument();
    fireEvent.change(input, { target: { value: "Ideas" } });
    fireEvent.blur(input);
    expect(await screen.findByRole("button", { name: /Ideas, group/ })).toBeInTheDocument();
  });

  it("deletes a folder and detaches its notes after confirmation", async () => {
    render(<NotesApp />);
    await screen.findByDisplayValue("A quieter place for your notes");
    fireEvent.click(screen.getByRole("button", { name: /Projects, folder/ }));
    fireEvent.click(screen.getByRole("button", { name: "Delete folder Projects" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete folder" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: /Projects, folder/ })).not.toBeInTheDocument());
    expect(screen.getByDisplayValue("A quieter place for your notes")).toBeInTheDocument();
  });

  it("offers collection actions from the mobile overflow menu", async () => {
    render(<NotesApp />);
    await screen.findByDisplayValue("A quieter place for your notes");
    fireEvent.click(screen.getByRole("button", { name: /Projects, folder/ }));
    const overflow = screen.getByRole("button", { name: "More actions for Projects" });
    fireEvent.keyDown(overflow, { key: "Enter" });
    expect(await screen.findByRole("menuitem", { name: "Delete folder Projects" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Rename folder Projects" })).toBeInTheDocument();
  });

  it("supports collapsed sidebar and shape color selection", async () => {
    render(<NotesApp />);
    await screen.findByDisplayValue("A quieter place for your notes");
    const appShell = document.querySelector<HTMLElement>(".app-shell");
    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    expect(appShell).toHaveAttribute("data-sidebar-collapsed", "true");
    fireEvent.keyDown(window, { key: "b", ctrlKey: true, shiftKey: true });
    expect(appShell).toHaveAttribute("data-sidebar-collapsed", "false");

    const projectsRow = screen.getByRole("button", { name: /Projects, folder/ }).closest(".folder-tree-node");
    expect(projectsRow).toBeInTheDocument();
    expect(projectsRow?.querySelectorAll(".collection-color-trigger")).toHaveLength(1);
    expect(projectsRow?.querySelectorAll(".collection-nav-item")).toHaveLength(1);
    const colorTrigger = within(projectsRow as HTMLElement).getByRole("button", { name: "Choose folder color for Projects" });
    fireEvent.keyDown(colorTrigger, { key: "Enter" });
    expect(await screen.findAllByRole("menuitem")).toHaveLength(9);
    fireEvent.click(screen.getByRole("menuitem", { name: "Blue color" }));
    expect(colorTrigger.querySelector("svg")).toHaveClass("blue");
  });

  it("uses the entire editor column as one scroll surface", async () => {
    render(<NotesApp />);
    await screen.findByDisplayValue("A quieter place for your notes");
    const editor = document.querySelector<HTMLElement>(".editor");
    const contentEditor = screen.getByLabelText("Note content");
    expect(editor).toBeInTheDocument();
    expect(editor?.querySelector(".editor-scroll")).not.toBeInTheDocument();
    expect(editor?.querySelector(":scope > .editor-header")).toBeInTheDocument();
    expect(editor?.querySelector(":scope > .editor-content")).toBeInTheDocument();
    expect(contentEditor).toHaveStyle({ overflowY: "hidden" });
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

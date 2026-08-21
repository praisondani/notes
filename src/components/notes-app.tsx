"use client";
/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  Check,
  Command as CommandIcon,
  File,
  FilePlus2,
  FolderPlus,
  Inbox,
  Keyboard,
  Layers3,
  Link2,
  ListChecks,
  Menu,
  Moon,
  Paperclip,
  Pin,
  PinOff,
  Plus,
  Search,
  Sun,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { createId, createNote, filterNotes, getNotePreview, moveNote, reorderNotes, toggleArchived, toggleChecklist, togglePinned, updateNote } from "@/lib/notes";
import { seedWorkspace } from "@/lib/seed";
import type { Attachment, Folder as NoteFolder, Group, Note, NoteFilter, NoteQuery, Workspace } from "@/lib/types";
import { cn, formatBytes, formatDate } from "@/lib/utils";

type MobilePane = "sidebar" | "list" | "editor";
type SaveState = "saved" | "saving" | "error";

const filterOptions: Array<{ id: NoteFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "pinned", label: "Pinned" },
  { id: "links", label: "Links" },
  { id: "files", label: "Files" },
];

function noteCount(notes: Note[], filter: NoteFilter): number {
  return filterNotes(notes, { search: "", filter, folderId: null, groupId: null }).length;
}

function colorClass(color: string): string {
  return color === "amber" ? "amber" : color === "slate" ? "slate" : "green";
}

function isEditableTarget(target: EventTarget | null): boolean {
  const element = target instanceof HTMLElement ? target : null;
  return element?.isContentEditable || element?.matches("input, textarea, select") || false;
}

export function NotesApp() {
  const [workspace, setWorkspace] = useState<Workspace>(seedWorkspace);
  const [selectedNoteId, setSelectedNoteId] = useState(seedWorkspace.notes[0]?.id ?? null);
  const [query, setQuery] = useState<NoteQuery>({ search: "", filter: "all", folderId: null, groupId: null });
  const [mobilePane, setMobilePane] = useState<MobilePane>("list");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [shortcutsDialogOpen, setShortcutsDialogOpen] = useState(false);
  const [linkName, setLinkName] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [newFolderName, setNewFolderName] = useState("");
  const [newGroupName, setNewGroupName] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [darkMode, setDarkMode] = useState(() => typeof window !== "undefined" && window.localStorage.getItem("notes-theme") === "dark");
  const [hydrated, setHydrated] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selectedNote = workspace.notes.find((note) => note.id === selectedNoteId) ?? null;
  const filteredNotes = useMemo(() => filterNotes(workspace.notes, query), [workspace.notes, query]);
  const selectedFolder = workspace.folders.find((folder) => folder.id === selectedNote?.folderId);
  const selectedGroup = workspace.groups.find((group) => group.id === selectedNote?.groupId);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode);
  }, [darkMode]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/workspace")
      .then(async (response) => {
        if (!response.ok) throw new Error("Workspace could not be loaded");
        return response.json() as Promise<Workspace>;
      })
      .then((remote) => {
        if (cancelled) return;
        setWorkspace(remote);
        setSelectedNoteId((current) => remote.notes.some((note) => note.id === current) ? current : remote.notes[0]?.id ?? null);
        setHydrated(true);
      })
      .catch(() => {
        if (!cancelled) {
          setHydrated(true);
          setSaveState("error");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const timeout = window.setTimeout(() => {
      void persistWorkspace(workspace);
    }, 350);
    return () => window.clearTimeout(timeout);
  }, [workspace, hydrated]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const modifier = event.metaKey || event.ctrlKey;
      if (modifier && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen(true);
        return;
      }
      if (modifier && event.key.toLowerCase() === "n") {
        event.preventDefault();
        createNewNote();
        return;
      }
      if (modifier && event.shiftKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (modifier && event.shiftKey && event.key.toLowerCase() === "p") {
        event.preventDefault();
        if (selectedNoteId) setWorkspace((current) => ({ ...current, notes: togglePinned(current.notes, selectedNoteId) }));
        return;
      }
      if (modifier && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void persistWorkspace(workspace);
        return;
      }
      if (event.key === "?" && !isEditableTarget(event.target)) {
        event.preventDefault();
        setShortcutsDialogOpen(true);
        return;
      }
      if (event.key === "Escape") {
        if (paletteOpen) setPaletteOpen(false);
        if (linkDialogOpen) setLinkDialogOpen(false);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  async function persistWorkspace(nextWorkspace: Workspace) {
    setSaveState("saving");
    try {
      const response = await fetch("/api/workspace", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(nextWorkspace) });
      if (!response.ok) throw new Error("Workspace could not be saved");
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  }

  function setTheme(nextDark: boolean) {
    setDarkMode(nextDark);
    document.documentElement.classList.toggle("dark", nextDark);
    window.localStorage.setItem("notes-theme", nextDark ? "dark" : "light");
  }

  function createNewNote() {
    const note = createNote(new Date());
    setWorkspace((current) => ({ ...current, notes: [{ ...note, position: 0 }, ...current.notes.map((item, index) => ({ ...item, position: index + 1 }))] }));
    setSelectedNoteId(note.id);
    setQuery({ search: "", filter: "all", folderId: null, groupId: null });
    setMobilePane("editor");
    window.setTimeout(() => titleRef.current?.focus(), 0);
  }

  function updateSelectedNote(patch: Partial<Note>) {
    if (!selectedNoteId) return;
    setWorkspace((current) => ({ ...current, notes: updateNote(current.notes, selectedNoteId, patch) }));
  }

  function selectNote(noteId: string) {
    setSelectedNoteId(noteId);
    setMobilePane("editor");
  }

  function moveSelected(folderId: string | null) {
    if (!selectedNoteId) return;
    setWorkspace((current) => ({ ...current, notes: moveNote(current.notes, selectedNoteId, folderId) }));
  }

  function moveSelectedToGroup(groupId: string | null) {
    if (!selectedNoteId) return;
    updateSelectedNote({ groupId });
  }

  function deleteSelectedNote() {
    if (!selectedNoteId) return;
    const index = workspace.notes.findIndex((note) => note.id === selectedNoteId);
    const remaining = workspace.notes.filter((note) => note.id !== selectedNoteId);
    setWorkspace((current) => ({ ...current, notes: remaining }));
    setSelectedNoteId(remaining[index]?.id ?? remaining[index - 1]?.id ?? null);
  }

  function createFolder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = newFolderName.trim();
    if (!name) return;
    const folder: NoteFolder = { id: createId("folder"), name, parentId: null, color: "green", position: workspace.folders.length };
    setWorkspace((current) => ({ ...current, folders: [...current.folders, folder] }));
    setNewFolderName("");
    setCreatingFolder(false);
  }

  function createGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = newGroupName.trim();
    if (!name) return;
    const group: Group = { id: createId("group"), name, color: workspace.groups.length % 2 ? "amber" : "green", position: workspace.groups.length };
    setWorkspace((current) => ({ ...current, groups: [...current.groups, group] }));
    setNewGroupName("");
    setCreatingGroup(false);
  }

  function handleFolderDrop(event: React.DragEvent<HTMLButtonElement>, folderId: string | null) {
    event.preventDefault();
    const noteId = event.dataTransfer.getData("text/plain") || draggingId;
    if (!noteId) return;
    setWorkspace((current) => ({ ...current, notes: moveNote(current.notes, noteId, folderId) }));
    setDraggingId(null);
  }

  function handleNoteDrop(event: React.DragEvent<HTMLButtonElement>, targetId: string) {
    event.preventDefault();
    const sourceId = event.dataTransfer.getData("text/plain") || draggingId;
    if (!sourceId) return;
    setWorkspace((current) => ({ ...current, notes: reorderNotes(current.notes, sourceId, targetId) }));
    setDraggingId(null);
  }

  function navigateNotes(offset: number) {
    if (!filteredNotes.length) return;
    const currentIndex = Math.max(0, filteredNotes.findIndex((note) => note.id === selectedNoteId));
    const next = filteredNotes[(currentIndex + offset + filteredNotes.length) % filteredNotes.length];
    selectNote(next.id);
    window.setTimeout(() => document.querySelector<HTMLButtonElement>(`[data-note-id="${next.id}"]`)?.focus(), 0);
  }

  function handleNoteKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      navigateNotes(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      navigateNotes(-1);
    } else if (event.key === "Home") {
      event.preventDefault();
      if (filteredNotes[0]) selectNote(filteredNotes[0].id);
    } else if (event.key === "End") {
      event.preventDefault();
      if (filteredNotes.at(-1)) selectNote(filteredNotes.at(-1)!.id);
    }
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !selectedNoteId) return;
    const formData = new FormData();
    formData.append("file", file);
    try {
      const response = await fetch("/api/attachments", { method: "POST", body: formData });
      if (!response.ok) throw new Error("File upload failed");
      const stored = await response.json() as { key: string; url: string; mimeType: string; size: number };
      const attachment: Attachment = { id: createId("attachment"), kind: file.type.startsWith("image/") ? "image" : "file", name: file.name, url: stored.url, mimeType: stored.mimeType, size: stored.size, objectKey: stored.key };
      updateSelectedNote({ attachments: [...(selectedNote?.attachments ?? []), attachment] });
    } catch {
      setSaveState("error");
    }
  }

  function addLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedNoteId || !linkUrl.trim()) return;
    const attachment: Attachment = { id: createId("attachment"), kind: "link", name: linkName.trim() || linkUrl.trim(), url: linkUrl.trim() };
    updateSelectedNote({ attachments: [...(selectedNote?.attachments ?? []), attachment] });
    setLinkDialogOpen(false);
    setLinkName("");
    setLinkUrl("");
  }

  function addChecklistItem() {
    if (!selectedNote) return;
    updateSelectedNote({ checklist: [...selectedNote.checklist, { id: createId("item"), text: "", completed: false }] });
  }

  function removeTag(tag: string) {
    if (!selectedNote) return;
    updateSelectedNote({ tags: selectedNote.tags.filter((item) => item !== tag) });
  }

  const [tagValue, setTagValue] = useState("");

  function runPaletteCommand(command: string) {
    setPaletteOpen(false);
    setPaletteQuery("");
    if (command === "new") createNewNote();
    if (command === "search") window.setTimeout(() => searchRef.current?.focus(), 0);
    if (command === "pin" && selectedNoteId) setWorkspace((current) => ({ ...current, notes: togglePinned(current.notes, selectedNoteId) }));
    if (command === "archive" && selectedNoteId) setWorkspace((current) => ({ ...current, notes: toggleArchived(current.notes, selectedNoteId) }));
    if (command === "shortcuts") setShortcutsDialogOpen(true);
  }

  const commands = [
    { id: "new", label: "New note", description: "Start with a blank note", shortcut: "⌘ N", icon: FilePlus2 },
    { id: "search", label: "Search notes", description: "Jump to the note search field", shortcut: "⌘ ⇧ F", icon: Search },
    { id: "pin", label: selectedNote?.pinned ? "Unpin note" : "Pin note", description: "Keep the current note near the top", shortcut: "⌘ ⇧ P", icon: Pin },
    { id: "archive", label: selectedNote?.archived ? "Restore note" : "Archive note", description: "Move the current note out of the active list", shortcut: "", icon: Archive },
    { id: "shortcuts", label: "Keyboard shortcuts", description: "See every keyboard action", shortcut: "?", icon: Keyboard },
  ].filter((command) => `${command.label} ${command.description}`.toLowerCase().includes(paletteQuery.toLowerCase()));

  function sidebarButton(label: string, icon: React.ReactNode, active: boolean, onClick: () => void, count?: number, onDrop?: (event: React.DragEvent<HTMLButtonElement>) => void, itemKey?: string) {
    return <button key={itemKey} type="button" className="nav-item" data-active={active} onClick={onClick} onDragOver={(event) => event.preventDefault()} onDrop={onDrop} aria-current={active ? "page" : undefined}>{icon}<span>{label}</span>{typeof count === "number" && <span className="count">{count}</span>}</button>;
  }

  return (
    <TooltipProvider delayDuration={500}>
      <div className="app-shell">
        <header className="topbar">
          <div className="brand-lockup">
            <Button variant="ghost" size="icon-sm" className="mobile-only" aria-label="Open navigation" onClick={() => setMobilePane("sidebar")}><Menu className="h-4 w-4" /></Button>
            <span className="brand-mark" aria-hidden="true"><Layers3 className="h-4 w-4" /></span>
            <span>Notes</span>
          </div>
          <div className="topbar-actions">
            <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon-sm" aria-label="Keyboard shortcuts" onClick={() => setShortcutsDialogOpen(true)}><Keyboard className="h-4 w-4" /></Button></TooltipTrigger><TooltipContent>Keyboard shortcuts</TooltipContent></Tooltip>
            <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={darkMode ? "Use light theme" : "Use dark theme"} onClick={() => setTheme(!darkMode)}>{darkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}</Button></TooltipTrigger><TooltipContent>{darkMode ? "Use light theme" : "Use dark theme"}</TooltipContent></Tooltip>
            <Button variant="outline" size="sm" aria-label="New note" onClick={createNewNote}><Plus className="h-4 w-4" /><span className="desktop-label">New note</span></Button>
          </div>
        </header>

        <main className="workspace" data-mobile-pane={mobilePane}>
          <aside className="sidebar" aria-label="Workspace navigation">
            <ScrollArea className="sidebar-scroll">
              <div className="sidebar-section">
                <div className="section-label"><span>Library</span></div>
                <nav className="nav-list" aria-label="Library">
                  {sidebarButton("All notes", <FileTextIcon />, query.filter === "all" && !query.folderId && !query.groupId, () => { setQuery({ search: "", filter: "all", folderId: null, groupId: null }); setMobilePane("list"); }, noteCount(workspace.notes, "all"), (event) => handleFolderDrop(event, null))}
                  {sidebarButton("Inbox", <Inbox className="h-4 w-4" />, query.filter === "inbox", () => { setQuery({ search: "", filter: "inbox", folderId: null, groupId: null }); setMobilePane("list"); }, noteCount(workspace.notes, "inbox"), (event) => handleFolderDrop(event, null))}
                  {sidebarButton("Pinned", <Pin className="h-4 w-4" />, query.filter === "pinned", () => { setQuery({ search: "", filter: "pinned", folderId: null, groupId: null }); setMobilePane("list"); }, noteCount(workspace.notes, "pinned"))}
                  {sidebarButton("Archive", <Archive className="h-4 w-4" />, query.filter === "archived", () => { setQuery({ search: "", filter: "archived", folderId: null, groupId: null }); setMobilePane("list"); }, noteCount(workspace.notes, "archived"))}
                </nav>
              </div>

              <div className="sidebar-section">
                <div className="section-label"><span>Folders</span><button type="button" aria-label="Add folder" onClick={() => setCreatingFolder(true)}><FolderPlus className="h-3.5 w-3.5" /></button></div>
                <div className="folder-list">
                  {workspace.folders.map((folder) => sidebarButton(folder.name, <span className={cn("folder-dot", colorClass(folder.color))} />, query.folderId === folder.id, () => { setQuery({ search: "", filter: "all", folderId: folder.id, groupId: null }); setMobilePane("list"); }, workspace.notes.filter((note) => note.folderId === folder.id && !note.archived).length, (event) => handleFolderDrop(event, folder.id), folder.id))}
                </div>
                {creatingFolder && <form className="inline-create" onSubmit={createFolder}><Input autoFocus value={newFolderName} onChange={(event) => setNewFolderName(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") setCreatingFolder(false); }} placeholder="Folder name" aria-label="New folder name" /><Button type="submit" size="icon-sm" aria-label="Create folder"><Check className="h-4 w-4" /></Button></form>}
              </div>

              <div className="sidebar-section">
                <div className="section-label"><span>Groups</span><button type="button" aria-label="Add group" onClick={() => setCreatingGroup(true)}><Plus className="h-3.5 w-3.5" /></button></div>
                <div className="group-list">
                  {workspace.groups.map((group) => sidebarButton(group.name, <span className={cn("group-dot", colorClass(group.color))} />, query.groupId === group.id, () => { setQuery({ search: "", filter: "all", folderId: null, groupId: group.id }); setMobilePane("list"); }, workspace.notes.filter((note) => note.groupId === group.id && !note.archived).length, undefined, group.id))}
                </div>
                {creatingGroup && <form className="inline-create" onSubmit={createGroup}><Input autoFocus value={newGroupName} onChange={(event) => setNewGroupName(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") setCreatingGroup(false); }} placeholder="Group name" aria-label="New group name" /><Button type="submit" size="icon-sm" aria-label="Create group"><Check className="h-4 w-4" /></Button></form>}
              </div>

              <div className="sidebar-section">
                <div className="section-label"><span>Filters</span></div>
                <div className="filter-list">
                  {sidebarButton("With links", <Link2 className="h-4 w-4" />, query.filter === "links", () => { setQuery({ search: "", filter: "links", folderId: null, groupId: null }); setMobilePane("list"); }, noteCount(workspace.notes, "links"))}
                  {sidebarButton("With files", <Paperclip className="h-4 w-4" />, query.filter === "files", () => { setQuery({ search: "", filter: "files", folderId: null, groupId: null }); setMobilePane("list"); }, noteCount(workspace.notes, "files"))}
                </div>
              </div>
            </ScrollArea>
          </aside>

          <section className="note-list" aria-label="Notes">
            <div className="note-list-header">
              <div className="list-title-row"><h1>{query.folderId ? workspace.folders.find((folder) => folder.id === query.folderId)?.name : query.groupId ? workspace.groups.find((group) => group.id === query.groupId)?.name : query.filter === "inbox" ? "Inbox" : query.filter === "pinned" ? "Pinned" : query.filter === "archived" ? "Archive" : "All notes"}</h1><span>{filteredNotes.length}</span></div>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input ref={searchRef} value={query.search} onChange={(event) => setQuery((current) => ({ ...current, search: event.target.value }))} placeholder="Search notes" aria-label="Search notes" className="h-9 pl-9 pr-14" />
                {!query.search && <span className="shortcut-hint absolute right-2 top-1.5"><kbd>⌘</kbd><kbd>K</kbd></span>}
              </div>
              <div className="list-filter-row" aria-label="Quick filters">
                {filterOptions.map((option) => <button type="button" key={option.id} className="filter-chip" data-active={query.filter === option.id} onClick={() => setQuery((current) => ({ ...current, filter: option.id, folderId: null, groupId: null }))}>{option.label}</button>)}
              </div>
            </div>
            <ScrollArea className="note-scroll">
              <div className="note-list-items" role="listbox" aria-label="Note list" aria-activedescendant={selectedNoteId ?? undefined}>
                {loading && <div className="empty-state"><div><strong>Loading notes</strong><p>Opening your local workspace.</p></div></div>}
                {!loading && !filteredNotes.length && <div className="empty-state"><div><strong>No notes found</strong><p>Try another search or create a new note.</p><Button className="mt-4" size="sm" onClick={createNewNote}><Plus className="h-4 w-4" />New note</Button></div></div>}
                {filteredNotes.map((note) => <button key={note.id} id={note.id} data-note-id={note.id} type="button" role="option" aria-selected={selectedNoteId === note.id} className="note-row" data-selected={selectedNoteId === note.id} data-dragging={draggingId === note.id} draggable onDragStart={(event) => { event.dataTransfer.setData("text/plain", note.id); setDraggingId(note.id); }} onDragEnd={() => setDraggingId(null)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => handleNoteDrop(event, note.id)} onClick={() => selectNote(note.id)} onKeyDown={handleNoteKeyDown}>
                  <span className="note-row-title"><span>{note.title || "Untitled note"}</span>{note.pinned && <Pin className="h-3 w-3 shrink-0 text-primary" aria-label="Pinned" />}</span>
                  <span className="note-row-preview">{getNotePreview(note)}</span>
                  <span className="note-meta"><span>{formatDate(note.updatedAt)}</span>{note.attachments.length > 0 && <><span aria-hidden="true">·</span><Paperclip className="h-3 w-3" /></>}<span className="note-meta-end">{note.tags[0] ? `#${note.tags[0]}` : ""}</span></span>
                </button>)}
              </div>
            </ScrollArea>
          </section>

          <section className="editor" aria-label="Note editor">
            <div className="editor-header">
              <div className="editor-meta"><Button variant="ghost" size="icon-sm" className="mobile-only" aria-label="Back to notes" onClick={() => setMobilePane("list")}><ArrowLeft className="h-4 w-4" /></Button><span className="breadcrumb">{selectedFolder?.name ?? "Inbox"}{selectedGroup ? ` / ${selectedGroup.name}` : ""}</span>{saveState === "saving" && <span>Saving…</span>}{saveState === "saved" && <span>Saved</span>}{saveState === "error" && <span className="text-destructive">Save error</span>}</div>
              <div className="toolbar-actions">
                {selectedNote && <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={selectedNote.pinned ? "Unpin note" : "Pin note"} onClick={() => setWorkspace((current) => ({ ...current, notes: togglePinned(current.notes, selectedNote.id) }))}>{selectedNote.pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}</Button></TooltipTrigger><TooltipContent>{selectedNote.pinned ? "Unpin note" : "Pin note"}</TooltipContent></Tooltip>}
                {selectedNote && <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={selectedNote.archived ? "Restore note" : "Archive note"} onClick={() => setWorkspace((current) => ({ ...current, notes: toggleArchived(current.notes, selectedNote.id) }))}>{selectedNote.archived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}</Button></TooltipTrigger><TooltipContent>{selectedNote.archived ? "Restore note" : "Archive note"}</TooltipContent></Tooltip>}
                {selectedNote && <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon-sm" aria-label="Delete note" onClick={deleteSelectedNote}><Trash2 className="h-4 w-4" /></Button></TooltipTrigger><TooltipContent>Delete note</TooltipContent></Tooltip>}
                <Button variant="ghost" size="icon-sm" aria-label="Open command palette" onClick={() => setPaletteOpen(true)}><CommandIcon className="h-4 w-4" /></Button>
              </div>
            </div>
            <ScrollArea className="editor-scroll">
              {selectedNote ? <div className="editor-content">
                <Input ref={titleRef} value={selectedNote.title} onChange={(event) => updateSelectedNote({ title: event.target.value })} className="title-input" placeholder="Untitled note" aria-label="Note title" />
                <div className="editor-subline">
                  <span>Updated {formatDate(selectedNote.updatedAt)}</span><span aria-hidden="true">·</span>
                  <select className="folder-select" aria-label="Move note to folder" value={selectedNote.folderId ?? "inbox"} onChange={(event) => moveSelected(event.target.value === "inbox" ? null : event.target.value)}><option value="inbox">Inbox</option>{workspace.folders.map((folder) => <option value={folder.id} key={folder.id}>{folder.name}</option>)}</select>
                  <select className="folder-select" aria-label="Assign note to group" value={selectedNote.groupId ?? "none"} onChange={(event) => moveSelectedToGroup(event.target.value === "none" ? null : event.target.value)}><option value="none">No group</option>{workspace.groups.map((group) => <option value={group.id} key={group.id}>{group.name}</option>)}</select>
                </div>
                <Textarea value={selectedNote.content} onChange={(event) => updateSelectedNote({ content: event.target.value })} placeholder="Start writing…" aria-label="Note content" className="content-editor" />

                <section className="editor-section" aria-labelledby="checklist-heading">
                  <div className="editor-section-heading"><span id="checklist-heading"><ListChecks className="mr-1 inline h-3.5 w-3.5" />Checklist</span><Button variant="ghost" size="sm" onClick={addChecklistItem}><Plus className="h-3.5 w-3.5" />Add item</Button></div>
                  {selectedNote.checklist.length > 0 && <div className="checklist">{selectedNote.checklist.map((item) => <label className="checklist-row" data-completed={item.completed} key={item.id}><input type="checkbox" checked={item.completed} onChange={() => setWorkspace((current) => ({ ...current, notes: toggleChecklist(current.notes, selectedNote.id, item.id) }))} aria-label={`Mark ${item.text || "checklist item"} complete`} /><input type="text" value={item.text} placeholder="Checklist item" aria-label="Checklist item text" onChange={(event) => updateSelectedNote({ checklist: selectedNote.checklist.map((entry) => entry.id === item.id ? { ...entry, text: event.target.value } : entry) })} /></label>)}</div>}
                </section>

                <section className="editor-section" aria-labelledby="attachments-heading">
                  <div className="editor-section-heading"><span id="attachments-heading"><Paperclip className="mr-1 inline h-3.5 w-3.5" />Attachments</span><div className="flex gap-1"><Button variant="ghost" size="sm" onClick={() => fileInputRef.current?.click()}><Paperclip className="h-3.5 w-3.5" />Add file</Button><Button variant="ghost" size="sm" onClick={() => setLinkDialogOpen(true)}><Link2 className="h-3.5 w-3.5" />Add link</Button></div></div>
                  <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileChange} />
                  {selectedNote.attachments.length > 0 && <div className="attachments">{selectedNote.attachments.map((attachment) => <div className="attachment-line" key={attachment.id}>{attachment.kind === "image" ? <img src={attachment.url} alt="" /> : attachment.kind === "link" ? <Link2 className="h-4 w-4 shrink-0 text-primary" /> : <File className="h-4 w-4 shrink-0 text-muted-foreground" />}<div className="attachment-name">{attachment.kind === "link" ? <a className="attachment-link" href={attachment.url} target="_blank" rel="noreferrer">{attachment.name}</a> : <strong>{attachment.name}</strong>}<span>{attachment.kind === "link" ? attachment.url : `${attachment.mimeType ?? "File"} · ${formatBytes(attachment.size)}`}</span></div><Button variant="ghost" size="icon-sm" aria-label={`Remove ${attachment.name}`} onClick={() => updateSelectedNote({ attachments: selectedNote.attachments.filter((item) => item.id !== attachment.id) })}><X className="h-4 w-4" /></Button></div>)}</div>}
                </section>

                <section className="editor-section" aria-labelledby="tags-heading">
                  <div className="editor-section-heading"><span id="tags-heading"><Tag className="mr-1 inline h-3.5 w-3.5" />Tags</span><span>Press Enter to add</span></div>
                  <div className="tag-row mt-2 flex-wrap gap-1.5">{selectedNote.tags.map((tag) => <Badge variant="secondary" key={tag}>#{tag}<button type="button" className="ml-1" aria-label={`Remove tag ${tag}`} onClick={() => removeTag(tag)}><X className="h-3 w-3" /></button></Badge>)}<Input value={tagValue} onChange={(event) => setTagValue(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); setTagDraftValue(tagValue); } }} placeholder="Add tag" aria-label="Add tag" className="h-7 w-28 border-0 bg-transparent px-1 text-xs shadow-none focus-visible:ring-0" /></div>
                </section>
              </div> : <div className="empty-state"><div><strong>Select a note</strong><p>Choose a note from the list or create a new one with ⌘ N.</p></div></div>}
            </ScrollArea>
          </section>
        </main>
      </div>

      <Dialog open={paletteOpen} onOpenChange={(open) => { setPaletteOpen(open); if (!open) setPaletteQuery(""); }}>
        <DialogContent className="max-w-xl">
          <DialogHeader><DialogTitle>Command palette</DialogTitle><DialogDescription>Run common note actions without leaving the keyboard.</DialogDescription></DialogHeader>
          <Input autoFocus value={paletteQuery} onChange={(event) => setPaletteQuery(event.target.value)} placeholder="Type a command…" aria-label="Filter commands" />
          <div className="palette-list">{commands.map((command) => { const Icon = command.icon; return <button type="button" className="palette-command" key={command.id} onClick={() => runPaletteCommand(command.id)}><span className="flex items-center gap-3"><Icon className="h-4 w-4 text-muted-foreground" /><span className="command-label"><strong>{command.label}</strong><span>{command.description}</span></span></span>{command.shortcut && <span className="shortcut-hint"><kbd>{command.shortcut}</kbd></span>}</button>; })}{commands.length === 0 && <div className="empty-state min-h-0"><div><strong>No command found</strong><p>Try “new”, “search”, or “shortcuts”.</p></div></div>}</div>
        </DialogContent>
      </Dialog>

      <Dialog open={linkDialogOpen} onOpenChange={setLinkDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add a link</DialogTitle><DialogDescription>Keep a useful reference beside the note that explains why it matters.</DialogDescription></DialogHeader>
          <form className="dialog-form" onSubmit={addLink}><div className="dialog-field"><label htmlFor="link-name">Name</label><Input id="link-name" value={linkName} onChange={(event) => setLinkName(event.target.value)} placeholder="Optional label" /></div><div className="dialog-field"><label htmlFor="link-url">URL</label><Input id="link-url" type="url" required value={linkUrl} onChange={(event) => setLinkUrl(event.target.value)} placeholder="https://" /></div><DialogFooter><Button type="button" variant="outline" onClick={() => setLinkDialogOpen(false)}>Cancel</Button><Button type="submit"><Link2 className="h-4 w-4" />Add link</Button></DialogFooter></form>
        </DialogContent>
      </Dialog>

      <Dialog open={shortcutsDialogOpen} onOpenChange={setShortcutsDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Keyboard shortcuts</DialogTitle><DialogDescription>Every core workflow stays available without a pointer.</DialogDescription></DialogHeader>
          <div className="grid gap-2 text-sm">{[["⌘ / Ctrl K", "Open command palette"], ["⌘ / Ctrl N", "New note"], ["⌘ / Ctrl ⇧ F", "Focus search"], ["⌘ / Ctrl S", "Save current workspace"], ["↑ / ↓", "Move through notes"], ["Enter", "Open selected note"], ["Escape", "Close dialogs and menus"]].map(([shortcut, label]) => <div className="flex items-center justify-between gap-4 rounded-md bg-muted px-3 py-2" key={shortcut}><span>{label}</span><kbd className="rounded border border-border bg-background px-2 py-1 text-xs text-muted-foreground">{shortcut}</kbd></div>)}</div>
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  );

  function setTagDraftValue(value: string) {
    const tag = value.trim().replace(/^#/, "");
    if (!tag || !selectedNote || selectedNote.tags.includes(tag)) return;
    updateSelectedNote({ tags: [...selectedNote.tags, tag] });
    setTagValue("");
  }
}

function FileTextIcon() {
  return <File className="h-4 w-4" />;
}

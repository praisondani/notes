"use client";
/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ChangeEvent, type FormEvent } from "react";
import Link from "next/link";
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronUp,
  Command as CommandIcon,
  File,
  FilePlus2,
  Folder as FolderIcon,
  FolderPlus,
  GripVertical,
  Hexagon,
  Inbox,
  Keyboard,
  Layers3,
  Link2,
  ListChecks,
  Menu,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Paperclip,
  Pin,
  PinOff,
  Plus,
  Search,
  Settings,
  Sun,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { LoginScreen } from "@/components/login-screen";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { createId, createNote, filterNotes, getNotePreview, isNoteEmpty, moveNote, reorderChecklist, reorderNotes, toggleArchived, toggleChecklist, togglePinned, updateNote, withDerivedTitle } from "@/lib/notes";
import type { Attachment, Folder as NoteFolder, Group, Note, NoteFilter, NoteQuery, Workspace } from "@/lib/types";
import { applyTheme, readThemePreference, resolveDarkTheme, setThemePreference as saveThemePreference, type ThemePreference } from "@/lib/theme";
import { cn, formatBytes, formatDate } from "@/lib/utils";

type MobilePane = "sidebar" | "list" | "editor";
type SaveState = "saved" | "saving" | "error";
type CollectionKind = "folder" | "group";
type CollectionTarget = { kind: CollectionKind; id: string };
type CollectionRenameSurface = "sidebar" | "title";

const collectionLabelOptions = [
  { id: "green", name: "Green" },
  { id: "amber", name: "Amber" },
  { id: "slate", name: "Slate" },
  { id: "blue", name: "Blue" },
  { id: "rose", name: "Rose" },
] as const;

type CollectionColor = (typeof collectionLabelOptions)[number]["id"];

const filterOptions: Array<{ id: NoteFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "pinned", label: "Pinned" },
  { id: "links", label: "Links" },
  { id: "files", label: "Files" },
];

const emptyWorkspace: Workspace = { version: 1, notes: [], folders: [], groups: [] };
const sidebarCollapsedStorageKey = "notes-sidebar-collapsed";
const sidebarCollapsedChangeEvent = "notes-sidebar-collapsed-change";

function getSidebarCollapsedSnapshot(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(sidebarCollapsedStorageKey) === "true";
}

function getSidebarCollapsedServerSnapshot(): boolean {
  return false;
}

function subscribeToSidebarCollapsed(onStoreChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("storage", onStoreChange);
  window.addEventListener(sidebarCollapsedChangeEvent, onStoreChange);
  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener(sidebarCollapsedChangeEvent, onStoreChange);
  };
}

function saveSidebarCollapsedPreference(value: boolean) {
  window.localStorage.setItem(sidebarCollapsedStorageKey, String(value));
  window.dispatchEvent(new Event(sidebarCollapsedChangeEvent));
}

function noteCount(notes: Note[], filter: NoteFilter): number {
  return filterNotes(notes, { search: "", filter, folderId: null, groupId: null }).length;
}

function colorClass(color: string): string {
  return collectionLabelOptions.some((option) => option.id === color) ? color : "slate";
}

function collectionKindLabel(kind: CollectionKind): string {
  return kind === "folder" ? "folder" : "group";
}

function collectionTargetLabel(target: CollectionTarget): string {
  return target.kind === "folder" ? "Folder" : "Group";
}

function isEditableTarget(target: EventTarget | null): boolean {
  const element = target instanceof HTMLElement ? target : null;
  return element?.isContentEditable || element?.matches("input, textarea, select") || false;
}

function CollectionShape({ kind, color }: { kind: CollectionKind; color: string }) {
  const Shape = kind === "folder" ? FolderIcon : Hexagon;
  return <Shape className={cn("collection-shape", kind === "folder" ? "folder-shape" : "group-shape", colorClass(color))} aria-hidden="true" />;
}

export function NotesApp() {
  const [workspace, setWorkspace] = useState<Workspace>(emptyWorkspace);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
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
  const [newFolderColor, setNewFolderColor] = useState<CollectionColor>("green");
  const [newGroupColor, setNewGroupColor] = useState<CollectionColor>("green");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const sidebarCollapsed = useSyncExternalStore(subscribeToSidebarCollapsed, getSidebarCollapsedSnapshot, getSidebarCollapsedServerSnapshot);
  const [editingCollection, setEditingCollection] = useState<CollectionTarget | null>(null);
  const [editingCollectionSurface, setEditingCollectionSurface] = useState<CollectionRenameSurface | null>(null);
  const [collectionNameDraft, setCollectionNameDraft] = useState("");
  const [collectionEditor, setCollectionEditor] = useState<CollectionTarget | null>(null);
  const [collectionEditorName, setCollectionEditorName] = useState("");
  const [collectionEditorColor, setCollectionEditorColor] = useState<CollectionColor>("green");
  const [deleteTarget, setDeleteTarget] = useState<CollectionTarget | null>(null);
  const [loading, setLoading] = useState(true);
  const [authRequired, setAuthRequired] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [checklistDraggingId, setChecklistDraggingId] = useState<string | null>(null);
  const [themePreference, setThemePreferenceState] = useState<ThemePreference>(() => readThemePreference());
  const [darkMode, setDarkMode] = useState(() => resolveDarkTheme(readThemePreference()));
  const [hydrated, setHydrated] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const collectionRenameRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selectedNote = workspace.notes.find((note) => note.id === selectedNoteId) ?? null;
  const filteredNotes = useMemo(() => filterNotes(workspace.notes, query), [workspace.notes, query]);
  const selectedFolder = workspace.folders.find((folder) => folder.id === selectedNote?.folderId);
  const selectedGroup = workspace.groups.find((group) => group.id === selectedNote?.groupId);
  const activeFolder = query.folderId ? workspace.folders.find((folder) => folder.id === query.folderId) : undefined;
  const activeGroup = query.groupId ? workspace.groups.find((group) => group.id === query.groupId) : undefined;
  const activeCollection = activeFolder ?? activeGroup;
  const activeCollectionTarget: CollectionTarget | null = activeFolder
    ? { kind: "folder", id: activeFolder.id }
    : activeGroup
      ? { kind: "group", id: activeGroup.id }
      : null;
  const listTitle = query.filter === "inbox"
    ? "Inbox"
    : query.filter === "pinned"
      ? "Pinned"
      : query.filter === "archived"
        ? "Archive"
        : "All notes";

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

  function leaveSelectedNote(nextNoteId: string | null) {
    if (!selectedNoteId || selectedNoteId === nextNoteId) return;
    setWorkspace((current) => {
      const selected = current.notes.find((note) => note.id === selectedNoteId);
      if (!selected) return current;
      const finalized = withDerivedTitle(selected);
      const notes = current.notes.map((note) => note.id === selectedNoteId ? finalized : note);
      return { ...current, notes: isNoteEmpty(finalized) ? notes.filter((note) => note.id !== selectedNoteId) : notes };
    });
  }

  function createNewNote(folderId: string | null = null, groupId: string | null = null) {
    leaveSelectedNote(null);
    const note = createNote(new Date());
    setWorkspace((current) => ({ ...current, notes: [{ ...note, folderId, groupId, position: 0 }, ...current.notes.map((item, index) => ({ ...item, position: index + 1 }))] }));
    setSelectedNoteId(note.id);
    setQuery({ search: "", filter: "all", folderId, groupId });
    setMobilePane("editor");
    window.setTimeout(() => titleRef.current?.focus(), 0);
  }

  function createNoteInActiveCollection() {
    if (!activeCollectionTarget) {
      createNewNote();
      return;
    }
    createNewNote(
      activeCollectionTarget.kind === "folder" ? activeCollectionTarget.id : null,
      activeCollectionTarget.kind === "group" ? activeCollectionTarget.id : null,
    );
  }

  function toggleSidebar() {
    saveSidebarCollapsedPreference(!sidebarCollapsed);
  }

  useEffect(() => {
    applyTheme(themePreference);
    const media = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)") : null;
    const updateSystemTheme = () => {
      setDarkMode(resolveDarkTheme(themePreference, media?.matches ?? false));
      if (themePreference === "system") applyTheme(themePreference);
    };
    updateSystemTheme();
    if (themePreference !== "system" || !media) return;
    media.addEventListener("change", updateSystemTheme);
    return () => media.removeEventListener("change", updateSystemTheme);
  }, [themePreference]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/workspace")
      .then(async (response) => {
        if (response.status === 401) {
          if (!cancelled) setAuthRequired(true);
          return null;
        }
        if (!response.ok) throw new Error("Workspace could not be loaded");
        return response.json() as Promise<Workspace>;
      })
      .then((remote) => {
        if (cancelled || !remote) return;
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
      if (modifier && event.shiftKey && event.key.toLowerCase() === "b" && !isEditableTarget(event.target)) {
        event.preventDefault();
        toggleSidebar();
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

  function setTheme(nextDark: boolean) {
    const nextPreference: ThemePreference = nextDark ? "dark" : "light";
    setThemePreferenceState(nextPreference);
    setDarkMode(saveThemePreference(nextPreference));
  }

  function updateSelectedNote(patch: Partial<Note>) {
    if (!selectedNoteId) return;
    setWorkspace((current) => ({ ...current, notes: updateNote(current.notes, selectedNoteId, patch) }));
  }

  function finalizeSelectedNote() {
    if (!selectedNoteId) return;
    setWorkspace((current) => ({ ...current, notes: current.notes.map((note) => note.id === selectedNoteId ? withDerivedTitle(note) : note) }));
  }

  function selectNoteView(nextQuery: NoteQuery) {
    leaveSelectedNote(null);
    setQuery(nextQuery);
    setMobilePane("list");
  }

  function selectNote(noteId: string) {
    leaveSelectedNote(noteId);
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

  function findCollection(target: CollectionTarget): NoteFolder | Group | undefined {
    return target.kind === "folder"
      ? workspace.folders.find((folder) => folder.id === target.id)
      : workspace.groups.find((group) => group.id === target.id);
  }

  function normalizeCollectionColor(color: string): CollectionColor {
    return collectionLabelOptions.some((option) => option.id === color) ? color as CollectionColor : "slate";
  }

  function beginCollectionRename(target: CollectionTarget, surface: CollectionRenameSurface) {
    const collection = findCollection(target);
    if (!collection) return;
    setEditingCollection(target);
    setEditingCollectionSurface(surface);
    setCollectionNameDraft(collection.name);
    window.setTimeout(() => {
      collectionRenameRef.current?.focus();
      collectionRenameRef.current?.select();
    }, 0);
  }

  function commitInlineCollectionRename() {
    if (!editingCollection) return;
    const name = collectionNameDraft.trim();
    if (!name) return;
    const target = editingCollection;
    setWorkspace((current) => target.kind === "folder"
      ? { ...current, folders: current.folders.map((folder) => folder.id === target.id ? { ...folder, name } : folder) }
      : { ...current, groups: current.groups.map((group) => group.id === target.id ? { ...group, name } : group) });
    setEditingCollection(null);
    setEditingCollectionSurface(null);
  }

  function saveInlineCollectionRename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    commitInlineCollectionRename();
  }

  function handleCollectionKeyDown(event: React.KeyboardEvent<HTMLElement>, target: CollectionTarget, surface: CollectionRenameSurface) {
    if (event.key === "F2") {
      event.preventDefault();
      beginCollectionRename(target, surface);
    } else if (event.key === "Delete") {
      event.preventDefault();
      requestCollectionDelete(target);
    }
  }

  function openCollectionEditor(target: CollectionTarget) {
    const collection = findCollection(target);
    if (!collection) return;
    setEditingCollection(null);
    setEditingCollectionSurface(null);
    setCollectionEditor(target);
    setCollectionEditorName(collection.name);
    setCollectionEditorColor(normalizeCollectionColor(collection.color));
  }

  function saveCollectionEditor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!collectionEditor) return;
    const name = collectionEditorName.trim();
    if (!name) return;
    const target = collectionEditor;
    setWorkspace((current) => target.kind === "folder"
      ? { ...current, folders: current.folders.map((folder) => folder.id === target.id ? { ...folder, name, color: collectionEditorColor } : folder) }
      : { ...current, groups: current.groups.map((group) => group.id === target.id ? { ...group, name, color: collectionEditorColor } : group) });
    setCollectionEditor(null);
  }

  function requestCollectionDelete(target: CollectionTarget) {
    if (!findCollection(target)) return;
    setEditingCollection(null);
    setEditingCollectionSurface(null);
    setCollectionEditor(null);
    setDeleteTarget(target);
  }

  function confirmCollectionDelete() {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setWorkspace((current) => target.kind === "folder"
      ? {
          ...current,
          folders: current.folders
            .filter((folder) => folder.id !== target.id)
            .map((folder) => folder.parentId === target.id ? { ...folder, parentId: null } : folder),
          notes: current.notes.map((note) => note.folderId === target.id ? { ...note, folderId: null } : note),
        }
      : {
          ...current,
          groups: current.groups.filter((group) => group.id !== target.id),
          notes: current.notes.map((note) => note.groupId === target.id ? { ...note, groupId: null } : note),
        });
    if ((target.kind === "folder" && query.folderId === target.id) || (target.kind === "group" && query.groupId === target.id)) {
      setQuery({ search: "", filter: "all", folderId: null, groupId: null });
      setMobilePane("list");
    }
    setDeleteTarget(null);
  }

  function createFolder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = newFolderName.trim();
    if (!name) return;
    const folder: NoteFolder = { id: createId("folder"), name, parentId: null, color: newFolderColor, position: workspace.folders.length };
    setWorkspace((current) => ({ ...current, folders: [...current.folders, folder] }));
    setNewFolderName("");
    setNewFolderColor("green");
    setCreatingFolder(false);
  }

  function createGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = newGroupName.trim();
    if (!name) return;
    const group: Group = { id: createId("group"), name, color: newGroupColor, position: workspace.groups.length };
    setWorkspace((current) => ({ ...current, groups: [...current.groups, group] }));
    setNewGroupName("");
    setNewGroupColor("green");
    setCreatingGroup(false);
  }

  function handleFolderDrop(event: React.DragEvent<HTMLButtonElement>, folderId: string | null) {
    event.preventDefault();
    event.stopPropagation();
    const noteId = event.dataTransfer.getData("text/plain") || draggingId;
    if (!noteId) return;
    setWorkspace((current) => ({ ...current, notes: moveNote(current.notes, noteId, folderId) }));
    setDraggingId(null);
  }

  function handleNoteDrop(event: React.DragEvent<HTMLButtonElement>, targetId: string) {
    event.preventDefault();
    event.stopPropagation();
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

  function reorderSelectedChecklist(sourceId: string, targetId: string) {
    if (!selectedNoteId) return;
    setWorkspace((current) => {
      const currentNote = current.notes.find((note) => note.id === selectedNoteId);
      return currentNote
        ? { ...current, notes: updateNote(current.notes, selectedNoteId, { checklist: reorderChecklist(currentNote.checklist, sourceId, targetId) }) }
        : current;
    });
    setChecklistDraggingId(null);
  }

  function moveChecklistItem(itemId: string, offset: number) {
    if (!selectedNote) return;
    const index = selectedNote.checklist.findIndex((item) => item.id === itemId);
    const target = selectedNote.checklist[index + offset];
    if (index < 0 || !target) return;
    reorderSelectedChecklist(itemId, target.id);
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
    if (command === "sidebar") toggleSidebar();
    if (command === "shortcuts") setShortcutsDialogOpen(true);
  }

  const commands = [
    { id: "new", label: "New note", description: "Start with a blank note", shortcut: "⌘ N", icon: FilePlus2 },
    { id: "search", label: "Search notes", description: "Jump to the note search field", shortcut: "⌘ ⇧ F", icon: Search },
    { id: "pin", label: selectedNote?.pinned ? "Unpin note" : "Pin note", description: "Keep the current note near the top", shortcut: "⌘ ⇧ P", icon: Pin },
    { id: "archive", label: selectedNote?.archived ? "Restore note" : "Archive note", description: "Move the current note out of the active list", shortcut: "", icon: Archive },
    { id: "sidebar", label: sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar", description: "Show or hide sidebar labels", shortcut: "⌘ ⇧ B", icon: sidebarCollapsed ? PanelLeftOpen : PanelLeftClose },
    { id: "shortcuts", label: "Keyboard shortcuts", description: "See every keyboard action", shortcut: "?", icon: Keyboard },
  ].filter((command) => `${command.label} ${command.description}`.toLowerCase().includes(paletteQuery.toLowerCase()));

  if (authRequired) return <LoginScreen />;

  function sidebarButton(label: string, icon: React.ReactNode, active: boolean, onClick: () => void, count?: number, onDrop?: (event: React.DragEvent<HTMLButtonElement>) => void, itemKey?: string) {
    return <button key={itemKey} type="button" className="nav-item" data-active={active} data-drop-target={onDrop ? "folder" : undefined} onClick={onClick} onDragOver={(event) => { if (!onDrop) return; event.preventDefault(); event.dataTransfer.dropEffect = "move"; }} onDrop={onDrop} aria-current={active ? "page" : undefined} title={label}>{icon}<span className="nav-item-label">{label}</span>{typeof count === "number" && <span className="count">{count}</span>}</button>;
  }

  function collectionRow(kind: CollectionKind, collection: NoteFolder | Group, count: number, onDrop?: (event: React.DragEvent<HTMLButtonElement>) => void) {
    const target: CollectionTarget = { kind, id: collection.id };
    const editing = editingCollectionSurface === "sidebar" && editingCollection?.kind === target.kind && editingCollection.id === target.id;
    const collectionLabel = collectionKindLabel(kind);
    return <div className="collection-nav-row" key={collection.id} data-editing={editing}>
      {editing ? <form className="collection-rename-form" onSubmit={saveInlineCollectionRename}>
        <Input ref={collectionRenameRef} value={collectionNameDraft} onChange={(event) => setCollectionNameDraft(event.target.value)} onBlur={commitInlineCollectionRename} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); setEditingCollection(null); setEditingCollectionSurface(null); } }} aria-label={`Rename ${collectionLabel}`} />
        <Button type="submit" variant="ghost" size="icon-sm" aria-label={`Save ${collectionLabel} name`}><Check className="h-4 w-4" /></Button>
      </form> : <>
        <button type="button" className="nav-item collection-nav-item" data-active={(kind === "folder" ? query.folderId : query.groupId) === collection.id} data-drop-target={onDrop ? "folder" : undefined} onClick={() => selectNoteView({ search: "", filter: "all", folderId: kind === "folder" ? collection.id : null, groupId: kind === "group" ? collection.id : null })} onDoubleClick={() => beginCollectionRename(target, "sidebar")} onKeyDown={(event) => handleCollectionKeyDown(event, target, "sidebar")} onDragOver={(event) => { if (!onDrop) return; event.preventDefault(); event.dataTransfer.dropEffect = "move"; }} onDrop={onDrop} aria-current={(kind === "folder" ? query.folderId : query.groupId) === collection.id ? "page" : undefined} aria-keyshortcuts="F2 Delete" aria-label={`${collection.name}, ${collectionLabel}. Double-click or press F2 to rename`} title={`${collection.name} · ${collectionLabel}`}>
          <CollectionShape kind={kind} color={collection.color} /><span className="nav-item-label">{collection.name}</span><span className="count">{count}</span>
        </button>
        <div className="collection-actions">
          <Tooltip><TooltipTrigger asChild><Button type="button" variant="ghost" size="icon-sm" className="collection-action" aria-label={`Edit ${collectionLabel} label`} onClick={() => openCollectionEditor(target)}><Pencil className="h-3.5 w-3.5" /></Button></TooltipTrigger><TooltipContent>Edit {collectionLabel}</TooltipContent></Tooltip>
          <Tooltip><TooltipTrigger asChild><Button type="button" variant="ghost" size="icon-sm" className="collection-action collection-delete-action" aria-label={`Delete ${collectionLabel} ${collection.name}`} onClick={() => requestCollectionDelete(target)}><Trash2 className="h-3.5 w-3.5" /></Button></TooltipTrigger><TooltipContent>Delete {collectionLabel}</TooltipContent></Tooltip>
        </div>
      </>}
    </div>;
  }

  return (
    <TooltipProvider delayDuration={500}>
      <div className="app-shell" data-sidebar-collapsed={sidebarCollapsed}>
        <header className="topbar">
          <div className="brand-lockup">
            <Button variant="ghost" size="icon-sm" className="mobile-only" aria-label="Open navigation" onClick={() => setMobilePane("sidebar")}><Menu className="h-4 w-4" /></Button>
            <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon-sm" className="desktop-only sidebar-toggle" aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"} onClick={toggleSidebar}>{sidebarCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}</Button></TooltipTrigger><TooltipContent>{sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}</TooltipContent></Tooltip>
            <span className="brand-mark" aria-hidden="true"><Layers3 className="h-4 w-4" /></span>
            <span>Notes</span>
          </div>
          <div className="topbar-actions">
            <Tooltip><TooltipTrigger asChild><Button asChild variant="ghost" size="icon-sm" aria-label="Open settings"><Link href="/settings"><Settings className="h-4 w-4" /></Link></Button></TooltipTrigger><TooltipContent>Settings</TooltipContent></Tooltip>
            <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon-sm" aria-label="Keyboard shortcuts" onClick={() => setShortcutsDialogOpen(true)}><Keyboard className="h-4 w-4" /></Button></TooltipTrigger><TooltipContent>Keyboard shortcuts</TooltipContent></Tooltip>
            <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={darkMode ? "Use light theme" : "Use dark theme"} onClick={() => setTheme(!darkMode)}>{darkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}</Button></TooltipTrigger><TooltipContent>{darkMode ? "Use light theme" : "Use dark theme"}</TooltipContent></Tooltip>
            <Button variant="outline" size="sm" aria-label="New note" onClick={() => createNewNote()}><Plus className="h-4 w-4" /><span className="desktop-label">New note</span></Button>
          </div>
        </header>

        <main className="workspace" data-mobile-pane={mobilePane}>
          <aside className="sidebar" aria-label="Workspace navigation">
            <ScrollArea className="sidebar-scroll">
              <div className="sidebar-section">
                <div className="section-label"><span>Library</span></div>
                <nav className="nav-list" aria-label="Library">
                  {sidebarButton("All notes", <FileTextIcon />, query.filter === "all" && !query.folderId && !query.groupId, () => selectNoteView({ search: "", filter: "all", folderId: null, groupId: null }), noteCount(workspace.notes, "all"), (event) => handleFolderDrop(event, null))}
                  {sidebarButton("Inbox", <Inbox className="h-4 w-4" />, query.filter === "inbox", () => selectNoteView({ search: "", filter: "inbox", folderId: null, groupId: null }), noteCount(workspace.notes, "inbox"), (event) => handleFolderDrop(event, null))}
                  {sidebarButton("Pinned", <Pin className="h-4 w-4" />, query.filter === "pinned", () => selectNoteView({ search: "", filter: "pinned", folderId: null, groupId: null }), noteCount(workspace.notes, "pinned"))}
                  {sidebarButton("Archive", <Archive className="h-4 w-4" />, query.filter === "archived", () => selectNoteView({ search: "", filter: "archived", folderId: null, groupId: null }), noteCount(workspace.notes, "archived"))}
                </nav>
              </div>

              <div className="sidebar-section">
                <div className="section-label"><span>Folders</span><button type="button" aria-label="Add folder" onClick={() => { saveSidebarCollapsedPreference(false); setCreatingFolder(true); }}><FolderPlus className="h-3.5 w-3.5" /></button></div>
                <div className="folder-list">
                  {workspace.folders.map((folder) => collectionRow("folder", folder, workspace.notes.filter((note) => note.folderId === folder.id && !note.archived).length, (event) => handleFolderDrop(event, folder.id)))}
                </div>
                {creatingFolder && <form className="inline-create" onSubmit={createFolder}><Input autoFocus value={newFolderName} onChange={(event) => setNewFolderName(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") setCreatingFolder(false); }} placeholder="Folder name" aria-label="New folder name" /><select className="collection-label-select" aria-label="Folder label" value={newFolderColor} onChange={(event) => setNewFolderColor(normalizeCollectionColor(event.target.value))}>{collectionLabelOptions.map((option) => <option value={option.id} key={option.id}>{option.name}</option>)}</select><Button type="submit" size="icon-sm" aria-label="Create folder"><Check className="h-4 w-4" /></Button></form>}
              </div>

              <div className="sidebar-section">
                <div className="section-label"><span>Groups</span><button type="button" aria-label="Add group" onClick={() => { saveSidebarCollapsedPreference(false); setCreatingGroup(true); }}><Plus className="h-3.5 w-3.5" /></button></div>
                <div className="group-list">
                  {workspace.groups.map((group) => collectionRow("group", group, workspace.notes.filter((note) => note.groupId === group.id && !note.archived).length))}
                </div>
                {creatingGroup && <form className="inline-create" onSubmit={createGroup}><Input autoFocus value={newGroupName} onChange={(event) => setNewGroupName(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") setCreatingGroup(false); }} placeholder="Group name" aria-label="New group name" /><select className="collection-label-select" aria-label="Group label" value={newGroupColor} onChange={(event) => setNewGroupColor(normalizeCollectionColor(event.target.value))}>{collectionLabelOptions.map((option) => <option value={option.id} key={option.id}>{option.name}</option>)}</select><Button type="submit" size="icon-sm" aria-label="Create group"><Check className="h-4 w-4" /></Button></form>}
              </div>

              <div className="sidebar-section">
                <div className="section-label"><span>Filters</span></div>
                <div className="filter-list">
                  {sidebarButton("With links", <Link2 className="h-4 w-4" />, query.filter === "links", () => selectNoteView({ search: "", filter: "links", folderId: null, groupId: null }), noteCount(workspace.notes, "links"))}
                  {sidebarButton("With files", <Paperclip className="h-4 w-4" />, query.filter === "files", () => selectNoteView({ search: "", filter: "files", folderId: null, groupId: null }), noteCount(workspace.notes, "files"))}
                </div>
              </div>
            </ScrollArea>
          </aside>

          <section className="note-list" aria-label="Notes">
            <div className="note-list-header">
              <div className="list-title-row">
                <div className="list-title-actions">
                  {activeCollection && activeCollectionTarget ? (editingCollectionSurface === "title" && editingCollection?.kind === activeCollectionTarget.kind && editingCollection.id === activeCollectionTarget.id ? <form className="list-title-form" onSubmit={saveInlineCollectionRename}><Input ref={collectionRenameRef} autoFocus value={collectionNameDraft} onChange={(event) => setCollectionNameDraft(event.target.value)} onBlur={commitInlineCollectionRename} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); setEditingCollection(null); setEditingCollectionSurface(null); } }} aria-label={`Rename ${collectionKindLabel(activeCollectionTarget.kind)}`} /></form> : <button type="button" className="list-title-button" onDoubleClick={() => beginCollectionRename(activeCollectionTarget, "title")} onKeyDown={(event) => handleCollectionKeyDown(event, activeCollectionTarget, "title")} aria-keyshortcuts="F2 Delete" aria-label={`${activeCollection.name}, ${collectionKindLabel(activeCollectionTarget.kind)}. Double-click or press F2 to rename`}><CollectionShape kind={activeCollectionTarget.kind} color={activeCollection.color} /><span>{activeCollection.name}</span></button>) : <h1>{listTitle}</h1>}
                  {activeCollection && <Tooltip><TooltipTrigger asChild><Button type="button" variant="ghost" size="icon-sm" className="list-title-add" aria-label={`Create note in ${activeCollection.name}`} onClick={createNoteInActiveCollection}><Plus className="h-4 w-4" /></Button></TooltipTrigger><TooltipContent>New note in {activeCollection.name}</TooltipContent></Tooltip>}
                </div>
                <span>{filteredNotes.length}</span>
              </div>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input ref={searchRef} value={query.search} onChange={(event) => setQuery((current) => ({ ...current, search: event.target.value }))} placeholder="Search notes" aria-label="Search notes" className="h-9 pl-9 pr-14" />
                {!query.search && <span className="shortcut-hint absolute right-2 top-1.5"><kbd>⌘</kbd><kbd>K</kbd></span>}
              </div>
              <div className="list-filter-row" aria-label="Quick filters">
                {filterOptions.map((option) => <button type="button" key={option.id} className="filter-chip" data-active={query.filter === option.id} onClick={() => selectNoteView({ ...query, filter: option.id, folderId: null, groupId: null })}>{option.label}</button>)}
              </div>
            </div>
            <ScrollArea className="note-scroll">
              <div className="note-list-items" role="listbox" aria-label="Note list" aria-activedescendant={selectedNoteId ?? undefined}>
                {loading && <div className="empty-state"><div><strong>Loading notes</strong><p>Opening your local workspace.</p></div></div>}
                {!loading && !filteredNotes.length && <div className="empty-state"><div><strong>No notes found</strong><p>Try another search or create a new note.</p><Button className="mt-4" size="sm" onClick={createNoteInActiveCollection}><Plus className="h-4 w-4" />New note</Button></div></div>}
                {filteredNotes.map((note) => <button key={note.id} id={note.id} data-note-id={note.id} type="button" role="option" aria-selected={selectedNoteId === note.id} className="note-row" data-selected={selectedNoteId === note.id} data-dragging={draggingId === note.id} draggable onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", note.id); setDraggingId(note.id); }} onDragEnd={() => setDraggingId(null)} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }} onDrop={(event) => handleNoteDrop(event, note.id)} onClick={() => selectNote(note.id)} onKeyDown={handleNoteKeyDown}>
                  <span className="note-row-title"><span>{note.title || "Untitled note"}</span>{note.pinned && <Pin className="h-3 w-3 shrink-0 text-primary" aria-label="Pinned" />}</span>
                  <span className="note-row-preview">{getNotePreview(note)}</span>
                  <span className="note-meta"><span>{formatDate(note.updatedAt)}</span>{note.attachments.length > 0 && <><span aria-hidden="true">·</span><Paperclip className="h-3 w-3" /></>}<span className="note-meta-end">{note.tags[0] ? `#${note.tags[0]}` : ""}</span></span>
                </button>)}
              </div>
            </ScrollArea>
          </section>

          <section className="editor" aria-label="Note editor">
            <div className="editor-header">
              <div className="editor-meta"><Button variant="ghost" size="icon-sm" className="mobile-only" aria-label="Back to notes" onClick={() => { leaveSelectedNote(null); setMobilePane("list"); }}><ArrowLeft className="h-4 w-4" /></Button><span className="breadcrumb">{selectedFolder?.name ?? "Inbox"}{selectedGroup ? ` / ${selectedGroup.name}` : ""}</span>{saveState === "saving" && <span>Saving…</span>}{saveState === "saved" && <span>Saved</span>}{saveState === "error" && <span className="text-destructive">Save error</span>}</div>
              <div className="toolbar-actions">
                {selectedNote && <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={selectedNote.pinned ? "Unpin note" : "Pin note"} onClick={() => setWorkspace((current) => ({ ...current, notes: togglePinned(current.notes, selectedNote.id) }))}>{selectedNote.pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}</Button></TooltipTrigger><TooltipContent>{selectedNote.pinned ? "Unpin note" : "Pin note"}</TooltipContent></Tooltip>}
                {selectedNote && <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={selectedNote.archived ? "Restore note" : "Archive note"} onClick={() => setWorkspace((current) => ({ ...current, notes: toggleArchived(current.notes, selectedNote.id) }))}>{selectedNote.archived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}</Button></TooltipTrigger><TooltipContent>{selectedNote.archived ? "Restore note" : "Archive note"}</TooltipContent></Tooltip>}
                {selectedNote && <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon-sm" aria-label="Delete note" onClick={deleteSelectedNote}><Trash2 className="h-4 w-4" /></Button></TooltipTrigger><TooltipContent>Delete note</TooltipContent></Tooltip>}
                <Button variant="ghost" size="icon-sm" aria-label="Open command palette" onClick={() => setPaletteOpen(true)}><CommandIcon className="h-4 w-4" /></Button>
              </div>
            </div>
            {selectedNote ? <div className="editor-content">
                <Input ref={titleRef} value={selectedNote.title} onChange={(event) => updateSelectedNote({ title: event.target.value })} className="title-input" placeholder="Untitled note" aria-label="Note title" />
                <div className="editor-subline">
                  <span>Updated {formatDate(selectedNote.updatedAt)}</span><span aria-hidden="true">·</span>
                  <select className="folder-select" aria-label="Move note to folder" value={selectedNote.folderId ?? "inbox"} onChange={(event) => moveSelected(event.target.value === "inbox" ? null : event.target.value)}><option value="inbox">Inbox</option>{workspace.folders.map((folder) => <option value={folder.id} key={folder.id}>{folder.name}</option>)}</select>
                  <select className="folder-select" aria-label="Assign note to group" value={selectedNote.groupId ?? "none"} onChange={(event) => moveSelectedToGroup(event.target.value === "none" ? null : event.target.value)}><option value="none">No group</option>{workspace.groups.map((group) => <option value={group.id} key={group.id}>{group.name}</option>)}</select>
                </div>
                <Textarea value={selectedNote.content} onChange={(event) => updateSelectedNote({ content: event.target.value })} onBlur={finalizeSelectedNote} placeholder="Start writing…" aria-label="Note content" className="content-editor" />

                <section className="editor-section" aria-labelledby="checklist-heading">
                  <div className="editor-section-heading"><span id="checklist-heading"><ListChecks className="mr-1 inline h-3.5 w-3.5" />Checklist</span><Button variant="ghost" size="sm" onClick={addChecklistItem}><Plus className="h-3.5 w-3.5" />Add item</Button></div>
                  {selectedNote.checklist.length > 0 && <div className="checklist">{selectedNote.checklist.map((item, index) => <div className="checklist-row" data-completed={item.completed} data-dragging={checklistDraggingId === item.id} key={item.id} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }} onDrop={(event) => { event.preventDefault(); reorderSelectedChecklist(event.dataTransfer.getData("text/plain") || checklistDraggingId || "", item.id); }}>
                    <Button type="button" variant="ghost" size="icon-sm" className="checklist-drag-handle" draggable aria-label={`Drag ${item.text || "checklist item"}`} onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", item.id); setChecklistDraggingId(item.id); }} onDragEnd={() => setChecklistDraggingId(null)}><GripVertical className="h-4 w-4" /></Button>
                    <input type="checkbox" checked={item.completed} onChange={() => setWorkspace((current) => ({ ...current, notes: toggleChecklist(current.notes, selectedNote.id, item.id) }))} aria-label={`Mark ${item.text || "checklist item"} complete`} />
                    <input type="text" value={item.text} placeholder="Checklist item" aria-label="Checklist item text" onChange={(event) => updateSelectedNote({ checklist: selectedNote.checklist.map((entry) => entry.id === item.id ? { ...entry, text: event.target.value } : entry) })} />
                    <span className="checklist-reorder"><Button type="button" variant="ghost" size="icon-sm" aria-label={`Move ${item.text || "checklist item"} up`} disabled={index === 0} onClick={() => moveChecklistItem(item.id, -1)}><ChevronUp className="h-3.5 w-3.5" /></Button><Button type="button" variant="ghost" size="icon-sm" aria-label={`Move ${item.text || "checklist item"} down`} disabled={index === selectedNote.checklist.length - 1} onClick={() => moveChecklistItem(item.id, 1)}><ChevronDown className="h-3.5 w-3.5" /></Button></span>
                  </div>)}</div>}
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

      <Dialog open={Boolean(collectionEditor)} onOpenChange={(open) => { if (!open) setCollectionEditor(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit {collectionEditor ? collectionTargetLabel(collectionEditor).toLocaleLowerCase() : "collection"}</DialogTitle><DialogDescription>Rename this collection or choose its visual label.</DialogDescription></DialogHeader>
          <form className="dialog-form" onSubmit={saveCollectionEditor}>
            <div className="dialog-field"><label htmlFor="collection-editor-name">Name</label><Input id="collection-editor-name" autoFocus value={collectionEditorName} onChange={(event) => setCollectionEditorName(event.target.value)} /></div>
            <fieldset className="collection-label-fieldset"><legend>Label</legend><div className="collection-label-options" role="radiogroup" aria-label="Collection label">{collectionLabelOptions.map((option) => <button type="button" role="radio" className="collection-label-option" data-color={option.id} data-active={collectionEditorColor === option.id} aria-label={`${option.name} label`} aria-checked={collectionEditorColor === option.id} key={option.id} onClick={() => setCollectionEditorColor(option.id)}><span className={cn("collection-label-swatch", option.id)} aria-hidden="true" /><span>{option.name}</span></button>)}</div></fieldset>
            <DialogFooter><Button type="button" variant="outline" onClick={() => setCollectionEditor(null)}>Cancel</Button><Button type="submit"><Check className="h-4 w-4" />Save changes</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(deleteTarget)} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Delete {deleteTarget ? collectionTargetLabel(deleteTarget).toLocaleLowerCase() : "collection"}?</DialogTitle><DialogDescription>{deleteTarget && findCollection(deleteTarget) ? <>{findCollection(deleteTarget)?.name} will be removed. Notes will move to Inbox or become ungrouped.</> : "This collection will be removed."}</DialogDescription></DialogHeader>
          <DialogFooter><Button type="button" variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button><Button type="button" variant="destructive" onClick={confirmCollectionDelete}><Trash2 className="h-4 w-4" />Delete {deleteTarget ? collectionTargetLabel(deleteTarget).toLocaleLowerCase() : "collection"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={shortcutsDialogOpen} onOpenChange={setShortcutsDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Keyboard shortcuts</DialogTitle><DialogDescription>Every core workflow stays available without a pointer.</DialogDescription></DialogHeader>
          <div className="grid gap-2 text-sm">{[["⌘ / Ctrl K", "Open command palette"], ["⌘ / Ctrl N", "New note"], ["⌘ / Ctrl ⇧ F", "Focus search"], ["⌘ / Ctrl ⇧ B", "Collapse sidebar"], ["⌘ / Ctrl S", "Save current workspace"], ["F2", "Rename focused folder or group"], ["Delete", "Delete focused folder or group"], ["↑ / ↓", "Move through notes"], ["Enter", "Open selected note"], ["Escape", "Close dialogs and menus"]].map(([shortcut, label]) => <div className="flex items-center justify-between gap-4 rounded-md bg-muted px-3 py-2" key={shortcut}><span>{label}</span><kbd className="rounded border border-border bg-background px-2 py-1 text-xs text-muted-foreground">{shortcut}</kbd></div>)}</div>
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

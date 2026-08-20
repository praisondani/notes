import type { Workspace } from "@/lib/types";

export const seedWorkspace: Workspace = {
  version: 1,
  folders: [
    { id: "folder-projects", name: "Projects", parentId: null, color: "green", position: 0 },
    { id: "folder-reading", name: "Reading list", parentId: null, color: "amber", position: 1 },
    { id: "folder-home", name: "Home", parentId: null, color: "slate", position: 2 },
  ],
  groups: [
    { id: "group-work", name: "Work", color: "green", position: 0 },
    { id: "group-personal", name: "Personal", color: "amber", position: 1 },
  ],
  notes: [
    {
      id: "note-welcome",
      title: "A quieter place for your notes",
      content: "Cinder keeps capture close and organization light.\n\nTry the shortcuts, drag a note into a folder, or add a link below.",
      folderId: "folder-projects",
      groupId: "group-work",
      tags: ["welcome", "workflow"],
      checklist: [
        { id: "check-shortcuts", text: "Press ⌘ K for the command palette", completed: false },
        { id: "check-drag", text: "Drag this note into another folder", completed: false },
      ],
      attachments: [
        { id: "attachment-docs", kind: "link", name: "Keyboard reference", url: "https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent" },
      ],
      pinned: true,
      archived: false,
      createdAt: "2026-08-19T15:00:00.000Z",
      updatedAt: "2026-08-20T14:24:00.000Z",
      position: 0,
    },
    {
      id: "note-weekly",
      title: "Weekly review",
      content: "Keep a short list of what moved, what is blocked, and what deserves less attention next week.",
      folderId: null,
      groupId: "group-work",
      tags: ["review"],
      checklist: [
        { id: "check-1", text: "Review open threads", completed: true },
        { id: "check-2", text: "Choose one priority", completed: false },
      ],
      attachments: [],
      pinned: false,
      archived: false,
      createdAt: "2026-08-18T10:00:00.000Z",
      updatedAt: "2026-08-20T09:10:00.000Z",
      position: 1,
    },
    {
      id: "note-reading",
      title: "Reading queue",
      content: "A small queue is easier to return to than an endless bookmark list.",
      folderId: "folder-reading",
      groupId: "group-personal",
      tags: ["reading", "ideas"],
      checklist: [],
      attachments: [
        { id: "attachment-linear", kind: "link", name: "Linear principles", url: "https://linear.app/method" },
      ],
      pinned: false,
      archived: false,
      createdAt: "2026-08-17T08:30:00.000Z",
      updatedAt: "2026-08-19T19:45:00.000Z",
      position: 2,
    },
  ],
};

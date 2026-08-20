export type AttachmentKind = "image" | "file" | "link";

export type Attachment = {
  id: string;
  kind: AttachmentKind;
  name: string;
  url: string;
  mimeType?: string;
  size?: number;
  objectKey?: string;
};

export type ChecklistItem = {
  id: string;
  text: string;
  completed: boolean;
};

export type Note = {
  id: string;
  title: string;
  content: string;
  folderId: string | null;
  groupId: string | null;
  tags: string[];
  checklist: ChecklistItem[];
  attachments: Attachment[];
  pinned: boolean;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  position: number;
};

export type Folder = {
  id: string;
  name: string;
  parentId: string | null;
  color: string;
  position: number;
};

export type Group = {
  id: string;
  name: string;
  color: string;
  position: number;
};

export type Workspace = {
  version: 1;
  notes: Note[];
  folders: Folder[];
  groups: Group[];
};

export type NoteFilter = "all" | "inbox" | "pinned" | "archived" | "links" | "files";

export type NoteQuery = {
  search: string;
  filter: NoteFilter;
  folderId: string | null;
  groupId: string | null;
};

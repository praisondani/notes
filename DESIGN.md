# Design

## Mood

A person writing in a quiet home office, switching between keyboard and trackpad while notes stay legible and visually still.

## Color strategy

Restrained: pure white content surfaces, cool neutral panels, deep moss for primary actions and selection, amber only for lightweight status and metadata.

## Palette

All colors use OKLCH tokens so themes can be replaced without changing component structure.

```css
:root {
  --background: oklch(1 0 0);
  --foreground: oklch(0.22 0.02 160);
  --card: oklch(0.985 0.008 160);
  --card-foreground: oklch(0.22 0.02 160);
  --popover: oklch(1 0 0);
  --popover-foreground: oklch(0.22 0.02 160);
  --primary: oklch(0.46 0.11 160);
  --primary-foreground: oklch(0.98 0.01 160);
  --secondary: oklch(0.95 0.015 160);
  --secondary-foreground: oklch(0.29 0.035 160);
  --muted: oklch(0.94 0.012 160);
  --muted-foreground: oklch(0.48 0.03 160);
  --accent: oklch(0.72 0.12 76);
  --accent-foreground: oklch(0.22 0.03 76);
  --destructive: oklch(0.56 0.18 28);
  --destructive-foreground: oklch(0.98 0.01 28);
  --border: oklch(0.88 0.018 160);
  --input: oklch(0.84 0.022 160);
  --ring: oklch(0.46 0.11 160);
  --sidebar: oklch(0.975 0.01 160);
  --sidebar-foreground: oklch(0.29 0.035 160);
  --sidebar-border: oklch(0.9 0.016 160);
}

.dark {
  --background: oklch(0.16 0.018 160);
  --foreground: oklch(0.94 0.015 160);
  --card: oklch(0.2 0.022 160);
  --card-foreground: oklch(0.94 0.015 160);
  --popover: oklch(0.2 0.022 160);
  --popover-foreground: oklch(0.94 0.015 160);
  --primary: oklch(0.68 0.12 160);
  --primary-foreground: oklch(0.16 0.018 160);
  --secondary: oklch(0.26 0.03 160);
  --secondary-foreground: oklch(0.9 0.015 160);
  --muted: oklch(0.25 0.024 160);
  --muted-foreground: oklch(0.72 0.025 160);
  --accent: oklch(0.75 0.13 76);
  --accent-foreground: oklch(0.16 0.018 160);
  --destructive: oklch(0.66 0.16 28);
  --destructive-foreground: oklch(0.16 0.018 160);
  --border: oklch(0.33 0.03 160);
  --input: oklch(0.36 0.035 160);
  --ring: oklch(0.68 0.12 160);
  --sidebar: oklch(0.19 0.022 160);
  --sidebar-foreground: oklch(0.9 0.015 160);
  --sidebar-border: oklch(0.31 0.028 160);
}
```

## Typography

Use a single system sans stack: `ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`. Use a compact product scale: 12px metadata, 13px navigation, 14px body controls, 16px note body, 24px page title. Use `text-wrap: balance` for headings and `text-wrap: pretty` for note excerpts.

## Layout

- Three-pane desktop workspace: navigation, note list, editor.
- Collapse to one active pane on narrow screens with explicit back navigation.
- Sidebar width 224px, note list width 320px, editor fills remaining space.
- Use 8px spacing steps with 12px and 16px control radii; no oversized rounded cards.
- Keep borders quiet and use elevation only for floating menus and dialogs.

## Components

Use shadcn/ui conventions and Radix primitives where they help: Button, Input, Textarea, DropdownMenu, Dialog, Command, Tooltip, Tabs, Badge, ScrollArea, Separator, and Toast. Keep component variants small and predictable. Every interactive state needs default, hover, focus-visible, active, disabled, loading, and error treatment.

## Interaction

- `⌘/Ctrl K`: command palette.
- `⌘/Ctrl N`: new note.
- `⌘/Ctrl Shift F`: focus search.
- `⌘/Ctrl S`: save current note.
- `⌘/Ctrl Shift P`: toggle pinned state.
- `Escape`: close overlays, cancel rename, or return focus to the editor.
- Arrow keys move through navigation and note lists; Enter activates; Space toggles selection where applicable.
- Drag and drop supports moving notes into folders and reordering notes within a group. All drag actions have keyboard equivalents.

## Motion

Use 150–200ms ease-out transitions for selection, panel changes, and toasts. Avoid decorative page-load animation. Respect `prefers-reduced-motion: reduce` by disabling transforms and reducing transitions to instant state changes.

# Changelog

All notable changes are documented here.

## [0.6.7] - 2026-11-24

### Added

- MCP initialize now returns shared agent-brain instructions that tell any client to call `get_agent_context` and `remember`.
- MCP server version is read from `package.json`.

## [0.6.4] - 2026-11-23

### Fixed

- OAuth refresh without a `scope` parameter now keeps the originally granted scopes instead of collapsing to `notes:read`.
- Refresh tokens that already lost `notes:write` are healed from the client's grant history on the next refresh.

### Changed

- Refresh tokens last 180 days by default and slide forward on each use.
- Access and refresh TTLs are configurable with `MCP_OAUTH_ACCESS_TOKEN_TTL_SECONDS` and `MCP_OAUTH_REFRESH_TOKEN_TTL_DAYS`.
- Settings shows each connected agent's granted scopes plus access/refresh expiry.

## [0.6.3] - 2026-11-22

### Added

- Markdown editing with a sanitized preview toggle for headings, lists, code, tables, links, images, and task checkboxes.
- Paste or drop images into the note body; uploads insert Markdown image syntax and attachment metadata.
- MCP tools `upload_image` and `upload_file` for URL or base64 payloads with MIME allowlists and a 25 MB size limit.

## [0.6.2] - 2026-11-22

### Fixed

- Default OAuth scopes and WWW-Authenticate now advertise `notes:read` and `notes:write`, so agents that omit `scope` get write access when the owner consents.
- Notes created or updated through MCP record optional `createdBy` / `updatedBy` client attribution.

### Security

- Upgrade Next.js to 16.4.6.
- Raise `@hono/node-server`, `hono`, `eslint`, and `minimatch` overrides/dependencies so `npm audit --audit-level=low` is clean.

## [0.6.1] - 2026-10-29

### Security

- Update the MCP server's Hono adapter to fix GHSA-rmxm-3fg6-px4f.

## [0.6.0] - 2026-08-22

### Added

- Arbitrary-depth folder trees with expandable and collapsible branches.
- Subfolder creation, same-group drag-to-reparent, and cycle protection.
- Clickable folder breadcrumbs in the note list and editor.

## [0.5.0] - 2026-08-22

### Added

- Groups are now project hubs that contain direct notes and group-owned folder trees.
- Group-aware folder creation, note placement, drag-and-drop, MCP CRUD, and deletion behavior.

### Changed

- Workspace schema migrated to version 2 with backward-compatible legacy workspace normalization.
- Deleting a group makes its folders global while preserving notes in their folder locations.

## [0.4.0] - 2026-08-21

### Added

- Browser-based MCP OAuth with protected-resource and authorization-server discovery.
- S256 PKCE consent flow, dynamic client registration, authorization-code exchange, refresh-token rotation, and token revocation.
- Settings controls for viewing and revoking connected agents.
- Codex and Cursor connection instructions with a safe bearer-token fallback.

### Security

- OAuth access tokens are resource-bound and stored only as hashes.
- Authorization requests require the authenticated Notes owner and exact redirect URI validation.

## [0.2.1] - 2026-08-21

### Changed

- Renamed the application, package, Docker deployment, MCP identity, and repository-facing metadata to Notes.

## [0.2.0] - 2026-08-20

### Added

- Authenticated Streamable HTTP and local stdio MCP transports.
- Scoped note, folder, group, and attachment metadata CRUD tools.
- Local lexical search and citation-bearing RAG resources.
- Hashed, revocable MCP token CLI and deployment configuration.

### Changed

- Workspace writes now use serialized atomic updates for concurrent web and agent access.

## [0.1.0] - 2026-08-20

### Added

- Initial Next.js web workspace.
- Notes, folders, groups, filters, search, tags, checklists, links, images, and files.
- Local persistence, optional S3-compatible storage, Docker install, CI, and SSH deployment workflow.
- Keyboard and mouse parity for core note actions.

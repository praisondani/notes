# Changelog

All notable changes are documented here.

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

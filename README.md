# Notes

Notes is a minimal, self-hostable private note workspace for text, images, files, links, checklists, folders, groups, filters, and search. It runs in a browser and keeps keyboard and mouse actions at parity.

Version `0.5.0` adds project-hub groups with group-owned folder trees, direct group notes, and backward-compatible workspace migration. Browser-based OAuth for MCP agents, PKCE authorization, token rotation and revocation, and connected-agent controls are included; sync conflict resolution and native clients remain future work.

## Features

- Three-pane desktop workspace with a focused editor.
- Responsive mobile layout with explicit pane navigation.
- Text notes, checklists, tags, links, images, and files.
- Groups act as project hubs for direct notes and their folder trees; folders remain each note's physical location.
- Pinned notes, archive, filters, and full-text search across note metadata.
- Native drag-and-drop for moving notes into folders or group roots and reordering the note list.
- Keyboard parity: `⌘/Ctrl K`, `⌘/Ctrl N`, `⌘/Ctrl Shift F`, `⌘/Ctrl Shift P`, `⌘/Ctrl S`, arrows, Enter, and Escape.
- Local JSON persistence by default; S3-compatible object storage for attachments.
- Owner account with username or email sign-in, salted password hashes, signed sessions, same-origin checks, login throttling, and password rotation.
- Authenticated MCP server for agent-connected CRUD, resources, search, and local RAG, with OAuth for browser-based clients and bearer-token fallback for scripts.
- shadcn/ui-style components built from Radix primitives.
- Instant navigation shell powered by Next.js Cache Components, with private workspace data kept behind the authenticated boundary.

## Run locally

Requirements: Node.js 20.9+ and npm.

```sh
cp .env.example .env
npm install
npm run dev
```

Open `http://localhost:3000`.

Run checks before opening a pull request:

```sh
npm run check
```

Next.js development does not prefetch in-app navigations. Use `npm run build && npm run start` or the standalone Docker server when checking production navigation behavior. See the [Next.js instant navigation guide](https://nextjs.org/docs/app/guides/instant-navigation) for the framework model and debugging tools.

## One-command self-hosting

With Docker installed:

```sh
./scripts/install.sh
```

The script creates `.env` if it does not exist, generates a private `AUTH_SECRET`, builds the production image, and starts Notes with a persistent Docker volume. Create the owner account in the browser, then add any R2 values to `.env`. On Windows, run the same workflow from WSL or use PowerShell:

```powershell
Copy-Item .env.example .env
docker compose up -d --build
```

When using the PowerShell path, replace the `AUTH_SECRET` placeholder in `.env` with a long random value before the first start.

Docker keeps the runtime and volume layout the same across Linux, macOS, Windows, and WSL.

## Configuration

Copy `.env.example` to `.env`.

- `DATA_DIR`: local workspace and upload path. Defaults to `./data`.
- `AUTH_USERNAME`, `AUTH_EMAIL`: optional values used for the first-run owner account or legacy password migration.
- `AUTH_PASSWORD`: legacy bootstrap password. If `data/auth.json` does not exist, Notes migrates this value once into a salted password hash. New installs can create the owner account in the browser instead.
- `AUTH_SECRET`: long random value used to sign session cookies. Required in production.
- `MCP_RESOURCE_URL`: optional canonical MCP resource URL. Defaults to `${APP_URL}/api/mcp`; leave empty for normal installs.
- `MCP_ACCESS_TOKEN`: optional legacy bearer token for HTTP MCP. OAuth clients do not need this value.
- `MCP_ACCESS_TOKEN_SCOPES`: comma-separated scopes for the environment token. Use `notes:read` for read-only access or add `notes:write` for CRUD.
- `MCP_ALLOWED_HOSTS`: exact `Host` values accepted by the MCP endpoint. Set this to the public hostname and port used by your reverse proxy; HTTP MCP fails closed if this and `APP_URL` are both missing.
- `MCP_ALLOWED_ORIGINS`: exact browser origins allowed to call MCP. Leave empty for native agent clients without browser CORS.
- `MCP_RATE_LIMIT_PER_MINUTE`: per-token in-memory request limit. Keep a reverse-proxy limit in front of public deployments.
- `S3_ENDPOINT`: any S3-compatible endpoint. For Cloudflare R2, use `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`.
- `S3_REGION`: use `auto` for R2.
- `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`: object storage credentials.
- `S3_PUBLIC_URL`: optional public or CDN URL prefix. Without it, Notes returns a seven-day signed URL for S3 objects.

Without S3 values, attachments are stored under `DATA_DIR/uploads`. This makes local development and private single-server installs work without a cloud account.

## MCP server

Notes exposes a standard MCP Streamable HTTP endpoint at `/api/mcp`. It supports OAuth 2.1-style authorization-code flow with S256 PKCE, dynamic client registration, protected-resource discovery, refresh-token rotation, and browser consent. OAuth access tokens are bound to the MCP resource and are never accepted in URLs or query parameters. The existing bearer-token flow remains available for scripts and older clients.

### Connect Codex or Cursor with browser sign-in

Use the public MCP URL with a client that supports remote OAuth:

```sh
codex mcp add notes --url https://notes.example.com/api/mcp
```

Codex discovers Notes’ OAuth metadata and opens a browser. Sign in, review the requested scopes, and approve the connection. In Cursor, add the same URL from its MCP settings; it will use the same browser consent flow. You can revoke either connection from **Settings → Data and connections**.

If Codex reports an invalid reasoning-effort value before it runs the command, update `~/.codex/config.toml` so it contains:

```toml
model_reasoning_effort = "xhigh"
```

Then retry the command. Do not pass a raw token to `--bearer-token-env-var`; that option expects the name of an environment variable.

For multiple agents, create revocable credentials. The raw token is printed once and the data directory stores only its SHA-256 hash:

```sh
npm run mcp:token -- create --label coding-agent --scopes notes:read,notes:write
npm run mcp:token -- list
npm run mcp:token -- revoke <token-id>
```

For the Docker install, run the same command inside the container:

```sh
docker compose exec notes node scripts/mcp-token.mjs create --label coding-agent --scopes notes:read
```

For a client without OAuth support, use a legacy bearer token. Create it on the server and keep the value in a local secret manager or environment variable:

```sh
export NOTES_MCP_TOKEN='paste-the-one-time-token-here'
codex mcp add notes --url https://notes.example.com/api/mcp --bearer-token-env-var NOTES_MCP_TOKEN
```

An equivalent remote-client configuration is:

```json
{
  "mcpServers": {
    "notes": {
      "url": "https://notes.example.com/api/mcp",
      "headers": {
        "Authorization": "Bearer cnd_mcp_replace_me"
      }
    }
  }
}
```

For a local coding agent, use stdio. The process reads and writes the configured `DATA_DIR` directly and does not open a network listener:

```sh
npm run mcp:stdio
```

Set `MCP_STDIO_READ_ONLY=1` when the local agent should not mutate notes.

The MCP surface includes `list_notes`, `get_note`, `create_note`, `update_note`, `delete_note`, attachment metadata operations, folder and group CRUD, `search_notes`, `rag_query`, and `workspace_summary`. It also exposes `notes://workspace` and `notes://notes/{noteId}` resources. `rag_query` is a private lexical retriever with bounded, cited context; it does not call an embedding provider or send note data to an external service. Binary files are not accepted as MCP payloads.

Use a read-only token whenever an agent only needs retrieval. Store tokens in the agent's secret configuration, never in source control, prompts, URLs, screenshots, or logs.

This release has one private workspace per deployment. The owner account that approves an OAuth connection controls access to that deployment; all valid legacy bearer tokens for the same deployment access that workspace.

## Cloudflare R2

R2 uses an S3-compatible API. Create a bucket with Wrangler, create an R2 API token with object read/write access, and add the values to `.env`:

```sh
npx wrangler login
npx wrangler r2 bucket create notes
```

```dotenv
S3_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
S3_REGION=auto
S3_BUCKET=notes
S3_ACCESS_KEY_ID=<R2_ACCESS_KEY_ID>
S3_SECRET_ACCESS_KEY=<R2_SECRET_ACCESS_KEY>
```

Keep R2 credentials server-side. They are never read by the browser bundle.

## Deploy to a Linux server

Clone the public repository on the server, create `.env`, set `AUTH_SECRET` and storage values, then run:

```sh
./scripts/install.sh
```

Put a TLS reverse proxy in front of port `3000`. The included GitHub Actions workflow expects these repository secrets:

- `DEPLOY_HOST`
- `DEPLOY_USER`
- `DEPLOY_PATH`
- `DEPLOY_SSH_KEY`

The workflow runs checks, then deploys version tags over SSH. It does not contain any maintainer-specific account, bucket, or host value. On first launch, create the owner account in the browser; older installs using `AUTH_PASSWORD` are migrated automatically on the first auth request.

## Architecture

- Next.js App Router and React 19 for the web client and server routes.
- TypeScript domain functions in `src/lib/notes.ts` with Vitest coverage.
- File-backed workspace adapter for a small, portable default install.
- S3-compatible attachment adapter that works with R2, MinIO, AWS S3, and similar services.
- Docker standalone output for server installs.

The storage boundary is intentionally replaceable. A future release can add SQLite or a remote database without changing the note editor contract.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Changes should include tests for domain behavior and keep keyboard access equivalent to pointer access.

## Security

See [SECURITY.md](SECURITY.md). Create an owner account, set `AUTH_SECRET`, and use HTTPS before exposing an instance publicly.

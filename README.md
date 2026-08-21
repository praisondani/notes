# Notes

Notes is a minimal, self-hostable private note workspace for text, images, files, links, checklists, folders, groups, filters, and search. It runs in a browser and keeps keyboard and mouse actions at parity.

Version `0.2.1` is the Notes rename release. The web client and local deployment path are usable; group collaboration, sync conflict resolution, and native clients are future work.

## Features

- Three-pane desktop workspace with a focused editor.
- Responsive mobile layout with explicit pane navigation.
- Text notes, checklists, tags, links, images, and files.
- Folders, groups, pinned notes, archive, filters, and full-text search across note metadata.
- Native drag-and-drop for moving notes into folders and reordering the note list.
- Keyboard parity: `⌘/Ctrl K`, `⌘/Ctrl N`, `⌘/Ctrl Shift F`, `⌘/Ctrl Shift P`, `⌘/Ctrl S`, arrows, Enter, and Escape.
- Local JSON persistence by default; S3-compatible object storage for attachments.
- Optional single-user password gate for private deployments.
- Authenticated MCP server for agent-connected CRUD, resources, search, and local RAG.
- shadcn/ui-style components built from Radix primitives.

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

## One-command self-hosting

With Docker installed:

```sh
./scripts/install.sh
```

The script creates `.env` if it does not exist, builds the production image, and starts Notes with a persistent Docker volume. On Windows, run the same workflow from WSL or use PowerShell:

```powershell
Copy-Item .env.example .env
docker compose up -d --build
```

Docker keeps the runtime and volume layout the same across Linux, macOS, Windows, and WSL.

## Configuration

Copy `.env.example` to `.env`.

- `DATA_DIR`: local workspace and upload path. Defaults to `./data`.
- `AUTH_PASSWORD`: optional single-user password. Set this before exposing Notes publicly.
- `AUTH_SECRET`: long random value used to sign the session cookie.
- `MCP_ACCESS_TOKEN`: optional single bearer token for HTTP MCP. Leave empty to keep HTTP MCP disabled.
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

Notes exposes a standard MCP Streamable HTTP endpoint at `/api/mcp`. It is stateless, bearer-authenticated, and disabled until a token is configured. Tokens are never accepted in URLs or query parameters.

For multiple agents, create revocable credentials. The raw token is printed once and the data directory stores only its SHA-256 hash:

```sh
npm run mcp:token -- create --label coding-agent --scopes notes:read,notes:write
npm run mcp:token -- list
npm run mcp:token -- revoke <token-id>
```

Connect any MCP client that supports remote servers with a configuration like this:

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

This release has one private workspace per deployment. All valid MCP tokens for the same deployment access that workspace; per-user workspace isolation and OAuth are future extensions.

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

Clone the public repository on the server, create `.env`, set a password and storage values, then run:

```sh
./scripts/install.sh
```

Put a TLS reverse proxy in front of port `3000`. The included GitHub Actions workflow expects these repository secrets:

- `DEPLOY_HOST`
- `DEPLOY_USER`
- `DEPLOY_PATH`
- `DEPLOY_SSH_KEY`

The workflow runs checks, then deploys version tags over SSH. It does not contain any maintainer-specific account, bucket, or host value.

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

See [SECURITY.md](SECURITY.md). Do not run a public instance with an empty `AUTH_PASSWORD` unless another access-control layer protects it.

# Security policy

Create the owner account and set a long random `AUTH_SECRET` before exposing an instance to a network. Put Notes behind HTTPS and a reverse proxy. Keep object-store credentials server-side and grant only the bucket permissions Notes needs.

Notes stores the owner password as a salted `scrypt` hash in `DATA_DIR/auth.json`; it never stores the plaintext password. Usernames and email addresses are normalized for sign-in, passwords must be at least 12 characters, sessions are HMAC-signed and `HttpOnly`, and failed sign-in attempts are throttled per client and identifier. Set a reverse-proxy request limit as an additional protection for public deployments.

## Rotate the password

While signed in, open **Settings → Security**, enter the current password, and choose **Rotate password**. The account’s session version changes, so older sessions are invalidated.

For an existing install that still uses `AUTH_PASSWORD`, the value is migrated once when `DATA_DIR/auth.json` is absent. Sign in with the legacy password, rotate it in Settings, then remove `AUTH_PASSWORD` from `.env` and restart Notes.

If the current password is lost, use a server-side recovery procedure:

1. Stop Notes and back up `DATA_DIR/auth.json` to a separate file.
2. Move `DATA_DIR/auth.json` out of the data directory so it is not loaded.
3. Set `AUTH_USERNAME`, `AUTH_EMAIL`, and a new temporary `AUTH_PASSWORD` in `.env`, then start Notes.
4. Sign in with that bootstrap password, rotate it in Settings, remove `AUTH_PASSWORD` from `.env`, and restart Notes.

The workspace remains in the other files under `DATA_DIR`; only the account file is replaced. Keep the backup private and remove the temporary password from shell history and service logs.

### MCP OAuth and agent access

HTTP MCP supports browser-based OAuth with S256 PKCE. Dynamic clients register exact HTTPS or loopback redirect URIs, consent is tied to the signed-in owner account, authorization codes are single-use, access tokens are bound to the configured MCP resource, and refresh tokens rotate. Only token hashes are stored under `DATA_DIR/mcp-oauth.json`. Revoke connected clients from **Settings → Data and connections**; revocation invalidates their access and refresh tokens.

OAuth is the preferred flow for Codex, Cursor, and other remote clients. The legacy bearer flow remains available for scripts: generate file-backed tokens with `npm run mcp:token`; only a SHA-256 hash is stored under `DATA_DIR/mcp-tokens.json`, and a token can be revoked by ID. Use `notes:read` for retrieval-only agents. Configure `MCP_ALLOWED_HOSTS` (or `APP_URL`); the endpoint fails closed without a host allowlist. For browser-based clients that call MCP directly from a web page, configure an exact `MCP_ALLOWED_ORIGINS` allowlist. Local stdio is intended only for an agent process you trust because it can access the local workspace according to `MCP_STDIO_READ_ONLY`.

Use HTTPS in production. Never paste OAuth or bearer tokens into prompts, URLs, source code, screenshots, or support chats. If a token is exposed, revoke the connected client or file-backed token immediately and issue a replacement.

The MCP RAG implementation is local lexical retrieval. Notes does not make embedding or model-provider calls. Note data is returned only after bearer authentication and only when an agent explicitly requests a read tool or resource.

Please do not report vulnerabilities in public issues. Send a private report to the repository maintainers with reproduction steps, impact, and a proposed mitigation.

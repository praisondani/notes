# Security policy

Set `AUTH_PASSWORD` and a long random `AUTH_SECRET` before exposing an instance to a network. Put Notes behind HTTPS and a reverse proxy. Keep object-store credentials server-side and grant only the bucket permissions Notes needs.

HTTP MCP requires a bearer token with an explicit scope. Generate file-backed tokens with `npm run mcp:token`; only a SHA-256 hash is stored under `DATA_DIR/mcp-tokens.json`, and a token can be revoked by ID. Use `notes:read` for retrieval-only agents. Configure `MCP_ALLOWED_HOSTS` (or `APP_URL`); the endpoint fails closed without a host allowlist. For browser-based clients, configure an exact `MCP_ALLOWED_ORIGINS` allowlist. Local stdio is intended only for an agent process you trust because it can access the local workspace according to `MCP_STDIO_READ_ONLY`.

The MCP RAG implementation is local lexical retrieval. Notes does not make embedding or model-provider calls. Note data is returned only after bearer authentication and only when an agent explicitly requests a read tool or resource.

Please do not report vulnerabilities in public issues. Send a private report to the repository maintainers with reproduction steps, impact, and a proposed mitigation.

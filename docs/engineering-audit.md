# Engineering audit and hardening

**Reviewed:** 2026-11-26
**Branch:** `codex/production-readiness-audit`
**Status:** Ready for human review; not deployed.

## Executive summary

This review covered the Notes web app, its owner authentication, JSON-backed workspace and OAuth stores, MCP HTTP/stdio integration, local and S3 attachment paths, and the Docker/GitHub deployment configuration. The app is a self-hosted, single-owner notes workspace. The web tier uses Next.js App Router and React; workspace, credentials, MCP tokens, and OAuth state are stored as files under `DATA_DIR`.

The changes address unbounded request parsing, cross-origin state changes, stale workspace overwrites, weak file permissions, active uploaded content, unbounded OAuth state, spoofable client-address headers, incomplete readiness checks, and several keyboard and save-status problems. No production data, S3 account, payment provider, or external delivery service was used.

No critical or high-severity issue was confirmed in the reviewed paths. This is not a claim that the application is vulnerability-free. Public S3 object access, distributed rate limits, general CSP coverage, large workspace compatibility, and multi-instance file-store behavior need the follow-up actions below.

## Architecture and scope

- **Web:** Next.js 16.4.6 App Router, React 19, TypeScript, Tailwind CSS, standalone Node deployment.
- **Authentication:** One owner account; password hashes use Node `scrypt`; session cookies are HTTP-only, SameSite Lax, and secure in production. `AUTH_SECRET` signs sessions.
- **Persistence:** Workspace, auth, MCP bearer-token, and OAuth state are JSON files in `DATA_DIR`; updates use temp files and rename. The workspace is also changed by MCP tools.
- **Integrations:** MCP SDK over HTTP and stdio, OAuth authorization-code flow with PKCE, optional S3-compatible attachment storage.
- **Deployment:** Docker Compose runs as a non-root user with a read-only root filesystem; the release workflow is manual. The GitHub PR workflow runs `npm ci`, `npm audit`, and `npm run check`.
- **Reviewed paths:** `app/api/**`, `app/oauth/**`, `src/lib/auth*`, `src/lib/workspace-store.ts`, `src/lib/storage.ts`, MCP HTTP/OAuth/service code, notes and settings UI, `next.config.ts`, Docker Compose, README, and CI/deploy workflow.

Repository guidance in `AGENTS.md`, `README.md`, `CONTRIBUTING.md`, `SECURITY.md`, `DESIGN.md`, and `PRODUCT.md` was read before implementation. The implementation preserves the file-backed architecture and current product flows.

## Findings and remediations

### Medium — HTTP request bodies were parsed without byte limits

**Evidence:** Several JSON handlers used `request.json()` and uploads used `request.formData()` before enforcing a size limit. A missing or false `Content-Length` could therefore cause large bodies to be buffered and parsed.

**Fix:** Added a streaming byte counter in `src/lib/request-body.ts`. Auth/profile requests, OAuth requests, workspace writes, MCP HTTP, and multipart uploads now enforce endpoint-specific limits against bytes actually read. Attachment storage also checks its 25 MiB object limit independently. Upload parsing no longer makes an additional full-size buffer copy.

**Regression and verification:** Unit coverage tests oversized streams without `Content-Length`. A production standalone-server smoke test sent oversized workspace and OAuth registration streams and received 413 responses. Valid owner setup, OAuth registration, and normal upload also succeeded.

**Affected areas:** `src/lib/request-body.ts`, auth and OAuth route handlers, `app/api/workspace/route.ts`, `app/api/attachments/route.ts`, `src/mcp/http.ts`.

### Medium — Concurrent full-workspace saves could overwrite newer data

**Evidence:** Browser autosave replaces the full workspace while MCP can update the same JSON file. A browser snapshot loaded before an MCP mutation could overwrite that newer version.

**Fix:** Workspace reads now return a SHA-256 revision. Browser writes send it in `If-Match`; server writes compare revisions while holding the filesystem lock and return 412 for a genuine conflict. An identical replay is accepted idempotently if the original response was lost. The UI keeps edits on a conflict, offers a download, and requires confirmation before loading the saved copy.

**Regression and verification:** Tests cover stale writes after an MCP-style update, idempotent retries, and UI preservation/no-retry behavior. The local production smoke test verified successful write, successful replay, and 412 for a genuinely stale write.

**Affected areas:** `src/lib/workspace-store.ts`, `app/api/workspace/route.ts`, `src/components/notes-app.tsx`.

### Medium — Cookie-authenticated mutations lacked consistent origin checks

**Evidence:** Cross-origin form or fetch requests to cookie-authenticated mutation routes could reach state-changing handlers without a consistent same-origin gate.

**Fix:** Added same-origin checks to account, workspace, OAuth client/consent, logout, and attachment mutations. The check rejects `Sec-Fetch-Site: cross-site` and mismatched `Origin` values.

**Regression and verification:** A synthetic cross-origin multipart upload was rejected with 403. Route-level unit coverage and the full regression suite passed. Other route-specific cross-origin cases were inspected but not each exercised through a live browser.

**Affected areas:** `src/lib/auth.ts`, `app/api/auth/**`, `app/api/workspace/route.ts`, `app/api/oauth/**`, `app/oauth/clients/route.ts`, `app/api/attachments/route.ts`.

### Medium — Forwarded client-address headers could be spoofed, and the safe default could lock out everyone

**Evidence:** Login and OAuth throttling previously trusted caller-supplied forwarding headers. In the absence of a trusted address, using one shared `unknown` login key also let five invalid attempts block all logins in that process.

**Fix:** Client addresses are now read only when `TRUST_PROXY_HEADERS=1`; login throttling is skipped when no trusted address exists rather than applying a global lockout. OAuth and MCP in-memory rate maps are bounded and pruned. README guidance requires the proxy to overwrite address headers and recommends proxy-side limits.

**Regression and verification:** Tests verify that untrusted headers do not split address identity and that the opt-in path uses proxy addresses. OAuth request throttling tests cover the default and configured paths.

**Affected areas:** `src/lib/client-address.ts`, login and OAuth/MCP rate limiters, `.env.example`, `README.md`.

**Deployment action:** Before exposing an instance, configure reverse-proxy rate limits for login, OAuth, and MCP. Set `TRUST_PROXY_HEADERS=1` only if the proxy overwrites the relevant headers. App-local rate state is process-local and does not coordinate across replicas.

### Medium — Private data files could inherit permissive existing modes

**Evidence:** File creation requested restrictive modes, but existing files and directories were not consistently corrected when loaded.

**Fix:** Workspace, auth, MCP token, and OAuth reads repair the `DATA_DIR` mode to 0700 and the corresponding private JSON file to 0600. Writes use private temporary files and atomic rename. Workspace lock files include an owner token, refresh their timestamp while held, and only release a lock they still own. Stale-lock reclamation checks the process, inode, and owner before removal.

**Regression and verification:** Tests deliberately loosen existing directory and file modes and verify that loading repairs them. Locking and file permissions were also reviewed in code. A real multi-process kill/recovery race was not stress-tested.

**Affected areas:** `src/lib/workspace-store.ts`, `src/lib/auth-store.ts`, `src/lib/mcp-auth.ts`, `src/lib/mcp-oauth.ts`, storage tests.

### Medium — Local uploads could be shared-cached or execute as same-origin SVG

**Evidence:** Local upload responses previously used public caching and served SVG with its active MIME type. S3 metadata also accepted active HTML/SVG-like types.

**Fix:** Local objects are private/no-store and send `nosniff`; SVG responses add `Content-Security-Policy: sandbox; default-src 'none'`. S3 uploads with HTML/XML/SVG/script/CSS-like MIME types or extensions are forced to `application/octet-stream` and attachment disposition.

**Regression and verification:** Storage tests cover active S3 MIME handling. The local production smoke test uploaded a synthetic SVG containing a script element and verified private/no-store, `nosniff`, and sandbox headers.

**Affected areas:** `app/api/uploads/[key]/route.ts`, `app/api/attachments/route.ts`, `src/lib/storage.ts`.

### Medium — OAuth state could grow without bound

**Evidence:** Public dynamic registration, pending requests, authorization codes, and old token histories were persisted without lifecycle caps.

**Fix:** Added caps for registered clients, pending requests, codes, active access/refresh tokens, and retained revoked-token history. Expired records, revoked clients, and unused old registrations are pruned during mutations. OAuth private-store files also receive restrictive modes.

**Regression and verification:** Tests cover registration capacity, revoked-client cleanup, OAuth refresh behavior, and existing store permission repair. Local HTTP smoke verified DCR success and rejection of a streamed request above the 64 KiB body limit.

**Affected areas:** `src/lib/mcp-oauth.ts`, `src/lib/mcp-oauth.test.ts`, `app/oauth/register/route.ts`.

**Remaining risk:** Dynamic registration is public by design. The persistent cap can still be exhausted by sufficiently distributed registrations before unused clients expire. The in-memory rate limit is not a substitute for an edge/proxy limit.

### Low — Readiness ignored session-secret validity and the app lacked baseline response headers

**Evidence:** The health route checked workspace access only; it could report ready while production authentication could not sign sessions. General framing, MIME-sniffing, referrer, and device-permission headers were absent.

**Fix:** Production requires a non-placeholder `AUTH_SECRET` of at least 32 bytes. Health returns 503 when it is missing/short; setup and login fail closed before mutating auth state. Added `nosniff`, `DENY` framing, strict-origin referrer policy, and a permissions policy. Compose and deploy probes use `/api/health`.

**Regression and verification:** Unit tests validate secret requirements. In isolated production servers, a valid secret returned health 200; a missing secret returned 503 and first-run setup returned 503 without creating `auth.json`. Response headers were checked in the valid-secret smoke test.

**Affected areas:** `src/lib/auth.ts`, `app/api/auth/login/route.ts`, `app/api/auth/setup/route.ts`, `app/api/health/route.ts`, `next.config.ts`, Docker Compose, deploy workflow.

### Low — Keyboard focus and save feedback were incomplete

**Evidence:** Theme options lacked arrow-key roving focus, Home/End could change note selection without moving focus, and save/conflict states were not announced consistently.

**Fix:** Added arrow/Home/End behavior for theme options, moves focus with Home/End note selection, and uses live status/alert regions. Conflict and oversized-workspace states preserve edits and offer a JSON download.

**Regression and verification:** Added component tests for keyboard focus, conflict handling, and 413 feedback. The full Vitest suite passed. Browser/assistive-technology checks could not run on this host; see limitations.

**Affected areas:** `src/components/settings-screen.tsx`, `src/components/notes-app.tsx`, related component tests.

## Performance measurements

- A bounded local ApacheBench run against the production health endpoint used 100 requests at concurrency 5: **221.27 requests/sec**, **22.6 ms mean request latency**, **31 ms p95**, **32 ms maximum**, and **0 failed requests**. This is a local synthetic health check, not a representative editor workload or production capacity claim.
- Request parsing now returns its final `ArrayBuffer` directly to multipart/MCP parsing. This removes one additional full-size copy (up to roughly 26 MiB for the attachment request limit) per active upload. This allocation reduction is based on the code path; a heap profile was not collected.
- Build phase timings were **44.0 s compile / 17.1 s TypeScript / 2.1 s static generation** at baseline and **9.5 s / 9.3 s / 1.6 s** in the final run. Those builds had different cache state, so the timing difference is not attributed to these changes.
- No representative before/after application workload or production profile was available. The health probe has no pre-change measurement and must not be read as an optimization result.

## Verification actually run

- Initial baseline `npm run check`: passed with 16 test files and 105 tests before changes.
- Final `npm run check`: passed lint, **23 test files / 127 tests**, TypeScript, and optimized Next production build; all 23 app routes were generated/recognized.
- `npm audit --audit-level=low`: **0 vulnerabilities** reported across the installed dependency tree.
- `git diff --check`: passed.
- Secret-pattern scan matched two existing test files with synthetic example values; no real credential was identified. The fixture values were not copied into this report.
- Isolated production-server smoke tests covered setup, health, response headers, workspace conditional save/replay/conflict, CSRF rejection, private SVG delivery, oversized streamed workspace/OAuth requests, and missing-secret readiness behavior.
- A browser launch was attempted. Playwright had no installed browser; its Chromium installer does not support this macOS 12 host, and its Chrome installer required unavailable sudo credentials. No browser E2E, cross-browser, screenshot, or assistive-technology run is claimed.

## Remaining vulnerabilities and limitations

- `S3_PUBLIC_URL` intentionally returns public object URLs. The metadata hardening prevents common active content from rendering inline, but it does not make a public bucket private. Do not use it for private attachments unless public disclosure is intended; prefer a private bucket and signed URLs.
- Rate limits are in-memory, per process. With no trusted client address, app-level login throttling is intentionally skipped to avoid a global lockout. Public deployments need proxy limits and trusted header overwrites.
- OAuth state mutations are serialized within a process; the JSON-file architecture is not a distributed datastore. Multi-replica deployments sharing `DATA_DIR` are not verified and can still race in auth/OAuth state updates. Keep one app process per data volume or move these stores to a transactional shared backend before scaling horizontally.
- The new workspace request ceiling is 16 MiB. A larger existing workspace can be read but browser saves will receive 413. Check the deployed workspace file size before rollout; use Settings → Export before making any content changes if the file is near/over the limit. The UI now preserves and can download rejected local edits.
- A general nonce-based Content Security Policy was not added. Local SVG is sandboxed, but CSP coverage for the complete Next app remains future work.
- S3 request timeout and metadata paths were inspected, but no S3-compatible service or credentials were available for integration testing.
- No production DAST, fuzzing, mutation testing, multi-process stress test, backup restore drill, or sustained load test was run. Docker was not installed on this host, so Compose health behavior was not executed inside a container.

## Required manual actions

1. Verify production `AUTH_SECRET` is a random value of at least 32 bytes. Updating a short/placeholder value invalidates existing signed sessions, though it does not change the stored password.
2. Check `DATA_DIR/workspace.json` is below 16 MiB before rollout.
3. Configure reverse-proxy rate limits for `/api/auth/login`, `/oauth/*`, and `/api/mcp`; set `TRUST_PROXY_HEADERS=1` only when forwarding headers are overwritten by that proxy.
4. Decide whether S3 attachment URLs may be public. Leave `S3_PUBLIC_URL` unset for private attachments and keep the bucket private when using signed URLs.
5. Terminate HTTPS at the proxy and configure HSTS there if appropriate for the deployment domain.

## Deployment, rollback, and prioritized follow-up

No deployment or production workflow was triggered. There is no workspace schema migration. The `/api/workspace` PUT contract now requires a matching ETag in `If-Match`; any external caller of this internal route must be updated. MCP tools continue using their existing operations.

For rollback, revert this branch’s commits and rebuild/restart the prior version. Permission tightening is reversible with filesystem mode changes, and the JSON data format is unchanged. If rolling back after clients adopted `If-Match`, the Notes web UI will continue to work after reload because the prior endpoint ignored the extra header.

Prioritized follow-up:

1. Add shared-store or proxy-backed distributed throttling before running multiple replicas.
2. Add browser-based keyboard/mobile checks and a nonce-based CSP rollout with report-only monitoring.
3. Test S3 behavior against a private bucket and verify CDN handling of `Content-Disposition`.
4. Add a repeatable data restore drill and a realistic large-workspace performance profile.

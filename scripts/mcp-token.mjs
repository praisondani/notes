import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import path from "node:path";

const scopes = new Set(["notes:read", "notes:write"]);
const dataDirectory = path.resolve(process.env.DATA_DIR?.trim() || path.join(process.cwd(), "data"));
const tokenFile = path.join(dataDirectory, "mcp-tokens.json");

function usage() {
  console.log(`Usage:
  npm run mcp:token -- create [--label <name>] [--scopes notes:read,notes:write]
  npm run mcp:token -- list
  npm run mcp:token -- revoke <token-id>`);
}

function valueAfter(flag, args, fallback) {
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

function parseScopes(value) {
  const parsed = [...new Set(value.split(",").map((scope) => scope.trim()).filter(Boolean))];
  if (!parsed.length || parsed.some((scope) => !scopes.has(scope))) throw new Error("Scopes must be notes:read and/or notes:write");
  return parsed;
}

function hashToken(token) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

async function readStore() {
  try {
    const parsed = JSON.parse(await readFile(tokenFile, "utf8"));
    if (parsed.version !== 1 || !Array.isArray(parsed.tokens)) throw new Error("Invalid MCP token store");
    return parsed;
  } catch (error) {
    if (error.code === "ENOENT") return { version: 1, tokens: [] };
    throw error;
  }
}

async function writeStore(store) {
  await mkdir(dataDirectory, { recursive: true, mode: 0o700 });
  const temporary = `${tokenFile}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(store, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, tokenFile);
  await chmod(tokenFile, 0o600);
}

async function main() {
  const [action, ...args] = process.argv.slice(2);
  if (!action || action === "help" || action === "--help") {
    usage();
    return;
  }

  const store = await readStore();
  if (action === "create") {
    const label = valueAfter("--label", args, "MCP client").trim();
    if (!label || label.length > 100) throw new Error("Label must contain 1 to 100 characters");
    const rawToken = `cnd_mcp_${randomBytes(32).toString("base64url")}`;
    const record = {
      id: `mcp-token-${randomUUID()}`,
      label,
      tokenHash: hashToken(rawToken),
      tokenPrefix: rawToken.slice(0, 12),
      scopes: parseScopes(valueAfter("--scopes", args, "notes:read")),
      createdAt: new Date().toISOString(),
      revokedAt: null,
    };
    store.tokens.push(record);
    await writeStore(store);
    console.log(`Created ${record.id} (${record.label}). Store this token now; it will not be shown again:`);
    console.log(rawToken);
    return;
  }

  if (action === "list") {
    if (!store.tokens.length) {
      console.log("No MCP tokens.");
      return;
    }
    for (const token of store.tokens) {
      console.log(`${token.id}\t${token.label}\t${token.tokenPrefix}\t${token.scopes.join(",")}\t${token.revokedAt ? "revoked" : "active"}`);
    }
    return;
  }

  if (action === "revoke") {
    const tokenId = args[0];
    const token = store.tokens.find((candidate) => candidate.id === tokenId);
    if (!token) throw new Error("Token not found");
    token.revokedAt = new Date().toISOString();
    await writeStore(store);
    console.log(`Revoked ${token.id}.`);
    return;
  }

  usage();
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "MCP token command failed");
  process.exitCode = 1;
});

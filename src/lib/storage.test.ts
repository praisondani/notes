import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readLocalObject, safeS3ObjectMetadata, storeBytes } from "@/lib/storage";

let dataDirectory = "";
const originalEnvironment = { ...process.env };

beforeEach(async () => {
  dataDirectory = await mkdtemp(path.join(os.tmpdir(), "notes-storage-"));
  process.env.DATA_DIR = dataDirectory;
  delete process.env.S3_ENDPOINT;
  delete process.env.S3_BUCKET;
  delete process.env.S3_ACCESS_KEY_ID;
  delete process.env.S3_SECRET_ACCESS_KEY;
});

afterEach(async () => {
  process.env = { ...originalEnvironment };
  await rm(dataDirectory, { recursive: true, force: true });
});

describe("local attachment storage", () => {
  it("serves SVG uploads as downloads in S3 to prevent active same-origin content", () => {
    expect(safeS3ObjectMetadata("note.svg", "image/svg+xml")).toEqual({
      contentType: "application/octet-stream",
      contentDisposition: 'attachment; filename="attachment"',
    });
    expect(safeS3ObjectMetadata("payload.bin", "image/svg+xml; charset=utf-8")).toMatchObject({ contentType: "application/octet-stream" });
    expect(safeS3ObjectMetadata("payload.html", "text/html")).toMatchObject({ contentType: "application/octet-stream", contentDisposition: expect.stringContaining("attachment") });
    expect(safeS3ObjectMetadata("photo.png", "image/png")).toEqual({ contentType: "image/png" });
  });

  it("stores private upload bytes with restrictive directory and file modes", async () => {
    const stored = await storeBytes("private note.svg", "image/svg+xml", Buffer.from("<svg></svg>"));
    const uploadDirectory = path.join(dataDirectory, "uploads");
    const uploadPath = path.join(uploadDirectory, stored.key);

    expect((await stat(uploadDirectory)).mode & 0o777).toBe(0o700);
    expect((await stat(uploadPath)).mode & 0o777).toBe(0o600);
    expect(await readLocalObject(stored.key)).toEqual(Buffer.from("<svg></svg>"));
    await expect(readLocalObject("../auth.json")).rejects.toThrow("Invalid object key");
  });

  it("enforces the object-size limit at the storage boundary", async () => {
    const tooLarge = Buffer.alloc(25 * 1024 * 1024 + 1);
    await expect(storeBytes("large.bin", "application/octet-stream", tooLarge)).rejects.toThrow("25 MB or smaller");
  });
});

import "server-only";

import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

type StoredObject = {
  key: string;
  url: string;
  mimeType: string;
  size: number;
};

const MAX_STORED_OBJECT_BYTES = 25 * 1024 * 1024;

function s3Config() {
  const endpoint = process.env.S3_ENDPOINT?.trim();
  const bucket = process.env.S3_BUCKET?.trim();
  const accessKeyId = process.env.S3_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY?.trim();
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return null;
  return { endpoint, bucket, accessKeyId, secretAccessKey, region: process.env.S3_REGION?.trim() || "auto" };
}

function localUploadPath(key: string): string {
  const root = process.env.DATA_DIR?.trim() || path.join(process.cwd(), "data");
  return path.resolve(root, "uploads", key);
}

function safeKey(name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "file";
  return `${Date.now()}-${crypto.randomUUID()}-${base}`;
}

export function safeS3ObjectMetadata(name: string, mimeType: string): { contentType: string; contentDisposition?: string } {
  const normalizedType = mimeType.trim().toLowerCase().split(";", 1)[0] || "";
  const activeContentType = /(?:html|xhtml|svg|xml|javascript|ecmascript|css|xsl|xslt)/.test(normalizedType);
  if (activeContentType || /\.(?:html?|js|mjs|svg|xhtml|xml|xsl|xslt)$/i.test(name)) {
    return { contentType: "application/octet-stream", contentDisposition: 'attachment; filename="attachment"' };
  }
  return { contentType: normalizedType || "application/octet-stream" };
}

export async function storeBytes(name: string, mimeType: string, body: Buffer | Uint8Array): Promise<StoredObject> {
  const key = safeKey(name);
  const buffer = Buffer.isBuffer(body) ? body : Buffer.from(body);
  if (buffer.length > MAX_STORED_OBJECT_BYTES) throw new Error("Files must be 25 MB or smaller");
  const contentType = mimeType || "application/octet-stream";
  const config = s3Config();

  if (config) {
    const client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: true,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
      requestHandler: { connectionTimeout: 5_000, requestTimeout: 30_000, throwOnRequestTimeout: true },
    });
    try {
      const metadata = safeS3ObjectMetadata(name, contentType);
      await client.send(new PutObjectCommand({ Bucket: config.bucket, Key: key, Body: buffer, ContentType: metadata.contentType, ContentDisposition: metadata.contentDisposition }));
      const publicRoot = process.env.S3_PUBLIC_URL?.trim();
      const url = publicRoot ? `${publicRoot.replace(/\/$/, "")}/${encodeURIComponent(key)}` : await getSignedUrl(client, new GetObjectCommand({ Bucket: config.bucket, Key: key }), { expiresIn: 60 * 60 * 24 * 7 });
      return { key, url, mimeType: contentType, size: buffer.length };
    } finally {
      client.destroy();
    }
  }

  const filename = localUploadPath(key);
  const directory = path.dirname(filename);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  await writeFile(filename, buffer, { mode: 0o600 });
  await chmod(filename, 0o600);
  return { key, url: `/api/uploads/${encodeURIComponent(key)}`, mimeType: contentType, size: buffer.length };
}

export async function storeObject(file: File): Promise<StoredObject> {
  if (file.size > MAX_STORED_OBJECT_BYTES) throw new Error("Files must be 25 MB or smaller");
  return storeBytes(file.name, file.type || "application/octet-stream", Buffer.from(await file.arrayBuffer()));
}

export async function readLocalObject(key: string): Promise<Buffer> {
  if (key.includes("..") || key.includes("/") || key.includes("\\")) throw new Error("Invalid object key");
  return readFile(localUploadPath(key));
}

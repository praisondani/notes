import "server-only";

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

type StoredObject = {
  key: string;
  url: string;
  mimeType: string;
  size: number;
};

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

export async function storeObject(file: File): Promise<StoredObject> {
  const key = safeKey(file.name);
  const buffer = Buffer.from(await file.arrayBuffer());
  const config = s3Config();

  if (config) {
    const client = new S3Client({ endpoint: config.endpoint, region: config.region, forcePathStyle: true, credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey } });
    await client.send(new PutObjectCommand({ Bucket: config.bucket, Key: key, Body: buffer, ContentType: file.type || "application/octet-stream" }));
    const publicRoot = process.env.S3_PUBLIC_URL?.trim();
    const url = publicRoot ? `${publicRoot.replace(/\/$/, "")}/${encodeURIComponent(key)}` : await getSignedUrl(client, new GetObjectCommand({ Bucket: config.bucket, Key: key }), { expiresIn: 60 * 60 * 24 * 7 });
    return { key, url, mimeType: file.type || "application/octet-stream", size: file.size };
  }

  const filename = localUploadPath(key);
  await mkdir(path.dirname(filename), { recursive: true });
  await writeFile(filename, buffer);
  return { key, url: `/api/uploads/${encodeURIComponent(key)}`, mimeType: file.type || "application/octet-stream", size: file.size };
}

export async function readLocalObject(key: string): Promise<Buffer> {
  if (key.includes("..") || key.includes("/") || key.includes("\\")) throw new Error("Invalid object key");
  return readFile(localUploadPath(key));
}

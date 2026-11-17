import fs from "node:fs/promises";
import path from "node:path";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { AppConfig } from "../config/env";
import { hmacSha256, safeEqual } from "../lib/crypto";

/** Private object storage. Objects are never public; access is via short-lived signed links. */
export interface StorageDriver {
  readonly name: string;
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  /** Short-lived download URL. */
  signedUrl(key: string, opts: { fileName: string; contentType: string; ttlSeconds: number }): Promise<string>;
}

const SAFE_KEY = /^[a-zA-Z0-9/_.-]+$/;

export class LocalStorage implements StorageDriver {
  readonly name = "local";
  private root: string;
  constructor(private config: AppConfig) {
    this.root = path.resolve(config.STORAGE_LOCAL_DIR);
  }
  private resolve(key: string) {
    if (!SAFE_KEY.test(key) || key.includes("..")) throw new Error("invalid object key");
    const p = path.resolve(this.root, key);
    if (!p.startsWith(this.root + path.sep)) throw new Error("invalid object key");
    return p;
  }
  async put(key: string, data: Buffer) {
    const p = this.resolve(key);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, data, { mode: 0o600 });
  }
  async get(key: string) {
    return fs.readFile(this.resolve(key));
  }
  async signedUrl(key: string, opts: { fileName: string; contentType: string; ttlSeconds: number }) {
    const exp = Math.floor(Date.now() / 1000) + opts.ttlSeconds;
    const sig = signLocal(this.config.APP_SECRET, key, exp);
    const q = new URLSearchParams({ key, exp: String(exp), sig, name: opts.fileName });
    return `${this.config.publicApiUrl}/api/v1/files/blob?${q.toString()}`;
  }
}

export function signLocal(secret: string, key: string, exp: number): string {
  return hmacSha256(secret, `file:${key}:${exp}`, "base64url");
}

export function verifyLocalSignature(secret: string, key: string, exp: number, sig: string): boolean {
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false;
  return safeEqual(signLocal(secret, key, exp), sig);
}

export class S3Storage implements StorageDriver {
  readonly name = "s3";
  private client: S3Client;
  constructor(private config: AppConfig) {
    this.client = new S3Client({
      region: config.S3_REGION ?? "auto",
      endpoint: config.S3_ENDPOINT,
      forcePathStyle: config.S3_FORCE_PATH_STYLE,
      credentials: config.S3_ACCESS_KEY_ID ? { accessKeyId: config.S3_ACCESS_KEY_ID, secretAccessKey: config.S3_SECRET_ACCESS_KEY ?? "" } : undefined,
    });
  }
  async put(key: string, data: Buffer, contentType: string) {
    await this.client.send(new PutObjectCommand({ Bucket: this.config.S3_BUCKET, Key: key, Body: data, ContentType: contentType, ServerSideEncryption: "AES256" }));
  }
  async get(key: string) {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.config.S3_BUCKET, Key: key }));
    return Buffer.from(await res.Body!.transformToByteArray());
  }
  async signedUrl(key: string, opts: { fileName: string; contentType: string; ttlSeconds: number }) {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.config.S3_BUCKET,
        Key: key,
        ResponseContentDisposition: `attachment; filename="${opts.fileName.replace(/["\\\r\n]/g, "_")}"`,
        ResponseContentType: opts.contentType,
      }),
      { expiresIn: opts.ttlSeconds },
    );
  }
}

export function createStorage(config: AppConfig): StorageDriver {
  return config.STORAGE_DRIVER === "s3" ? new S3Storage(config) : new LocalStorage(config);
}

// ---------------------------------------------------------------- upload validation
export interface SniffedType {
  mime: string;
  ext: string;
}

/** Allow-list of upload types, verified by magic bytes (not the client-declared MIME type). */
export function sniffFileType(buf: Buffer, fileName: string): SniffedType | null {
  const ext = path.extname(fileName).toLowerCase().replace(".", "");
  const starts = (...bytes: number[]) => bytes.every((b, i) => buf[i] === b);
  if (starts(0x25, 0x50, 0x44, 0x46)) return ext === "pdf" ? { mime: "application/pdf", ext } : null;
  if (starts(0x89, 0x50, 0x4e, 0x47)) return ext === "png" ? { mime: "image/png", ext } : null;
  if (starts(0xff, 0xd8, 0xff)) return ["jpg", "jpeg"].includes(ext) ? { mime: "image/jpeg", ext } : null;
  if (buf.subarray(0, 4).toString() === "RIFF" && buf.subarray(8, 12).toString() === "WEBP") return ext === "webp" ? { mime: "image/webp", ext } : null;
  if (buf.subarray(0, 6).toString() === "GIF87a" || buf.subarray(0, 6).toString() === "GIF89a") return ext === "gif" ? { mime: "image/gif", ext } : null;
  if (starts(0x50, 0x4b, 0x03, 0x04)) {
    const map: Record<string, string> = {
      zip: "application/zip",
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    };
    return map[ext] ? { mime: map[ext], ext } : null;
  }
  if (["txt", "csv", "md"].includes(ext)) {
    // Plain text: reject binary content (NUL bytes) and anything that looks like HTML/script.
    const head = buf.subarray(0, 4096);
    if (head.includes(0)) return null;
    const text = head.toString("utf8").toLowerCase();
    if (/<\s*(script|html|svg|iframe)/.test(text)) return null;
    return { mime: ext === "csv" ? "text/csv" : "text/plain", ext };
  }
  return null;
}

export function sanitizeFileName(name: string): string {
  const base = path.basename(name).normalize("NFKC").replace(/[^\w.\- ()]/g, "_").slice(0, 150);
  return base || "file";
}

import crypto from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(crypto.scrypt) as (pw: string | Buffer, salt: Buffer, keylen: number, opts: crypto.ScryptOptions) => Promise<Buffer>;

/** URL-safe random token (default 32 bytes ≈ 256 bits). */
export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function sha256(input: string | Buffer): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export function hmacSha256(key: string | Buffer, input: string | Buffer, encoding: "hex" | "base64" | "base64url" = "hex"): string {
  return crypto.createHmac("sha256", key).update(input).digest(encoding);
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

// ---------------------------------------------------------------- passwords (scrypt, OWASP-recommended parameters)
const SCRYPT_N = 2 ** 17;
const SCRYPT_r = 8;
const SCRYPT_p = 1;
const KEYLEN = 64;

export async function hashPassword(password: string, opts: { fast?: boolean } = {}): Promise<string> {
  const salt = crypto.randomBytes(16);
  const N = opts.fast ? 2 ** 12 : SCRYPT_N;
  const key = await scrypt(password.normalize("NFKC"), salt, KEYLEN, { N, r: SCRYPT_r, p: SCRYPT_p, maxmem: 256 * 1024 * 1024 });
  return `scrypt$${N}$${SCRYPT_r}$${SCRYPT_p}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) {
    // Equalise timing for unknown users / passwordless accounts.
    await scrypt("x", Buffer.alloc(16), KEYLEN, { N: 2 ** 12, r: 8, p: 1 });
    return false;
  }
  const [alg, n, r, p, saltB64, keyB64] = stored.split("$");
  if (alg !== "scrypt") return false;
  const expected = Buffer.from(keyB64, "base64");
  const key = await scrypt(password.normalize("NFKC"), Buffer.from(saltB64, "base64"), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: 256 * 1024 * 1024,
  });
  return crypto.timingSafeEqual(key, expected);
}

// ---------------------------------------------------------------- symmetric encryption (MFA secrets)
function deriveKey(secret: string, purpose: string): Buffer {
  return crypto.createHash("sha256").update(`${purpose}:${secret}`).digest();
}

export function encrypt(plaintext: string, secret: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", deriveKey(secret, "enc"), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return `v1.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${enc.toString("base64url")}`;
}

export function decrypt(payload: string, secret: string): string {
  const [v, iv, tag, data] = payload.split(".");
  if (v !== "v1") throw new Error("unknown ciphertext version");
  const decipher = crypto.createDecipheriv("aes-256-gcm", deriveKey(secret, "enc"), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}

// ---------------------------------------------------------------- TOTP (RFC 6238) for staff MFA
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.replace(/=+$/, "").toUpperCase().replace(/\s/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error("invalid base32");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function generateTotpSecret(): string {
  return base32Encode(crypto.randomBytes(20));
}

export function totp(secretB32: string, timeMs = Date.now(), step = 30, digits = 6): string {
  const counter = Math.floor(timeMs / 1000 / step);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac("sha1", base32Decode(secretB32)).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits;
  return code.toString().padStart(digits, "0");
}

export function verifyTotp(secretB32: string, code: string, timeMs = Date.now(), window = 1): boolean {
  for (let w = -window; w <= window; w++) {
    if (safeEqual(totp(secretB32, timeMs + w * 30_000), code)) return true;
  }
  return false;
}

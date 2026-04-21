/**
 * src/lib/agent/skills/camofox/crypto.ts
 *
 * AES-256-GCM encryption/decryption for camofox session files and credential
 * vault rows. The key is derived from the AGENT_SECRET_KEY env var via
 * scrypt so any string length works.
 *
 * Output format (base64): iv(12) | authTag(16) | ciphertext
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;
// Fixed salt is acceptable here: the secret-key IS the secret. Using a stable
// salt lets decrypting work across restarts without storing a per-row salt.
const SALT = Buffer.from("camofox-v1-salt-fixed-16b", "utf8");

let cachedKey: Buffer | null = null;

function getKey(): Buffer {
    if (cachedKey) return cachedKey;
    const secret = process.env.AGENT_SECRET_KEY;
    if (!secret || secret.length < 8) {
        throw new Error(
            "AGENT_SECRET_KEY env var must be set (min 8 chars) to use camofox encryption. " +
            "Add it to .env.local.",
        );
    }
    cachedKey = scryptSync(secret, SALT, 32);
    return cachedKey;
}

export function encrypt(plaintext: string): string {
    const iv = randomBytes(IV_LEN);
    const cipher = createCipheriv(ALGO, getKey(), iv);
    const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, ct]).toString("base64");
}

export function decrypt(payload: string): string {
    const buf = Buffer.from(payload, "base64");
    if (buf.length < IV_LEN + TAG_LEN + 1) {
        throw new Error("Ciphertext too short / corrupted.");
    }
    const iv = buf.subarray(0, IV_LEN);
    const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
    const ct = buf.subarray(IV_LEN + TAG_LEN);
    const decipher = createDecipheriv(ALGO, getKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

/** Check if encryption is available without throwing. */
export function isEncryptionAvailable(): boolean {
    try {
        getKey();
        return true;
    } catch {
        return false;
    }
}

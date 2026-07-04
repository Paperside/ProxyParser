import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

// 自建节点敏感字段加密（AES-256-GCM，技术方案 §6.1）。
// 密钥来源：env PP_SECRET_KEY（hex 64 位）→ data 目录 .secret-key 文件（首启自动生成）。
// ciphertext 布局：iv(12) || authTag(16) || data

const IV_LENGTH = 12;
const TAG_LENGTH = 16;

export class SecretBox {
  private readonly key: Buffer;

  constructor(key: Buffer) {
    if (key.length !== 32) {
      throw new Error("SecretBox 密钥必须是 32 字节（hex 64 位）。");
    }
    this.key = key;
  }

  encrypt(fields: Record<string, unknown>): Buffer {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const plaintext = Buffer.from(JSON.stringify(fields), "utf8");
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
  }

  decrypt(ciphertext: Buffer | Uint8Array): Record<string, unknown> {
    const buffer = Buffer.from(ciphertext);
    if (buffer.length < IV_LENGTH + TAG_LENGTH) {
      throw new Error("密文长度非法。");
    }
    const iv = buffer.subarray(0, IV_LENGTH);
    const tag = buffer.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
    const data = buffer.subarray(IV_LENGTH + TAG_LENGTH);
    const decipher = createDecipheriv("aes-256-gcm", this.key, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
    return JSON.parse(plaintext) as Record<string, unknown>;
  }
}

export const loadOrCreateSecretBox = (options: {
  secretKeyHex: string | null;
  dataDir: string;
}): SecretBox => {
  if (options.secretKeyHex) {
    const key = Buffer.from(options.secretKeyHex, "hex");
    if (key.length !== 32) {
      throw new Error("PP_SECRET_KEY 必须是 64 位 hex（32 字节）。");
    }
    return new SecretBox(key);
  }

  const keyPath = resolve(options.dataDir, ".secret-key");
  if (existsSync(keyPath)) {
    const key = Buffer.from(readFileSync(keyPath, "utf8").trim(), "hex");
    if (key.length !== 32) {
      throw new Error(`密钥文件 ${keyPath} 内容非法（应为 64 位 hex）。`);
    }
    return new SecretBox(key);
  }

  const key = randomBytes(32);
  mkdirSync(dirname(keyPath), { recursive: true });
  writeFileSync(keyPath, key.toString("hex"), { mode: 0o600 });
  return new SecretBox(key);
};

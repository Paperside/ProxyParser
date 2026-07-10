import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

// 自建节点敏感字段加密（AES-256-GCM，技术方案 §6.1）。
// 密钥来源：env PP_SECRET_KEY（hex 64 位）→ data 目录 .secret-key 文件（首启自动生成）。
// ciphertext 布局：iv(12) || authTag(16) || data

const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const SECRET_KEY_HEX_PATTERN = /^[0-9a-fA-F]{64}$/;

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

export interface LoadOrCreateSecretBoxOptions {
  secretKeyHex: string | null;
  dataDir: string;
  requireExistingKey?: boolean;
  legacyDataDir?: string;
}

type SecretKeyFileWriteOptions = { mode: number; flag: "wx" };
type SecretKeyFileWriter = (
  path: string,
  content: string,
  options: SecretKeyFileWriteOptions
) => void;
type SecretKeyFileReader = (path: string) => Buffer;
type RetryWaiter = (milliseconds: number) => void;

const decodeSecretKey = (hex: string, invalidMessage: string): Buffer => {
  if (!SECRET_KEY_HEX_PATTERN.test(hex)) {
    throw new Error(invalidMessage);
  }
  return Buffer.from(hex, "hex");
};

const readSecretKeyFile = (keyPath: string): Buffer =>
  decodeSecretKey(
    readFileSync(keyPath, "utf8").trim(),
    `密钥文件 ${keyPath} 内容非法（应为 64 位 hex）。`
  );

const isFileExistsError = (error: unknown): error is NodeJS.ErrnoException =>
  error instanceof Error && "code" in error && error.code === "EEXIST";

const waitForFileWrite: RetryWaiter = (milliseconds) => {
  const signal = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));
  Atomics.wait(signal, 0, 0, milliseconds);
};

const readSecretKeyFileAfterCreateRace = (
  keyPath: string,
  reader: SecretKeyFileReader,
  waiter: RetryWaiter
) => {
  let lastError: unknown;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      return reader(keyPath);
    } catch (error) {
      lastError = error;
      if (attempt < 19) waiter(5);
    }
  }
  throw lastError;
};

// `wx` 保证多个进程同时首启时只有一个候选 key 能落盘；失败方读取赢家，
// 绝不覆盖已经被另一个进程采用的密钥。
export const createOrReadSecretKeyFile = (
  keyPath: string,
  candidateKey: Buffer,
  writer: SecretKeyFileWriter = (path, content, options) =>
    writeFileSync(path, content, options),
  reader: SecretKeyFileReader = readSecretKeyFile,
  waiter: RetryWaiter = waitForFileWrite
): Buffer => {
  if (candidateKey.length !== 32) {
    throw new Error("待持久化的 SecretBox 密钥必须是 32 字节。");
  }
  try {
    writer(keyPath, candidateKey.toString("hex"), { mode: 0o600, flag: "wx" });
    return candidateKey;
  } catch (error) {
    if (!isFileExistsError(error)) {
      throw error;
    }
    // O_EXCL publishes the inode before the winning process has necessarily
    // finished its synchronous write. Retry bounded reads until the 64 hex
    // bytes are complete; a crashed winner still fails closed after 100ms.
    return readSecretKeyFileAfterCreateRace(keyPath, reader, waiter);
  }
};

export const loadOrCreateSecretBox = (options: LoadOrCreateSecretBoxOptions): SecretBox => {
  const keyPath = resolve(options.dataDir, ".secret-key");
  if (options.secretKeyHex) {
    const key = decodeSecretKey(
      options.secretKeyHex,
      "PP_SECRET_KEY 必须是 64 位 hex（32 字节）。"
    );
    if (existsSync(keyPath) && !readSecretKeyFile(keyPath).equals(key)) {
      throw new Error(
        `PP_SECRET_KEY 与持久化密钥 ${keyPath} 不一致。为避免生成混合密文，ProxyParser 已停止启动；请先完成显式密钥迁移。`
      );
    }
    return new SecretBox(key);
  }

  if (existsSync(keyPath)) {
    return new SecretBox(readSecretKeyFile(keyPath));
  }

  if (options.requireExistingKey) {
    const legacyKeyPath = options.legacyDataDir
      ? resolve(options.legacyDataDir, ".secret-key")
      : null;
    const legacyHint =
      legacyKeyPath && legacyKeyPath !== keyPath && existsSync(legacyKeyPath)
        ? `检测到旧运行目录密钥 ${legacyKeyPath}；请在确认其属于当前数据库后，将它复制到 ${keyPath}。`
        : "若正在从旧容器升级，请从旧容器或同一备份集恢复原 .secret-key，或提供原 PP_SECRET_KEY。";
    throw new Error(
      `数据库包含已有加密记录，但未设置 PP_SECRET_KEY，且持久化密钥 ${keyPath} 不存在。` +
        ` 为避免生成新密钥后令已有数据无法解密，ProxyParser 已停止启动。${legacyHint}`
    );
  }

  mkdirSync(dirname(keyPath), { recursive: true });
  const key = createOrReadSecretKeyFile(keyPath, randomBytes(32));
  return new SecretBox(key);
};

export const verifySecretBoxCiphertexts = (
  secretBox: SecretBox,
  ciphertexts: Iterable<Buffer | Uint8Array>
) => {
  for (const ciphertext of ciphertexts) {
    try {
      secretBox.decrypt(ciphertext);
    } catch {
      throw new Error(
        "PP_SECRET_KEY 或持久化 .secret-key 与数据库中的加密记录不匹配，或数据库密文已经损坏；ProxyParser 已停止启动。请恢复与该数据库属于同一备份集的原始密钥和数据库。"
      );
    }
  }
};

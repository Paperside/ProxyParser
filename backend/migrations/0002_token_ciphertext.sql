-- 长期链接支持随时复制：token 明文改为应用层密钥加密存储（AES-256-GCM，复用 SecretBox）。
-- token_hash 仍保留，拉取端点鉴权继续走哈希比对，不受影响。

ALTER TABLE subscription_tokens ADD COLUMN token_ciphertext BLOB;

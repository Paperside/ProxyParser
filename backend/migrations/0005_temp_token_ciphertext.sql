-- 短期链接支持在有效期内按需复制/展示二维码：明文使用应用层密钥加密保存。
-- 列保持 nullable，既有短期链接只有哈希、无法逆向恢复，但继续可以正常拉取直至过期或撤销。

ALTER TABLE subscription_temp_tokens ADD COLUMN token_ciphertext BLOB;

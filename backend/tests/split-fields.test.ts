import { describe, expect, test } from "bun:test";

import { splitFields } from "../src/lib/nodes/split-fields";

describe("splitFields", () => {
  test("ss：password 进 secretFields，其余进 extra", () => {
    const { secretFields, extra } = splitFields("ss", {
      cipher: "aes-256-gcm",
      password: "s3cr3t",
      udp: true
    });
    expect(secretFields).toEqual({ password: "s3cr3t" });
    expect(extra).toEqual({ cipher: "aes-256-gcm", udp: true });
  });

  test("ss：plugin-opts 整体进 secretFields", () => {
    const { secretFields, extra } = splitFields("ss", {
      cipher: "aes-256-gcm",
      password: "s3cr3t",
      plugin: "shadow-tls",
      "plugin-opts": { host: "cloud.example.com", password: "inner-pass", version: 3 }
    });
    expect(secretFields["plugin-opts"]).toEqual({
      host: "cloud.example.com",
      password: "inner-pass",
      version: 3
    });
    expect(extra).toEqual({ cipher: "aes-256-gcm", plugin: "shadow-tls" });
  });

  test("vmess：uuid 与 private-key 敏感，servername/network 非敏感", () => {
    const { secretFields, extra } = splitFields("vmess", {
      uuid: "11111111-2222-3333-4444-555555555555",
      alterId: 0,
      cipher: "auto",
      network: "ws",
      servername: "example.com",
      "private-key": "-----BEGIN PRIVATE KEY-----"
    });
    expect(secretFields).toEqual({
      uuid: "11111111-2222-3333-4444-555555555555",
      "private-key": "-----BEGIN PRIVATE KEY-----"
    });
    expect(extra).toEqual({ alterId: 0, cipher: "auto", network: "ws", servername: "example.com" });
  });

  test("trojan：ss-opts 整体敏感", () => {
    const { secretFields, extra } = splitFields("trojan", {
      password: "trojan-pass",
      sni: "example.com",
      "ss-opts": { enabled: true, method: "AES-128-GCM", password: "inner" }
    });
    expect(Object.keys(secretFields)).toEqual(["password", "ss-opts"]);
    expect(extra).toEqual({ sni: "example.com" });
  });

  test("hysteria2：obfs-password 敏感，obfs 非敏感；realm-opts 整体敏感", () => {
    const { secretFields, extra } = splitFields("hysteria2", {
      password: "h2-pass",
      obfs: "salamander",
      "obfs-password": "obfs-pass",
      sni: "example.com",
      "realm-opts": { enable: true, token: "realm-token" }
    });
    expect(secretFields).toEqual({
      password: "h2-pass",
      "obfs-password": "obfs-pass",
      "realm-opts": { enable: true, token: "realm-token" }
    });
    expect(extra).toEqual({ obfs: "salamander", sni: "example.com" });
  });

  test("tuic：token 与 uuid/password 均敏感（variant 分支合并）", () => {
    const tokenMode = splitFields("tuic", { token: "tuic-token", sni: "example.com" });
    expect(tokenMode.secretFields).toEqual({ token: "tuic-token" });
    expect(tokenMode.extra).toEqual({ sni: "example.com" });

    const uuidMode = splitFields("tuic", { uuid: "uuid-1", password: "pw-1", sni: "example.com" });
    expect(uuidMode.secretFields).toEqual({ uuid: "uuid-1", password: "pw-1" });
    expect(uuidMode.extra).toEqual({ sni: "example.com" });
  });

  test("wireguard：private-key 与 peers 整体敏感，public-key 非敏感", () => {
    const { secretFields, extra } = splitFields("wireguard", {
      "private-key": "self-priv",
      "public-key": "peer-pub",
      mtu: 1408,
      peers: [{ server: "1.2.3.4", port: 51820, "public-key": "p", "pre-shared-key": "psk", "allowed-ips": ["0.0.0.0/0"] }]
    });
    expect(secretFields["private-key"]).toBe("self-priv");
    expect(secretFields.peers).toBeDefined();
    expect(extra).toEqual({ "public-key": "peer-pub", mtu: 1408 });
  });

  test("未知协议：按正则兜底识别敏感字段", () => {
    const { secretFields, extra } = splitFields("mieru", {
      username: "alice",
      password: "hunter2",
      port: 1234,
      "api-token": "should-not-leak"
    });
    expect(secretFields).toEqual({ password: "hunter2", "api-token": "should-not-leak" });
    expect(extra).toEqual({ username: "alice", port: 1234 });
  });

  test("已知协议里出现 schema 未列出但形似凭据的字段，仍被正则兜底保护", () => {
    const { secretFields, extra } = splitFields("ss", {
      cipher: "aes-256-gcm",
      password: "s3cr3t",
      "custom-secret-token": "leaked-if-not-caught"
    });
    expect(secretFields).toEqual({ password: "s3cr3t", "custom-secret-token": "leaked-if-not-caught" });
    expect(extra).toEqual({ cipher: "aes-256-gcm" });
  });
});

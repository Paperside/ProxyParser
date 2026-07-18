import { describe, expect, test } from "bun:test";
import { Elysia } from "elysia";

import { NodeUriParseError, parseNodeShareUri } from "../src/lib/nodes/share-uri";
import type { AuthService } from "../src/modules/auth/auth.service";
import { createNodeRoutes } from "../src/modules/nodes/routes";

const b64 = (value: string) => Buffer.from(value).toString("base64url");

describe("节点分享链接解析", () => {
  test("解析 SIP002 Shadowsocks 链接", () => {
    const result = parseNodeShareUri(`ss://${b64("aes-256-gcm:secret")}@example.com:8388#东京`);
    expect(result).toMatchObject({ type: "ss", server: "example.com", port: 8388, name: "东京" });
    expect(result.fields).toMatchObject({ cipher: "aes-256-gcm", password: "secret" });
  });

  test("解析 API 对含凭据的请求与响应显式禁止缓存", async () => {
    const authService = {
      authenticate: () => ({})
    } as unknown as AuthService;
    const app = new Elysia().use(createNodeRoutes(authService));
    const response = await app.handle(
      new Request("http://localhost/api/nodes/parse-uri", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          uri: `ss://${b64("aes-256-gcm:secret")}@example.com:8388#东京`
        })
      })
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("pragma")).toBe("no-cache");
  });

  test("解析 VMess JSON 链接", () => {
    const result = parseNodeShareUri(`vmess://${b64(JSON.stringify({
      v: "2", ps: "香港", add: "hk.example.com", port: "443", id: "uuid-1",
      aid: "0", net: "ws", host: "cdn.example.com", path: "/ws", tls: "tls", sni: "hk.example.com"
    }))}`);
    expect(result).toMatchObject({ type: "vmess", server: "hk.example.com", port: 443, name: "香港" });
    expect(result.fields).toMatchObject({ uuid: "uuid-1", network: "ws", tls: true });
  });

  test("解析 VLESS Reality 与传输参数", () => {
    const result = parseNodeShareUri(
      "vless://uuid@example.com:443?security=reality&type=grpc&sni=edge.example.com&pbk=pub&sid=01&serviceName=svc#US"
    );
    expect(result).toMatchObject({ type: "vless", server: "example.com", port: 443, name: "US" });
    expect(result.fields).toMatchObject({
      uuid: "uuid", tls: true, network: "grpc", servername: "edge.example.com",
      "reality-opts": { "public-key": "pub", "short-id": "01" },
      "grpc-opts": { "grpc-service-name": "svc" }
    });
  });

  test("解析 Trojan、HTTP、SOCKS5、Hysteria 2、TUIC 与 AnyTLS", () => {
    expect(parseNodeShareUri("trojan://pass@host.test:443?sni=sni.test#T").fields.password).toBe("pass");
    expect(parseNodeShareUri("https://u:p@host.test:443#H")).toMatchObject({ type: "http", fields: { username: "u", password: "p", tls: true } });
    expect(parseNodeShareUri("socks5://u:p@host.test:1080#S").type).toBe("socks5");
    expect(parseNodeShareUri("hy2://pass@host.test:443?sni=sni.test#H2")).toMatchObject({ type: "hysteria2", fields: { password: "pass", sni: "sni.test" } });
    expect(parseNodeShareUri("tuic://uuid:pass@host.test:443?sni=sni.test#U")).toMatchObject({ type: "tuic", fields: { uuid: "uuid", password: "pass" } });
    expect(parseNodeShareUri("anytls://pass@host.test:443?sni=sni.test#A")).toMatchObject({ type: "anytls", fields: { password: "pass" } });
  });

  test("解析 Hysteria v1 查询参数格式", () => {
    const result = parseNodeShareUri(
      "hysteria://host.test:443?auth=token&peer=sni.test&upmbps=20&downmbps=100&protocol=udp&insecure=1#HY"
    );
    expect(result).toMatchObject({
      type: "hysteria",
      fields: {
        "auth-str": "token",
        sni: "sni.test",
        up: "20",
        down: "100",
        protocol: "udp",
        "skip-cert-verify": true
      }
    });
  });

  test("Snell 与未知协议给出明确错误", () => {
    expect(() => parseNodeShareUri("snell://x@y.test:443")).toThrow(NodeUriParseError);
    expect(() => parseNodeShareUri("mieru://x@y.test:443")).toThrow("暂不支持");
  });

  test("拒绝空值、非法端口和超长输入", () => {
    expect(() => parseNodeShareUri(" ")).toThrow("请粘贴");
    expect(() => parseNodeShareUri("vless://uuid@example.com")).toThrow("端口");
    expect(() => parseNodeShareUri(`vless://${"x".repeat(17_000)}`)).toThrow("过长");
  });
});

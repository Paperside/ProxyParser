export interface ParsedNodeUri {
  name: string;
  type: string;
  server: string;
  port: number;
  fields: Record<string, unknown>;
  warnings: string[];
  scheme: string;
}

export class NodeUriParseError extends Error {}

const MAX_URI_LENGTH = 16_384;

const decodeBase64 = (value: string): string => {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  try {
    return Buffer.from(padded, "base64").toString("utf8");
  } catch {
    throw new NodeUriParseError("链接中的 Base64 内容无效。");
  }
};

const decodeComponent = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const requireEndpoint = (server: string, port: number) => {
  if (!server || !Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new NodeUriParseError("链接缺少合法的服务器地址或端口。");
  }
};

const queryBoolean = (params: URLSearchParams, ...keys: string[]): boolean | undefined => {
  for (const key of keys) {
    const raw = params.get(key);
    if (raw === null) continue;
    return raw === "1" || raw === "true";
  }
};

const setTlsAndTransport = (fields: Record<string, unknown>, params: URLSearchParams) => {
  const security = params.get("security") ?? params.get("securityType");
  if (security === "tls" || security === "reality") fields.tls = true;
  const sni = params.get("sni") ?? params.get("serverName") ?? params.get("peer");
  if (sni) fields.servername = sni;
  const network = params.get("type") ?? params.get("network");
  if (network && network !== "tcp") fields.network = network;
  const host = params.get("host");
  const path = params.get("path");
  if (network === "ws") {
    fields["ws-opts"] = {
      ...(path ? { path } : {}),
      ...(host ? { headers: { Host: host } } : {})
    };
  } else if (network === "grpc") {
    fields["grpc-opts"] = { "grpc-service-name": params.get("serviceName") ?? path ?? "" };
  } else if (network === "h2") {
    fields["h2-opts"] = {
      ...(host ? { host: host.split(",") } : {}),
      ...(path ? { path } : {})
    };
  }
  if (security === "reality") {
    fields["reality-opts"] = {
      "public-key": params.get("pbk") ?? params.get("publicKey") ?? "",
      ...(params.get("sid") ? { "short-id": params.get("sid") } : {})
    };
  }
  const fingerprint = params.get("fp");
  if (fingerprint) fields["client-fingerprint"] = fingerprint;
  const alpn = params.get("alpn");
  if (alpn) fields.alpn = alpn.split(",").filter(Boolean);
};

const fromUrl = (raw: string, scheme: string): ParsedNodeUri => {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new NodeUriParseError("链接格式无效。");
  }
  const server = url.hostname;
  const port = Number(url.port || (scheme === "https" ? "443" : scheme === "http" ? "80" : ""));
  requireEndpoint(server, port);
  const name = decodeComponent(url.hash.slice(1)) || `${scheme.toUpperCase()} ${server}`;
  const user = decodeComponent(url.username);
  const password = decodeComponent(url.password);
  const params = url.searchParams;
  const warnings: string[] = [];
  const fields: Record<string, unknown> = {};
  let type = scheme;

  switch (scheme) {
    case "vless":
      fields.uuid = user;
      setTlsAndTransport(fields, params);
      if (params.get("flow")) fields.flow = params.get("flow");
      if (queryBoolean(params, "allowInsecure") !== undefined) {
        fields["skip-cert-verify"] = queryBoolean(params, "allowInsecure");
      }
      break;
    case "trojan":
      fields.password = user || password;
      setTlsAndTransport(fields, params);
      if (params.get("sni")) fields.sni = params.get("sni");
      break;
    case "http":
    case "https":
      type = "http";
      if (user) fields.username = user;
      if (password) fields.password = password;
      if (scheme === "https") fields.tls = true;
      if (params.get("sni")) fields.sni = params.get("sni");
      break;
    case "socks":
    case "socks5":
      type = "socks5";
      if (user) fields.username = user;
      if (password) fields.password = password;
      break;
    case "hysteria":
    case "hy":
      type = "hysteria";
      fields["auth-str"] = params.get("auth") ?? (user || password);
      if (params.get("peer") || params.get("sni")) fields.sni = params.get("peer") ?? params.get("sni");
      if (params.get("up") || params.get("upmbps")) fields.up = params.get("up") ?? params.get("upmbps");
      if (params.get("down") || params.get("downmbps")) fields.down = params.get("down") ?? params.get("downmbps");
      if (params.get("protocol")) fields.protocol = params.get("protocol");
      if (params.get("obfs")) fields.obfs = params.get("obfs");
      if (queryBoolean(params, "insecure") !== undefined) fields["skip-cert-verify"] = queryBoolean(params, "insecure");
      break;
    case "hysteria2":
    case "hy2":
      type = "hysteria2";
      fields.password = user || password;
      if (params.get("sni")) fields.sni = params.get("sni");
      if (queryBoolean(params, "insecure") !== undefined) fields["skip-cert-verify"] = queryBoolean(params, "insecure");
      if (params.get("obfs") === "salamander") {
        fields.obfs = "salamander";
        if (params.get("obfs-password")) fields["obfs-password"] = params.get("obfs-password");
      }
      break;
    case "tuic":
      fields.uuid = user;
      fields.password = password;
      if (params.get("sni")) fields.sni = params.get("sni");
      if (params.get("congestion_control")) fields["congestion-controller"] = params.get("congestion_control");
      break;
    case "wireguard":
    case "wg":
      type = "wireguard";
      fields["private-key"] = user || password;
      if (params.get("publickey")) fields["public-key"] = params.get("publickey");
      if (params.get("address")) fields.ip = params.get("address")!.split(",")[0];
      warnings.push("WireGuard 分享链接没有统一标准，请核对公钥、地址与保留位等参数。");
      break;
    case "anytls":
      fields.password = user || password;
      if (params.get("sni")) fields.sni = params.get("sni");
      break;
    default:
      throw new NodeUriParseError(`暂不支持 ${scheme}:// 分享链接。`);
  }
  return { name, type, server, port, fields, warnings, scheme };
};

const parseShadowsocks = (raw: string): ParsedNodeUri => {
  const withoutScheme = raw.slice(5);
  const hashIndex = withoutScheme.indexOf("#");
  const fragment = hashIndex >= 0 ? withoutScheme.slice(hashIndex + 1) : "";
  const beforeHash = hashIndex >= 0 ? withoutScheme.slice(0, hashIndex) : withoutScheme;
  const queryIndex = beforeHash.indexOf("?");
  const main = queryIndex >= 0 ? beforeHash.slice(0, queryIndex) : beforeHash;
  const query = new URLSearchParams(queryIndex >= 0 ? beforeHash.slice(queryIndex + 1) : "");
  const expanded = main.includes("@") ? main : decodeBase64(main);
  const at = expanded.lastIndexOf("@");
  if (at < 1) throw new NodeUriParseError("Shadowsocks 链接缺少用户信息或服务器地址。");
  let credentials = expanded.slice(0, at);
  if (!credentials.includes(":")) credentials = decodeBase64(credentials);
  const colon = credentials.indexOf(":");
  if (colon < 1) throw new NodeUriParseError("Shadowsocks 链接缺少加密方式或密码。");
  const endpoint = new URL(`ss://x@${expanded.slice(at + 1)}`);
  const port = Number(endpoint.port);
  requireEndpoint(endpoint.hostname, port);
  const fields: Record<string, unknown> = {
    cipher: decodeComponent(credentials.slice(0, colon)),
    password: decodeComponent(credentials.slice(colon + 1))
  };
  const plugin = query.get("plugin");
  if (plugin) {
    const [pluginName, ...options] = plugin.split(";");
    fields.plugin = pluginName;
    if (options.length) fields["plugin-opts"] = Object.fromEntries(options.map((item) => {
      const [key, ...rest] = item.split("=");
      return [key!, rest.length ? rest.join("=") : true];
    }));
  }
  return {
    name: decodeComponent(fragment) || `SS ${endpoint.hostname}`,
    type: "ss",
    server: endpoint.hostname,
    port,
    fields,
    warnings: [],
    scheme: "ss"
  };
};

const parseVmess = (raw: string): ParsedNodeUri => {
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(decodeBase64(raw.slice("vmess://".length))) as Record<string, unknown>;
  } catch {
    throw new NodeUriParseError("VMess 链接中的 JSON/Base64 内容无效。");
  }
  const server = String(payload.add ?? "");
  const port = Number(payload.port);
  requireEndpoint(server, port);
  const fields: Record<string, unknown> = {
    uuid: String(payload.id ?? ""),
    alterId: Number(payload.aid ?? 0),
    cipher: String(payload.scy ?? "auto")
  };
  const network = String(payload.net ?? "tcp");
  if (network !== "tcp") fields.network = network;
  if (payload.tls === "tls") fields.tls = true;
  if (payload.sni) fields.servername = String(payload.sni);
  if (network === "ws") fields["ws-opts"] = {
    ...(payload.path ? { path: String(payload.path) } : {}),
    ...(payload.host ? { headers: { Host: String(payload.host) } } : {})
  };
  if (network === "grpc") fields["grpc-opts"] = { "grpc-service-name": String(payload.path ?? "") };
  return {
    name: String(payload.ps ?? `VMess ${server}`), type: "vmess", server, port, fields,
    warnings: [], scheme: "vmess"
  };
};

const parseShadowsocksR = (raw: string): ParsedNodeUri => {
  const decoded = decodeBase64(raw.slice("ssr://".length));
  const [main, queryText = ""] = decoded.split("/?", 2);
  const parts = main!.split(":");
  if (parts.length < 6) throw new NodeUriParseError("ShadowsocksR 链接字段不完整。");
  const [server, portRaw, protocol, cipher, obfs, encodedPassword] = parts;
  const port = Number(portRaw);
  requireEndpoint(server!, port);
  const params = new URLSearchParams(queryText);
  const decodeParam = (key: string) => params.get(key) ? decodeBase64(params.get(key)!) : undefined;
  const fields: Record<string, unknown> = {
    cipher, password: decodeBase64(encodedPassword!), protocol, obfs
  };
  const protocolParam = decodeParam("protoparam");
  const obfsParam = decodeParam("obfsparam");
  if (protocolParam) fields["protocol-param"] = protocolParam;
  if (obfsParam) fields["obfs-param"] = obfsParam;
  return {
    name: decodeParam("remarks") ?? `SSR ${server}`, type: "ssr", server: server!, port, fields,
    warnings: ["ShadowsocksR 分享格式属于社区约定，请在保存前核对高级参数。"], scheme: "ssr"
  };
};

export const parseNodeShareUri = (input: string): ParsedNodeUri => {
  const raw = input.trim();
  if (!raw) throw new NodeUriParseError("请粘贴节点分享链接。");
  if (raw.length > MAX_URI_LENGTH) throw new NodeUriParseError("分享链接过长，最大允许 16 KiB。");
  const schemeMatch = /^([a-z][a-z0-9+.-]*):\/\//i.exec(raw);
  if (!schemeMatch) throw new NodeUriParseError("未识别到协议前缀，例如 vless:// 或 ss://。");
  const scheme = schemeMatch[1]!.toLowerCase();
  if (scheme === "ss") return parseShadowsocks(raw);
  if (scheme === "ssr") return parseShadowsocksR(raw);
  if (scheme === "vmess") return parseVmess(raw);
  if (scheme === "snell") throw new NodeUriParseError("Snell 没有通用分享链接标准，请使用表单手动添加。");
  return fromUrl(raw, scheme);
};

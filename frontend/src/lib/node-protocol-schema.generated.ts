// ⚠️ 生成自 backend/src/lib/nodes/protocol-schema.ts —— 勿手改，改动后运行 bun run sync-types。
// 自建节点协议字段 schema（权威定义）。
// 数据来源：mihomo（Meta 分支）adapter/outbound/*.go 的 Option struct，人工整理。
// 用途：驱动前端「基础模式」填空表单的动态渲染，以及后端敏感字段拆分（split-fields.ts）。
// 前端持有同构副本 frontend/src/lib/node-protocol-schema.generated.ts（由 sync-types 脚本复制）。
//
// 设计原则：敏感性只标记在顶层 key 上；含敏感子字段的复合对象（如 plugin-opts/ss-opts/
// realm-opts/peers）整体标记 sensitive，作为一个不可拆分的单元进 secretRef，
// 避免渲染层需要做深度合并。

export type FieldType =
  | "string"
  | "number"
  | "boolean"
  | "enum"
  | "stringList"
  | "stringMap"
  | "object"
  | "objectList" // 对象数组（如 wireguard 的 peers），基础模式下用 YAML 片段编辑
  | "variant";

export interface EnumOption {
  value: string;
  label?: string;
}

export interface FieldSchema {
  key: string; // yaml key，如 "password"
  label: string; // 中文标签
  type: FieldType;
  required?: boolean;
  sensitive?: boolean; // 顶层字段：true 表示整体进 secretRef
  tier: "common" | "advanced"; // common：直接展示；advanced：收进“高级配置”折叠区
  default?: unknown;
  enumOptions?: EnumOption[];
  placeholder?: string;
  hint?: string;
  visibleWhen?: { field: string; equals: unknown };
  fields?: FieldSchema[]; // type === "object" 时的嵌套字段
  variants?: { value: string; label: string; fields: FieldSchema[] }[]; // type === "variant" 时的分支
}

export interface ProtocolSchema {
  type: string;
  label: string;
  fields: FieldSchema[];
}

// ── 可复用的通用字段片段 ──────────────────────────────────────

const udpField: FieldSchema = {
  key: "udp",
  label: "允许 UDP 转发",
  type: "boolean",
  tier: "common",
  default: false
};

const tlsCommonFields = (opts?: { sniKey?: "sni" | "servername" }): FieldSchema[] => [
  {
    key: opts?.sniKey ?? "sni",
    label: "SNI",
    type: "string",
    tier: "common",
    hint: "留空默认取服务器地址"
  },
  { key: "skip-cert-verify", label: "跳过证书校验", type: "boolean", tier: "common", default: false },
  { key: "alpn", label: "ALPN", type: "stringList", tier: "advanced" },
  { key: "fingerprint", label: "证书 SHA256 指纹", type: "string", tier: "advanced" },
  { key: "client-fingerprint", label: "uTLS 客户端指纹", type: "enum", tier: "advanced", enumOptions: [
    { value: "chrome" }, { value: "firefox" }, { value: "safari" }, { value: "ios" }, { value: "random" }, { value: "none" }
  ] },
  { key: "certificate", label: "mTLS 客户端证书 (PEM)", type: "string", tier: "advanced" },
  { key: "private-key", label: "mTLS 客户端私钥 (PEM)", type: "string", tier: "advanced", sensitive: true },
  {
    key: "ech-opts",
    label: "ECH 配置",
    type: "object",
    tier: "advanced",
    fields: [
      { key: "enable", label: "启用 ECH", type: "boolean", tier: "common", default: false },
      { key: "config", label: "ECH Config (base64)", type: "string", tier: "common" },
      { key: "query-server-name", label: "Query Server Name", type: "string", tier: "advanced" }
    ]
  }
];

const realityOptsField: FieldSchema = {
  key: "reality-opts",
  label: "REALITY 参数",
  type: "object",
  tier: "advanced",
  fields: [
    { key: "public-key", label: "服务器公钥", type: "string", tier: "common", required: true },
    { key: "short-id", label: "Short ID", type: "string", tier: "common" },
    { key: "support-x25519mlkem768", label: "支持 x25519mlkem768", type: "boolean", tier: "advanced", default: false }
  ]
};

const dialerAdvancedFields: FieldSchema[] = [
  { key: "tfo", label: "TCP Fast Open", type: "boolean", tier: "advanced", default: false },
  { key: "mptcp", label: "多路径 TCP", type: "boolean", tier: "advanced", default: false },
  {
    key: "ip-version",
    label: "IP 版本偏好",
    type: "enum",
    tier: "advanced",
    default: "dual",
    enumOptions: [
      { value: "dual" }, { value: "ipv4" }, { value: "ipv6" }, { value: "ipv4-prefer" }, { value: "ipv6-prefer" }
    ]
  },
  { key: "interface-name", label: "出站网卡", type: "string", tier: "advanced" },
  { key: "routing-mark", label: "路由标记 (fwmark)", type: "number", tier: "advanced" },
  { key: "dialer-proxy", label: "链式代理（通过指定节点转发）", type: "string", tier: "advanced" }
];

const wsOptsField: FieldSchema = {
  key: "ws-opts",
  label: "WebSocket 参数",
  type: "object",
  tier: "common",
  visibleWhen: { field: "network", equals: "ws" },
  fields: [
    { key: "path", label: "路径", type: "string", tier: "common", placeholder: "/" },
    { key: "headers", label: "自定义 Header", type: "stringMap", tier: "common" },
    { key: "max-early-data", label: "Max Early Data", type: "number", tier: "advanced" },
    { key: "early-data-header-name", label: "Early Data Header 名", type: "string", tier: "advanced" },
    { key: "v2ray-http-upgrade", label: "V2Ray HTTP Upgrade", type: "boolean", tier: "advanced", default: false },
    { key: "v2ray-http-upgrade-fast-open", label: "HTTP Upgrade Fast Open", type: "boolean", tier: "advanced", default: false }
  ]
};

const grpcOptsField: FieldSchema = {
  key: "grpc-opts",
  label: "gRPC 参数",
  type: "object",
  tier: "common",
  visibleWhen: { field: "network", equals: "grpc" },
  fields: [
    { key: "grpc-service-name", label: "Service Name", type: "string", tier: "common" },
    { key: "grpc-user-agent", label: "User-Agent", type: "string", tier: "advanced" },
    { key: "ping-interval", label: "Ping Interval (秒)", type: "number", tier: "advanced", default: 0 },
    { key: "max-connections", label: "最大连接数", type: "number", tier: "advanced" },
    { key: "min-streams", label: "最小流数", type: "number", tier: "advanced" },
    { key: "max-streams", label: "最大流数", type: "number", tier: "advanced" }
  ]
};

const httpOptsField: FieldSchema = {
  key: "http-opts",
  label: "HTTP 传输参数",
  type: "object",
  tier: "advanced",
  visibleWhen: { field: "network", equals: "http" },
  fields: [
    { key: "method", label: "Method", type: "string", tier: "common", default: "GET" },
    { key: "path", label: "路径列表", type: "stringList", tier: "common" },
    { key: "headers", label: "自定义 Header", type: "stringMap", tier: "advanced" }
  ]
};

const h2OptsField: FieldSchema = {
  key: "h2-opts",
  label: "HTTP/2 参数",
  type: "object",
  tier: "common",
  visibleWhen: { field: "network", equals: "h2" },
  fields: [
    { key: "host", label: "Host 列表", type: "stringList", tier: "common", placeholder: "www.example.com" },
    { key: "path", label: "路径", type: "string", tier: "common" }
  ]
};

const networkField = (extra?: EnumOption[]): FieldSchema => ({
  key: "network",
  label: "传输层",
  type: "enum",
  tier: "common",
  default: "tcp",
  enumOptions: [
    { value: "tcp", label: "TCP（原始）" },
    { value: "ws", label: "WebSocket" },
    { value: "http", label: "HTTP" },
    { value: "h2", label: "HTTP/2" },
    { value: "grpc", label: "gRPC" },
    ...(extra ?? [])
  ]
});

// ── 各协议 schema ────────────────────────────────────────────

const ssSchema: ProtocolSchema = {
  type: "ss",
  label: "Shadowsocks",
  fields: [
    {
      key: "cipher",
      label: "加密方式",
      type: "enum",
      required: true,
      tier: "common",
      enumOptions: [
        "aes-128-gcm", "aes-192-gcm", "aes-256-gcm",
        "aes-128-cfb", "aes-192-cfb", "aes-256-cfb",
        "aes-128-ctr", "aes-192-ctr", "aes-256-ctr",
        "rc4-md5", "chacha20-ietf", "xchacha20",
        "chacha20-ietf-poly1305", "xchacha20-ietf-poly1305",
        "2022-blake3-aes-128-gcm", "2022-blake3-aes-256-gcm", "2022-blake3-chacha20-poly1305"
      ].map((v) => ({ value: v }))
    },
    { key: "password", label: "密码", type: "string", required: true, sensitive: true, tier: "common" },
    udpField,
    {
      key: "plugin",
      label: "混淆插件",
      type: "enum",
      tier: "advanced",
      enumOptions: ["obfs", "v2ray-plugin", "gost-plugin", "shadow-tls", "restls", "kcptun"].map((v) => ({ value: v }))
    },
    {
      key: "plugin-opts",
      label: "插件参数",
      type: "object",
      tier: "advanced",
      sensitive: true,
      hint: "字段随所选插件而不同，可能含密码/私钥，整体加密存储",
      fields: [
        { key: "mode", label: "模式", type: "string", tier: "common" },
        { key: "host", label: "伪装域名 (host)", type: "string", tier: "common" },
        { key: "password", label: "密码（shadow-tls / restls）", type: "string", tier: "common" },
        { key: "key", label: "密钥（kcptun）", type: "string", tier: "common" },
        { key: "path", label: "路径（v2ray-plugin / gost-plugin）", type: "string", tier: "advanced" },
        { key: "tls", label: "启用 TLS（v2ray-plugin / gost-plugin）", type: "boolean", tier: "advanced" },
        { key: "version-hint", label: "Version Hint（restls）", type: "string", tier: "advanced" },
        { key: "version", label: "版本（shadow-tls）", type: "number", tier: "advanced" }
      ]
    },
    { key: "udp-over-tcp", label: "UDP over TCP", type: "boolean", tier: "advanced", default: false },
    ...dialerAdvancedFields
  ]
};

const ssrSchema: ProtocolSchema = {
  type: "ssr",
  label: "ShadowsocksR",
  fields: [
    { key: "cipher", label: "加密方式", type: "string", required: true, tier: "common", placeholder: "aes-256-cfb" },
    { key: "password", label: "密码", type: "string", required: true, sensitive: true, tier: "common" },
    {
      key: "obfs",
      label: "混淆",
      type: "enum",
      required: true,
      tier: "common",
      enumOptions: ["plain", "http_simple", "http_post", "random_head", "tls1.2_ticket_auth", "tls1.2_ticket_fastauth"].map((v) => ({ value: v }))
    },
    { key: "obfs-param", label: "混淆参数", type: "string", tier: "common", hint: "常为伪装域名" },
    {
      key: "protocol",
      label: "协议",
      type: "enum",
      required: true,
      tier: "common",
      enumOptions: ["origin", "auth_sha1_v4", "auth_aes128_md5", "auth_aes128_sha1", "auth_chain_a", "auth_chain_b"].map((v) => ({ value: v }))
    },
    { key: "protocol-param", label: "协议参数", type: "string", tier: "advanced", sensitive: true, hint: "部分协议格式为「用户数:密码」，按敏感处理" },
    udpField,
    ...dialerAdvancedFields
  ]
};

const vmessSchema: ProtocolSchema = {
  type: "vmess",
  label: "VMess",
  fields: [
    { key: "uuid", label: "UUID", type: "string", required: true, sensitive: true, tier: "common" },
    { key: "alterId", label: "AlterId", type: "number", required: true, tier: "common", default: 0 },
    {
      key: "cipher",
      label: "加密方式",
      type: "enum",
      required: true,
      tier: "common",
      default: "auto",
      enumOptions: ["auto", "aes-128-gcm", "chacha20-poly1305", "none"].map((v) => ({ value: v }))
    },
    udpField,
    { key: "tls", label: "启用 TLS", type: "boolean", tier: "common", default: false },
    networkField(),
    wsOptsField,
    grpcOptsField,
    httpOptsField,
    h2OptsField,
    ...tlsCommonFields({ sniKey: "servername" }),
    realityOptsField,
    { key: "xudp", label: "XUDP 模式", type: "boolean", tier: "advanced", default: false },
    { key: "packet-addr", label: "Packet Addr 模式", type: "boolean", tier: "advanced", default: false },
    {
      key: "packet-encoding",
      label: "UDP 封包编码",
      type: "enum",
      tier: "advanced",
      enumOptions: ["packetaddr", "packet", "xudp"].map((v) => ({ value: v }))
    },
    { key: "global-padding", label: "Global Padding", type: "boolean", tier: "advanced", default: false },
    { key: "authenticated-length", label: "Authenticated Length", type: "boolean", tier: "advanced", default: false },
    ...dialerAdvancedFields
  ]
};

const xhttpOptsField: FieldSchema = {
  key: "xhttp-opts",
  label: "XHTTP 参数",
  type: "object",
  tier: "advanced",
  visibleWhen: { field: "network", equals: "xhttp" },
  fields: [
    { key: "path", label: "路径", type: "string", tier: "common" },
    { key: "host", label: "Host", type: "string", tier: "common" },
    {
      key: "mode",
      label: "模式",
      type: "enum",
      tier: "common",
      enumOptions: ["stream-one", "stream-up", "packet-up"].map((v) => ({ value: v }))
    },
    { key: "headers", label: "自定义 Header", type: "stringMap", tier: "advanced" },
    { key: "no-grpc-header", label: "禁用 gRPC Header", type: "boolean", tier: "advanced", default: false },
    { key: "x-padding-bytes", label: "Padding 字节数", type: "string", tier: "advanced" },
    { key: "x-padding-obfs-mode", label: "Padding 混淆模式", type: "boolean", tier: "advanced", default: false },
    { key: "x-padding-key", label: "Padding Key", type: "string", tier: "advanced" },
    { key: "x-padding-header", label: "Padding Header", type: "string", tier: "advanced" },
    {
      key: "x-padding-placement",
      label: "Padding 位置",
      type: "enum",
      tier: "advanced",
      enumOptions: ["queryInHeader", "cookie", "header", "query"].map((v) => ({ value: v }))
    },
    {
      key: "x-padding-method",
      label: "Padding 方式",
      type: "enum",
      tier: "advanced",
      enumOptions: ["repeat-x", "tokenish"].map((v) => ({ value: v }))
    },
    {
      key: "uplink-http-method",
      label: "上行 HTTP Method",
      type: "enum",
      tier: "advanced",
      enumOptions: ["POST", "PUT", "PATCH", "DELETE"].map((v) => ({ value: v }))
    },
    {
      key: "session-placement",
      label: "Session 位置",
      type: "enum",
      tier: "advanced",
      enumOptions: ["path", "query", "cookie", "header"].map((v) => ({ value: v }))
    },
    { key: "session-key", label: "Session Key", type: "string", tier: "advanced" },
    { key: "seq-placement", label: "Seq 位置", type: "string", tier: "advanced" },
    { key: "seq-key", label: "Seq Key", type: "string", tier: "advanced" },
    {
      key: "uplink-data-placement",
      label: "上行数据位置",
      type: "enum",
      tier: "advanced",
      enumOptions: ["body", "cookie", "header"].map((v) => ({ value: v }))
    },
    { key: "uplink-data-key", label: "上行数据 Key", type: "string", tier: "advanced" },
    { key: "uplink-chunk-size", label: "上行分块大小", type: "string", tier: "advanced" },
    { key: "sc-max-each-post-bytes", label: "单次 POST 最大字节数", type: "string", tier: "advanced" },
    { key: "sc-min-posts-interval-ms", label: "POST 最小间隔 (ms)", type: "string", tier: "advanced" }
  ]
};

const vlessSchema: ProtocolSchema = {
  type: "vless",
  label: "VLESS",
  fields: [
    { key: "uuid", label: "UUID", type: "string", required: true, sensitive: true, tier: "common" },
    {
      key: "flow",
      label: "Flow",
      type: "enum",
      tier: "common",
      enumOptions: [{ value: "", label: "无" }, { value: "xtls-rprx-vision" }]
    },
    { key: "tls", label: "启用 TLS", type: "boolean", tier: "common", default: false },
    udpField,
    networkField([{ value: "xhttp", label: "XHTTP" }]),
    wsOptsField,
    grpcOptsField,
    httpOptsField,
    h2OptsField,
    xhttpOptsField,
    ...tlsCommonFields({ sniKey: "servername" }),
    realityOptsField,
    { key: "encryption", label: "原生加密串", type: "string", tier: "advanced", sensitive: true, hint: "含 X25519/ML-KEM 私钥材料" },
    { key: "xudp", label: "XUDP 模式", type: "boolean", tier: "advanced", default: false },
    { key: "packet-addr", label: "Packet Addr 模式", type: "boolean", tier: "advanced", default: false },
    {
      key: "packet-encoding",
      label: "UDP 封包编码",
      type: "enum",
      tier: "advanced",
      enumOptions: ["packetaddr", "packet", "xudp"].map((v) => ({ value: v }))
    },
    ...dialerAdvancedFields
  ]
};

const trojanSchema: ProtocolSchema = {
  type: "trojan",
  label: "Trojan",
  fields: [
    { key: "password", label: "密码", type: "string", required: true, sensitive: true, tier: "common" },
    udpField,
    {
      ...networkField(),
      enumOptions: [
        { value: "tcp", label: "TCP + TLS（原始）" },
        { value: "ws", label: "WebSocket" },
        { value: "grpc", label: "gRPC" }
      ]
    },
    wsOptsField,
    grpcOptsField,
    ...tlsCommonFields(),
    realityOptsField,
    {
      key: "ss-opts",
      label: "内层 Shadowsocks 叠加（trojan-go 兼容）",
      type: "object",
      tier: "advanced",
      sensitive: true,
      fields: [
        { key: "enabled", label: "启用", type: "boolean", tier: "common", default: false },
        { key: "method", label: "加密方式", type: "string", tier: "common", default: "AES-128-GCM" },
        { key: "password", label: "密码", type: "string", tier: "common" }
      ]
    },
    ...dialerAdvancedFields
  ]
};

const httpSchema: ProtocolSchema = {
  type: "http",
  label: "HTTP",
  fields: [
    { key: "username", label: "用户名", type: "string", tier: "common" },
    { key: "password", label: "密码", type: "string", sensitive: true, tier: "common" },
    { key: "tls", label: "启用 TLS（HTTPS CONNECT）", type: "boolean", tier: "common", default: false },
    ...tlsCommonFields(),
    { key: "headers", label: "自定义 CONNECT Header", type: "stringMap", tier: "advanced" },
    ...dialerAdvancedFields
  ]
};

const socks5Schema: ProtocolSchema = {
  type: "socks5",
  label: "SOCKS5",
  fields: [
    { key: "username", label: "用户名", type: "string", tier: "common" },
    { key: "password", label: "密码", type: "string", sensitive: true, tier: "common" },
    { key: "tls", label: "启用 TLS（SOCKS5 over TLS）", type: "boolean", tier: "advanced", default: false },
    udpField,
    ...tlsCommonFields(),
    ...dialerAdvancedFields
  ]
};

const snellSchema: ProtocolSchema = {
  type: "snell",
  label: "Snell",
  fields: [
    { key: "psk", label: "PSK（预共享密钥）", type: "string", required: true, sensitive: true, tier: "common" },
    {
      key: "version",
      label: "版本",
      type: "enum",
      tier: "common",
      default: "4",
      enumOptions: ["1", "2", "3", "4", "5"].map((v) => ({ value: v }))
    },
    udpField,
    { key: "reuse", label: "复用连接", type: "boolean", tier: "advanced", default: false, hint: "仅 v4/v5 有效；v2 强制开启" },
    {
      key: "obfs-opts",
      label: "混淆参数",
      type: "object",
      tier: "advanced",
      fields: [
        {
          key: "mode",
          label: "模式",
          type: "enum",
          tier: "common",
          enumOptions: [{ value: "", label: "无" }, { value: "tls" }, { value: "http" }]
        },
        { key: "host", label: "伪装域名", type: "string", tier: "common", placeholder: "bing.com" }
      ]
    },
    ...dialerAdvancedFields
  ]
};

const hysteriaSchema: ProtocolSchema = {
  type: "hysteria",
  label: "Hysteria",
  fields: [
    { key: "ports", label: "端口跳跃范围", type: "string", tier: "common", placeholder: "1000,2000-3000,5000", hint: "与 port 二选一" },
    {
      key: "protocol",
      label: "承载协议",
      type: "enum",
      tier: "common",
      default: "udp",
      enumOptions: ["udp", "wechat-video", "faketcp"].map((v) => ({ value: v }))
    },
    { key: "up", label: "上行带宽", type: "string", required: true, tier: "common", placeholder: "30 Mbps" },
    { key: "down", label: "下行带宽", type: "string", required: true, tier: "common", placeholder: "200 Mbps" },
    { key: "auth-str", label: "认证字符串", type: "string", sensitive: true, tier: "common", hint: "与 auth (base64) 二选一" },
    { key: "auth", label: "认证负载 (base64)", type: "string", sensitive: true, tier: "advanced" },
    { key: "obfs", label: "混淆密码 (XPlus)", type: "string", sensitive: true, tier: "advanced" },
    { key: "sni", label: "SNI", type: "string", tier: "common" },
    { key: "alpn", label: "ALPN", type: "stringList", tier: "advanced", default: ["hysteria"] },
    { key: "skip-cert-verify", label: "跳过证书校验", type: "boolean", tier: "common", default: false },
    { key: "fingerprint", label: "证书 SHA256 指纹", type: "string", tier: "advanced" },
    { key: "certificate", label: "mTLS 客户端证书 (PEM)", type: "string", tier: "advanced" },
    { key: "private-key", label: "mTLS 客户端私钥 (PEM)", type: "string", tier: "advanced", sensitive: true },
    {
      key: "ech-opts",
      label: "ECH 配置",
      type: "object",
      tier: "advanced",
      fields: [
        { key: "enable", label: "启用 ECH", type: "boolean", tier: "common", default: false },
        { key: "config", label: "ECH Config (base64)", type: "string", tier: "common" },
        { key: "query-server-name", label: "Query Server Name", type: "string", tier: "advanced" }
      ]
    },
    { key: "up-speed", label: "上行速度 (Mbps)", type: "number", tier: "advanced" },
    { key: "down-speed", label: "下行速度 (Mbps)", type: "number", tier: "advanced" },
    { key: "recv-window-conn", label: "QUIC 单连接接收窗口", type: "number", tier: "advanced" },
    { key: "recv-window", label: "QUIC 连接接收窗口", type: "number", tier: "advanced" },
    { key: "disable-mtu-discovery", label: "禁用 MTU 发现", type: "boolean", tier: "advanced", default: false },
    { key: "fast-open", label: "Fast Open", type: "boolean", tier: "advanced", default: false },
    { key: "hop-interval", label: "端口跳跃间隔 (秒)", type: "number", tier: "advanced", default: 10 },
    ...dialerAdvancedFields
  ]
};

const hysteria2Schema: ProtocolSchema = {
  type: "hysteria2",
  label: "Hysteria2",
  fields: [
    { key: "ports", label: "端口跳跃范围", type: "string", tier: "common", placeholder: "1000-2000", hint: "与 port 二选一" },
    { key: "password", label: "密码", type: "string", required: true, sensitive: true, tier: "common" },
    {
      key: "obfs",
      label: "混淆类型",
      type: "enum",
      tier: "common",
      enumOptions: [{ value: "", label: "无" }, { value: "salamander" }, { value: "gecko" }]
    },
    { key: "obfs-password", label: "混淆密码", type: "string", sensitive: true, tier: "common", hint: "启用混淆时填写" },
    { key: "sni", label: "SNI", type: "string", tier: "common" },
    { key: "up", label: "上行带宽", type: "string", tier: "common", hint: "留空则使用 BBR 自动流控" },
    { key: "down", label: "下行带宽", type: "string", tier: "common" },
    { key: "skip-cert-verify", label: "跳过证书校验", type: "boolean", tier: "common", default: false },
    { key: "alpn", label: "ALPN", type: "stringList", tier: "advanced" },
    { key: "fingerprint", label: "证书 SHA256 指纹", type: "string", tier: "advanced" },
    { key: "certificate", label: "mTLS 客户端证书 (PEM)", type: "string", tier: "advanced" },
    { key: "private-key", label: "mTLS 客户端私钥 (PEM)", type: "string", tier: "advanced", sensitive: true },
    { key: "hop-interval", label: "端口跳跃间隔（秒）", type: "string", tier: "advanced", default: "30" },
    { key: "cwnd", label: "拥塞窗口", type: "number", tier: "advanced" },
    {
      key: "bbr-profile",
      label: "BBR Profile",
      type: "enum",
      tier: "advanced",
      default: "standard",
      enumOptions: ["standard", "conservative", "aggressive"].map((v) => ({ value: v }))
    },
    { key: "udp-mtu", label: "UDP MTU", type: "number", tier: "advanced", default: 1197 },
    {
      key: "obfs-min-packet-size",
      label: "混淆最小包长（gecko）",
      type: "number",
      tier: "advanced",
      visibleWhen: { field: "obfs", equals: "gecko" }
    },
    {
      key: "obfs-max-packet-size",
      label: "混淆最大包长（gecko）",
      type: "number",
      tier: "advanced",
      visibleWhen: { field: "obfs", equals: "gecko" }
    },
    {
      key: "realm-opts",
      label: "Realm 中转/打洞",
      type: "object",
      tier: "advanced",
      sensitive: true,
      fields: [
        { key: "enable", label: "启用", type: "boolean", tier: "common", default: false },
        { key: "server-url", label: "Server URL", type: "string", tier: "common" },
        { key: "token", label: "Token", type: "string", tier: "common" },
        { key: "realm-id", label: "Realm ID", type: "string", tier: "common" },
        { key: "stun-servers", label: "STUN 服务器", type: "stringList", tier: "advanced" }
      ]
    },
    {
      key: "ech-opts",
      label: "ECH 配置",
      type: "object",
      tier: "advanced",
      fields: [
        { key: "enable", label: "启用 ECH", type: "boolean", tier: "common", default: false },
        { key: "config", label: "ECH Config (base64)", type: "string", tier: "common" }
      ]
    },
    ...dialerAdvancedFields
  ]
};

const tuicSchema: ProtocolSchema = {
  type: "tuic",
  label: "TUIC",
  fields: [
    {
      key: "auth-mode",
      label: "鉴权方式",
      type: "variant",
      tier: "common",
      variants: [
        {
          value: "v5",
          label: "UUID + 密码（v5）",
          fields: [
            { key: "uuid", label: "UUID", type: "string", required: true, sensitive: true, tier: "common" },
            { key: "password", label: "密码", type: "string", required: true, sensitive: true, tier: "common" }
          ]
        },
        {
          value: "v4",
          label: "Token（v4）",
          fields: [{ key: "token", label: "Token", type: "string", required: true, sensitive: true, tier: "common" }]
        }
      ]
    },
    { key: "sni", label: "SNI", type: "string", tier: "common" },
    { key: "skip-cert-verify", label: "跳过证书校验", type: "boolean", tier: "common", default: false },
    { key: "alpn", label: "ALPN", type: "stringList", tier: "advanced", default: ["h3"] },
    { key: "fingerprint", label: "证书 SHA256 指纹", type: "string", tier: "advanced" },
    { key: "certificate", label: "mTLS 客户端证书 (PEM)", type: "string", tier: "advanced" },
    { key: "private-key", label: "mTLS 客户端私钥 (PEM)", type: "string", tier: "advanced", sensitive: true },
    { key: "ip", label: "覆盖解析 IP", type: "string", tier: "advanced" },
    { key: "heartbeat-interval", label: "心跳间隔 (ms)", type: "number", tier: "advanced", default: 10000 },
    { key: "reduce-rtt", label: "0-RTT", type: "boolean", tier: "advanced", default: false },
    { key: "request-timeout", label: "请求超时 (ms)", type: "number", tier: "advanced", default: 8000 },
    {
      key: "udp-relay-mode",
      label: "UDP 转发模式",
      type: "enum",
      tier: "advanced",
      default: "native",
      enumOptions: ["native", "quic"].map((v) => ({ value: v }))
    },
    {
      key: "congestion-controller",
      label: "拥塞控制算法",
      type: "enum",
      tier: "advanced",
      default: "cubic",
      enumOptions: ["cubic", "new_reno", "bbr"].map((v) => ({ value: v }))
    },
    { key: "disable-sni", label: "禁用 SNI", type: "boolean", tier: "advanced", default: false },
    { key: "max-udp-relay-packet-size", label: "UDP 转发最大包长", type: "number", tier: "advanced", default: 1252 },
    { key: "fast-open", label: "Fast Open", type: "boolean", tier: "advanced", default: false },
    { key: "max-open-streams", label: "最大打开流数", type: "number", tier: "advanced", default: 100 },
    { key: "cwnd", label: "拥塞窗口", type: "number", tier: "advanced", default: 32 },
    { key: "disable-mtu-discovery", label: "禁用 MTU 发现", type: "boolean", tier: "advanced", default: false },
    { key: "udp-over-stream", label: "UDP over Stream（Meta 扩展）", type: "boolean", tier: "advanced", default: false },
    ...dialerAdvancedFields
  ]
};

const wireguardSchema: ProtocolSchema = {
  type: "wireguard",
  label: "WireGuard",
  fields: [
    { key: "ip", label: "本机隧道 IPv4", type: "string", tier: "common", hint: "ip / ipv6 至少填一个" },
    { key: "ipv6", label: "本机隧道 IPv6", type: "string", tier: "common" },
    { key: "private-key", label: "本机私钥 (base64)", type: "string", required: true, sensitive: true, tier: "common" },
    { key: "public-key", label: "对端公钥 (base64)", type: "string", required: true, tier: "common", hint: "填写 peers 时忽略此字段" },
    { key: "pre-shared-key", label: "预共享密钥 (base64)", type: "string", sensitive: true, tier: "common" },
    udpField,
    { key: "mtu", label: "MTU", type: "number", tier: "advanced", default: 1408 },
    { key: "persistent-keepalive", label: "保活间隔 (秒)", type: "number", tier: "advanced", default: 0 },
    { key: "workers", label: "Worker 数", type: "number", tier: "advanced" },
    { key: "remote-dns-resolve", label: "远端解析 DNS", type: "boolean", tier: "advanced", default: false },
    { key: "dns", label: "DNS 服务器", type: "stringList", tier: "advanced", visibleWhen: { field: "remote-dns-resolve", equals: true } },
    { key: "refresh-server-ip-interval", label: "刷新服务器 IP 间隔 (秒)", type: "number", tier: "advanced", default: 0 },
    {
      key: "peers",
      label: "多端点 Peers（YAML 片段）",
      type: "objectList",
      tier: "advanced",
      sensitive: true,
      hint: "填写后忽略顶层 server/port/public-key/pre-shared-key；每项需含 server/port/public-key/allowed-ips，可选 pre-shared-key"
    },
    {
      key: "amnezia-wg-option",
      label: "AmneziaWG 抗封锁参数",
      type: "object",
      tier: "advanced",
      fields: [
        { key: "jc", label: "Jc", type: "number", tier: "common" },
        { key: "jmin", label: "Jmin", type: "number", tier: "common" },
        { key: "jmax", label: "Jmax", type: "number", tier: "common" },
        { key: "s1", label: "S1", type: "number", tier: "advanced" },
        { key: "s2", label: "S2", type: "number", tier: "advanced" },
        { key: "h1", label: "H1", type: "string", tier: "advanced" },
        { key: "h2", label: "H2", type: "string", tier: "advanced" },
        { key: "h3", label: "H3", type: "string", tier: "advanced" },
        { key: "h4", label: "H4", type: "string", tier: "advanced" }
      ]
    },
    ...dialerAdvancedFields
  ]
};

const anytlsSchema: ProtocolSchema = {
  type: "anytls",
  label: "AnyTLS",
  fields: [
    { key: "password", label: "密码", type: "string", required: true, sensitive: true, tier: "common" },
    udpField,
    ...tlsCommonFields(),
    { key: "idle-session-check-interval", label: "空闲会话检查间隔 (秒)", type: "number", tier: "advanced" },
    { key: "idle-session-timeout", label: "空闲会话超时 (秒)", type: "number", tier: "advanced" },
    { key: "min-idle-session", label: "最小空闲会话数", type: "number", tier: "advanced" },
    ...dialerAdvancedFields
  ]
};

export const PROTOCOL_SCHEMAS: ProtocolSchema[] = [
  ssSchema,
  ssrSchema,
  vmessSchema,
  vlessSchema,
  trojanSchema,
  httpSchema,
  socks5Schema,
  snellSchema,
  hysteriaSchema,
  hysteria2Schema,
  tuicSchema,
  wireguardSchema,
  anytlsSchema
];

export const findProtocolSchema = (type: string): ProtocolSchema | undefined =>
  PROTOCOL_SCHEMAS.find((schema) => schema.type === type);
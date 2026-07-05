import { Card, CardTitle } from "../components/ui/card";
import { StatusBadge } from "../components/shared";
import { formatRelative, formatTime } from "../lib/format";
import { useInstanceHealth } from "../lib/hooks";
import { useAuth } from "../providers/auth-provider";

export const SettingsPage = () => {
  const { session } = useAuth();
  const health = useInstanceHealth();

  return (
    <div className="mx-auto max-w-[860px] px-5 pb-16 pt-6">
      <div className="mb-5">
        <h1 className="text-lg font-semibold">设置</h1>
        <p className="text-xs text-muted">账号信息与实例健康。订阅链接的管理在各订阅的「访问」页签。</p>
      </div>

      <div className="flex flex-col gap-4">
        <Card>
          <CardTitle>账号</CardTitle>
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-[12.5px]">
            <dt className="text-faint">显示名称</dt>
            <dd>{session?.user.displayName}</dd>
            <dt className="text-faint">用户名</dt>
            <dd className="font-mono text-xs">{session?.user.username}</dd>
            <dt className="text-faint">邮箱</dt>
            <dd className="font-mono text-xs">{session?.user.email}</dd>
          </dl>
        </Card>

        <Card>
          <CardTitle>实例健康</CardTitle>
          {health.data ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-[12.5px]">
              <dt className="text-faint">mihomo 内核校验</dt>
              <dd>
                <StatusBadge
                  ok={health.data.mihomoGate.available}
                  okText="已启用（发布前会用真实内核校验配置）"
                  failText="未启用（降级为结构校验；运行 bun scripts/fetch-mihomo.ts 启用）"
                />
              </dd>
              <dt className="text-faint">后台调度器</dt>
              <dd>
                最近一轮 {health.data.scheduler.lastTickAt ? formatRelative(health.data.scheduler.lastTickAt) : "尚未运行"}
              </dd>
              <dt className="text-faint">数据库</dt>
              <dd className="font-mono text-[11px] text-muted">{health.data.database.path}</dd>
              <dt className="text-faint">公开地址</dt>
              <dd className="font-mono text-[11px] text-muted">{health.data.publicBaseUrl}</dd>
              <dt className="text-faint">内置规则源</dt>
              <dd>{health.data.database.rulesetCatalogCount} 个</dd>
            </dl>
          ) : (
            <p className="text-xs text-faint">载入中…</p>
          )}
        </Card>

        <Card>
          <CardTitle>备份</CardTitle>
          <p className="text-xs text-muted">
            所有数据都在单个 SQLite 文件里（见上方路径），连同 <code className="rounded bg-surface2 px-1 font-mono text-[11px]">data/.secret-key</code>
            （自建节点凭据的加密密钥）一起备份即可完整恢复。停止服务后复制文件是最稳妥的方式。
          </p>
          <p className="mt-2 text-[11px] text-faint">当前时间 {formatTime(new Date().toISOString())}</p>
        </Card>
      </div>
    </div>
  );
};

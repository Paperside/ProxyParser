import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { toast } from "sonner";

import { formatRelative } from "../../lib/format";
import { useAccess, useAccessMutations } from "../../lib/hooks";
import type { IssuedToken } from "../../lib/types";
import { CopyButton, SectionTitle } from "../shared";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardTitle } from "../ui/card";
import { Dialog, DialogContent } from "../ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { useWorkspace } from "./context";

// 新链接只在此刻展示一次（后端只存哈希）
const IssuedTokenDialog = ({ issued, onClose }: { issued: IssuedToken; onClose: () => void }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (canvasRef.current) {
      void QRCode.toCanvas(canvasRef.current, issued.url, {
        width: 168,
        margin: 1,
        color: { dark: "#e8eaf2", light: "#00000000" }
      });
    }
  }, [issued.url]);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title="订阅链接已生成"
        description="出于安全，链接只在此刻完整展示一次——请立即复制或扫码导入。"
      >
        <div className="flex flex-col items-center gap-3">
          <canvas ref={canvasRef} className="rounded-md border border-line bg-surface2 p-1.5" />
          <code className="max-w-full overflow-x-auto whitespace-nowrap rounded-md border border-line bg-bg px-3 py-1.5 font-mono text-[11px] text-muted">
            {issued.url}
          </code>
          <CopyButton text={issued.url} />
        </div>
      </DialogContent>
    </Dialog>
  );
};

export const AccessTab = () => {
  const { detail } = useWorkspace();
  const access = useAccess(detail.id);
  const mutations = useAccessMutations(detail.id);
  const [issued, setIssued] = useState<IssuedToken | null>(null);
  const [ttlHours, setTtlHours] = useState("24");

  const handle = (promise: Promise<IssuedToken>) =>
    promise
      .then(setIssued)
      .catch((error: unknown) => toast.error(error instanceof Error ? error.message : "操作失败"));

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <SectionTitle
        title="访问"
        desc="每条链接独立可轮换：换掉一台设备的链接不影响其他设备。链接明文只在生成时展示一次。"
      />

      <Card>
        <CardTitle>
          长期链接
          <Button
            size="sm"
            className="ml-auto"
            onClick={() => handle(mutations.createToken.mutateAsync("新设备"))}
          >
            生成新链接
          </Button>
        </CardTitle>
        <div className="flex flex-col">
          {(access.data?.tokens ?? []).map((token) => (
            <div key={token.id} className="flex items-center gap-2.5 border-b border-line py-2 text-[12.5px] last:border-b-0">
              <span className="font-medium">{token.label ?? "未命名"}</span>
              {token.revokedAt ? <Badge variant="err">已撤销</Badge> : <Badge variant="ok">有效</Badge>}
              <span className="text-[11px] text-faint">
                创建 {formatRelative(token.createdAt)} · 最近使用 {formatRelative(token.lastUsedAt)}
              </span>
              {!token.revokedAt ? (
                <span className="ml-auto flex gap-1.5">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      if (confirm("轮换后旧链接立即失效，使用它的设备需要更换新链接。继续？")) {
                        handle(mutations.rotateToken.mutateAsync(token.id));
                      }
                    }}
                  >
                    轮换
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => {
                      if (confirm("撤销后此链接立即失效。继续？")) {
                        void mutations.revokeToken.mutateAsync(token.id);
                      }
                    }}
                  >
                    撤销
                  </Button>
                </span>
              ) : null}
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <CardTitle>
          短期分享链接
          <span className="ml-auto flex items-center gap-2">
            <Select value={ttlHours} onValueChange={setTtlHours}>
              <SelectTrigger className="h-6.5 w-28 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="1">1 小时</SelectItem>
                <SelectItem value="24">24 小时</SelectItem>
                <SelectItem value="168">7 天</SelectItem>
                <SelectItem value="720">30 天</SelectItem>
              </SelectContent>
            </Select>
            <Button
              size="sm"
              onClick={() =>
                handle(
                  mutations.createTempToken.mutateAsync({
                    label: "分享",
                    ttlSeconds: Number(ttlHours) * 3600
                  })
                )
              }
            >
              生成
            </Button>
          </span>
        </CardTitle>
        <div className="flex flex-col">
          {(access.data?.tempTokens ?? []).map((token) => {
            const expired = token.expiresAt ? new Date(token.expiresAt).getTime() < Date.now() : false;
            return (
              <div key={token.id} className="flex items-center gap-2.5 border-b border-line py-2 text-[12.5px] last:border-b-0">
                <span>{token.label ?? "分享链接"}</span>
                {token.revokedAt ? (
                  <Badge variant="err">已撤销</Badge>
                ) : expired ? (
                  <Badge>已过期</Badge>
                ) : (
                  <Badge variant="ok">有效 · {formatRelative(token.expiresAt ?? null)}到期</Badge>
                )}
                {!token.revokedAt && !expired ? (
                  <Button
                    size="sm"
                    variant="danger"
                    className="ml-auto"
                    onClick={() => void mutations.revokeTempToken.mutateAsync(token.id)}
                  >
                    立即失效
                  </Button>
                ) : null}
              </div>
            );
          })}
          {access.data?.tempTokens.length === 0 ? (
            <p className="text-xs text-faint">给朋友临时用？生成一条到期自动失效的链接。</p>
          ) : null}
        </div>
      </Card>

      <Card>
        <CardTitle>拉取日志</CardTitle>
        <div className="flex flex-col">
          {(access.data?.pullLogs ?? []).slice(0, 20).map((log) => (
            <div key={log.id} className="flex items-center gap-2.5 border-b border-line py-1.5 font-mono text-[11px] text-muted last:border-b-0">
              <span className={log.status === "success" ? "text-ok" : "text-warn"}>
                {log.http_status}
              </span>
              <span>{formatRelative(log.created_at)}</span>
              <span className="truncate text-faint">{log.user_agent ?? "unknown"}</span>
              <span className="ml-auto text-faint">{log.client_ip ?? ""}</span>
            </div>
          ))}
          {access.data?.pullLogs.length === 0 ? (
            <p className="text-xs text-faint">还没有拉取记录。</p>
          ) : null}
        </div>
      </Card>

      {issued ? <IssuedTokenDialog issued={issued} onClose={() => setIssued(null)} /> : null}
    </div>
  );
};

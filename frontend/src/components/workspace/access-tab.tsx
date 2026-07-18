import { useState } from "react";
import { toast } from "sonner";

import { formatRelative } from "../../lib/format";
import { useAccess, useAccessMutations } from "../../lib/hooks";
import type { IssuedToken, TokenInfo } from "../../lib/types";
import { AsyncCopyButton, CopyButton, QrCode, SectionTitle } from "../shared";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardTitle } from "../ui/card";
import { Dialog, DialogContent, DialogFooter } from "../ui/dialog";
import { Field, Input } from "../ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { useWorkspace } from "./context";

// 新链接只在此刻展示一次（后端只存哈希用于鉴权比对，明文另有加密副本供之后按需复制）
const IssuedTokenDialog = ({ issued, onClose }: { issued: IssuedToken; onClose: () => void }) => (
  <Dialog open onOpenChange={(open) => !open && onClose()}>
    <DialogContent
      title="订阅链接已生成"
      description="链接明文已加密保存，之后可在列表里随时点「复制」取回；这里再额外展示一次方便你现在就导入。"
    >
      <div className="flex flex-col items-center gap-3">
        <QrCode url={issued.url} />
        <code className="max-w-full overflow-x-auto whitespace-nowrap rounded-md border border-line bg-bg px-3 py-1.5 font-mono text-[11px] text-muted">
          {issued.url}
        </code>
        <CopyButton text={issued.url} />
      </div>
    </DialogContent>
  </Dialog>
);

const RenameTokenDialog = ({
  token,
  onClose,
  onSave
}: {
  token: TokenInfo;
  onClose: () => void;
  onSave: (label: string) => void;
}) => {
  const [label, setLabel] = useState(token.label ?? "");
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent title="重命名链接">
        <Field label="名称">
          <Input autoFocus value={label} onChange={(event) => setLabel(event.target.value)} placeholder="例如：客厅路由器" />
        </Field>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button variant="primary" onClick={() => onSave(label.trim())}>保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export const AccessTab = () => {
  const { detail } = useWorkspace();
  const access = useAccess(detail.id);
  const mutations = useAccessMutations(detail.id);
  const [issued, setIssued] = useState<IssuedToken | null>(null);
  const [renaming, setRenaming] = useState<TokenInfo | null>(null);
  const [ttlHours, setTtlHours] = useState("24");

  const handle = (promise: Promise<IssuedToken>) =>
    promise
      .then(setIssued)
      .catch((error: unknown) => toast.error(error instanceof Error ? error.message : "操作失败"));

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <SectionTitle
        title="访问"
        desc="每条链接独立可轮换：换掉一台设备的链接不影响其他设备。列表里的「复制」随时可用，明文以加密形式保存。"
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
              <Badge variant="ok">有效</Badge>
              <span className="text-[11px] text-faint">
                创建 {formatRelative(token.createdAt)} · 最近使用 {formatRelative(token.lastUsedAt)}
              </span>
              <span className="ml-auto flex gap-1.5">
                <AsyncCopyButton
                  qrTitle={`${token.label ?? "长期链接"}二维码`}
                  onReveal={async () => (await mutations.revealToken.mutateAsync(token.id)).url}
                />
                <Button size="sm" variant="ghost" onClick={() => setRenaming(token)}>
                  重命名
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    if (confirm("轮换后旧链接立即失效，使用它的设备需要更换新链接；名称会保留。继续？")) {
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
                    if (confirm("删除后此链接立即失效，且从列表中移除，无法恢复。继续？")) {
                      void mutations.revokeToken.mutateAsync(token.id);
                    }
                  }}
                >
                  删除
                </Button>
              </span>
            </div>
          ))}
          {access.data?.tokens.length === 0 ? (
            <p className="text-xs text-faint">还没有长期链接，点「生成新链接」创建第一条。</p>
          ) : null}
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
                  <span className="ml-auto flex items-center gap-1.5">
                    {token.canReveal === false ? (
                      <span
                        className="text-[11px] text-faint"
                        title="此链接创建于安全恢复能力上线前，明文没有被保存"
                      >
                        旧链接不可再次查看，请重新生成
                      </span>
                    ) : (
                      <AsyncCopyButton
                        qrTitle={`${token.label ?? "短期链接"}二维码`}
                        onReveal={async () =>
                          (await mutations.revealTempToken.mutateAsync(token.id)).url
                        }
                      />
                    )}
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => void mutations.revokeTempToken.mutateAsync(token.id)}
                    >
                      立即失效
                    </Button>
                  </span>
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
      {renaming ? (
        <RenameTokenDialog
          token={renaming}
          onClose={() => setRenaming(null)}
          onSave={(label) => {
            mutations.renameToken
              .mutateAsync({ tokenId: renaming.id, label: label.length > 0 ? label : null })
              .then(() => setRenaming(null))
              .catch((error: unknown) => toast.error(error instanceof Error ? error.message : "重命名失败"));
          }}
        />
      ) : null}
    </div>
  );
};

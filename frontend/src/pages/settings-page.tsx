import { Copy, KeyRound, RefreshCw, Save, ShieldCheck, UserRound } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";

import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { ScrollArea } from "../components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "../components/ui/select";
import { copyText } from "../lib/clipboard";
import type { AuditLogEntry } from "../lib/types";
import { useAuth } from "../providers/auth-provider";
import { useWorkspace } from "../providers/workspace-provider";

export const SettingsPage = () => {
  const auth = useAuth();
  const workspace = useWorkspace();
  const user = auth.session?.user;
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [form, setForm] = useState({
    displayName: user?.displayName ?? "",
    locale: user?.locale ?? "zh-CN"
  });
  const [message, setMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isRotating, setIsRotating] = useState(false);
  const [isLoadingAuditLogs, setIsLoadingAuditLogs] = useState(false);

  const loadAuditLogs = async () => {
    if (!auth.session) {
      setAuditLogs([]);
      return;
    }

    setIsLoadingAuditLogs(true);

    try {
      const entries = await auth.authorizedRequest<AuditLogEntry[]>("/api/settings/audit-logs");
      setAuditLogs(entries);
    } finally {
      setIsLoadingAuditLogs(false);
    }
  };

  useEffect(() => {
    setForm({
      displayName: user?.displayName ?? "",
      locale: user?.locale ?? "zh-CN"
    });
  }, [user?.displayName, user?.locale]);

  useEffect(() => {
    void loadAuditLogs();
  }, [auth.session?.user.id]);

  const revealedSecret = auth.revealedSubscriptionSecret;
  const auditActionText: Record<string, string> = {
    "auth.register": "注册账号",
    "auth.login": "登录账号",
    "auth.refresh": "刷新会话",
    "user.profile.update": "更新个人资料",
    "subscription_secret.rotate": "轮换长期订阅秘钥",
    "subscription.temp_token.create": "创建临时拉取令牌",
    "draft.publish": "发布生成订阅",
    "draft.extract_template": "从草稿提炼模板"
  };

  const secretHint = useMemo(() => {
    if (revealedSecret) {
      return "这是最近一次生成的长期秘钥，请尽快妥善保存。";
    }

    return "出于安全原因，长期秘钥不会再次展示；如需新的秘钥，请重新生成。";
  }, [revealedSecret]);

  const handleSaveProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSaving(true);
    setMessage(null);

    try {
      await auth.updateCurrentUser(form);
      await loadAuditLogs();
      setMessage("个人资料已更新。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存失败。");
    } finally {
      setIsSaving(false);
    }
  };

  const handleRotateSecret = async () => {
    setIsRotating(true);
    setMessage(null);

    try {
      await workspace.rotateSubscriptionSecret();
      await loadAuditLogs();
      setMessage("新的长期秘钥已生成。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "生成秘钥失败。");
    } finally {
      setIsRotating(false);
    }
  };

  const handleCopySecret = async () => {
    if (!revealedSecret) {
      return;
    }

    try {
      await copyText(revealedSecret);
      setMessage("长期秘钥已复制。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "复制失败。");
    }
  };

  return (
    <div className="space-y-6">
      {message ? (
        <div className="rounded-[28px] border border-slate-200 bg-white/80 px-5 py-4 text-sm text-slate-600 shadow-[0_18px_45px_rgba(15,23,42,0.06)] backdrop-blur-xl">
          {message}
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(340px,0.85fr)]">
        <Card className="rounded-[32px] p-6">
          <div className="flex items-start gap-4">
            <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-slate-950 text-white">
              <UserRound className="size-5" />
            </div>
            <div>
              <h3 className="text-xl font-semibold tracking-tight text-slate-950">个人资料</h3>
              <p className="mt-2 text-sm text-slate-500">维护展示名称与界面语言设置。</p>
            </div>
          </div>

          <form className="mt-6 space-y-4" onSubmit={handleSaveProfile}>
            <label className="block space-y-2">
              <span className="text-sm font-medium text-slate-600">邮箱</span>
              <Input value={user?.email ?? ""} readOnly className="bg-slate-50 text-slate-500" />
            </label>

            <label className="block space-y-2">
              <span className="text-sm font-medium text-slate-600">用户名</span>
              <Input
                value={user?.username ?? ""}
                readOnly
                className="bg-slate-50 text-slate-500"
              />
            </label>

            <label className="block space-y-2">
              <span className="text-sm font-medium text-slate-600">显示名称</span>
              <Input
                value={form.displayName}
                onChange={(event) => {
                  setForm((current) => ({
                    ...current,
                    displayName: event.target.value
                  }));
                }}
                placeholder="用于页面展示"
              />
            </label>

            <label className="block space-y-2">
              <span className="text-sm font-medium text-slate-600">界面语言</span>
              <Select
                value={form.locale}
                onValueChange={(value) => {
                  setForm((current) => ({
                    ...current,
                    locale: value
                  }));
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="选择语言" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="zh-CN">简体中文</SelectItem>
                  <SelectItem value="en-US">English</SelectItem>
                </SelectContent>
              </Select>
            </label>

            <Button type="submit" disabled={isSaving}>
              <Save className="size-4" />
              {isSaving ? "保存中..." : "保存资料"}
            </Button>
          </form>
        </Card>

        <div className="space-y-6">
          <Card className="rounded-[32px] p-6">
            <div className="flex items-start gap-4">
              <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-slate-950 text-white">
                <KeyRound className="size-5" />
              </div>
              <div>
                <h3 className="text-xl font-semibold tracking-tight text-slate-950">订阅秘钥</h3>
                <p className="mt-2 text-sm text-slate-500">
                  所有生成订阅共享同一套长期秘钥，也可以单独生成临时链接。
                </p>
              </div>
            </div>

            <div className="mt-6 rounded-[24px] border border-slate-200 bg-slate-50/80 p-4">
              <div className="flex items-center justify-between gap-3">
                <Badge className="border-slate-200 bg-white text-slate-600">长期秘钥</Badge>
                <Button
                  variant="secondary"
                  disabled={isRotating}
                  onClick={() => void handleRotateSecret()}
                >
                  <RefreshCw className="size-4" />
                  {isRotating ? "生成中..." : "重新生成"}
                </Button>
              </div>

              <p className="mt-4 text-sm text-slate-500">{secretHint}</p>

              {revealedSecret ? (
                <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                  <Input value={revealedSecret} readOnly className="font-mono text-xs" />
                  <Button variant="ghost" onClick={() => void handleCopySecret()}>
                    <Copy className="size-4" />
                    复制
                  </Button>
                </div>
              ) : null}
            </div>
          </Card>

          <Card className="rounded-[32px] p-6">
            <h3 className="text-xl font-semibold tracking-tight text-slate-950">账号信息</h3>
            <div className="mt-5 grid gap-3 text-sm text-slate-500">
              <p>创建时间：{user ? new Date(user.createdAt).toLocaleString("zh-CN") : "暂无"}</p>
              <p>最近更新：{user ? new Date(user.updatedAt).toLocaleString("zh-CN") : "暂无"}</p>
              <p>账号状态：{user?.status === "active" ? "正常" : "已停用"}</p>
            </div>
          </Card>

          <Card className="rounded-[32px] p-6">
            <div className="flex items-start gap-4">
              <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-slate-950 text-white">
                <ShieldCheck className="size-5" />
              </div>
              <div>
                <h3 className="text-xl font-semibold tracking-tight text-slate-950">最近安全活动</h3>
                <p className="mt-2 text-sm text-slate-500">展示最近的登录、秘钥与发布相关操作。</p>
              </div>
            </div>

            <ScrollArea className="mt-6 h-[320px] pr-4">
              <div className="space-y-3">
                {isLoadingAuditLogs ? (
                  <div className="rounded-[24px] border border-slate-200 bg-slate-50/80 px-4 py-3 text-sm text-slate-500">
                    正在加载最近活动...
                  </div>
                ) : auditLogs.length > 0 ? (
                  auditLogs.map((entry) => (
                    <div
                      key={entry.id}
                      className="rounded-[24px] border border-slate-200 bg-slate-50/80 px-4 py-4"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge className="border-slate-200 bg-white text-slate-600">
                          {auditActionText[entry.action] ?? entry.action}
                        </Badge>
                        <span className="text-xs text-slate-400">
                          {new Date(entry.createdAt).toLocaleString("zh-CN")}
                        </span>
                      </div>
                      <p className="mt-3 text-sm text-slate-600">
                        {entry.summary ?? "已记录一条安全相关活动。"}
                      </p>
                    </div>
                  ))
                ) : (
                  <div className="rounded-[24px] border border-dashed border-slate-200 bg-slate-50/70 px-4 py-5 text-sm text-slate-500">
                    暂无最近活动。
                  </div>
                )}
              </div>
            </ScrollArea>
          </Card>
        </div>
      </div>
    </div>
  );
};

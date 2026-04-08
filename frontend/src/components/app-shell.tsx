import * as Avatar from "@radix-ui/react-avatar";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Link, useRouterState } from "@tanstack/react-router";
import {
  Layers3,
  LayoutDashboard,
  LogOut,
  RefreshCw,
  Settings2,
  Sparkles,
  Waypoints
} from "lucide-react";
import { type PropsWithChildren, useMemo, useState } from "react";

import { cn } from "../lib/cn";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { ScrollArea } from "./ui/scroll-area";
import { Separator } from "./ui/separator";
import { useAuth } from "../providers/auth-provider";
import { useWorkspace } from "../providers/workspace-provider";

const navigationItems = [
  {
    to: "/dashboard",
    label: "仪表盘",
    icon: LayoutDashboard
  },
  {
    to: "/subscriptions",
    label: "订阅",
    icon: Waypoints
  },
  {
    to: "/templates",
    label: "模板",
    icon: Layers3
  }
] as const;

const pageTitles = {
  "/dashboard": {
    title: "工作台",
    description: "集中查看你的外部订阅、模板与生成订阅。"
  },
  "/subscriptions": {
    title: "订阅管理",
    description: "统一管理外部订阅和生成订阅。"
  },
  "/templates": {
    title: "模板中心",
    description: "组织自己的模板，并浏览社区模板与规则源。"
  },
  "/settings": {
    title: "个人设置",
    description: "维护个人资料与订阅秘钥。"
  }
} as const;

const getInitials = (value: string) => {
  const trimmed = value.trim();

  if (!trimmed) {
    return "PP";
  }

  return trimmed.slice(0, 2).toUpperCase();
};

const getPageMeta = (pathname: string) => {
  if (pathname.startsWith("/subscriptions")) {
    return pageTitles["/subscriptions"];
  }

  if (pathname.startsWith("/templates")) {
    return pageTitles["/templates"];
  }

  if (pathname.startsWith("/settings")) {
    return pageTitles["/settings"];
  }

  return pageTitles["/dashboard"];
};

const navLinkClassName =
  "group flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-medium text-slate-500 transition hover:bg-white hover:text-slate-950";

export const AppShell = ({ children }: PropsWithChildren) => {
  const auth = useAuth();
  const workspace = useWorkspace();
  const pathname = useRouterState({
    select: (state) => state.location.pathname
  });
  const pageMeta = getPageMeta(pathname);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const todayText = useMemo(() => {
    return new Intl.DateTimeFormat("zh-CN", {
      month: "long",
      day: "numeric",
      weekday: "long"
    }).format(new Date());
  }, []);

  const handleRefresh = async () => {
    setIsRefreshing(true);

    try {
      await workspace.refreshAll();
    } finally {
      setIsRefreshing(false);
    }
  };

  const displayName = auth.session?.user.displayName || auth.session?.user.username || "ProxyParser";

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#f4f7fb] text-slate-950">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-[-12%] top-[-8%] h-72 w-72 rounded-full bg-sky-200/35 blur-3xl" />
        <div className="absolute bottom-[-16%] right-[-8%] h-96 w-96 rounded-full bg-emerald-200/30 blur-3xl" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.88),rgba(244,247,251,0.78)_42%,rgba(240,244,248,0.9))]" />
      </div>

      <div className="relative mx-auto flex min-h-screen w-full max-w-[1600px] gap-4 p-4 lg:gap-6 lg:p-6">
        <aside className="hidden w-72 shrink-0 flex-col rounded-[32px] border border-white/70 bg-white/70 p-5 shadow-[0_24px_70px_rgba(15,23,42,0.08)] backdrop-blur-xl lg:flex">
          <div className="flex items-center gap-3 px-2">
            <div className="flex size-11 items-center justify-center rounded-2xl bg-slate-950 text-white shadow-[0_12px_30px_rgba(15,23,42,0.16)]">
              <Sparkles className="size-5" />
            </div>
            <div>
              <p className="text-sm font-medium text-slate-500">Mihomo Workspace</p>
              <h1 className="text-lg font-semibold tracking-tight">ProxyParser</h1>
            </div>
          </div>

          <Separator className="my-5" />

          <ScrollArea className="flex-1">
            <nav className="space-y-2 pr-3">
              {navigationItems.map((item) => {
                const Icon = item.icon;

                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    className={navLinkClassName}
                    activeProps={{
                      className:
                        "bg-slate-950 text-white shadow-[0_18px_40px_rgba(15,23,42,0.14)] hover:bg-slate-950 hover:text-white"
                    }}
                  >
                    <Icon className="size-4" />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </nav>
          </ScrollArea>

          <Separator className="my-5" />

          <Link
            to="/settings"
            className={navLinkClassName}
            activeProps={{
              className:
                "bg-slate-950 text-white shadow-[0_18px_40px_rgba(15,23,42,0.14)] hover:bg-slate-950 hover:text-white"
            }}
          >
            <Settings2 className="size-4" />
            <span>设置</span>
          </Link>

          <div className="mt-4 rounded-[24px] border border-slate-200/80 bg-slate-50/80 p-4">
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-400">当前账号</p>
            <p className="mt-2 text-base font-semibold text-slate-950">{displayName}</p>
            <p className="mt-1 text-sm text-slate-500">{auth.session?.user.email}</p>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col gap-4 lg:gap-6">
          <header className="rounded-[32px] border border-white/70 bg-white/68 p-4 shadow-[0_24px_70px_rgba(15,23,42,0.08)] backdrop-blur-xl lg:p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className="border-sky-200 bg-sky-50 text-sky-700">{todayText}</Badge>
                  {workspace.isLoading ? (
                    <Badge className="border-amber-200 bg-amber-50 text-amber-700">
                      正在同步数据
                    </Badge>
                  ) : null}
                </div>
                <div>
                  <h2 className="text-2xl font-semibold tracking-tight">{pageMeta.title}</h2>
                  <p className="mt-1 text-sm text-slate-500">{pageMeta.description}</p>
                </div>
              </div>

              <div className="flex items-center justify-between gap-3 lg:justify-end">
                <Button
                  variant="secondary"
                  onClick={() => void handleRefresh()}
                  disabled={isRefreshing || workspace.isLoading}
                  className="shrink-0"
                >
                  <RefreshCw className={cn("size-4", (isRefreshing || workspace.isLoading) && "animate-spin")} />
                  刷新数据
                </Button>

                <DropdownMenu.Root>
                  <DropdownMenu.Trigger asChild>
                    <button className="inline-flex items-center gap-3 rounded-2xl border border-slate-200 bg-white/90 px-3 py-2 text-left shadow-[0_12px_30px_rgba(15,23,42,0.06)] transition hover:border-slate-300">
                      <Avatar.Root className="flex size-10 items-center justify-center overflow-hidden rounded-2xl bg-slate-950 text-sm font-semibold text-white">
                        <Avatar.Fallback>{getInitials(displayName)}</Avatar.Fallback>
                      </Avatar.Root>
                      <div className="hidden min-w-0 sm:block">
                        <p className="truncate text-sm font-medium text-slate-950">{displayName}</p>
                        <p className="truncate text-xs text-slate-500">{auth.session?.user.username}</p>
                      </div>
                    </button>
                  </DropdownMenu.Trigger>

                  <DropdownMenu.Portal>
                    <DropdownMenu.Content
                      align="end"
                      sideOffset={10}
                      className="z-50 min-w-56 rounded-2xl border border-slate-200 bg-white p-2 shadow-[0_24px_70px_rgba(15,23,42,0.12)]"
                    >
                      <DropdownMenu.Item asChild>
                        <Link
                          to="/settings"
                          className="flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2 text-sm text-slate-700 outline-none transition hover:bg-slate-100"
                        >
                          <Settings2 className="size-4" />
                          个人设置
                        </Link>
                      </DropdownMenu.Item>
                      <DropdownMenu.Item
                        className="flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2 text-sm text-rose-600 outline-none transition hover:bg-rose-50"
                        onSelect={() => {
                          void auth.logout();
                        }}
                      >
                        <LogOut className="size-4" />
                        退出登录
                      </DropdownMenu.Item>
                    </DropdownMenu.Content>
                  </DropdownMenu.Portal>
                </DropdownMenu.Root>
              </div>
            </div>

            <div className="mt-4 flex gap-2 overflow-x-auto pb-1 lg:hidden">
              {navigationItems.map((item) => {
                const Icon = item.icon;

                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    className="inline-flex shrink-0 items-center gap-2 rounded-2xl border border-slate-200 bg-white/90 px-4 py-2.5 text-sm font-medium text-slate-500"
                    activeProps={{
                      className: "border-slate-950 bg-slate-950 text-white"
                    }}
                  >
                    <Icon className="size-4" />
                    {item.label}
                  </Link>
                );
              })}

              <Link
                to="/settings"
                className="inline-flex shrink-0 items-center gap-2 rounded-2xl border border-slate-200 bg-white/90 px-4 py-2.5 text-sm font-medium text-slate-500"
                activeProps={{
                  className: "border-slate-950 bg-slate-950 text-white"
                }}
              >
                <Settings2 className="size-4" />
                设置
              </Link>
            </div>
          </header>

          <main className="min-h-0 flex-1">{children}</main>
        </div>
      </div>
    </div>
  );
};

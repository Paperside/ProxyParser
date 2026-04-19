import * as Avatar from "@radix-ui/react-avatar";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Link, useRouterState } from "@tanstack/react-router";
import {
  ChevronDown,
  type LucideIcon,
  LayoutDashboard,
  Layers3,
  LogOut,
  RefreshCw,
  Settings2,
  Sparkles,
  Waypoints
} from "lucide-react";
import { type PropsWithChildren, useMemo, useState } from "react";

import { useAuth } from "../providers/auth-provider";
import { useWorkspace } from "../providers/workspace-provider";
import { cn } from "../lib/cn";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Separator } from "./ui/separator";

type NavigationLinkChild = {
  label: string;
  matchPrefixes: readonly string[];
  to: string;
};

type NavigationItem =
  | {
      exact?: boolean;
      icon: LucideIcon;
      id: string;
      kind: "link";
      label: string;
      to: string;
    }
  | {
      basePath: string;
      children: readonly NavigationLinkChild[];
      icon: LucideIcon;
      id: string;
      kind: "group";
      label: string;
    };

type NavigationGroupItem = Extract<NavigationItem, { kind: "group" }>;

const navigationItems: readonly NavigationItem[] = [
  {
    exact: true,
    icon: LayoutDashboard,
    id: "dashboard",
    kind: "link",
    label: "仪表盘",
    to: "/dashboard"
  },
  {
    basePath: "/subscriptions",
    children: [
      {
        label: "外部订阅",
        matchPrefixes: ["/subscriptions/upstream"],
        to: "/subscriptions/upstream"
      },
      {
        label: "生成订阅",
        matchPrefixes: ["/subscriptions/generated", "/subscriptions/drafts"],
        to: "/subscriptions/generated"
      }
    ],
    icon: Waypoints,
    id: "subscriptions",
    kind: "group",
    label: "订阅"
  },
  {
    basePath: "/templates",
    children: [
      {
        label: "我的模板",
        matchPrefixes: ["/templates/mine"],
        to: "/templates/mine"
      },
      {
        label: "模板市场",
        matchPrefixes: ["/templates/market"],
        to: "/templates/market"
      }
    ],
    icon: Layers3,
    id: "templates",
    kind: "group",
    label: "模板"
  }
];

const isNavigationGroup = (item: NavigationItem): item is NavigationGroupItem => {
  return item.kind === "group";
};

const pageTitles = {
  "/dashboard": {
    description: "集中查看你的外部订阅、模板与生成订阅。",
    title: "工作台"
  },
  "/settings": {
    description: "维护个人资料与订阅秘钥。",
    title: "个人设置"
  },
  "/subscriptions": {
    description: "统一管理外部订阅和生成订阅。",
    title: "订阅管理"
  },
  "/templates": {
    description: "组织自己的模板，并浏览社区模板与规则源。",
    title: "模板中心"
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

const isRouteActive = (pathname: string, to: string, exact = false) => {
  if (exact) {
    return pathname === to;
  }

  return pathname === to || pathname.startsWith(`${to}/`);
};

const isChildRouteActive = (pathname: string, child: NavigationLinkChild) => {
  return child.matchPrefixes.some((prefix) => isRouteActive(pathname, prefix, true));
};

const navLinkBaseClassName =
  "flex min-h-[52px] w-full items-center gap-3 rounded-2xl border-0 bg-transparent px-4 py-3 text-sm font-medium leading-5 transition-[background-color,color,box-shadow] duration-200";

const getDesktopNavLinkClassName = (isActive: boolean) =>
  cn(
    navLinkBaseClassName,
    isActive
      ? "bg-slate-950 text-white shadow-[0_18px_40px_rgba(15,23,42,0.14)]"
      : "text-slate-500 hover:bg-slate-100/90 hover:text-slate-950"
  );

const getDesktopGroupClassName = (isActive: boolean, isExpanded: boolean) =>
  cn(
    navLinkBaseClassName,
    "relative pr-12 text-left",
    isActive && !isExpanded
      ? "bg-slate-950 text-white shadow-[0_18px_40px_rgba(15,23,42,0.14)]"
      : isActive || isExpanded
        ? "bg-slate-100/90 text-slate-950 ring-1 ring-slate-200/80"
        : "text-slate-500 hover:bg-slate-100/90 hover:text-slate-950"
  );

const getDesktopGroupChevronClassName = (isActive: boolean, isExpanded: boolean) =>
  cn(
    "pointer-events-none absolute right-4 top-1/2 size-4 -translate-y-1/2 shrink-0 transition-transform duration-200",
    isExpanded && "rotate-180",
    isActive && !isExpanded ? "text-white" : "text-current"
  );

const getDesktopChildLinkClassName = (isActive: boolean) =>
  cn(
    "flex min-h-11 items-center rounded-xl px-4 py-2.5 text-sm font-medium leading-5 transition-[background-color,color,box-shadow] duration-200",
    isActive
      ? "bg-slate-950 text-white shadow-[0_14px_32px_rgba(15,23,42,0.12)]"
      : "text-slate-500 hover:bg-slate-100/90 hover:text-slate-950"
  );

const getMobileNavLinkClassName = (isActive: boolean) =>
  cn(
    "inline-flex shrink-0 items-center gap-2 rounded-2xl border px-4 py-2.5 text-sm font-medium transition-colors",
    isActive
      ? "border-slate-950 bg-slate-950 text-white"
      : "border-slate-200 bg-white/90 text-slate-500 hover:border-slate-300 hover:text-slate-950"
  );

const getMobileChildLinkClassName = (isActive: boolean) =>
  cn(
    "inline-flex shrink-0 items-center gap-2 rounded-2xl border px-4 py-2 text-sm font-medium transition-colors",
    isActive
      ? "border-slate-950 bg-slate-950 text-white"
      : "border-slate-200 bg-white/90 text-slate-500 hover:border-slate-300 hover:text-slate-950"
  );

export const AppShell = ({ children }: PropsWithChildren) => {
  const auth = useAuth();
  const workspace = useWorkspace();
  const pathname = useRouterState({
    select: (state) => state.location.pathname
  });
  const pageMeta = getPageMeta(pathname);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [isRefreshing, setIsRefreshing] = useState(false);

  const todayText = useMemo(() => {
    return new Intl.DateTimeFormat("zh-CN", {
      day: "numeric",
      month: "long",
      weekday: "long"
    }).format(new Date());
  }, []);

  const activeMobileGroup = useMemo(() => {
    return navigationItems.find(
      (item): item is NavigationGroupItem =>
        isNavigationGroup(item) && isRouteActive(pathname, item.basePath)
    );
  }, [pathname]);

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
    <div className="relative h-screen overflow-hidden bg-[#f4f7fb] text-slate-950">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-[-12%] top-[-8%] h-72 w-72 rounded-full bg-sky-200/35 blur-3xl" />
        <div className="absolute bottom-[-16%] right-[-8%] h-96 w-96 rounded-full bg-emerald-200/30 blur-3xl" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.88),rgba(244,247,251,0.78)_42%,rgba(240,244,248,0.9))]" />
      </div>

      <div className="relative mx-auto flex h-full w-full max-w-[1600px] gap-4 p-4 lg:gap-6 lg:p-6">
        <aside className="hidden h-full w-72 shrink-0 flex-col rounded-[32px] border border-white/70 bg-white/70 p-5 backdrop-blur-xl lg:flex">
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

          <div className="flex-1 py-2">
            <nav className="space-y-2">
              {navigationItems.map((item) => {
                const Icon = item.icon;

                if (item.kind === "link") {
                  return (
                    <Link
                      key={item.id}
                      to={item.to}
                      activeOptions={{ exact: item.exact }}
                      className={getDesktopNavLinkClassName(
                        isRouteActive(pathname, item.to, item.exact)
                      )}
                    >
                      <Icon className="size-4 shrink-0" />
                      <span className="text-inherit">{item.label}</span>
                    </Link>
                  );
                }

                const isActive = isRouteActive(pathname, item.basePath);
                const isExpanded = expandedGroups[item.id] ?? isActive;

                return (
                  <div key={item.id} className="space-y-2">
                    <button
                      type="button"
                      aria-expanded={isExpanded}
                      onClick={() => {
                        setExpandedGroups((current) => ({
                          ...current,
                          [item.id]: !(current[item.id] ?? isActive)
                        }));
                      }}
                      className={getDesktopGroupClassName(isActive, isExpanded)}
                    >
                      <span className="flex items-center gap-3">
                        <Icon className="size-4 shrink-0" />
                        <span>{item.label}</span>
                      </span>
                      <ChevronDown
                        aria-hidden="true"
                        className={getDesktopGroupChevronClassName(isActive, isExpanded)}
                      />
                    </button>

                    <div
                      className={cn(
                        "grid transition-[grid-template-rows,opacity] duration-200 ease-out",
                        isExpanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
                      )}
                    >
                      <div className="min-h-0 overflow-hidden pl-4">
                        <div className="space-y-1 border-l border-slate-200/80 pl-4">
                          {item.children.map((child) => (
                            <Link
                              key={child.to}
                              to={child.to}
                              activeOptions={{ exact: true }}
                              className={getDesktopChildLinkClassName(
                                isChildRouteActive(pathname, child)
                              )}
                            >
                              <span className="text-inherit">{child.label}</span>
                            </Link>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </nav>
          </div>

          <Separator className="my-5" />

          <Link
            to="/settings"
            activeOptions={{ exact: true }}
            className={getDesktopNavLinkClassName(isRouteActive(pathname, "/settings", true))}
          >
            <Settings2 className="size-4 shrink-0" />
            <span className="text-inherit">设置</span>
          </Link>

          <div className="mt-4 flex items-center justify-between gap-3 rounded-[24px] border border-slate-200/80 bg-slate-50/80 p-4">
            <div className="min-w-0 flex-1">
              <p className="truncate text-base font-semibold text-slate-950">{displayName}</p>
              <p className="mt-1 truncate text-sm text-slate-500">{auth.session?.user.email}</p>
            </div>
            <button
              type="button"
              aria-label="退出登录"
              title="退出登录"
              onClick={() => {
                void auth.logout();
              }}
              className="inline-flex size-11 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-400 transition-[background-color,border-color,color,box-shadow] duration-200 hover:border-rose-500 hover:bg-rose-500 hover:text-white hover:shadow-[0_14px_28px_rgba(244,63,94,0.18)]"
            >
              <LogOut className="size-4" />
            </button>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1">
          <div className="-mx-3 flex min-h-0 flex-1 overflow-y-auto px-3 py-1 lg:-mx-4 lg:px-4 [scrollbar-gutter:stable]">
            <div className="flex min-h-full w-full min-w-0 flex-col gap-4 lg:gap-6">
              <header className="shrink-0 rounded-[32px] border border-white/70 bg-white/68 p-4 shadow-[0_24px_70px_rgba(15,23,42,0.08)] backdrop-blur-xl lg:p-5">
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
                const targetTo = item.kind === "link" ? item.to : item.children[0].to;
                const isActive =
                  item.kind === "link"
                    ? isRouteActive(pathname, item.to, item.exact)
                    : isRouteActive(pathname, item.basePath);

                return (
                  <Link
                    key={item.id}
                    to={targetTo}
                    activeOptions={{ exact: item.kind === "link" ? item.exact : false }}
                    className={getMobileNavLinkClassName(isActive)}
                  >
                    <Icon className="size-4" />
                    {item.label}
                  </Link>
                );
              })}

              <Link
                to="/settings"
                activeOptions={{ exact: true }}
                className={getMobileNavLinkClassName(isRouteActive(pathname, "/settings", true))}
              >
                <Settings2 className="size-4" />
                设置
              </Link>
            </div>

            {activeMobileGroup ? (
              <div className="mt-3 flex gap-2 overflow-x-auto pb-1 lg:hidden">
                {activeMobileGroup.children.map((child) => (
                  <Link
                    key={child.to}
                    to={child.to}
                    activeOptions={{ exact: true }}
                    className={getMobileChildLinkClassName(isChildRouteActive(pathname, child))}
                  >
                    {child.label}
                  </Link>
                ))}
              </div>
            ) : null}
              </header>

              <main className="min-h-0 flex-1 pb-4 lg:pb-6">{children}</main>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

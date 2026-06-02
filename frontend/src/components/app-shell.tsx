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
        label: "扩展订阅",
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
    description: "集中查看你的外部订阅、模板与扩展订阅。",
    title: "工作台"
  },
  "/settings": {
    description: "维护个人资料与订阅秘钥。",
    title: "个人设置"
  },
  "/subscriptions": {
    description: "统一管理外部订阅、扩展订阅、共享与订阅 Key。",
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
  "flex min-h-11 w-full items-center gap-3 rounded-lg border-0 bg-transparent px-3 py-2.5 text-sm font-medium leading-5 transition-[background-color,color,border-color] duration-150";

const getDesktopNavLinkClassName = (isActive: boolean) =>
  cn(
    navLinkBaseClassName,
    isActive
      ? "bg-[#e9e5da] text-[#141413]"
      : "text-[#73726c] hover:bg-[#f1eee6] hover:text-[#141413]"
  );

const getDesktopGroupClassName = (isActive: boolean, isExpanded: boolean) =>
  cn(
    navLinkBaseClassName,
    "relative pr-10 text-left",
    isActive && !isExpanded
      ? "bg-[#e9e5da] text-[#141413]"
      : isActive || isExpanded
        ? "bg-[#f1eee6] text-[#141413]"
        : "text-[#73726c] hover:bg-[#f1eee6] hover:text-[#141413]"
  );

const getDesktopGroupChevronClassName = (isActive: boolean, isExpanded: boolean) =>
  cn(
    "pointer-events-none absolute right-4 top-1/2 size-4 -translate-y-1/2 shrink-0 transition-transform duration-200",
    isExpanded && "rotate-180",
    "text-current"
  );

const getDesktopChildLinkClassName = (isActive: boolean) =>
  cn(
    "flex min-h-10 items-center rounded-lg px-3 py-2 text-sm font-medium leading-5 transition-[background-color,color] duration-150",
    isActive
      ? "bg-[#141413] text-[#faf9f5]"
      : "text-[#73726c] hover:bg-[#f1eee6] hover:text-[#141413]"
  );

const getMobileNavLinkClassName = (isActive: boolean) =>
  cn(
    "inline-flex shrink-0 items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors",
    isActive
      ? "border-[#141413] bg-[#141413] text-[#faf9f5]"
      : "border-[#dedcd1] bg-[#fffdf8] text-[#73726c] hover:border-[#c9c6ba] hover:text-[#141413]"
  );

const getMobileChildLinkClassName = (isActive: boolean) =>
  cn(
    "inline-flex shrink-0 items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-colors",
    isActive
      ? "border-[#141413] bg-[#141413] text-[#faf9f5]"
      : "border-[#dedcd1] bg-[#fffdf8] text-[#73726c] hover:border-[#c9c6ba] hover:text-[#141413]"
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
    <div className="relative h-screen overflow-hidden bg-[#f5f4ed] text-[#141413]">
      <div className="relative flex h-full w-full">
        <aside className="hidden h-full w-60 shrink-0 flex-col border-r border-[#dedcd1] bg-[#faf9f5] p-3 lg:flex">
          <div className="flex items-center gap-3 px-2">
            <div className="flex size-10 items-center justify-center rounded-lg bg-[#141413] text-[#faf9f5]">
              <Sparkles className="size-5" />
            </div>
            <div>
              <p className="text-sm font-medium text-[#73726c]">Mihomo 订阅工作台</p>
              <h1 className="text-lg font-semibold">ProxyParser</h1>
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
                        "grid transition-[grid-template-rows,opacity] duration-150 ease-out",
                        isExpanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
                      )}
                    >
                      <div className="min-h-0 overflow-hidden pl-4">
                        <div className="space-y-1 border-l border-[#dedcd1] pl-4">
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

          <Separator className="my-4" />

          <div className="flex items-center gap-2 rounded-lg border border-[#dedcd1] bg-[#f5f4ed] p-2">
            <Link
              to="/settings"
              activeOptions={{ exact: true }}
              className="flex min-w-0 flex-1 items-center gap-2 rounded-md p-1.5 transition hover:bg-[#fffdf8]"
              title="个人设置"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-[#141413] text-xs font-semibold text-[#faf9f5]">
                {getInitials(displayName)}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-[#141413]">
                  {displayName}
                </span>
                <span className="block truncate text-xs text-[#73726c]">
                  {auth.session?.user.email}
                </span>
              </span>
            </Link>
            <button
              type="button"
              aria-label="退出登录"
              title="退出登录"
              onClick={() => {
                void auth.logout();
              }}
              className="inline-flex size-9 shrink-0 items-center justify-center rounded-md border border-[#dedcd1] bg-[#fffdf8] text-[#73726c] transition-[background-color,border-color,color] duration-150 hover:border-[#a73d39] hover:bg-[#f7ecec] hover:text-[#a73d39] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#a73d39]/25"
            >
              <LogOut className="size-4" />
            </button>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1">
          <div className="flex min-h-0 flex-1 overflow-y-auto px-4 py-4 lg:px-6 lg:py-6 [scrollbar-gutter:stable]">
            <div className="flex min-h-full w-full min-w-0 flex-col gap-4 lg:gap-6">
              <header className="shrink-0 rounded-lg border border-[#dedcd1] bg-[#fffdf8] p-4 shadow-[0_1px_2px_rgba(20,20,19,0.04)] lg:p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className="border-[#dedcd1] bg-[#f5f4ed] text-[#5f5e58]">{todayText}</Badge>
                  {workspace.isLoading ? (
                    <Badge className="border-[#d1a041]/40 bg-[#f6eedf] text-[#5a4815]">
                      正在同步数据
                    </Badge>
                  ) : null}
                </div>
                <div>
                  <h2 className="text-2xl font-semibold">{pageMeta.title}</h2>
                  <p className="mt-1 text-sm text-[#73726c]">{pageMeta.description}</p>
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

              <main key={pathname} className="pp-page-motion min-h-0 flex-1 pb-4 lg:pb-6">{children}</main>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

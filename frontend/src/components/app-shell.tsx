import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { LogOut } from "lucide-react";
import type { PropsWithChildren } from "react";

import { cn } from "../lib/cn";
import { useAuth } from "../providers/auth-provider";
import { Button } from "./ui/button";

const NAV_ITEMS = [
  { to: "/workbench", label: "工作台" },
  { to: "/subscriptions", label: "订阅" },
  { to: "/sources", label: "订阅源" },
  { to: "/rulesets", label: "规则库" },
  { to: "/templates", label: "模板" },
  { to: "/settings", label: "设置" }
] as const;

export const AppShell = ({ children }: PropsWithChildren) => {
  const { session, logout } = useAuth();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  return (
    <div className="min-h-screen bg-bg">
      <header className="sticky top-0 z-40 flex h-[52px] items-center gap-7 border-b border-line bg-surface px-5">
        <Link to="/workbench" className="flex items-center gap-2 text-sm font-semibold tracking-wide">
          <span className="grid size-5 place-items-center rounded-[5px] border border-accent-strong bg-accent-bg font-mono text-[11px] font-bold text-accent">
            P
          </span>
          ProxyParser
        </Link>
        <nav className="flex gap-1">
          {NAV_ITEMS.map((item) => {
            const active =
              pathname === item.to ||
              (item.to !== "/workbench" && pathname.startsWith(`${item.to}`));
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "rounded-md px-2.5 py-1 text-[13px] text-muted transition-colors hover:bg-surface2 hover:text-ink",
                  active && "bg-surface2 font-medium text-ink"
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <span className="text-xs text-faint">{session?.user.displayName}</span>
          <Button
            variant="ghost"
            size="sm"
            title="退出登录"
            onClick={async () => {
              await logout();
              void navigate({ to: "/login" });
            }}
          >
            <LogOut className="size-3.5" />
          </Button>
        </div>
      </header>
      <main className="mx-auto w-full">{children}</main>
    </div>
  );
};

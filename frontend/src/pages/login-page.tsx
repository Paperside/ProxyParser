import { Link } from "@tanstack/react-router";
import { ArrowRight, LockKeyhole, UserRound } from "lucide-react";
import { type FormEvent, useState } from "react";

import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { useAuth } from "../providers/auth-provider";

export const LoginPage = () => {
  const auth = useAuth();
  const [form, setForm] = useState({
    login: "",
    password: ""
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      await auth.login(form);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "登录失败，请稍后重试。");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#eff4fa] px-4 py-10">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-0 h-80 w-80 -translate-x-1/2 rounded-full bg-sky-200/40 blur-3xl" />
        <div className="absolute bottom-[-12%] right-[-6%] h-96 w-96 rounded-full bg-emerald-200/35 blur-3xl" />
      </div>

      <Card className="relative w-full max-w-md rounded-[32px] p-8">
        <div className="mb-8">
          <p className="text-sm font-medium uppercase tracking-[0.18em] text-slate-400">ProxyParser</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">登录工作台</h1>
          <p className="mt-2 text-sm text-slate-500">继续管理你的 Mihomo 订阅、模板与分发链接。</p>
        </div>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <label className="block space-y-2">
            <span className="text-sm font-medium text-slate-600">邮箱或用户名</span>
            <div className="relative">
              <UserRound className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <Input
                required
                value={form.login}
                onChange={(event) => {
                  setForm((current) => ({
                    ...current,
                    login: event.target.value
                  }));
                }}
                className="pl-11"
                placeholder="输入邮箱或用户名"
              />
            </div>
          </label>

          <label className="block space-y-2">
            <span className="text-sm font-medium text-slate-600">密码</span>
            <div className="relative">
              <LockKeyhole className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <Input
                required
                type="password"
                value={form.password}
                onChange={(event) => {
                  setForm((current) => ({
                    ...current,
                    password: event.target.value
                  }));
                }}
                className="pl-11"
                placeholder="输入登录密码"
              />
            </div>
          </label>

          {errorMessage ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {errorMessage}
            </div>
          ) : null}

          <Button type="submit" disabled={isSubmitting} className="w-full">
            {isSubmitting ? "登录中..." : "登录"}
            <ArrowRight className="size-4" />
          </Button>
        </form>

        <div className="mt-6 text-center">
          <Link
            to="/register"
            className="inline-flex items-center justify-center rounded-2xl px-4 py-2 text-sm font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-950"
          >
            创建新账号
          </Link>
        </div>
      </Card>
    </div>
  );
};

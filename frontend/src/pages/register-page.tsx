import { Link } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight, LockKeyhole, Mail, Signature, UserRound } from "lucide-react";
import { type FormEvent, useState } from "react";

import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { useAuth } from "../providers/auth-provider";

export const RegisterPage = () => {
  const auth = useAuth();
  const [form, setForm] = useState({
    email: "",
    username: "",
    displayName: "",
    password: ""
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      await auth.register(form);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "注册失败，请稍后重试。");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#eff4fa] px-4 py-10">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-[-8%] top-[-8%] h-72 w-72 rounded-full bg-amber-200/30 blur-3xl" />
        <div className="absolute right-[-8%] top-[18%] h-80 w-80 rounded-full bg-sky-200/35 blur-3xl" />
        <div className="absolute bottom-[-12%] left-[15%] h-80 w-80 rounded-full bg-emerald-200/30 blur-3xl" />
      </div>

      <Card className="relative w-full max-w-xl rounded-[32px] p-8">
        <div className="mb-8">
          <p className="text-sm font-medium uppercase tracking-[0.18em] text-slate-400">New Account</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">创建账号</h1>
          <p className="mt-2 text-sm text-slate-500">注册后即可开始整理你的订阅来源、模板与生成订阅。</p>
        </div>

        <form className="grid gap-4 md:grid-cols-2" onSubmit={handleSubmit}>
          <label className="block space-y-2 md:col-span-2">
            <span className="text-sm font-medium text-slate-600">邮箱</span>
            <div className="relative">
              <Mail className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <Input
                required
                type="email"
                value={form.email}
                onChange={(event) => {
                  setForm((current) => ({
                    ...current,
                    email: event.target.value
                  }));
                }}
                className="pl-11"
                placeholder="name@example.com"
              />
            </div>
          </label>

          <label className="block space-y-2">
            <span className="text-sm font-medium text-slate-600">用户名</span>
            <div className="relative">
              <UserRound className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <Input
                required
                value={form.username}
                onChange={(event) => {
                  setForm((current) => ({
                    ...current,
                    username: event.target.value
                  }));
                }}
                className="pl-11"
                placeholder="至少 3 个字符"
              />
            </div>
          </label>

          <label className="block space-y-2">
            <span className="text-sm font-medium text-slate-600">显示名称</span>
            <div className="relative">
              <Signature className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={form.displayName}
                onChange={(event) => {
                  setForm((current) => ({
                    ...current,
                    displayName: event.target.value
                  }));
                }}
                className="pl-11"
                placeholder="页面展示名称"
              />
            </div>
          </label>

          <label className="block space-y-2 md:col-span-2">
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
                placeholder="至少 8 个字符"
              />
            </div>
          </label>

          {errorMessage ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 md:col-span-2">
              {errorMessage}
            </div>
          ) : null}

          <div className="md:col-span-2">
            <Button type="submit" disabled={isSubmitting} className="w-full">
              {isSubmitting ? "创建中..." : "完成注册"}
              <ArrowRight className="size-4" />
            </Button>
          </div>
        </form>

        <div className="mt-6 text-center">
          <Link
            to="/login"
            className="inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-2 text-sm font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-950"
          >
            <ArrowLeft className="size-4" />
            返回登录
          </Link>
        </div>
      </Card>
    </div>
  );
};

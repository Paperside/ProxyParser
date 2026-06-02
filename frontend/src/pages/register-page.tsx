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
    <div className="flex min-h-screen items-center bg-[#faf9f5] px-5 py-8 text-[#141413]">
      <div className="mx-auto grid w-full max-w-5xl gap-8 md:grid-cols-[minmax(0,0.8fr)_minmax(520px,1fr)] md:items-center">
        <section className="hidden border-l border-[#c96442] px-8 py-4 md:block">
          <p className="text-sm font-medium text-[#73726c]">ProxyParser</p>
          <h1 className="mt-6 text-4xl font-semibold leading-tight">创建一个本地工作区账号。</h1>
          <p className="mt-4 max-w-md text-base leading-7 text-[#5f5e58]">
            用它隔离你的外部订阅、模板和分发密钥。这里是本地测试环境，可以放心试流程。
          </p>
        </section>

        <Card className="w-full p-6 md:p-7">
          <div className="mb-7">
            <p className="text-sm font-medium text-[#c96442]">账户注册</p>
            <h1 className="mt-3 text-3xl font-semibold text-[#141413]">创建账号</h1>
            <p className="mt-2 text-sm leading-6 text-[#73726c]">
              注册后即可开始整理你的订阅来源、模板与扩展订阅。
            </p>
        </div>

        <form className="grid gap-4 md:grid-cols-2" onSubmit={handleSubmit}>
          <label className="block space-y-2 md:col-span-2">
            <span className="text-sm font-medium text-[#5f5e58]">邮箱</span>
            <div className="relative">
              <Mail className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-[#9c9a92]" />
              <Input
                required
                type="text"
                inputMode="email"
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
            <span className="text-sm font-medium text-[#5f5e58]">用户名</span>
            <div className="relative">
              <UserRound className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-[#9c9a92]" />
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
            <span className="text-sm font-medium text-[#5f5e58]">显示名称</span>
            <div className="relative">
              <Signature className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-[#9c9a92]" />
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
            <span className="text-sm font-medium text-[#5f5e58]">密码</span>
            <div className="relative">
              <LockKeyhole className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-[#9c9a92]" />
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
            <div
              role="alert"
              className="rounded-lg border border-[#cd5c58]/50 bg-[#f7ecec] px-4 py-3 text-sm text-[#7f2c28] md:col-span-2"
            >
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
            className="inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-[#73726c] transition hover:bg-[#f1eee6] hover:text-[#141413]"
          >
            <ArrowLeft className="size-4" />
            返回登录
          </Link>
        </div>
      </Card>
      </div>
    </div>
  );
};

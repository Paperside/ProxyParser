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
    <div className="flex min-h-screen items-center bg-[#faf9f5] px-5 py-8 text-[#141413]">
      <div className="mx-auto grid w-full max-w-5xl gap-8 md:grid-cols-[minmax(0,1fr)_420px] md:items-center">
        <section className="hidden min-h-[520px] flex-col justify-between border-l border-[#c96442] px-8 py-4 md:flex">
          <div>
            <p className="text-sm font-medium text-[#73726c]">ProxyParser</p>
            <h1 className="mt-6 max-w-xl text-4xl font-semibold leading-tight">
              把外部订阅、操作草稿和分发密钥放回同一个工作流。
            </h1>
            <p className="mt-4 max-w-lg text-base leading-7 text-[#5f5e58]">
              面向 Mihomo 的本地订阅管理台。少一点装饰，多一点可判断的状态、可复用的模板和可追踪的发布记录。
            </p>
          </div>
          <div className="grid max-w-xl gap-3 text-sm text-[#73726c]">
            <div className="border-t border-[#dedcd1] pt-4">
              外部订阅 + 操作草稿 + 发布设置 = 可分发的扩展订阅
            </div>
            <div className="border-t border-[#dedcd1] pt-4">
              模板只保存可复用操作，不带真实节点。
            </div>
          </div>
        </section>

        <Card className="w-full p-6 md:p-7">
          <div className="mb-7">
            <p className="text-sm font-medium text-[#c96442]">账户入口</p>
            <h1 className="mt-3 text-3xl font-semibold text-[#141413]">登录工作台</h1>
            <p className="mt-2 text-sm leading-6 text-[#73726c]">
              继续管理你的 Mihomo 订阅、模板与分发链接。
            </p>
        </div>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <label className="block space-y-2">
            <span className="text-sm font-medium text-[#5f5e58]">邮箱或用户名</span>
            <div className="relative">
              <UserRound className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-[#9c9a92]" />
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
                placeholder="输入登录密码"
              />
            </div>
          </label>

          {errorMessage ? (
            <div
              role="alert"
              className="rounded-lg border border-[#cd5c58]/50 bg-[#f7ecec] px-4 py-3 text-sm text-[#7f2c28]"
            >
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
            className="inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-medium text-[#73726c] transition hover:bg-[#f1eee6] hover:text-[#141413]"
          >
            创建新账号
          </Link>
        </div>
      </Card>
      </div>
    </div>
  );
};

import { Link, useNavigate } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";

import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Field, Input } from "../components/ui/input";
import { useAuth } from "../providers/auth-provider";

export const RegisterPage = () => {
  const auth = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: "", username: "", displayName: "", password: "" });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      await auth.register({
        email: form.email,
        username: form.username,
        displayName: form.displayName || undefined,
        password: form.password
      });
      void navigate({ to: "/workbench" });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "注册失败，请稍后重试。");
    } finally {
      setIsSubmitting(false);
    }
  };

  const bind = (key: keyof typeof form) => ({
    value: form[key],
    onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
      setForm((current) => ({ ...current, [key]: event.target.value }))
  });

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-5">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2.5">
          <span className="grid size-7 place-items-center rounded-md border border-accent-strong bg-accent-bg font-mono text-sm font-bold text-accent">
            P
          </span>
          <div>
            <h1 className="text-base font-semibold leading-tight">创建账号</h1>
            <p className="text-xs text-faint">3 分钟后拿到你的第一条稳定订阅链接</p>
          </div>
        </div>
        <Card className="p-5">
          <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
            <Field label="邮箱">
              <Input required type="email" {...bind("email")} />
            </Field>
            <Field label="用户名">
              <Input required minLength={3} {...bind("username")} />
            </Field>
            <Field label="显示名称" hint="可选，默认使用用户名">
              <Input {...bind("displayName")} />
            </Field>
            <Field label="密码" hint="至少 8 位">
              <Input required type="password" minLength={8} {...bind("password")} />
            </Field>
            {errorMessage ? (
              <p role="alert" className="rounded-md bg-err-bg px-3 py-2 text-xs text-err">
                {errorMessage}
              </p>
            ) : null}
            <Button type="submit" variant="primary" disabled={isSubmitting} className="w-full">
              {isSubmitting ? "创建中…" : "创建账号"}
            </Button>
          </form>
          <p className="mt-4 text-center text-xs text-muted">
            已有账号？{" "}
            <Link to="/login" className="text-accent hover:underline">
              登录
            </Link>
          </p>
        </Card>
      </div>
    </div>
  );
};

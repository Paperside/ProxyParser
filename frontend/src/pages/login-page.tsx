import { Link, useNavigate } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";

import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Field, Input } from "../components/ui/input";
import { useAuth } from "../providers/auth-provider";

export const LoginPage = () => {
  const auth = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ login: "", password: "" });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      await auth.login(form);
      void navigate({ to: "/workbench" });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "登录失败，请稍后重试。");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-5">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2.5">
          <span className="grid size-7 place-items-center rounded-md border border-accent-strong bg-accent-bg font-mono text-sm font-bold text-accent">
            P
          </span>
          <div>
            <h1 className="text-base font-semibold leading-tight">ProxyParser</h1>
            <p className="text-xs text-faint">你的订阅配置的家</p>
          </div>
        </div>
        <Card className="p-5">
          <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
            <Field label="邮箱或用户名">
              <Input
                required
                autoFocus
                value={form.login}
                onChange={(event) =>
                  setForm((current) => ({ ...current, login: event.target.value }))
                }
              />
            </Field>
            <Field label="密码">
              <Input
                required
                type="password"
                value={form.password}
                onChange={(event) =>
                  setForm((current) => ({ ...current, password: event.target.value }))
                }
              />
            </Field>
            {errorMessage ? (
              <p role="alert" className="rounded-md bg-err-bg px-3 py-2 text-xs text-err">
                {errorMessage}
              </p>
            ) : null}
            <Button type="submit" variant="primary" disabled={isSubmitting} className="w-full">
              {isSubmitting ? "登录中…" : "登录"}
            </Button>
          </form>
          <p className="mt-4 text-center text-xs text-muted">
            还没有账号？{" "}
            <Link to="/register" className="text-accent hover:underline">
              创建账号
            </Link>
          </p>
        </Card>
      </div>
    </div>
  );
};

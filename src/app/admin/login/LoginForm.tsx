"use client";

import { useActionState } from "react";

import { loginAction, type LoginActionState } from "@/app/admin/login/actions";
import { MaterialSurface } from "@/components/ui/MaterialSurface";
import { Pressable } from "@/components/ui/Pressable";

const INITIAL_STATE: LoginActionState = { status: "idle" };

export function LoginForm({ state }: { state?: LoginActionState }) {
  const [actionState, formAction, pending] = useActionState(loginAction, INITIAL_STATE);
  const current = state ?? actionState;
  const locked = current.status === "locked";
  const waitMinutes = locked ? Math.max(1, Math.ceil(current.retryAfterSeconds / 60)) : 0;

  return (
    <MaterialSurface as="section" className="admin-login-panel" variant="floating">
      <header className="admin-login-heading">
        <p>收藏系统</p>
        <h1>登录管理端</h1>
      </header>
      <form action={state ? undefined : formAction} className="admin-login-form">
        <label>
          <span>用户名</span>
          <input
            autoComplete="username"
            disabled={locked || pending}
            name="username"
            required
            spellCheck={false}
          />
        </label>
        <label>
          <span>密码</span>
          <input
            autoComplete="current-password"
            disabled={locked || pending}
            name="password"
            required
            type="password"
          />
        </label>
        {current.status === "error" ? (
          <p role="alert">用户名或密码不正确。失败次数已记录。</p>
        ) : null}
        {locked ? <p role="alert">登录已临时锁定，请在 {waitMinutes} 分钟后重试。</p> : null}
        <Pressable disabled={locked || pending} type="submit">
          {pending ? "登录中…" : "登录管理端"}
        </Pressable>
      </form>
    </MaterialSurface>
  );
}

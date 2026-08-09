"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";

import { loginAction, type LoginActionState } from "@/app/admin/login/actions";
import { MaterialSurface } from "@/components/ui/MaterialSurface";
import { Pressable } from "@/components/ui/Pressable";

const INITIAL_STATE: LoginActionState = { status: "idle" };

export function LoginForm({ state }: { state?: LoginActionState }) {
  const t = useTranslations("admin.login");
  const [actionState, formAction, pending] = useActionState(loginAction, INITIAL_STATE);
  const current = state ?? actionState;
  const locked = current.status === "locked";
  const waitMinutes = locked ? Math.max(1, Math.ceil(current.retryAfterSeconds / 60)) : 0;

  return (
    <MaterialSurface as="section" className="admin-login-panel" variant="floating">
      <header className="admin-login-heading">
        <p>{t("brand")}</p>
        <h1>{t("title")}</h1>
      </header>
      <form action={state ? undefined : formAction} className="admin-login-form">
        <label>
          <span>{t("username")}</span>
          <input
            autoComplete="username"
            disabled={locked || pending}
            name="username"
            required
            spellCheck={false}
          />
        </label>
        <label>
          <span>{t("password")}</span>
          <input
            autoComplete="current-password"
            disabled={locked || pending}
            name="password"
            required
            type="password"
          />
        </label>
        {current.status === "error" ? (
          <p role="alert">{t("invalid")}</p>
        ) : null}
        {locked ? <p role="alert">{t("locked", { minutes: waitMinutes })}</p> : null}
        <Pressable disabled={locked || pending} type="submit">
          {pending ? t("pending") : t("submit")}
        </Pressable>
      </form>
    </MaterialSurface>
  );
}

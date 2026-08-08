import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { LoginForm } from "@/app/admin/login/LoginForm";

describe("admin login page", () => {
  it("shows the approved default, failure, and locked copy", () => {
    const { rerender } = render(<LoginForm state={{ status: "idle" }} />);
    expect(screen.getByLabelText("用户名")).toBeEnabled();
    expect(screen.getByLabelText("密码")).toBeEnabled();
    expect(screen.getByRole("button", { name: "登录管理端" })).toBeEnabled();

    rerender(<LoginForm state={{ status: "error" }} />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "用户名或密码不正确。失败次数已记录。",
    );

    rerender(<LoginForm state={{ status: "locked", retryAfterSeconds: 120 }} />);
    expect(screen.getByRole("alert")).toHaveTextContent("请在 2 分钟后重试");
    expect(screen.getByLabelText("用户名")).toBeDisabled();
    expect(screen.getByLabelText("密码")).toBeDisabled();
    expect(screen.getByRole("button", { name: "登录管理端" })).toBeDisabled();
  });
});

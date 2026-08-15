import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AdminNav } from "@/app/admin/(protected)/AdminNav";
import { render } from "../render";

let pathname = "/admin/library";
let mobile = false;

vi.mock("next/navigation", () => ({ usePathname: () => pathname }));
vi.mock("@/app/admin/login/actions", () => ({ logoutAction: vi.fn() }));

describe("AdminNav", () => {
  beforeEach(() => {
    pathname = "/admin/library";
    mobile = false;
    vi.stubGlobal("matchMedia", vi.fn((query: string) => ({
      matches: mobile && query === "(max-width: 720px)",
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })));
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.style.overflow = "";
  });

  it("groups navigation and marks only the exact route family current", () => {
    const view = render(<AdminNav />);
    expect(screen.getByRole("heading", { name: "收藏库" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "整理" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "系统" })).toBeVisible();
    expect(screen.getByRole("link", { name: "收藏库" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "运行设置" })).not.toHaveAttribute("aria-current");

    pathname = "/admin/settings/models";
    view.rerender(<AdminNav />);
    expect(screen.getByRole("link", { name: "模型与嵌入" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "运行设置" })).not.toHaveAttribute("aria-current");
  });

  it("makes the mobile drawer modal and returns focus on Escape", async () => {
    mobile = true;
    render(<><AdminNav /><main id="admin-main"><button>Background</button></main><div className="locale-switcher"><button>中文</button></div></>);

    const trigger = screen.getByRole("button", { name: "打开导航" });
    await waitFor(() => expect(screen.queryByRole("complementary", { name: "管理端主导航" })).not.toBeInTheDocument());
    fireEvent.click(trigger);

    const sidebar = await screen.findByRole("complementary", { name: "管理端主导航" });
    expect(document.getElementById("admin-main")?.inert).toBe(true);
    expect(document.body.style.overflow).toBe("hidden");
    fireEvent.keyDown(sidebar, { key: "Escape" });

    await waitFor(() => expect(trigger).toHaveFocus());
    expect(document.getElementById("admin-main")?.inert).toBe(false);
    expect(document.body.style.overflow).toBe("");
  });
});

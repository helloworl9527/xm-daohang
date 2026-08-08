// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const cookieGet = vi.fn();
const redirect = vi.fn((path: string) => {
  throw new Error(`REDIRECT:${path}`);
});

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: cookieGet })),
}));
vi.mock("next/navigation", () => ({ redirect }));

describe("admin page guard", () => {
  beforeEach(() => {
    cookieGet.mockReset();
    redirect.mockClear();
  });

  it("redirects an anonymous page request to login", async () => {
    cookieGet.mockReturnValue(undefined);
    const { requireAdminPage } = await import("@/lib/auth/guard");

    await expect(requireAdminPage()).rejects.toThrow("REDIRECT:/admin/login");
    expect(redirect).toHaveBeenCalledWith("/admin/login");
  });
});

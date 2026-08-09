// @vitest-environment node

import { describe, expect, it } from "vitest";

import { dailyOrderKey } from "@/lib/items/daily";

describe("daily deterministic order", () => {
  it("changes the stable tie-breaker across days", () => {
    const ids = ["a", "b", "c", "d"];
    const first = [...ids].sort((left, right) =>
      dailyOrderKey("2026-08-09", left).localeCompare(dailyOrderKey("2026-08-09", right)),
    );
    const second = [...ids].sort((left, right) =>
      dailyOrderKey("2026-08-10", left).localeCompare(dailyOrderKey("2026-08-10", right)),
    );
    expect(first).not.toEqual(second);
  });
});

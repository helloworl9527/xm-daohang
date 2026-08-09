// @vitest-environment node

import { afterEach, describe, expect, it } from "vitest";

import { businessDay } from "@/lib/time/businessDay";

const originalTimezone = process.env.APP_TIMEZONE;

afterEach(() => {
  if (originalTimezone === undefined) delete process.env.APP_TIMEZONE;
  else process.env.APP_TIMEZONE = originalTimezone;
});

describe("businessDay", () => {
  it("advances at Shanghai midnight rather than UTC midnight", () => {
    process.env.APP_TIMEZONE = "Asia/Shanghai";
    expect(businessDay(new Date("2026-08-09T15:59:59.999Z"))).toBe("2026-08-09");
    expect(businessDay(new Date("2026-08-09T16:00:00.000Z"))).toBe("2026-08-10");
    expect(businessDay(new Date("2026-08-10T00:00:00.000Z"))).toBe("2026-08-10");
  });

  it.each([undefined, "", "Not/A-Timezone"])("rejects invalid timezone %s", (timezone) => {
    if (timezone === undefined) delete process.env.APP_TIMEZONE;
    else process.env.APP_TIMEZONE = timezone;
    expect(() => businessDay(new Date())).toThrow("APP_TIMEZONE_INVALID");
  });
});

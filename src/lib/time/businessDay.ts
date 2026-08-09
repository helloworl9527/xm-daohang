export function businessDay(now = new Date(), timeZone = process.env.APP_TIMEZONE): string {
  if (!timeZone || Number.isNaN(now.getTime())) throw new Error("APP_TIMEZONE_INVALID");

  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      calendar: "iso8601",
      numberingSystem: "latn",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now);
  } catch {
    throw new Error("APP_TIMEZONE_INVALID");
  }

  const values = Object.fromEntries(
    parts
      .filter((part) => part.type === "year" || part.type === "month" || part.type === "day")
      .map((part) => [part.type, part.value]),
  );
  if (!/^\d{4}$/.test(values.year ?? "") || !/^\d{2}$/.test(values.month ?? "") || !/^\d{2}$/.test(values.day ?? "")) {
    throw new Error("APP_TIMEZONE_INVALID");
  }
  return `${values.year}-${values.month}-${values.day}`;
}

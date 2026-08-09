export const locales = ["zh", "en"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "zh";
export const localeCookieName = "locale";

export function resolveLocale(value: string | null | undefined): Locale {
  return value === "en" ? "en" : defaultLocale;
}

type Messages = Record<string, unknown>;

export function mergeWithChineseFallback(fallback: Messages, translated: Messages): Messages {
  const merged: Messages = { ...fallback };
  for (const [key, value] of Object.entries(translated)) {
    const fallbackValue = fallback[key];
    if (
      value && typeof value === "object" && !Array.isArray(value) &&
      fallbackValue && typeof fallbackValue === "object" && !Array.isArray(fallbackValue)
    ) {
      merged[key] = mergeWithChineseFallback(fallbackValue as Messages, value as Messages);
    } else {
      merged[key] = value;
    }
  }
  return merged;
}

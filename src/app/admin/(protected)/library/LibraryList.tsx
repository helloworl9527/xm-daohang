import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";

import type { LibraryItemDto } from "@/lib/items/list";

export function LibraryList({ items }: { items: LibraryItemDto[] }) {
  const locale = useLocale();
  const t = useTranslations("admin.library");
  const common = useTranslations("common");
  const statusLabels = { processing: common("processing"), completed: common("completed"), failed: common("failed") };
  const sourceLabels = { admin: common("adminSource"), telegram: common("telegramSource") };
  return (
    <ol aria-label={t("itemsLabel")} className="library-list">
      {items.map((item) => {
        const label = item.title || item.url;
        return (
          <li className="library-item" key={item.id}>
            <div className="library-item-main">
              <div className="library-item-heading">
                <span className={`library-status library-status--${item.status}`}>
                  {statusLabels[item.status]}
                </span>
                <h2>{label}</h2>
              </div>
              <a className="library-item-url" href={item.url} rel="noreferrer" target="_blank">
                {item.url}
              </a>
              <p className="library-item-summary">
                {item.summary ?? (item.status === "processing" ? t("generating") : t("noSummary"))}
              </p>
              {item.failReason ? <p className="library-item-failure">{t("failureReason", { reason: item.failReason })}</p> : null}
              <ul aria-label={common("itemTags")} className="library-tags">
                {item.tags.map((tag) => <li key={tag}>{tag}</li>)}
              </ul>
            </div>
            <footer className="library-item-meta">
              <span>{sourceLabels[item.source]}</span>
              <time dateTime={item.updatedAt}>
                {new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(item.updatedAt))}
              </time>
              {item.summaryManual ? <span>{t("manual")}</span> : null}
              <Link aria-label={t("viewLabel", { label })} href={`/admin/library/${item.id}`} prefetch={false}>
                {t("viewDetail")}
              </Link>
            </footer>
          </li>
        );
      })}
    </ol>
  );
}

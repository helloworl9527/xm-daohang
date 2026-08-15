import Link from "next/link";
import { ChevronRight, CircleAlert, CircleCheck, Clock3, FileText, GitFork, Globe2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import type { LibraryItemDto } from "@/lib/items/list";

export function LibraryList({ items }: { items: LibraryItemDto[] }) {
  const locale = useLocale();
  const t = useTranslations("admin.library");
  const common = useTranslations("common");
  const statusLabels = { processing: common("processing"), completed: common("completed"), failed: common("failed") };
  const sourceLabels = { admin: common("adminSource"), telegram: common("telegramSource") };
  const statusIcons = { processing: Clock3, completed: CircleCheck, failed: CircleAlert };
  const typeMeta = {
    web: { icon: Globe2, label: t("typeWeb") },
    github: { icon: GitFork, label: t("typeGithub") },
    doc: { icon: FileText, label: t("typeDoc") },
  };
  return (
    <ol aria-label={t("itemsLabel")} className="library-list">
      {items.map((item) => {
        const label = item.title || item.url;
        const StatusIcon = statusIcons[item.status];
        const TypeIcon = typeMeta[item.type].icon;
        return (
          <li className="library-item" key={item.id}>
            <div className={`library-item-type library-item-type--${item.type}`}>
              <TypeIcon aria-hidden="true" size={20} />
              <span>{typeMeta[item.type].label}</span>
            </div>
            <div className="library-item-main">
              <div className="library-item-heading">
                <h2>{label}</h2>
                <span className="library-type-label">{typeMeta[item.type].label}</span>
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
              <div className="library-item-meta-top">
                <span className={`library-status library-status--${item.status}`}>
                  <StatusIcon aria-hidden="true" size={15} />
                  {statusLabels[item.status]}
                </span>
                <span>{sourceLabels[item.source]}</span>
                {item.summaryManual ? <span>{t("manual")}</span> : null}
              </div>
              <div className="library-item-meta-bottom">
                <time dateTime={item.updatedAt}>
                  {new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(item.updatedAt))}
                </time>
                <Link aria-label={t("viewLabel", { label })} href={`/admin/library/${item.id}`} prefetch={false}>
                  {t("viewDetail")}<ChevronRight aria-hidden="true" size={15} />
                </Link>
              </div>
            </footer>
          </li>
        );
      })}
    </ol>
  );
}

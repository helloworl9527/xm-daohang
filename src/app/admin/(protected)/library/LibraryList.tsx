import Link from "next/link";

import type { LibraryItemDto } from "@/lib/items/list";

const statusLabels = {
  processing: "处理中",
  completed: "已完成",
  failed: "失败",
} as const;

const sourceLabels = { admin: "管理端", telegram: "Telegram" } as const;

export function LibraryList({ items }: { items: LibraryItemDto[] }) {
  return (
    <ol aria-label="收藏库条目" className="library-list">
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
                {item.summary ?? (item.status === "processing" ? "正在生成总结…" : "暂无总结")}
              </p>
              {item.failReason ? <p className="library-item-failure">失败原因：{item.failReason}</p> : null}
              <ul aria-label="条目标签" className="library-tags">
                {item.tags.map((tag) => <li key={tag}>{tag}</li>)}
              </ul>
            </div>
            <footer className="library-item-meta">
              <span>{sourceLabels[item.source]}</span>
              <time dateTime={item.updatedAt}>
                {new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium" }).format(new Date(item.updatedAt))}
              </time>
              {item.summaryManual ? <span>人工编辑</span> : null}
              <Link aria-label={`查看 ${label}`} href={`/admin/library/${item.id}`} prefetch={false}>
                查看详情
              </Link>
            </footer>
          </li>
        );
      })}
    </ol>
  );
}

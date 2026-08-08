import Link from "next/link";

const links = [
  { href: "/admin", label: "添加内容" },
  { href: "/admin/library", label: "收藏库" },
  { href: "/admin/settings/models", label: "设置" },
] as const;

export function AdminNav() {
  return (
    <aside className="admin-sidebar">
      <header className="admin-brand">
        <span aria-hidden="true">CS</span>
        <div>
          <strong>收藏系统</strong>
          <small>站主工作台</small>
        </div>
      </header>
      <nav aria-label="管理端主导航" className="admin-nav">
        {links.map((link) => (
          <Link href={link.href} key={link.href} prefetch={false}>{link.label}</Link>
        ))}
      </nav>
    </aside>
  );
}

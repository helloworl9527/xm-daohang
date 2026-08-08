import Link from "next/link";

export default function AdminPage() {
  return (
    <main>
      <h1>添加内容</h1>
      <Link href="/admin/settings/models">模型设置</Link>
    </main>
  );
}

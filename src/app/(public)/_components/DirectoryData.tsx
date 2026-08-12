import { getPublicDirectory } from "@/lib/categories/publicDirectory";
import { DirectoryView } from "@/app/(public)/_components/DirectoryView";
import { DirectoryState } from "@/app/(public)/_components/DirectoryShell";

export async function DirectoryData() {
  try { return <DirectoryView groups={await getPublicDirectory()} />; }
  catch { return <DirectoryState kind="error" />; }
}

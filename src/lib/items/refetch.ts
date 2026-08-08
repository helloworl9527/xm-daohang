import { requestProcessing } from "@/lib/items/processing";

export async function manualRefetch(itemId: string): Promise<{ processGeneration: number }> {
  const processGeneration = await requestProcessing(itemId);
  return { processGeneration };
}

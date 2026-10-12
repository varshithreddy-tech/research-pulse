// Each topic keeps the same pastel everywhere (sidebar dot, overview card, paper stripe, bars).
export function pc(topicId: number | null | undefined): string {
  if (!topicId) return "pc-0";
  return `pc-${(((topicId - 1) % 8) + 8) % 8}`;
}

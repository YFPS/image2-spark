export type AppNavKey = "studio" | "gallery" | "models" | "logs" | "admin";

export function shouldShowAiAssistant(activeNav: string): boolean {
  return activeNav === "studio";
}

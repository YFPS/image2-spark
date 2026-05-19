import type { GenerateImage, GenerateUsage } from "../api/gptImage";
import type { MessageStatus } from "../api/conversations";

type ResultMessageLike = {
  role: "ai" | "user";
  status?: MessageStatus;
  image_urls?: string[] | null;
  params?: Record<string, unknown> | null;
};

type ResultConversationLike = {
  messages: ResultMessageLike[];
};

export function extractConversationResults(
  conversation: ResultConversationLike | null | undefined,
): { images: GenerateImage[]; usage: GenerateUsage | null } {
  const messages = conversation?.messages ?? [];
  const lastUserIdx = messages.reduce(
    (idx, msg, i) => (msg.role === "user" ? i : idx),
    -1,
  );
  const candidateMessages = messages.slice(lastUserIdx + 1);
  const images: GenerateImage[] = [];
  const usage: GenerateUsage = { input_tokens: 0, output_tokens: 0, total_tokens: 0 };

  for (const msg of candidateMessages) {
    if (msg.role !== "ai" || msg.status !== "done" || !msg.image_urls?.length) continue;
    for (const src of msg.image_urls) {
      images.push({ url: src, b64_json: null });
    }

    const rawUsage = msg.params?.usage;
    if (isUsage(rawUsage)) {
      usage.input_tokens += rawUsage.input_tokens;
      usage.output_tokens += rawUsage.output_tokens;
      usage.total_tokens += rawUsage.total_tokens;
    }
  }

  return { images, usage: images.length > 0 ? usage : null };
}

function isUsage(value: unknown): value is GenerateUsage {
  if (!value || typeof value !== "object") return false;
  const usage = value as Partial<GenerateUsage>;
  return (
    typeof usage.input_tokens === "number" &&
    typeof usage.output_tokens === "number" &&
    typeof usage.total_tokens === "number"
  );
}

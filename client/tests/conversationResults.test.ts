import { extractConversationResults } from "../src/conversation/conversationResults";

function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

function run(): void {
  const result = extractConversationResults({
    messages: [
      {
        role: "user",
        status: "done",
        image_urls: null,
        params: null,
      },
      {
        role: "ai",
        status: "done",
        image_urls: ["https://cdn.example/old.png"],
        params: { usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } },
      },
      {
        role: "user",
        status: "done",
        image_urls: null,
        params: null,
      },
      {
        role: "ai",
        status: "done",
        image_urls: ["data:image/png;base64,new"],
        params: { usage: { input_tokens: 3, output_tokens: 4, total_tokens: 7 } },
      },
    ],
  });

  assertEqual(result.images.length, 1, "uses only images after the latest user message");
  assertEqual(result.images[0]?.url, "data:image/png;base64,new", "keeps the latest image src");
  assertEqual(result.usage?.total_tokens, 7, "keeps usage for the latest generation group");
}

run();

import {
  chooseRestoredConversationId,
  conversationHasPendingGeneration,
} from "../src/conversation/pendingGeneration";

function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

function run(): void {
  assertEqual(
    chooseRestoredConversationId({
      currentId: null,
      list: [
        { id: 10, has_pending: false },
        { id: 11, has_pending: true },
      ],
    }),
    11,
    "restores the pending conversation when currentId is missing",
  );

  assertEqual(
    chooseRestoredConversationId({
      currentId: 7,
      list: [{ id: 7, has_pending: false }],
    }),
    7,
    "keeps the explicit current conversation when no conversation is pending",
  );

  assertEqual(
    chooseRestoredConversationId({
      currentId: 7,
      list: [
        { id: 7, has_pending: false },
        { id: 11, has_pending: true },
      ],
    }),
    11,
    "prefers a pending conversation over a stale current conversation",
  );

  assertEqual(
    conversationHasPendingGeneration({
      messages: [
        { role: "user", status: "done" },
        { role: "ai", status: "pending" },
      ],
    }),
    true,
    "detects an AI pending message",
  );
}

run();

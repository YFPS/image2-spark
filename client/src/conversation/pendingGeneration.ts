type PendingMessageLike = {
  role: "ai" | "user";
  status?: "done" | "pending" | "failed";
};

type ConversationLike = {
  messages: PendingMessageLike[];
};

type PendingListItemLike = {
  id: number;
  has_pending?: boolean;
};

export function conversationHasPendingGeneration(
  conversation: ConversationLike | null | undefined,
): boolean {
  return !!conversation?.messages.some((m) => m.role === "ai" && m.status === "pending");
}

export function chooseRestoredConversationId({
  currentId,
  list,
}: {
  currentId: number | null;
  list: PendingListItemLike[];
}): number | null {
  const currentItem = currentId == null ? null : list.find((item) => item.id === currentId);
  if (currentItem?.has_pending) return currentId;
  return list.find((item) => item.has_pending)?.id ?? currentId;
}

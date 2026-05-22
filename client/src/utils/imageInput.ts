import type * as React from "react";

/**
 * 输入框图片粘贴/拖拽的共享工具。
 *
 * - REF_MAX：参考图上限，与左侧参考图卡保持一致
 * - extractImageFilesFromEvent：从 ClipboardEvent / DragEvent 里筛出 image/* File
 * - fileToDataURL：File → base64 dataURL（异步）
 */

export const REF_MAX = 10;

export function extractImageFilesFromEvent(
  e: React.ClipboardEvent | React.DragEvent,
): File[] {
  // ClipboardEvent.clipboardData.items / DragEvent.dataTransfer.items
  const items =
    "clipboardData" in e
      ? e.clipboardData?.items
      : e.dataTransfer?.items;
  const files: File[] = [];
  if (!items) return files;
  for (const item of Array.from(items)) {
    if (item.kind === "file" && item.type.startsWith("image/")) {
      const f = item.getAsFile();
      if (f) files.push(f);
    }
  }
  return files;
}

export function fileToDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("FileReader error"));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}

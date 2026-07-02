"use client";

import { useEffect } from "react";
import Dialog from "./Dialog";
import { IconTrash, IconInfo } from "./icons";

/**
 * Branded confirmation popup — replaces the browser-native `confirm()`. Icon
 * tile + title + message, with Cancel / Confirm bottom-right. Enter confirms,
 * Escape (or Cancel / backdrop) dismisses. `tone="danger"` tints the icon tile
 * red and defaults the icon to a trash can, while the confirm button stays the
 * light primary button so destructive actions read the same as the rest.
 */
export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "default",
  icon,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "default" | "danger";
  /** Override the default tile icon. */
  icon?: React.ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  // Enter confirms while the dialog is open (Escape is handled by Dialog).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        onConfirm();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onConfirm]);

  const danger = tone === "danger";

  return (
    <Dialog open={open} onClose={onCancel} ariaLabel={title}>
      <div
        className={`mb-4 flex h-10 w-10 items-center justify-center rounded-xl border ${
          danger
            ? "border-red-900/60 bg-red-950/40 text-red-400"
            : "border-neutral-800 bg-neutral-900 text-neutral-300"
        }`}
      >
        {icon ?? (danger ? <IconTrash size={18} /> : <IconInfo size={18} />)}
      </div>

      <h2 className="text-lg font-light leading-tight text-neutral-100">
        {title}
      </h2>
      {message && <p className="mt-1.5 text-sm leading-relaxed text-neutral-400">{message}</p>}

      <div className="mt-6 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-xl border border-neutral-700 px-3 py-2 text-sm text-neutral-200 transition-colors hover:bg-neutral-900"
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          autoFocus
          onClick={onConfirm}
          className="flex items-center gap-1.5 rounded-xl bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-900 transition-colors hover:bg-white"
        >
          {confirmLabel}
          <span aria-hidden className="text-neutral-500">
            ⏎
          </span>
        </button>
      </div>
    </Dialog>
  );
}


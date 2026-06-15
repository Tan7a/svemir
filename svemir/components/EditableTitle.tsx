"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type RenameResult = { success: true } | { success: false; error: string };

type Props = {
  /** Current title. */
  value: string;
  /** Server action (bound to the entity id) that performs the rename. */
  onRename: (next: string) => Promise<RenameResult>;
  /** Classes for the static display element. */
  className?: string;
  /** Classes for the edit input (falls back to `className`). */
  inputClassName?: string;
  /** Element to render the display as. */
  as?: "h1" | "span";
};

/**
 * Inline-editable title. Double-click swaps the text for an input; Enter / blur
 * commits via `onRename`, Escape cancels. The display element swallows its own
 * clicks so that when it lives inside a navigational link (e.g. a channel card),
 * clicking the title doesn't navigate and a double-click reliably starts editing
 * instead of triggering the link on the first click.
 */
export default function EditableTitle({
  value,
  onRename,
  className = "",
  inputClassName,
  as = "span",
}: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  function swallow(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
  }

  function startEdit(e: React.MouseEvent) {
    swallow(e);
    setDraft(value);
    setEditing(true);
  }

  async function commit() {
    if (busy) return;
    const next = draft.trim();
    if (!next || next === value) {
      setEditing(false);
      setDraft(value);
      return;
    }
    setBusy(true);
    const res = await onRename(next);
    setBusy(false);
    if (res.success) {
      setEditing(false);
      router.refresh();
    } else {
      // Keep editing so the rename can be retried.
      inputRef.current?.focus();
      console.warn("rename failed:", res.error);
    }
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="text"
        value={draft}
        disabled={busy}
        onChange={(e) => setDraft(e.target.value)}
        onClick={swallow}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            setEditing(false);
            setDraft(value);
          }
        }}
        onBlur={commit}
        className={inputClassName ?? className}
      />
    );
  }

  const Tag = as;
  return (
    <Tag
      className={className}
      title="Double-click to rename"
      onClick={swallow}
      onDoubleClick={startEdit}
    >
      {value || "Untitled"}
    </Tag>
  );
}

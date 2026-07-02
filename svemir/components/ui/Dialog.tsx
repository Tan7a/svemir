"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";

/**
 * Dialog shell — the canonical centered modal for svemir. Portalled to
 * document.body (so a backdrop-blur ancestor can't trap it), dims + blurs the
 * page, locks scroll, and closes on Escape or backdrop click. Animates in with
 * the shared `dialog-in` keyframes. Mirrors the pattern in SignInModal /
 * ChannelInfoModal so those can migrate onto it later.
 */
export default function Dialog({
  open,
  onClose,
  ariaLabel,
  className = "",
  children,
}: {
  open: boolean;
  onClose: () => void;
  ariaLabel?: string;
  /** Width/padding overrides for the dialog card. */
  className?: string;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        className={`relative w-full max-w-sm rounded-2xl border border-neutral-800 bg-background p-6 shadow-2xl shadow-black/60 ${className}`}
        style={{ animation: "dialog-in 0.18s ease-out" }}
      >
        {children}
      </div>
    </div>,
    document.body
  );
}

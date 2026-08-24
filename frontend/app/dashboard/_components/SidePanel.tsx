"use client";

import { ReactNode, useEffect, useState } from "react";

interface SidePanelProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children?: ReactNode;
  footer?: ReactNode;
}

const TRANSITION_MS = 200;

// Right-edge drawer — sibling of Modal (same overlay-click-to-close idea)
// but for a full-height form panel instead of a small centered dialog.
// Modal doesn't close on Escape today, so there was nothing to reuse for
// that part; implemented fresh here only.
export default function SidePanel({ open, onClose, title, children, footer }: SidePanelProps) {
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- syncs DOM presence/transition state with the open prop
      setMounted(true);
      const raf = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(raf);
    }
    setVisible(false);
    const timeout = setTimeout(() => setMounted(false), TRANSITION_MS);
    return () => clearTimeout(timeout);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!mounted) return null;

  return (
    <div
      className={`fixed inset-0 z-50 bg-black/40 transition-opacity duration-200 ${visible ? "opacity-100" : "opacity-0"}`}
      onClick={onClose}
    >
      <div
        className={`fixed right-0 top-0 flex h-full w-[480px] max-w-full flex-col bg-white shadow-[-4px_0_16px_rgba(0,0,0,0.08)] transition-transform duration-200 ${
          visible ? "translate-x-0" : "translate-x-full"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-admin-border p-6">
          <h2 className="text-[22px] font-bold text-admin-ink">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="text-xl leading-none text-admin-ink-soft transition hover:text-admin-ink"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">{children}</div>

        {footer && <div className="flex justify-end gap-2 border-t border-admin-border p-6">{footer}</div>}
      </div>
    </div>
  );
}

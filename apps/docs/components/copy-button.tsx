"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";

/** Clipboard failure is visible; timers cannot update an unmounted control. */
export function CopyButton({ text, label, className }: { text: string; label: string; className?: string }) {
  const [status, setStatus] = useState<"idle" | "copied" | "error">("idle");
  const resetTimer = useRef<ReturnType<typeof setTimeout>>(null);
  // Reset confirmation when the command changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: text intentionally resets the confirmation
  useEffect(() => {
    setStatus("idle");
    return () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    };
  }, [text]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setStatus("copied");
    } catch {
      setStatus("error");
    }
    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setStatus("idle"), 2000);
  };

  return (
    <>
      <button
        type="button"
        className={`hig-button ${className ?? ""}`}
        data-intent="ghost"
        onClick={copy}
        aria-label={status === "copied" ? "Copied to clipboard" : label}
      >
        {status === "copied" ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
      </button>
      <span className="copy-feedback" role="status" data-error={status === "error"}>
        {status === "copied" ? "Copied" : status === "error" ? "Copy failed. Select and copy manually." : ""}
      </span>
    </>
  );
}

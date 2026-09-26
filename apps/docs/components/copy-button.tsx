"use client";

import { Check, Copy } from "lucide-react";
import { useRef, useState } from "react";

/** Copies `text` to the clipboard and confirms with a check for two seconds. */
export function CopyButton({ text, label, className }: { text: string; label: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout>>(null);

  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button type="button" className={className} onClick={copy} aria-label={copied ? "Copied to clipboard" : label}>
      {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
    </button>
  );
}

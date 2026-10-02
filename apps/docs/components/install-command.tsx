"use client";

import { Check, Copy } from "lucide-react";
import { type CSSProperties, useRef, useState } from "react";

const installers = [
  { name: "bun", command: "bun add @bloxwap/hyperliquid" },
  { name: "npm", command: "npm install @bloxwap/hyperliquid" },
  { name: "pnpm", command: "pnpm add @bloxwap/hyperliquid" },
  { name: "yarn", command: "yarn add @bloxwap/hyperliquid" },
];

export function InstallCommand() {
  const [active, setActive] = useState(0);
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout>>(null);

  const copy = async () => {
    await navigator.clipboard.writeText(installers[active].command);
    setCopied(true);
    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="install-picker">
      <div
        className="install-tabs"
        role="tablist"
        aria-label="Package manager"
        style={{ "--count": installers.length, "--active": active } as CSSProperties}
      >
        <span className="install-tabs-thumb" aria-hidden="true" />
        {installers.map((installer, index) => (
          <button
            key={installer.name}
            type="button"
            role="tab"
            aria-selected={index === active}
            className={index === active ? "active" : undefined}
            onClick={() => {
              setActive(index);
              setCopied(false);
            }}
          >
            {installer.name}
          </button>
        ))}
      </div>
      <div className="install-command">
        <span aria-hidden="true">$</span>
        <code>{installers[active].command}</code>
        <button
          type="button"
          className="install-copy"
          onClick={copy}
          aria-label={copied ? "Copied to clipboard" : "Copy install command"}
        >
          {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
        </button>
      </div>
    </div>
  );
}

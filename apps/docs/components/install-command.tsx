"use client";

import { type CSSProperties, useState } from "react";
import { CopyButton } from "./copy-button";

const installers = [
  { name: "bun", command: "bun add @bloxwap/hyperliquid" },
  { name: "npm", command: "npm install @bloxwap/hyperliquid" },
  { name: "pnpm", command: "pnpm add @bloxwap/hyperliquid" },
  { name: "yarn", command: "yarn add @bloxwap/hyperliquid" },
];

export function InstallCommand() {
  const [active, setActive] = useState(0);
  return (
    <div className="install-picker">
      <fieldset
        className="install-tabs"
        aria-label="Package manager"
        style={{ "--count": installers.length, "--active": active } as CSSProperties}
      >
        <span className="install-tabs-thumb" aria-hidden="true" />
        {installers.map((installer, index) => (
          <button
            key={installer.name}
            type="button"
            aria-pressed={index === active}
            className={index === active ? "active" : undefined}
            onClick={() => setActive(index)}
          >
            {installer.name}
          </button>
        ))}
      </fieldset>
      <div className="install-command">
        <span aria-hidden="true">$</span>
        <code>{installers[active].command}</code>
        <CopyButton text={installers[active].command} label="Copy install command" className="install-copy" />
      </div>
    </div>
  );
}

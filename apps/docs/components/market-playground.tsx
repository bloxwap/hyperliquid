"use client";

import { SubscriptionClient } from "@bloxwap/hyperliquid/api/subscription/client";
import { WebSocketTransport } from "@bloxwap/hyperliquid/transport/websocket";
import { animate } from "animejs/animation";
import { scrambleText } from "animejs/text";
import { Radio, RotateCcw } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { CopyButton } from "@/components/copy-button";

const assets = [
  { coin: "BTC", label: "BTC" },
  { coin: "HYPE", label: "HYPE" },
  { coin: "SOL", label: "Solana" },
  { coin: "ETH", label: "Ethereum" },
] as const;

const feeds = [
  { id: "allMids", label: "Mid price" },
  { id: "l2Book", label: "Order book" },
  { id: "trades", label: "Trades" },
  { id: "candle", label: "Candles" },
  { id: "activeAssetCtx", label: "Market context" },
] as const;

type Coin = (typeof assets)[number]["coin"];
type Feed = (typeof feeds)[number]["id"];
type Status = "off" | "connecting" | "waiting" | "live" | "reconnecting" | "error";
type Stream = { status: Status; payload: string | null; count: number; receivedAt: number | null };
const idle: Stream = { status: "off", payload: null, count: 0, receivedAt: null };

function snippet(coin: Coin, feed: Feed | null): string {
  if (!feed) {
    return `// Explore live Hyperliquid market data.
//
// 1. Choose an asset: ${coin}
// 2. Select a data feed below
//
// Your subscription code will appear here.
// No connection opens until you select a feed.`;
  }
  const call =
    feed === "allMids"
      ? `client.allMids({}, (data) => {
  console.log({ coin: "${coin}", midPx: data.mids["${coin}"] });
})`
      : `client.${feed}(
  { coin: "${coin}"${feed === "candle" ? ', interval: "1m"' : ""} },
  (data) => console.log(data),
)`;
  return `import { SubscriptionClient }
  from "@bloxwap/hyperliquid/api/subscription/client";
import { WebSocketTransport }
  from "@bloxwap/hyperliquid/transport/websocket";

const transport = new WebSocketTransport();
const client = new SubscriptionClient({ transport });

// Stream ${feeds.find((item) => item.id === feed)?.label.toLowerCase()} for ${coin}
const sub = await ${call};

// When you're done streaming:
// await sub.unsubscribe();
// transport.close();`;
}

/** Build syntax highlighting with text nodes, including while the code is being scrambled. */
function highlight(element: HTMLElement, text: string): void {
  const nodes: Node[] = [];
  let offset = 0;
  for (const match of text.matchAll(
    /\/\/[^\n]*|"(?:[^"\\]|\\.)*"|\b(?:import|from|const|new|await|SubscriptionClient|WebSocketTransport)\b/g,
  )) {
    nodes.push(document.createTextNode(text.slice(offset, match.index)));
    const token = document.createElement("span");
    token.className = match[0].startsWith("//")
      ? "syntax-muted"
      : match[0].startsWith('"')
        ? "syntax-green"
        : /Client|Transport/.test(match[0])
          ? "syntax-blue"
          : "syntax-purple";
    token.textContent = match[0];
    nodes.push(token);
    offset = match.index + match[0].length;
  }
  nodes.push(document.createTextNode(text.slice(offset)));
  element.replaceChildren(...nodes);
}

function AnimatedCode({ text }: { text: string }) {
  const initial = useRef(text);
  const codeRef = useRef<HTMLElement>(null);
  const measureRef = useRef<HTMLPreElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const previous = useRef(text);

  useLayoutEffect(() => {
    const code = codeRef.current;
    const viewport = viewportRef.current;
    const measure = measureRef.current;
    if (!code || !viewport || !measure) return;
    const oldHeight = viewport.getBoundingClientRect().height;
    const newHeight = measure.getBoundingClientRect().height;
    if (previous.current === text || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      highlight(code, text);
      previous.current = text;
      viewport.style.height = "auto";
      return;
    }

    // Pin the current height before swapping in the new line count, so the first frame (and a
    // Strict Mode re-run of this effect) still starts from the old height.
    viewport.style.height = `${oldHeight}px`;

    // Animate each line independently so scrambling never removes the code's line breaks.
    const oldLines = previous.current.split("\n");
    const newLines = text.split("\n");
    const lines = newLines.map((line, index) => {
      const span = document.createElement("span");
      span.className = "playground-code-line";
      span.textContent = oldLines[index] || line;
      return span;
    });
    code.replaceChildren(...lines);
    const reveal = animate(lines, {
      innerHTML: scrambleText({ text: (_target, index) => newLines[index], chars: "a-z0-9_", duration: 420 }),
      onComplete: () => {
        highlight(code, text);
        // Committed only once the reveal lands: a cancelled run (Strict Mode, or a quick second
        // click) must animate again rather than snap.
        previous.current = text;
      },
    });
    const resize = animate(viewport, {
      height: [`${oldHeight}px`, `${newHeight}px`],
      duration: 420,
      ease: "out(3)",
      onComplete: () => {
        viewport.style.height = "auto";
      },
    });
    return () => {
      reveal.cancel();
      resize.cancel();
    };
  }, [text]);

  return (
    <div className="playground-code">
      <div ref={viewportRef} className="playground-code-viewport">
        {/* biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users must be able to scroll the code horizontally. */}
        <pre tabIndex={0}>
          <code ref={codeRef}>{initial.current}</code>
        </pre>
      </div>
      <pre ref={measureRef} className="playground-code-measure" aria-hidden="true">
        <code>{text}</code>
      </pre>
    </div>
  );
}

/** One reusable socket, with abortable subscriptions and coalesced UI updates. */
function useMarketStream(coin: Coin, feed: Feed | null, retry: number): Stream {
  const transportRef = useRef<WebSocketTransport | null>(null);
  const [stream, setStream] = useState<Stream>(idle);

  useEffect(
    () => () => {
      transportRef.current?.close();
      transportRef.current = null;
    },
    [],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: Retry intentionally restarts the subscription after a connection failure.
  useEffect(() => {
    if (!feed) {
      transportRef.current?.close();
      transportRef.current = null;
      setStream(idle);
      return;
    }
    const controller = new AbortController();
    const transport = transportRef.current ?? new WebSocketTransport();
    transportRef.current = transport;
    const client = new SubscriptionClient({ transport });
    let timer: ReturnType<typeof setTimeout> | undefined;
    let count = 0;
    let latest: unknown;
    let receivedAt = 0;
    setStream({ ...idle, status: "connecting" });

    // Bound rendering to four updates per second, while counting every event received.
    const publish = () => {
      timer = undefined;
      if (!controller.signal.aborted) {
        setStream({ status: "live", payload: JSON.stringify(latest, null, 2), count, receivedAt });
      }
    };
    const receive = (data: unknown) => {
      if (controller.signal.aborted) return;
      latest = data;
      count++;
      receivedAt = Date.now();
      timer ??= setTimeout(publish, 250);
    };
    const fail = () => {
      if (controller.signal.aborted) return;
      clearTimeout(timer);
      controller.abort();
      transport.close();
      if (transportRef.current === transport) transportRef.current = null;
      setStream({ ...idle, status: "error" });
    };
    transport.events.addEventListener(
      "connectionstatechange",
      (event) => {
        if (event.detail === "connected") {
          setStream((current) => ({ ...current, status: "waiting" }));
        } else if (event.detail === "reconnecting" || event.detail === "connecting") {
          clearTimeout(timer);
          timer = undefined;
          setStream((current) => ({ ...current, status: "reconnecting" }));
        } else if (event.detail === "disconnected") {
          fail();
        }
      },
      { signal: controller.signal },
    );

    const options = { signal: controller.signal, onError: fail };
    const subscription =
      feed === "allMids"
        ? client.allMids(
            {},
            (data) => {
              if (data.mids[coin] !== undefined) receive({ coin, midPx: data.mids[coin] });
            },
            options,
          )
        : feed === "l2Book"
          ? client.l2Book({ coin }, receive, options)
          : feed === "trades"
            ? client.trades({ coin }, receive, options)
            : feed === "candle"
              ? client.candle({ coin, interval: "1m" }, receive, options)
              : client.activeAssetCtx({ coin }, receive, options);

    subscription
      .then(() => {
        if (!controller.signal.aborted) {
          setStream((current) => (current.status === "live" ? current : { ...current, status: "waiting" }));
        }
      })
      .catch(fail);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [coin, feed, retry]);

  return stream;
}

const statusLabels: Record<Status, string> = {
  off: "Stream off",
  connecting: "Connecting",
  waiting: "Waiting for data",
  live: "Live",
  reconnecting: "Reconnecting",
  error: "Connection unavailable",
};

export function MarketPlayground() {
  const [coin, setCoin] = useState<Coin>("BTC");
  const [feed, setFeed] = useState<Feed | null>(null);
  const [retry, setRetry] = useState(0);
  const stream = useMarketStream(coin, feed, retry);
  const code = snippet(coin, feed);

  return (
    <div className="code-window playground">
      <div className="code-toolbar">
        <div className="window-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
        <span>playground.ts</span>
        <div className="code-actions">
          <span className="code-language">TS</span>
          <CopyButton text={code} label="Copy playground code" className="code-copy" />
        </div>
      </div>
      <div className="playground-body">
        <div className="playground-editor">
          <div className="playground-controls">
            <fieldset>
              <legend>Asset</legend>
              <div className="playground-options">
                {assets.map((asset) => (
                  <button
                    key={asset.coin}
                    type="button"
                    aria-pressed={coin === asset.coin}
                    onClick={() => setCoin(asset.coin)}
                  >
                    {asset.label}
                  </button>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend>
                Data feed <span>Select to start streaming</span>
              </legend>
              <div className="playground-options playground-feeds">
                <button type="button" aria-pressed={feed === null} onClick={() => setFeed(null)}>
                  Off
                </button>
                {feeds.map((item) => (
                  <button key={item.id} type="button" aria-pressed={feed === item.id} onClick={() => setFeed(item.id)}>
                    {item.label}
                  </button>
                ))}
              </div>
            </fieldset>
          </div>
          <AnimatedCode text={code} />
        </div>
        <div className="playground-output">
          <div className="playground-output-toolbar">
            <span className="playground-status" data-status={stream.status} role="status">
              <i />
              {statusLabels[stream.status]}
            </span>
            {stream.receivedAt !== null && (
              <span className="playground-event-count">
                {stream.count.toLocaleString()} events · {new Date(stream.receivedAt).toLocaleTimeString()}
              </span>
            )}
            {stream.status === "off" && <span className="playground-network">Mainnet</span>}
            {stream.status === "error" && (
              <button type="button" className="playground-retry" onClick={() => setRetry((value) => value + 1)}>
                <RotateCcw size={12} aria-hidden /> Retry
              </button>
            )}
          </div>
          {stream.payload ? (
            /* biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users must be able to scroll the live JSON. */
            <pre className="playground-json" tabIndex={0}>
              <code>{stream.payload}</code>
            </pre>
          ) : (
            <div className="playground-empty">
              <Radio size={20} aria-hidden />
              <p>
                {stream.status === "off"
                  ? "Pick a feed. Watch the market move."
                  : stream.status === "error"
                    ? "Couldn't connect. Retry or choose another feed."
                    : "Listening for the first update…"}
              </p>
              <span>
                {stream.status === "off" ? "Real data. Your code. No API key needed." : `${coin} · Hyperliquid mainnet`}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

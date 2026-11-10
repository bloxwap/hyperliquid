/**
 * Match a transport's `isTestnet` flag to the Hyperliquid host it actually dials.
 *
 * Signing, the nonce lock, and the WebSocket quota all read `isTestnet` and never the URL.
 * The hosts below are the ones this SDK documents, so a flag that disagrees with one of them
 * is a configuration bug. Any other host — a proxy, a local node, a private port on a
 * different name — is left alone.
 *
 * @module
 */

/** Official mainnet API and RPC hosts. */
const MAINNET_HOSTS: ReadonlySet<string> = new Set(["api.hyperliquid.xyz", "rpc.hyperliquid.xyz"]);
/** Official testnet API and RPC hosts. */
const TESTNET_HOSTS: ReadonlySet<string> = new Set(["api.hyperliquid-testnet.xyz", "rpc.hyperliquid-testnet.xyz"]);

/**
 * Whether `url` names an official Hyperliquid host.
 *
 * @returns `true` for testnet, `false` for mainnet, `undefined` for any other host or for a
 * string that is not a URL. The path, query, and userinfo are ignored, and one trailing dot
 * on the hostname is ignored, so none of those hide a known host.
 */
export function knownHyperliquidIsTestnet(url: string | URL): boolean | undefined {
  let hostname: string;
  try {
    hostname = (typeof url === "string" ? new URL(url) : url).hostname;
  } catch {
    return undefined;
  }
  if (hostname.endsWith(".")) hostname = hostname.slice(0, -1);
  if (TESTNET_HOSTS.has(hostname)) return true;
  if (MAINNET_HOSTS.has(hostname)) return false;
  return undefined;
}

/**
 * Resolves `isTestnet` from an explicit flag and any known Hyperliquid URLs.
 *
 * An omitted flag is derived from a known host, or `false` when every supplied URL is custom
 * or absent. An explicit flag that disagrees with a known host throws, and so do two known
 * hosts on different networks. Custom hosts do not participate.
 *
 * @throws {TypeError} When `isTestnet` is set and is not a boolean, or when it disagrees with
 * a known host, or when two known hosts disagree with each other.
 */
export function resolveTransportIsTestnet(
  label: string,
  explicit: boolean | undefined,
  endpoints: readonly { name: string; url: string | URL | undefined }[],
): boolean {
  let derived: boolean | undefined;
  let derivedFrom: string | undefined;
  for (const endpoint of endpoints) {
    if (endpoint.url === undefined) continue;
    const network = knownHyperliquidIsTestnet(endpoint.url);
    if (network === undefined) continue;
    if (derived !== undefined && derived !== network) {
      throw new TypeError(
        `${label}: ${derivedFrom} is Hyperliquid ${networkName(derived)} but ${endpoint.name} is Hyperliquid ${networkName(network)}. Use one network, or omit isTestnet to derive it. Custom hosts are not checked.`,
      );
    }
    derived = network;
    derivedFrom = endpoint.name;
  }
  if (explicit === undefined) return derived ?? false;
  if (typeof explicit !== "boolean") {
    throw new TypeError(`${label}: isTestnet must be a boolean when set (got ${typeof explicit})`);
  }
  if (derived !== undefined && derived !== explicit) {
    throw new TypeError(
      `${label}: isTestnet is ${explicit} but ${derivedFrom} is Hyperliquid ${networkName(derived)}. Set isTestnet to match that host, or omit it to derive the network. Custom hosts are not checked.`,
    );
  }
  return explicit;
}

/** `"testnet"` or `"mainnet"` for error text. */
function networkName(isTestnet: boolean): "testnet" | "mainnet" {
  return isTestnet ? "testnet" : "mainnet";
}

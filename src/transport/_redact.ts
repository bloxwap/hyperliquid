/**
 * Redaction helper for payloads copied into transport errors.
 *
 * Signed exchange payloads (`{ action, signature, nonce }`) are attached to
 * `HttpRequestError.request` and `WebSocketRequestError.request` so callers can see which
 * request failed. Forwarded to telemetry or logs, the raw signature would leak trading intent
 * (which market, which side, at what price — never keys: signatures are single-use), so the
 * transports replace it with a placeholder when the error is constructed.
 * @module
 */

/** Placeholder that replaces the `signature` value when a signed payload is copied into an error. */
export const REDACTED_SIGNATURE = "0x<redacted>";

/**
 * Returns `payload` unchanged unless it is an object carrying a `signature` property; in that
 * case returns a shallow copy with the signature replaced by {@linkcode REDACTED_SIGNATURE}.
 *
 * The redacted value is a COPY: the object actually sent to the server is never mutated, so the
 * wire keeps the real signature. Payloads without a signature pass through by reference, which
 * keeps the common info-request path allocation-free.
 */
export function redactSignature<T>(payload: T): T {
  if (typeof payload !== "object" || payload === null || !("signature" in payload)) return payload;
  return { ...payload, signature: REDACTED_SIGNATURE };
}

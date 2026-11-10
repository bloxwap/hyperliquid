/**
 * Shape of a user-signed EIP-712 `types` object.
 *
 * The signer reads the primary type as `Object.keys(types)[0]` and multi-sig inserts its fields
 * after that type's first field, which is `hyperliquidChain`. `EIP712Domain` is not part of the
 * object: the SDK supplies the domain. A definition that lists another type first, or whose first
 * field is not `hyperliquidChain`, fails `satisfies UserSignedActionTypes`.
 * @module
 */

/** One EIP-712 field. `name` stays open so action fields after `hyperliquidChain` type-check. */
export interface UserSignedField {
  readonly name: string;
  readonly type: string;
}

/**
 * User-signed action types. Every key is a `HyperliquidTransaction:` primary type whose first
 * field is `{ name: "hyperliquidChain", type: "string" }`.
 */
export type UserSignedActionTypes = {
  readonly [primaryType: `HyperliquidTransaction:${string}`]: readonly [
    { readonly name: "hyperliquidChain"; readonly type: "string" },
    ...(readonly UserSignedField[]),
  ];
};

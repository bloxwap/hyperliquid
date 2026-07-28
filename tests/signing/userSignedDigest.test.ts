/**
 * Differential conformance tests for the hand-rolled user-signed digest fast path.
 *
 * `src/signing/_userSigned.ts` signs user-signed actions through the hand-rolled digest in
 * `src/signing/_fastDigest.ts` (`createUserSignedDigestBytes`) whenever the wallet can sign a raw
 * digest, and the digest it produces is signed — a single differing byte would authorize a
 * payload the user never approved. So viem is kept as the oracle here, in the style of
 * `multiSigDigest.test.ts`: the digest must be byte-identical to viem's `hashTypedData` across
 * EVERY user-signed action type the package ships, chain IDs, and networks, and the full
 * `signUserSignedAction` output must equal the same flow run with the raw-digest capability
 * stripped (forcing the signature through viem's `signTypedData`). Shapes the encoder does not
 * cover (arrays, nested structs, fixed `bytesN`, checksummed mixed-case addresses, out-of-range
 * integers) must yield `undefined`, so the caller falls back to the typed-data path.
 * @module
 */

import { describe, expect, test } from "bun:test";
import { bytesToHex } from "@noble/hashes/utils.js";
import { hashTypedData } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { signUserSignedAction } from "@bloxwap/hyperliquid/signing";
import {
  ApproveAgentTypes,
  ApproveBuilderFeeTypes,
  CDepositTypes,
  CWithdrawTypes,
  ConvertToMultiSigUserTypes,
  LinkStakingUserTypes,
  SendAssetTypes,
  SendToEvmWithDataTypes,
  SpotSendTypes,
  StakingLinkDisableTradingUserTypes,
  TokenDelegateTypes,
  UsdClassTransferTypes,
  UsdSendTypes,
  UserDexAbstractionTypes,
  UserPortfolioMarginTypes,
  UserSetAbstractionTypes,
  Withdraw3Types,
} from "@bloxwap/hyperliquid/api/exchange";
import { SIGN_DIGEST_BYTES } from "../../src/signing/_abstractWallet.ts";
import { createUserSignedDigestBytes } from "../../src/signing/_fastDigest.ts";

// --- Fixtures --------------------------------------------------

const PRIVATE_KEY = "0x822e9959e022b78423eb653a62ea0020cd283e71a2a8133a6ff2aeffaf373cff";

const NONCE = 1700000000000;

/** `0x66eee` is the Hyperliquid mainnet default; the rest exercise the per-chain domain separator cache. */
const SIGNATURE_CHAIN_IDS = ["0x66eee", "0x1", "0xa4b1", "0x539", "0xaa36a7"] as const;

const USER = "0x1234567890123456789012345678901234567890";
const DESTINATION = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";

type Types = Record<string, readonly { name: string; type: string }[]>;

/** Every user-signed action type the package ships, with a fully-populated message. */
const CASES: readonly { label: string; types: Types; message: Record<string, unknown> }[] = [
  {
    label: "approveAgent",
    types: ApproveAgentTypes,
    message: { hyperliquidChain: "Mainnet", agentAddress: USER, agentName: "Agent", nonce: NONCE },
  },
  {
    label: "approveAgent (unnamed, empty agentName)",
    types: ApproveAgentTypes,
    message: { hyperliquidChain: "Testnet", agentAddress: USER, agentName: "", nonce: NONCE },
  },
  {
    label: "approveBuilderFee",
    types: ApproveBuilderFeeTypes,
    message: { hyperliquidChain: "Mainnet", maxFeeRate: "0.001%", builder: USER, nonce: NONCE },
  },
  {
    label: "cDeposit",
    types: CDepositTypes,
    message: { hyperliquidChain: "Mainnet", wei: 123456789, nonce: NONCE },
  },
  {
    label: "cWithdraw",
    types: CWithdrawTypes,
    message: { hyperliquidChain: "Testnet", wei: 1, nonce: NONCE },
  },
  {
    label: "convertToMultiSigUser",
    types: ConvertToMultiSigUserTypes,
    message: { hyperliquidChain: "Mainnet", signers: JSON.stringify([USER, DESTINATION]), nonce: NONCE },
  },
  {
    label: "linkStakingUser",
    types: LinkStakingUserTypes,
    message: { hyperliquidChain: "Mainnet", user: USER, isFinalize: true, nonce: NONCE },
  },
  {
    label: "linkStakingUser (false bool)",
    types: LinkStakingUserTypes,
    message: { hyperliquidChain: "Testnet", user: USER, isFinalize: false, nonce: NONCE },
  },
  {
    label: "sendAsset",
    types: SendAssetTypes,
    message: {
      hyperliquidChain: "Mainnet",
      destination: DESTINATION,
      sourceDex: "spot",
      destinationDex: "",
      token: "PURR:0xeb62eee3685fc4c43992febcd9e75443",
      amount: "1.5",
      fromSubAccount: "",
      nonce: NONCE,
    },
  },
  {
    label: "sendToEvmWithData (bytes + uint32 fields)",
    types: SendToEvmWithDataTypes,
    message: {
      hyperliquidChain: "Mainnet",
      token: "USDC:0xeb62eee3685fc4c43992febcd9e75443",
      amount: "10.0",
      sourceDex: "",
      destinationRecipient: DESTINATION,
      addressEncoding: "hex",
      destinationChainId: 42161,
      gasLimit: 250000,
      data: "0x095ea7b30000000000000000000000001234567890123456789012345678901234567890",
      nonce: NONCE,
    },
  },
  {
    label: "sendToEvmWithData (empty bytes)",
    types: SendToEvmWithDataTypes,
    message: {
      hyperliquidChain: "Testnet",
      token: "USDC:0xeb62eee3685fc4c43992febcd9e75443",
      amount: "0.1",
      sourceDex: "spot",
      destinationRecipient: DESTINATION,
      addressEncoding: "hex",
      destinationChainId: 0,
      gasLimit: 0,
      data: "0x",
      nonce: 0,
    },
  },
  {
    label: "spotSend",
    types: SpotSendTypes,
    message: {
      hyperliquidChain: "Mainnet",
      destination: DESTINATION,
      token: "PURR:0xeb62eee3685fc4c43992febcd9e75443",
      amount: "2.25",
      time: NONCE,
    },
  },
  {
    label: "stakingLinkDisableTradingUser",
    types: StakingLinkDisableTradingUserTypes,
    message: { hyperliquidChain: "Mainnet", tradingUser: USER, nonce: NONCE },
  },
  {
    label: "tokenDelegate",
    types: TokenDelegateTypes,
    message: { hyperliquidChain: "Mainnet", validator: USER, wei: 9007199254740991, isUndelegate: false, nonce: NONCE },
  },
  {
    label: "usdClassTransfer",
    types: UsdClassTransferTypes,
    message: { hyperliquidChain: "Mainnet", amount: "100.5", toPerp: true, nonce: NONCE },
  },
  {
    label: "usdSend",
    types: UsdSendTypes,
    message: { hyperliquidChain: "Mainnet", destination: DESTINATION, amount: "3.14", time: NONCE },
  },
  {
    label: "userDexAbstraction",
    types: UserDexAbstractionTypes,
    message: { hyperliquidChain: "Mainnet", user: USER, enabled: true, nonce: NONCE },
  },
  {
    label: "userPortfolioMargin",
    types: UserPortfolioMarginTypes,
    message: { hyperliquidChain: "Testnet", user: USER, enabled: false, nonce: NONCE },
  },
  {
    label: "userSetAbstraction",
    types: UserSetAbstractionTypes,
    message: { hyperliquidChain: "Mainnet", user: USER, abstraction: "unifiedAccount", nonce: NONCE },
  },
  {
    label: "withdraw3",
    types: Withdraw3Types,
    message: { hyperliquidChain: "Mainnet", destination: DESTINATION, amount: "42.0", time: NONCE },
  },
  {
    label: "bigint and non-ASCII string values",
    types: ApproveAgentTypes,
    message: { hyperliquidChain: "Mainnet", agentAddress: USER, agentName: "Agent ünïcode ✓", nonce: BigInt(NONCE) },
  },
];

/** The viem typed-data envelope for a case under `signatureChainId`. */
function oracleTypedData(types: Types, message: Record<string, unknown>, signatureChainId: `0x${string}`) {
  return {
    domain: {
      name: "HyperliquidSignTransaction",
      version: "1",
      chainId: parseInt(signatureChainId, 16),
      verifyingContract: "0x0000000000000000000000000000000000000000",
    },
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" },
      ],
      ...types,
    },
    primaryType: Object.keys(types)[0],
    message,
  } as const;
}

// --- Digest conformance ----------------------------------------

describe("createUserSignedDigestBytes()", () => {
  test("matches viem hashTypedData across every shipped action type x chain IDs", () => {
    for (const { label, types, message } of CASES) {
      for (const signatureChainId of SIGNATURE_CHAIN_IDS) {
        // Extra undeclared keys (as the real action carries: `type`, `signatureChainId`) must be
        // ignored, exactly like the message filtering the typed-data path applies.
        const action = { type: label, signatureChainId, ...message };
        const oracle = hashTypedData(oracleTypedData(types, message, signatureChainId) as never);
        const digest = createUserSignedDigestBytes(action, types, signatureChainId);
        expect(digest, `${label} / ${signatureChainId}`).toBeDefined();
        expect(`0x${bytesToHex(digest!)}`, `${label} / ${signatureChainId}`).toBe(oracle);
      }
    }
  });

  test("keeps the known-good digest (pins typehash, domain separator, and field encoding)", () => {
    // Captured from viem `hashTypedData`; a wrong typehash, domain separator, or field word breaks this.
    const action = {
      type: "approveAgent",
      signatureChainId: "0x66eee",
      hyperliquidChain: "Mainnet",
      agentAddress: USER,
      agentName: "Agent",
      nonce: NONCE,
    };
    const digest = createUserSignedDigestBytes(action, ApproveAgentTypes, "0x66eee");
    expect(digest).toBeDefined();
    expect(`0x${bytesToHex(digest!)}`).toBe("0x3df7ffbed96976200c31604dd7626e6a6da2733a6dad32681027e908d7294117");
  });

  test("matches viem for the multi-sig-extended types (payloadMultiSigUser/outerSigner injected)", () => {
    // The shape `getMultiSigExtendedTypes` in `_userSigned.ts` builds: two address fields
    // injected after the primary type's first field.
    const extendedTypes = {
      "HyperliquidTransaction:ApproveAgent": [
        { name: "hyperliquidChain", type: "string" },
        { name: "payloadMultiSigUser", type: "address" },
        { name: "outerSigner", type: "address" },
        { name: "agentAddress", type: "address" },
        { name: "agentName", type: "string" },
        { name: "nonce", type: "uint64" },
      ],
    } as const;
    const message = {
      hyperliquidChain: "Testnet",
      payloadMultiSigUser: USER,
      outerSigner: DESTINATION,
      agentAddress: USER,
      agentName: "Agent",
      nonce: NONCE,
    };
    const oracle = hashTypedData(oracleTypedData(extendedTypes, message, "0x66eee") as never);
    const digest = createUserSignedDigestBytes({ ...message, type: "approveAgent" }, extendedTypes, "0x66eee");
    expect(digest).toBeDefined();
    expect(`0x${bytesToHex(digest!)}`).toBe(oracle);
  });

  test("accepts a Uint8Array for a dynamic bytes field, like viem", () => {
    const types = SendToEvmWithDataTypes;
    const dataBytes = new Uint8Array([1, 2, 3, 250]);
    const base = CASES.find((c) => c.label === "sendToEvmWithData (bytes + uint32 fields)")!.message;
    const message = { ...base, data: dataBytes };
    const oracle = hashTypedData(oracleTypedData(types, message, "0x66eee") as never);
    const digest = createUserSignedDigestBytes(message, types, "0x66eee");
    expect(digest).toBeDefined();
    expect(`0x${bytesToHex(digest!)}`).toBe(oracle);
  });
});

// --- Fallback (unsupported shapes yield no digest) --------------

describe("createUserSignedDigestBytes() fallback", () => {
  const ACTION = {
    type: "approveAgent",
    signatureChainId: "0x66eee" as const,
    hyperliquidChain: "Mainnet",
    agentAddress: USER,
    agentName: "Agent",
    nonce: NONCE,
  };

  test("returns undefined for an array field type", () => {
    const types = {
      "HyperliquidTransaction:Custom": [
        { name: "hyperliquidChain", type: "string" },
        { name: "payloads", type: "bytes32[]" },
        { name: "nonce", type: "uint64" },
      ],
    } as const;
    expect(createUserSignedDigestBytes(ACTION, types, "0x66eee")).toBeUndefined();
  });

  test("returns undefined for a nested struct field type", () => {
    const types = {
      "HyperliquidTransaction:Custom": [
        { name: "hyperliquidChain", type: "string" },
        { name: "inner", type: "Inner" },
        { name: "nonce", type: "uint64" },
      ],
      Inner: [{ name: "value", type: "uint64" }],
    } as const;
    expect(createUserSignedDigestBytes(ACTION, types, "0x66eee")).toBeUndefined();
  });

  test("returns undefined for a fixed bytesN field type", () => {
    const types = {
      "HyperliquidTransaction:Custom": [
        { name: "hyperliquidChain", type: "string" },
        { name: "connectionId", type: "bytes32" },
        { name: "nonce", type: "uint64" },
      ],
    } as const;
    expect(createUserSignedDigestBytes(ACTION, types, "0x66eee")).toBeUndefined();
  });

  test("returns undefined for a mixed-case (checksummed) address — viem must validate it", () => {
    const action = { ...ACTION, agentAddress: "0xaBcdEf1234567890aBcDeF1234567890aBcDeF12" };
    expect(createUserSignedDigestBytes(action, ApproveAgentTypes, "0x66eee")).toBeUndefined();
  });

  test("returns undefined for a missing declared field", () => {
    const { agentName: _, ...action } = ACTION;
    expect(createUserSignedDigestBytes(action, ApproveAgentTypes, "0x66eee")).toBeUndefined();
  });

  test("returns undefined for out-of-domain integer values", () => {
    expect(createUserSignedDigestBytes({ ...ACTION, nonce: -1 }, ApproveAgentTypes, "0x66eee")).toBeUndefined();
    expect(createUserSignedDigestBytes({ ...ACTION, nonce: 1.5 }, ApproveAgentTypes, "0x66eee")).toBeUndefined();
    expect(
      createUserSignedDigestBytes({ ...ACTION, nonce: "1700000000000" }, ApproveAgentTypes, "0x66eee"),
    ).toBeUndefined();
  });

  test("returns undefined for an unparsable signatureChainId", () => {
    expect(createUserSignedDigestBytes(ACTION, ApproveAgentTypes, "0xZZ")).toBeUndefined();
  });
});

// --- Signing flow conformance ------------------------------------

type ViemAccount = ReturnType<typeof privateKeyToAccount>;

/** The same account with the raw-digest capability removed: the signature goes through viem's `signTypedData`. */
function stripped(account: ViemAccount) {
  return {
    address: account.address,
    signTypedData: (params: never) => account.signTypedData(params),
  };
}

describe("signUserSignedAction() fast path", () => {
  test("is byte-identical to the typed-data path across action types x chain IDs", async () => {
    const account = privateKeyToAccount(PRIVATE_KEY);
    const oracle = stripped(account);
    for (const { label, types, message } of CASES) {
      for (const signatureChainId of ["0x66eee", "0x1"] as const) {
        const action = { type: label, signatureChainId, ...message };
        const fast = await signUserSignedAction({ wallet: account, action, types });
        const reference = await signUserSignedAction({ wallet: oracle, action, types });
        expect(fast, `${label} / ${signatureChainId}`).toEqual(reference);
      }
    }
  });

  test("signs exactly viem's digest through the raw-digest path, never signTypedData", async () => {
    const account = privateKeyToAccount(PRIVATE_KEY);
    const signedDigests: `0x${string}`[] = [];
    let typedDataCalls = 0;
    const wallet = {
      address: account.address,
      sign: (args: { hash: `0x${string}` }) => {
        signedDigests.push(args.hash);
        return account.sign(args);
      },
      signTypedData: (params: never) => {
        typedDataCalls++;
        return account.signTypedData(params);
      },
    };
    const { label, types, message } = CASES[0];
    const signatureChainId = "0x66eee";
    const action: { signatureChainId: `0x${string}`; [key: string]: unknown } = {
      type: label,
      signatureChainId,
      ...message,
    };

    const signature = await signUserSignedAction({ wallet, action, types });

    const oracle = hashTypedData(oracleTypedData(types, message, signatureChainId) as never);
    expect(typedDataCalls).toBe(0);
    expect(signedDigests).toEqual([oracle]);
    // …and the signature equals what signing that digest with viem produces.
    const oracleHex = await account.sign({ hash: oracle });
    expect(`${signature.r.slice(2)}${signature.s.slice(2)}${signature.v.toString(16)}`).toBe(oracleHex.slice(2));
  });

  test("falls back to signTypedData for a wallet without raw-digest signing", async () => {
    const account = privateKeyToAccount(PRIVATE_KEY);
    let typedDataCalls = 0;
    const wallet = {
      address: account.address,
      signTypedData: (params: never) => {
        typedDataCalls++;
        return account.signTypedData(params);
      },
    };
    const { label, types, message } = CASES[0];
    const action = { type: label, signatureChainId: "0x66eee" as const, ...message };

    const fallback = await signUserSignedAction({ wallet, action, types });
    const fast = await signUserSignedAction({ wallet: account, action, types });

    expect(typedDataCalls).toBe(1);
    expect(fallback).toEqual(fast);
  });

  test("falls back to signTypedData for an unsupported types shape", async () => {
    const account = privateKeyToAccount(PRIVATE_KEY);
    let signCalls = 0;
    let typedDataCalls = 0;
    const wallet = {
      address: account.address,
      sign: (args: { hash: `0x${string}` }) => {
        signCalls++;
        return account.sign(args);
      },
      signTypedData: (params: never) => {
        typedDataCalls++;
        return account.signTypedData(params);
      },
    };
    // An array field is not covered by the hand-rolled encoder, so the typed-data path must sign.
    const types = {
      "HyperliquidTransaction:Custom": [
        { name: "hyperliquidChain", type: "string" },
        { name: "payloads", type: "bytes32[]" },
        { name: "nonce", type: "uint64" },
      ],
    } as const;
    const action = {
      type: "custom",
      signatureChainId: "0x66eee" as const,
      hyperliquidChain: "Testnet",
      payloads: ["0x1111111111111111111111111111111111111111111111111111111111111111"],
      nonce: NONCE,
    };

    const fallback = await signUserSignedAction({ wallet, action, types });
    const reference = await signUserSignedAction({ wallet: stripped(account), action, types });

    expect(signCalls).toBe(0);
    expect(typedDataCalls).toBe(1);
    expect(fallback).toEqual(reference);
  });

  test("never uses the fast path for a JSON-RPC wallet", async () => {
    const account = privateKeyToAccount(PRIVATE_KEY);
    let typedDataCalls = 0;
    // JSON-RPC shape: signTypedData + getAddresses + getChainId, and NO address field. Even though the
    // underlying signer could sign a digest locally, the adapter must route through real signTypedData.
    const wallet = {
      signTypedData: (params: never) => {
        typedDataCalls++;
        return account.signTypedData(params);
      },
      getAddresses: () => Promise.resolve([account.address]),
      getChainId: () => Promise.resolve(0x66eee),
    };
    const { label, types, message } = CASES[0];
    const action = { type: label, signatureChainId: "0x66eee" as const, ...message };

    const jsonRpc = await signUserSignedAction({ wallet, action, types });
    const fast = await signUserSignedAction({ wallet: account, action, types });

    expect(typedDataCalls).toBe(1);
    expect(jsonRpc).toEqual(fast);
  });

  test("prefers the SIGN_DIGEST_BYTES capability and hands it the exact digest bytes", async () => {
    const account = privateKeyToAccount(PRIVATE_KEY);
    const digests: Uint8Array[] = [];
    let hexSignCalls = 0;
    const wallet = {
      address: account.address,
      sign: (args: { hash: `0x${string}` }) => {
        hexSignCalls++;
        return account.sign(args);
      },
      [SIGN_DIGEST_BYTES]: (digest: Uint8Array) => {
        digests.push(digest);
        return account.sign({ hash: `0x${bytesToHex(digest)}` });
      },
      signTypedData: (params: never) => account.signTypedData(params),
    };
    const { label, types, message } = CASES[0];
    const signatureChainId = "0x66eee";
    const action: { signatureChainId: `0x${string}`; [key: string]: unknown } = {
      type: label,
      signatureChainId,
      ...message,
    };

    await signUserSignedAction({ wallet, action, types });

    const oracle = hashTypedData(oracleTypedData(types, message, signatureChainId) as never);
    expect(hexSignCalls).toBe(0);
    expect(digests.length).toBe(1);
    expect(`0x${bytesToHex(digests[0])}`).toBe(oracle);
  });
});

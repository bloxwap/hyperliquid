/** Type-check against the relocated published package, rather than source aliases. */
import { ExchangeClient, HttpTransport } from "@bloxwap/hyperliquid";
import { allMids } from "@bloxwap/hyperliquid/api/info/allMids";
import { buildOrder } from "@bloxwap/hyperliquid/actions/order";
import { executeAction, signAction, submitAction } from "@bloxwap/hyperliquid/actions/execution";
import { createOrderBatcher, type OrderOutcome } from "@bloxwap/hyperliquid/actions/orderBatcher";
import type { OrderSuccessResponse } from "@bloxwap/hyperliquid/api/exchange/order";
import type { ExchangeConfig } from "@bloxwap/hyperliquid/api/exchange";
// @ts-expect-error Private declaration paths remain closed by the published export map.
import type { ActionMetadata } from "@bloxwap/hyperliquid/actions/_canonical";
void ({} as ActionMetadata);

declare const config: ExchangeConfig;
const transport = new HttpTransport();
const mids: Record<string, string> = await allMids({ transport });
void mids;
const input = { a: 0, b: true, p: "1", s: "1", r: false, t: { limit: { tif: "Gtc" as const } } };
const action = buildOrder({ orders: [input] });
const client = new ExchangeClient(config);
const signed = await client.sign(action);
const submitted: OrderSuccessResponse = await client.submit(signed);
const executed: OrderSuccessResponse = await client.execute(action);
const staged: OrderSuccessResponse = await submitAction(config, await signAction(config, action));
const direct: OrderSuccessResponse = await executeAction(config, action);
const outcome: OrderOutcome = await createOrderBatcher(config).enqueue(input);
void [submitted, executed, staged, direct, outcome];
// @ts-expect-error The published type exposes an immutable signature.
signed.signature.v = 28;
// @ts-expect-error Signed action fields are immutable as well.
signed.action.type = "cancel";
// @ts-expect-error Operation-specific inputs retain their literal union types.
buildOrder({ orders: [{ ...input, t: { limit: { tif: "invalid" } } }] });

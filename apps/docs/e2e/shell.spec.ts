import { expect, test } from "@playwright/test";

test("static shell, keyboard install and copy success/failure", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: async (text: string) => {
          (window as unknown as { copied: string }).copied = text;
        },
      },
      configurable: true,
    });
  });
  await page.goto("/hyperliquid/");
  await expect(page.locator(".hig-shell")).toHaveAttribute("data-hig-density", "comfortable");
  const npm = page.getByRole("button", { name: "npm", exact: true });
  await npm.focus();
  await page.keyboard.press("Enter");
  await expect(npm).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Copy install command" }).click();
  await expect(page.locator(".install-command [role=status]")).toHaveText("Copied");
  expect(await page.evaluate(() => (window as unknown as { copied: string }).copied)).toBe(
    "npm install @bloxwap/hyperliquid",
  );
  await page.evaluate(() => {
    navigator.clipboard.writeText = async () => {
      throw new Error("Denied");
    };
  });
  await page.getByRole("button", { name: "yarn", exact: true }).click();
  await page.getByRole("button", { name: "Copy install command" }).click();
  await expect(page.locator(".install-command [role=status]")).toContainText("Copy failed");
  expect(await page.locator(".hero-description").evaluate((element) => getComputedStyle(element).animationName)).toBe(
    "none",
  );
  const footer = await page.locator(".site-footer").boundingBox();
  const playground = await page.locator(".playground-section").boundingBox();
  expect(footer?.y).toBeGreaterThan((playground?.y ?? 0) + (playground?.height ?? 0));
  expect(errors).toEqual([]);
});

test("search keyboard, results, empty state and deep link", async ({ page }) => {
  await page.goto("/hyperliquid/docs/clients/");
  await page.keyboard.press("Control+k");
  const input = page.getByRole("dialog").locator("input");
  await input.fill("transport");
  await expect(page.getByRole("dialog").getByRole("option").first()).toBeVisible();
  await input.fill("zzzzdoesnotexistzzzz");
  await expect(page.getByText("No matches. Try a method name", { exact: false })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.locator("h1")).toContainText("Clients");
});

test("market SDK subscription, payload, asset change and off", async ({ page }) => {
  await page.routeWebSocket("wss://api.hyperliquid.xyz/ws", (socket) => {
    const interval = setInterval(
      () => socket.send(JSON.stringify({ channel: "allMids", data: { mids: { BTC: "65000", SOL: "150" } } })),
      250,
    );
    socket.onClose(() => clearInterval(interval));
    socket.onMessage((raw) => {
      const message = JSON.parse(String(raw));
      if (message.method === "unsubscribe")
        socket.send(JSON.stringify({ channel: "subscriptionResponse", data: message }));
      if (message.method === "subscribe") {
        socket.send(JSON.stringify({ channel: "subscriptionResponse", data: message }));
        socket.send(JSON.stringify({ channel: "allMids", data: { mids: { BTC: "65000", SOL: "150" } } }));
      }
    });
  });
  await page.goto("/hyperliquid/");
  await expect(page.locator(".playground-status")).toHaveAttribute("data-status", "off");
  await page.getByRole("button", { name: "Mid price", exact: true }).click();
  await expect(page.locator(".playground-status")).toHaveAttribute("data-status", "live");
  await expect(page.locator(".playground-json")).toContainText("65000");
  await page.getByRole("button", { name: "Solana", exact: true }).click();
  await expect(page.locator(".playground-json")).toContainText("150");
  await page.getByRole("button", { name: "Off", exact: true }).click();
  await expect(page.locator(".playground-status")).toHaveAttribute("data-status", "off");
});

test("mobile navigation, large text and RTL reflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/hyperliquid/docs/clients/");
  await page.getByRole("button", { name: "Open Sidebar" }).click();
  await expect(page.getByRole("link", { name: "Connect to Hyperliquid", exact: true }).last()).toBeVisible();
  await page.getByRole("link", { name: "Connect to Hyperliquid", exact: true }).last().click();
  await expect(page).toHaveURL(/\/docs\/transports\//);
  await page.evaluate(() => {
    document.documentElement.dir = "rtl";
    document.documentElement.style.fontSize = "20px";
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("market loading, server rejection and retry", async ({ page }) => {
  let subscriptions = 0;
  let rejectSubscription = () => {};
  await page.routeWebSocket("wss://api.hyperliquid.xyz/ws", (socket) => {
    socket.onMessage((raw) => {
      const message = JSON.parse(String(raw));
      if (message.method !== "subscribe") return;
      subscriptions++;
      if (subscriptions === 1) {
        rejectSubscription = () =>
          socket.send(
            JSON.stringify({ channel: "error", data: `Invalid subscription ${JSON.stringify(message.subscription)}` }),
          );
      } else {
        socket.send(JSON.stringify({ channel: "subscriptionResponse", data: message }));
        socket.send(JSON.stringify({ channel: "allMids", data: { mids: { BTC: "65000" } } }));
      }
    });
  });
  await page.goto("/hyperliquid/");
  await page.getByRole("button", { name: "Mid price", exact: true }).click();
  await expect(page.locator(".playground-status")).toHaveAttribute("data-status", /connecting|reconnecting|waiting/);
  await expect.poll(() => subscriptions).toBe(1);
  rejectSubscription();
  await expect(page.locator(".playground-status")).toHaveAttribute("data-status", "error");
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.locator(".playground-status")).toHaveAttribute("data-status", "live");
});

test("search offline error is visible", async ({ page }) => {
  await page.route("**/search-index.json", (route) => route.abort());
  await page.goto("/hyperliquid/docs/clients/");
  await page.keyboard.press("Control+k");
  await page.getByRole("dialog").locator("input").fill("transport");
  await expect(page.getByRole("alert")).toContainText("Search unavailable");
});

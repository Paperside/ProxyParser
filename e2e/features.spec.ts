import { expect, test, type Page, type Route } from "@playwright/test";

const registerAndCreateSubscription = async (page: Page) => {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
  await page.goto("/register");
  await page.getByLabel("邮箱").fill(`e2e-${suffix}@example.test`);
  await page.getByLabel("用户名", { exact: true }).fill(`e2e${suffix.replaceAll("-", "")}`);
  await page.getByLabel("密码").fill("e2e-password-123");
  await page.getByRole("button", { name: "创建账号" }).click();
  await expect(page).toHaveURL(/\/workbench/);

  return page.evaluate(async () => {
    const session = JSON.parse(localStorage.getItem("proxyparser.session")!) as { accessToken: string };
    const request = async (path: string, body: unknown) => {
      const response = await fetch(`http://127.0.0.1:7311${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.accessToken}` },
        body: JSON.stringify(body)
      });
      if (!response.ok) throw new Error(await response.text());
      return response.json();
    };
    const source = await request("/api/sources", {
      displayName: "E2E fixture",
      yamlContent: [
        "proxies:",
        "  - name: Fixture SS 1",
        "    type: ss",
        "    server: 127.0.0.1",
        "    port: 8388",
        "    cipher: aes-128-gcm",
        "    password: fixture",
        "  - name: Fixture SS 2",
        "    type: ss",
        "    server: 127.0.0.1",
        "    port: 8389",
        "    cipher: aes-128-gcm",
        "    password: fixture",
        "  - name: Fixture SS 3",
        "    type: ss",
        "    server: 127.0.0.1",
        "    port: 8390",
        "    cipher: aes-128-gcm",
        "    password: fixture",
        "proxy-groups: []",
        "rules: []"
      ].join("\n")
    }) as { id: string };
    const created = await request("/api/subscriptions", {
      displayName: "E2E subscription",
      sourceIds: [source.id],
      start: { kind: "recommended" }
    }) as { subscription: { id: string } };
    return created.subscription.id;
  });
};

test("规则交付开关、URI 自动识别与延迟测试入口可用", async ({ page }) => {
  const subscriptionId = await registerAndCreateSubscription(page);
  await page.goto(`/subscriptions/${subscriptionId}/rules`);
  const inlineSwitch = page.getByRole("switch", { name: "将规则直接写入订阅文件" });
  await expect(inlineSwitch).not.toBeChecked();
  await inlineSwitch.click();
  await expect(inlineSwitch).toBeChecked();
  await expect(page.getByText("文件会明显变大", { exact: false })).toBeVisible();

  await page.goto(`/subscriptions/${subscriptionId}/nodes`);
  await expect(page.getByText("只代表服务器所在网络", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "测试全部" })).toBeVisible();
  await page.getByRole("button", { name: "新增自建节点" }).click();
  const uriInput = page.getByLabel("粘贴节点分享链接", { exact: false });
  const shareUri = "vless://11111111-1111-1111-1111-111111111111@edge.example.com:443?security=tls&type=ws&sni=edge.example.com&path=%2Fws#E2E-VLESS";
  await uriInput.evaluate((element, uri) => {
    const data = new DataTransfer();
    data.setData("text", uri);
    element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, clipboardData: data }));
  }, shareUri);
  await expect(page.getByLabel("名称")).toHaveValue("E2E-VLESS");
  await expect(page.getByLabel("服务器", { exact: true })).toHaveValue("edge.example.com");
  await expect(page.getByLabel("端口")).toHaveValue("443");
  await expect(page.getByText("已识别 vless:// 节点", { exact: false })).toBeVisible();
});

test("工作区不自动生成完整预览，大 YAML 仅按需下载", async ({ page }) => {
  const subscriptionId = await registerAndCreateSubscription(page);
  let previewRequests = 0;
  let yamlRequests = 0;
  let previewContainedYamlText = false;

  await page.route(`**/api/subscriptions/${subscriptionId}/preview`, async (route) => {
    previewRequests += 1;
    const response = await route.fetch();
    const payload = await response.json() as Record<string, unknown>;
    previewContainedYamlText = Object.hasOwn(payload, "yamlText");
    await route.fulfill({
      response,
      json: { ...payload, yamlBytes: 2 * 1024 * 1024 }
    });
  });
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.endsWith("/preview/yaml")) yamlRequests += 1;
  });

  await page.goto(`/subscriptions/${subscriptionId}/overview`);
  await expect(page.getByRole("button", { name: "生成预览与差异" })).toBeVisible();
  expect(previewRequests).toBe(0);
  expect(yamlRequests).toBe(0);

  await page.getByRole("button", { name: "生成预览与差异" }).click();
  await expect.poll(() => previewRequests).toBe(1);
  expect(previewContainedYamlText).toBe(false);
  expect(yamlRequests).toBe(0);

  await page.getByRole("button", { name: "预览", exact: true }).click();
  await expect(page.getByText("大于 1 MiB 的内容只提供文件下载", { exact: false })).toBeVisible();
  await expect(page.locator("aside pre")).toHaveCount(0);

  const yamlResponsePromise = page.waitForResponse((response) =>
    new URL(response.url()).pathname.endsWith("/preview/yaml")
  );
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载完整 YAML" }).click();
  const [yamlResponse, download] = await Promise.all([yamlResponsePromise, downloadPromise]);
  expect(yamlResponse.headers()["content-type"]).toContain("application/yaml");
  expect(yamlResponse.headers()["x-draft-revision"]).toBeTruthy();
  expect(yamlResponse.headers()["x-rendered-hash"]).toBeTruthy();
  expect(download.suggestedFilename()).toMatch(/\.yaml$/);
  expect(yamlRequests).toBe(1);
  await expect(page.locator("aside pre")).toHaveCount(0);
});

test("单节点测速互不禁用，第三个请求在客户端排队且认证刷新只执行一次", async ({ page }) => {
  const subscriptionId = await registerAndCreateSubscription(page);
  const firstUnauthorized: Array<{ route: Route; release: () => void }> = [];
  const pendingSuccess: Array<{ nodeIds: string[]; finish: () => Promise<void> }> = [];
  let forcedUnauthorized = 0;
  let refreshRequests = 0;

  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/auth/refresh") refreshRequests += 1;
  });
  await page.route(`**/api/subscriptions/${subscriptionId}/latency-tests`, async (route) => {
    const body = route.request().postDataJSON() as { nodeIds: string[] };
    if (forcedUnauthorized < 2) {
      forcedUnauthorized += 1;
      await new Promise<void>((resolve) => {
        firstUnauthorized.push({ route, release: resolve });
        if (firstUnauthorized.length === 2) {
          void Promise.all(
            firstUnauthorized.map((entry) =>
              entry.route.fulfill({ status: 401, json: { message: "expired for e2e" } })
            )
          ).then(() => firstUnauthorized.forEach((entry) => entry.release()));
        }
      });
      return;
    }

    await new Promise<void>((resolve) => {
      pendingSuccess.push({
        nodeIds: body.nodeIds,
        finish: async () => {
          await route.fulfill({
            status: 200,
            json: {
              testUrl: "https://example.test/generate_204",
              timeoutMs: 5_000,
              testedAt: new Date().toISOString(),
              results: body.nodeIds.map((nodeId) => ({
                nodeId,
                name: nodeId,
                status: "ok",
                delayMs: 42
              }))
            }
          });
          resolve();
        }
      });
    });
  });

  await page.goto(`/subscriptions/${subscriptionId}/nodes`);
  const firstRow = page.getByRole("row").filter({ hasText: "Fixture SS 1" });
  const secondRow = page.getByRole("row").filter({ hasText: "Fixture SS 2" });
  const thirdRow = page.getByRole("row").filter({ hasText: "Fixture SS 3" });
  await expect(firstRow).toBeVisible();

  await firstRow.getByRole("button", { name: "测试", exact: true }).click();
  await expect(firstRow.getByRole("button", { name: "测试中…" })).toBeDisabled();
  await expect(secondRow.getByRole("button", { name: "测试", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "测试全部" })).toBeEnabled();
  await secondRow.getByRole("button", { name: "测试", exact: true }).click();
  await thirdRow.getByRole("button", { name: "测试", exact: true }).click();
  await expect(thirdRow.getByRole("button", { name: "排队中…" })).toBeDisabled();

  await expect.poll(() => pendingSuccess.length).toBe(2);
  await expect.poll(() => refreshRequests).toBe(1);
  await pendingSuccess[0]!.finish();
  await expect.poll(() => pendingSuccess.length).toBe(3);
  await expect(thirdRow.getByRole("button", { name: "测试中…" })).toBeDisabled();
  await Promise.all([pendingSuccess[1]!.finish(), pendingSuccess[2]!.finish()]);

  await expect(firstRow.getByRole("button", { name: "42 ms" })).toBeEnabled();
  await expect(secondRow.getByRole("button", { name: "42 ms" })).toBeEnabled();
  await expect(thirdRow.getByRole("button", { name: "42 ms" })).toBeEnabled();
});

test("模板敏感信息开关显示加密与分享确认", async ({ page }) => {
  const subscriptionId = await registerAndCreateSubscription(page);
  await page.goto(`/subscriptions/${subscriptionId}/overview`);
  await page.getByRole("button", { name: "提炼为模板" }).click();
  await expect(page.getByText("保留自建节点敏感信息")).toBeVisible();
  await page.getByRole("switch").click();
  await expect(page.getByText("任何成功应用此模板的人", { exact: false })).toBeVisible();
  await page.getByRole("combobox").click();
  await page.getByRole("option", { name: "公开" }).click();
  await expect(page.getByText("公开或拿到链接的用户", { exact: false })).toBeVisible();
});

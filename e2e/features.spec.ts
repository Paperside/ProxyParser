import { expect, test, type Page } from "@playwright/test";

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
        "  - name: Fixture SS",
        "    type: ss",
        "    server: 127.0.0.1",
        "    port: 8388",
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

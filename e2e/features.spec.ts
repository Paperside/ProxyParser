import { expect, test, type Page, type Route } from "@playwright/test";

const registerUser = async (page: Page) => {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
  await page.goto("/register");
  await page.getByLabel("邮箱").fill(`e2e-${suffix}@example.test`);
  await page.getByLabel("用户名", { exact: true }).fill(`e2e${suffix.replaceAll("-", "")}`);
  await page.getByLabel("密码").fill("e2e-password-123");
  await page.getByRole("button", { name: "创建账号" }).click();
  await expect(page).toHaveURL(/\/workbench/);
};

const registerAndCreateSubscription = async (page: Page) => {
  await registerUser(page);

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

test("新建订阅可多选来源，并阻止多来源使用机场原版配置", async ({ page }) => {
  await registerUser(page);
  await page.evaluate(async () => {
    const session = JSON.parse(localStorage.getItem("proxyparser.session")!) as { accessToken: string };
    const createSource = async (displayName: string, port: number) => {
      const response = await fetch("http://127.0.0.1:7311/api/sources", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.accessToken}`
        },
        body: JSON.stringify({
          displayName,
          yamlContent: [
            "proxies:",
            `  - name: ${displayName} Node`,
            "    type: ss",
            "    server: 127.0.0.1",
            `    port: ${port}`,
            "    cipher: aes-128-gcm",
            "    password: fixture",
            "proxy-groups: []",
            "rules: []"
          ].join("\n")
        })
      });
      if (!response.ok) throw new Error(await response.text());
    };
    await createSource("Source Alpha", 8388);
    await createSource("Source Beta", 8389);
  });

  await page.goto("/subscriptions/new");
  await page.getByRole("checkbox", { name: "选择订阅源 Source Alpha" }).check();
  await page.getByRole("checkbox", { name: "选择订阅源 Source Beta" }).check();
  await expect(page.getByText("已选 2")).toBeVisible();
  await page.getByRole("button", { name: "继续（2 个源）" }).click();

  await expect(page.getByText("多来源只合并节点")).toBeVisible();
  await expect(page.getByText("每个节点名都会追加来源", { exact: false })).toBeVisible();
  await expect(
    page.getByRole("button", { name: /保留机场原版配置/ })
  ).toBeDisabled();
  await expect(page.getByText("仅支持单一来源")).toBeVisible();

  await page.getByRole("button", { name: "继续", exact: true }).click();
  await page.getByLabel("订阅名称").fill("Merged E2E");
  const createResponsePromise = page.waitForResponse((response) =>
    response.request().method() === "POST" &&
    new URL(response.url()).pathname === "/api/subscriptions"
  );
  await page.getByRole("button", { name: "创建订阅" }).click();
  const createResponse = await createResponsePromise;
  const createBody = createResponse.request().postDataJSON() as { sourceIds: string[] };
  expect(createBody.sourceIds).toHaveLength(2);
  const created = await createResponse.json() as { subscription: { id: string } };

  await page.goto(`/subscriptions/${created.subscription.id}/nodes`);
  const alphaRow = page.getByRole("row").filter({ hasText: "Source Alpha Node · Source Alpha" });
  const betaRow = page.getByRole("row").filter({ hasText: "Source Beta Node · Source Beta" });
  await expect(alphaRow.getByRole("cell").nth(1)).toHaveText("Source Alpha");
  await expect(betaRow.getByRole("cell").nth(1)).toHaveText("Source Beta");
});

test("地区范围默认常用且 Final 兜底组可编辑", async ({ page }) => {
  const subscriptionId = await registerAndCreateSubscription(page);
  await page.goto(`/subscriptions/${subscriptionId}/groups`);

  const scope = page.getByRole("combobox", { name: "地区分组范围" });
  await expect(scope).toContainText("常用地区");
  const saveFullScope = page.waitForResponse(
    (response) =>
      response.request().method() === "PUT" &&
      new URL(response.url()).pathname === `/api/subscriptions/${subscriptionId}/draft`
  );
  await scope.click();
  await page.getByRole("option", { name: "完整地区" }).click();
  await expect(scope).toContainText("完整地区");
  expect((await saveFullScope).ok()).toBe(true);

  await page.goto(`/subscriptions/${subscriptionId}/overview`);
  page.once("dialog", (dialog) => void dialog.accept());
  const saveRecommendedDraft = page.waitForResponse(
    (response) =>
      response.request().method() === "PUT" &&
      new URL(response.url()).pathname === `/api/subscriptions/${subscriptionId}/draft`
  );
  await page.getByRole("button", { name: "套用最新推荐分组与规则" }).click();
  await expect(page.getByText("已套用最新推荐分组与规则", { exact: false })).toBeVisible();
  expect((await saveRecommendedDraft).ok()).toBe(true);

  await page.goto(`/subscriptions/${subscriptionId}/groups`);
  await expect(page.getByRole("combobox", { name: "地区分组范围" })).toContainText("常用地区");

  const openAiGroup = page.getByRole("group", { name: "代理组 OpenAI" });
  await openAiGroup.getByRole("button", { name: "编辑" }).click();
  const scopedDialog = page.getByRole("dialog");
  await expect(scopedDialog.getByText("当前不生效的地区组引用", { exact: false })).toBeVisible();
  await expect(scopedDialog.getByText("组 Others", { exact: true })).toBeVisible();
  await expect(scopedDialog.getByText("组 DE", { exact: true })).toHaveCount(0);
  await expect(scopedDialog.getByText("组 FR", { exact: true })).toHaveCount(0);
  await scopedDialog.getByRole("combobox", { name: "成员类型" }).click();
  await page.getByRole("option", { name: "代理组", exact: true }).click();
  await scopedDialog.getByRole("combobox", { name: "选择" }).click();
  await expect(page.getByRole("option", { name: "Others", exact: true })).toBeVisible();
  await expect(page.getByRole("option", { name: "DE", exact: true })).toHaveCount(0);
  await page.getByRole("option", { name: "Others", exact: true }).click();
  const preserveHiddenMembers = page.waitForResponse(
    (response) =>
      response.request().method() === "PUT" &&
      new URL(response.url()).pathname === `/api/subscriptions/${subscriptionId}/draft`
  );
  await scopedDialog.getByRole("button", { name: "保存" }).click();
  const savedPayload = (await preserveHiddenMembers).request().postDataJSON() as {
    buildConfig: {
      groups: { custom: Array<{ name: string; members: Array<{ kind: string; name?: string }> }> };
    };
  };
  const savedOpenAi = savedPayload.buildConfig.groups.custom.find((group) => group.name === "OpenAI");
  expect(savedOpenAi?.members).toContainEqual({ kind: "group", name: "FR" });

  const finalGroup = page.getByRole("group", { name: "代理组 Final" });
  await expect(finalGroup.getByText("MATCH 兜底")).toBeVisible();
  await finalGroup.getByRole("button", { name: "编辑" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("第一项是默认出口", { exact: false })).toBeVisible();
  await expect(dialog.getByText("组 Proxies", { exact: true })).toBeVisible();
  await expect(dialog.getByText("DIRECT", { exact: true })).toBeVisible();
});

test("订阅快捷入口与访问页均可按需展示二维码", async ({ page }) => {
  const subscriptionId = await registerAndCreateSubscription(page);

  await page.setViewportSize({ width: 900, height: 600 });
  await page.goto("/workbench");
  const workbenchCard = page.getByRole("group", { name: "订阅 E2E subscription" });
  const workbenchCopy = workbenchCard.getByRole("button", { name: "复制链接", exact: true });
  const workbenchQr = workbenchCard.getByRole("button", { name: "显示订阅二维码" });
  await expect(workbenchQr).toBeVisible();
  const workbenchPreview = workbenchCard.getByTestId("subscription-qr-popover");
  const positionCopyAnchor = async (position: "top" | "middle" | "bottom") => {
    await workbenchCopy.evaluate((button, nextPosition) => {
      const anchor = button.parentElement;
      if (!anchor) throw new Error("二维码触发器缺少定位容器");
      const anchorHeight = anchor.getBoundingClientRect().height;
      const top =
        nextPosition === "top"
          ? 8
          : nextPosition === "bottom"
            ? window.innerHeight - anchorHeight - 8
            : (window.innerHeight - anchorHeight) / 2;
      Object.assign(anchor.style, {
        position: "fixed",
        right: "24px",
        top: `${top}px`,
        zIndex: "80"
      });
    }, position);
  };
  const closeHoverPreview = async () => {
    await page.mouse.move(2, 2);
    await expect(workbenchPreview).toBeHidden();
  };

  await positionCopyAnchor("top");
  await workbenchCopy.hover();
  await expect(workbenchPreview).toBeVisible();
  await expect(workbenchPreview).toHaveAttribute("data-placement", "down");
  await expect(workbenchPreview.getByRole("img", { name: "订阅二维码" })).toBeVisible();
  await expect(workbenchPreview.getByText("仅在气泡打开期间读取并生成")).toHaveCount(0);
  const downGeometry = await workbenchPreview.evaluate((popover) => {
    const anchor = popover.parentElement;
    if (!anchor) throw new Error("二维码气泡缺少定位容器");
    return {
      anchorBottom: anchor.getBoundingClientRect().bottom,
      popoverTop: popover.getBoundingClientRect().top
    };
  });
  expect(downGeometry.popoverTop).toBeGreaterThanOrEqual(downGeometry.anchorBottom - 1);

  await closeHoverPreview();
  await positionCopyAnchor("bottom");
  await workbenchCopy.hover();
  await expect(workbenchPreview).toHaveAttribute("data-placement", "up");
  await expect.poll(() => workbenchPreview.evaluate((popover) => {
    const anchor = popover.parentElement;
    if (!anchor) throw new Error("二维码气泡缺少定位容器");
    return popover.getBoundingClientRect().bottom - anchor.getBoundingClientRect().top;
  })).toBeLessThanOrEqual(1);

  await closeHoverPreview();
  await page.setViewportSize({ width: 900, height: 260 });
  await positionCopyAnchor("middle");
  await workbenchCopy.hover();
  await expect(workbenchPreview).toHaveAttribute("data-placement", "down");
  const constrainedGeometry = await workbenchPreview.evaluate((popover) => {
    const anchor = popover.parentElement;
    if (!anchor) throw new Error("二维码气泡缺少定位容器");
    const anchorRect = anchor.getBoundingClientRect();
    const requiredSpace = popover.getBoundingClientRect().height + 8;
    return {
      requiredSpace,
      spaceAbove: anchorRect.top,
      spaceBelow: window.innerHeight - anchorRect.bottom
    };
  });
  expect(constrainedGeometry.spaceAbove).toBeLessThan(constrainedGeometry.requiredSpace);
  expect(constrainedGeometry.spaceBelow).toBeLessThan(constrainedGeometry.requiredSpace);
  const constrainedBounds = await workbenchPreview.boundingBox();
  expect(constrainedBounds).not.toBeNull();
  expect(constrainedBounds!.y).toBeGreaterThanOrEqual(0);
  expect(constrainedBounds!.y + constrainedBounds!.height).toBeLessThanOrEqual(260);

  await closeHoverPreview();
  await page.setViewportSize({ width: 240, height: 600 });
  await workbenchCopy.evaluate((button) => {
    const anchor = button.parentElement;
    if (!anchor) throw new Error("二维码触发器缺少定位容器");
    Object.assign(anchor.style, { position: "fixed", left: "2px", right: "auto", top: "8px" });
  });
  await workbenchCopy.hover();
  const narrowBounds = await workbenchPreview.boundingBox();
  expect(narrowBounds).not.toBeNull();
  expect(narrowBounds!.x).toBeGreaterThanOrEqual(0);
  expect(narrowBounds!.x + narrowBounds!.width).toBeLessThanOrEqual(240);

  await closeHoverPreview();
  await page.setViewportSize({ width: 1280, height: 720 });
  await workbenchCopy.evaluate((button) => button.parentElement?.removeAttribute("style"));
  await workbenchQr.click();
  const qrDialog = page.getByRole("dialog", { name: "订阅二维码" });
  await expect(qrDialog.getByRole("img", { name: "订阅二维码" })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.goto("/subscriptions");
  const subscriptionRow = page.getByRole("row").filter({ hasText: "E2E subscription" });
  await expect(subscriptionRow.getByRole("button", { name: "显示订阅二维码" })).toBeVisible();
  await subscriptionRow.getByRole("button", { name: "复制链接", exact: true }).hover();
  await expect(subscriptionRow.getByTestId("subscription-qr-popover")).toBeVisible();
  await expect(
    subscriptionRow.getByTestId("subscription-qr-popover").getByRole("img", { name: "订阅二维码" })
  ).toBeVisible();

  await page.goto(`/subscriptions/${subscriptionId}/access`);
  const longTokenRow = page.getByText("默认设备", { exact: true }).locator("..");
  await longTokenRow.getByRole("button", { name: "复制链接", exact: true }).hover();
  await expect(longTokenRow.getByTestId("subscription-qr-popover")).toBeVisible();
  await expect(
    longTokenRow.getByTestId("subscription-qr-popover").getByRole("img", { name: "订阅二维码" })
  ).toBeVisible();

  await page.getByRole("button", { name: "生成", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "订阅链接已生成" })).toBeVisible();
  await page.keyboard.press("Escape");
  const tempTokenRow = page.getByText("分享", { exact: true }).locator("..");
  await expect(tempTokenRow.getByRole("button", { name: "复制链接", exact: true })).toBeVisible();
  await tempTokenRow.getByRole("button", { name: "复制链接", exact: true }).hover();
  await expect(tempTokenRow.getByTestId("subscription-qr-popover")).toBeVisible();
  await expect(
    tempTokenRow.getByTestId("subscription-qr-popover").getByRole("img", { name: "订阅二维码" })
  ).toBeVisible();
});

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
    const pathname = new URL(request.url()).pathname;
    if (pathname.endsWith("/preview/yaml")) yamlRequests += 1;
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

  await page.getByRole("button", { name: "版本", exact: true }).click();
  const autoPolicy = page.getByRole("radio", { name: /自动发布/ });
  const confirmPolicy = page.getByRole("radio", { name: /确认后发布/ });
  const nextPolicy = (await autoPolicy.isChecked()) ? confirmPolicy : autoPolicy;
  const equivalentDetailRefetch = page.waitForResponse((response) =>
    response.request().method() === "GET" &&
    new URL(response.url()).pathname === `/api/subscriptions/${subscriptionId}`
  );
  await nextPolicy.click();
  expect((await equivalentDetailRefetch).ok()).toBe(true);
  await expect(page.getByText("大于 1 MiB 的内容只提供文件下载", { exact: false })).toBeVisible();
  expect(previewRequests).toBe(1);

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

test("发布弹窗先展示候选结果，Mihomo 通过后才允许原子发布", async ({ page }) => {
  const subscriptionId = await registerAndCreateSubscription(page);
  let releaseValidation: (() => void) | null = null;
  let publishedBody: Record<string, unknown> | null = null;
  let validationRequests = 0;
  let validation404s = 0;

  await page.route(
    `**/api/subscriptions/${subscriptionId}/publish-candidates/*/validate`,
    async (route) => {
      validationRequests += 1;
      await new Promise<void>((resolve) => { releaseValidation = resolve; });
      const response = await route.fetch();
      if (response.status() === 404) validation404s += 1;
      await route.fulfill({ response });
    }
  );
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === `/api/subscriptions/${subscriptionId}/publish`) {
      publishedBody = request.postDataJSON() as Record<string, unknown>;
    }
  });

  await page.goto(`/subscriptions/${subscriptionId}/overview`);
  await page.getByRole("button", { name: "预览并发布" }).click();
  await expect.poll(() => releaseValidation).not.toBeNull();
  await expect(page.getByText("渲染完成，Mihomo 内核正在校验", { exact: false })).toBeVisible();
  await expect(page.getByText(/节点/).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "确认发布" })).toBeDisabled();

  releaseValidation?.();
  await expect(page.getByText("Mihomo 内核校验通过", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "确认发布" })).toBeEnabled();
  const publishResponsePromise = page.waitForResponse((response) =>
    response.request().method() === "POST" &&
    new URL(response.url()).pathname === `/api/subscriptions/${subscriptionId}/publish`
  );
  await page.getByRole("button", { name: "确认发布" }).click();
  const publishedRelease = await (await publishResponsePromise).json() as { id: string };
  await expect.poll(() => publishedBody).not.toBeNull();
  expect(typeof publishedBody?.candidateId).toBe("string");
  expect(publishedBody?.expectedRenderedHash).toMatch(/^[a-f0-9]{64}$/);
  await expect(page.getByRole("button", { name: "预览并发布" })).toBeVisible();
  expect(validationRequests).toBe(1);
  expect(validation404s).toBe(0);

  const largeYaml = "# release download\n" + "x".repeat(2 * 1024 * 1024);
  const largeYamlBytes = Buffer.byteLength(largeYaml);
  let releaseDetailRequests = 0;
  let releaseYamlRequests = 0;
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname === `/api/subscriptions/${subscriptionId}/releases/${publishedRelease.id}`) {
      releaseDetailRequests += 1;
    }
    if (pathname === `/api/subscriptions/${subscriptionId}/releases/${publishedRelease.id}/yaml`) {
      releaseYamlRequests += 1;
    }
  });
  await page.route(`**/api/subscriptions/${subscriptionId}/releases`, async (route) => {
    const response = await route.fetch();
    const payload = await response.json() as Array<Record<string, unknown>>;
    await route.fulfill({
      response,
      json: payload.map((release) =>
        release.id === publishedRelease.id ? { ...release, yamlBytes: largeYamlBytes } : release
      )
    });
  });
  await page.route(
    `**/api/subscriptions/${subscriptionId}/releases/${publishedRelease.id}/yaml`,
    (route) => route.fulfill({
      status: 200,
      headers: {
        "Content-Type": "application/yaml; charset=utf-8",
        "Content-Length": String(largeYamlBytes),
        "Access-Control-Allow-Origin": "http://127.0.0.1:7312",
        "Access-Control-Expose-Headers": "X-Rendered-Hash, X-Yaml-Bytes, Content-Length",
        "X-Rendered-Hash": "a".repeat(64),
        "X-Yaml-Bytes": String(largeYamlBytes)
      },
      body: largeYaml
    })
  );

  await page.getByRole("button", { name: "版本", exact: true }).click();
  const releaseDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载 YAML" }).click();
  const releaseDownload = await releaseDownloadPromise;
  expect(releaseDownload.suggestedFilename()).toMatch(/-v1\.yaml$/);
  expect(releaseYamlRequests).toBe(1);
  expect(releaseDetailRequests).toBe(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
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

test("上传 YAML 创建订阅源，并可用文件或编辑器更新", async ({ page }) => {
  await registerAndCreateSubscription(page);
  await page.goto("/sources");
  await page.getByRole("button", { name: "添加订阅源" }).click();
  await page.getByRole("button", { name: "上传或编辑 YAML" }).click();
  await page.getByLabel("选择 YAML 文件").setInputFiles({
    name: "e2e-upload.yaml",
    mimeType: "text/yaml",
    buffer: Buffer.from([
      "proxies:",
      "  - name: Upload-1",
      "    type: ss",
      "    server: upload.test",
      "    port: 443",
      "    cipher: aes-128-gcm",
      "    password: fixture",
      "proxy-groups: []",
      "rules: []"
    ].join("\n"))
  });
  await expect(page.getByLabel("YAML 内容")).toContainText("Upload-1");
  await expect(page.getByText("已解析：1 节点 · 0 组 · 0 规则")).toBeVisible();
  await page.getByRole("button", { name: "取消" }).click();

  await page.getByRole("button", { name: "添加订阅源" }).click();
  await page.getByRole("button", { name: "上传或编辑 YAML" }).click();
  await expect(page.getByLabel("YAML 内容")).toHaveValue("");
  await page.getByLabel("选择 YAML 文件").setInputFiles({
    name: "e2e-upload.yaml",
    mimeType: "text/yaml",
    buffer: Buffer.from([
      "proxies:",
      "  - name: Upload-1",
      "    type: ss",
      "    server: upload.test",
      "    port: 443",
      "    cipher: aes-128-gcm",
      "    password: fixture",
      "proxy-groups: []",
      "rules: []"
    ].join("\n"))
  });
  await page.getByRole("button", { name: "添加并同步" }).click();

  let contentRequests = 0;
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (/\/api\/sources\/[^/]+\/content$/.test(pathname)) contentRequests += 1;
  });
  const updateButton = page.getByRole("button", { name: "更新 YAML" }).last();
  const card = updateButton.locator("xpath=ancestor::div[contains(@class, 'rounded')][1]");
  await expect(updateButton).toBeVisible();
  await updateButton.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("YAML 内容")).toHaveValue(/Upload-1/);
  await dialog.getByLabel("YAML 内容").fill("SENSITIVE-YAML-MUST-NOT-SURVIVE-CLOSE");
  await dialog.getByRole("button", { name: "取消" }).click();
  await expect(dialog).not.toBeVisible();

  const requestsBeforeReopen = contentRequests;
  await updateButton.click();
  await expect.poll(() => contentRequests).toBeGreaterThan(requestsBeforeReopen);
  await expect(dialog.getByLabel("YAML 内容")).toHaveValue(/Upload-1/);
  await expect(dialog.getByLabel("YAML 内容")).not.toHaveValue(
    /SENSITIVE-YAML-MUST-NOT-SURVIVE-CLOSE/
  );
  await dialog.getByLabel("选择 YAML 文件").setInputFiles({
    name: "e2e-replacement.yml",
    mimeType: "text/yaml",
    buffer: Buffer.from([
      "proxies:",
      "  - name: Upload-1",
      "    type: ss",
      "    server: upload.test",
      "    port: 443",
      "    cipher: aes-128-gcm",
      "    password: fixture",
      "  - name: Upload-2",
      "    type: ss",
      "    server: upload2.test",
      "    port: 443",
      "    cipher: aes-128-gcm",
      "    password: fixture",
      "proxy-groups: []",
      "rules: []"
    ].join("\n"))
  });
  await expect(dialog.getByText("已解析：2 节点 · 0 组 · 0 规则")).toBeVisible();
  await dialog.getByRole("button", { name: "保存并更新" }).click();
  await expect(card).toContainText("2 节点");
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

import { chromium } from "playwright";
import { join } from "node:path";
import { tmpdir } from "node:os";

const baseUrl = process.env.STAGING_BASE_URL;
const storagePath = process.env.STAGING_STORAGE_PATH;
const action = process.argv[2];
if (!baseUrl || !storagePath) {
  throw new Error("STAGING_BASE_URL and STAGING_STORAGE_PATH are required.");
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  storageState: storagePath,
  viewport: { width: 1440, height: 1000 },
});
const page = await context.newPage();

async function selectOrganisation(name, continuation) {
  await page.goto(`${baseUrl}/organisations/select?next=${encodeURIComponent(continuation)}`, { waitUntil: "networkidle" });
  await page.getByLabel(name).check();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.waitForURL((url) => url.pathname === continuation, { timeout: 30_000 });
}

async function claimDevice(registrationCode) {
  const kioskContext = await browser.newContext({ viewport: { width: 1024, height: 768 } });
  const kioskPage = await kioskContext.newPage();
  await kioskPage.goto(`${baseUrl}/kiosk/register`, { waitUntil: "networkidle" });
  await kioskPage.getByLabel("One-time registration code").fill(registrationCode.replaceAll(" ", ""));
  await kioskPage.getByRole("button", { name: "Connect this device" }).click();
  await kioskPage.waitForURL(/\/clock$/, { timeout: 30_000 });
  const heading = kioskPage.getByRole("heading").first();
  await heading.waitFor({ timeout: 30_000 });
  const headingText = (await heading.innerText()).trim();
  if (headingText !== "Staff Clock") throw new Error(`Claimed kiosk did not reach roster: ${headingText}`);
  return { kioskContext, kioskPage };
}

try {
  if (action === "transfer-staff") {
    await selectOrganisation("Northstar Staging Operations", "/admin/staff");
    const record = page.locator("[data-admin-search]", { hasText: "Morgan Example" });
    await record.getByText("Manage record").click();
    const form = record.locator('form:has(input[name="commandName"][value="upsert_assignment"])');
    await form.locator('select[name="siteId"]').selectOption({ label: "Northstar East Staging" });
    await form.locator('input[name="effectiveFrom"]').fill("2026-08-17");
    const primary = form.locator('input[name="primary"]');
    if (!(await primary.isChecked())) await primary.check();
    await form.getByRole("button", { name: "Schedule assignment" }).click();
    await form.getByRole("status").waitFor({ timeout: 30_000 });
    process.stdout.write(`TRANSFER_RESULT ${(await form.getByRole("status").innerText()).trim()}\n`);
  } else if (action === "inspect") {
    await selectOrganisation("Northstar Staging Operations", "/admin");
    process.stdout.write(`ADMIN_TITLE ${(await page.locator("h1").first().innerText()).trim()}\n`);
  } else if (action === "replace-device") {
    const originalName = `Closure Test Tablet ${Date.now()}`;
    const replacementName = `${originalName} replacement`;
    await selectOrganisation("Northstar Staging Operations", "/admin/devices");
    for (;;) {
      const stale = page.getByRole("heading", { name: /^Closure Test Tablet/ }).first();
      if (!(await stale.count())) break;
      const stalePanel = stale.locator("xpath=ancestor::section[1]");
      const revoke = stalePanel.getByRole("button", { name: "Revoke device" });
      if (!(await revoke.count())) break;
      page.once("dialog", (dialog) => dialog.accept());
      await revoke.click();
      await page.waitForLoadState("networkidle");
      await page.reload({ waitUntil: "networkidle" });
    }
    let form = page.locator('form:has(input[name="commandName"][value="start_kiosk_registration"])');
    await form.locator('input[name="deviceName"]').fill(originalName);
    await form.locator('select[name="siteId"]').selectOption({ label: "Northstar East Staging" });
    await form.getByRole("button", { name: "Generate registration code" }).click();
    await form.getByRole("status").waitFor({ timeout: 30_000 });
    if (!(await form.locator("code").count())) {
      throw new Error(`Device registration failed: ${(await form.getByRole("status").innerText()).trim()}`);
    }
    const originalCode = (await form.locator("code").innerText()).trim();
    const original = await claimDevice(originalCode);
    process.stdout.write("INITIAL_DEVICE_CLAIMED true\n");

    await page.reload({ waitUntil: "networkidle" });
    const panel = page.getByRole("heading", { name: originalName }).locator("xpath=ancestor::section[1]");
    await panel.getByText("Replace this device").click();
    form = panel.locator('form:has(input[name="commandName"][value="replace_kiosk_device"])');
    await form.locator('input[name="deviceName"]').fill(replacementName);
    page.once("dialog", (dialog) => dialog.accept());
    await form.getByRole("button", { name: "Revoke and create replacement code" }).click();
    await form.getByRole("status").waitFor({ timeout: 30_000 });
    if (!(await form.locator("code").count())) {
      throw new Error(`Device replacement failed: ${(await form.getByRole("status").innerText()).trim()}`);
    }
    const replacementCode = (await form.locator("code").innerText()).trim();

    await original.kioskPage.reload({ waitUntil: "networkidle" });
    await original.kioskPage.getByRole("heading", { name: "Staff Clock could not load" }).waitFor({ timeout: 30_000 });
    const oldRejected = await original.kioskPage.getByText("it is no longer active", { exact: false }).isVisible();
    const replacement = await claimDevice(replacementCode);
    process.stdout.write(`OLD_DEVICE_REJECTED ${oldRejected}\n`);
    process.stdout.write("REPLACEMENT_DEVICE_CLAIMED true\n");
    await original.kioskContext.close();
    await replacement.kioskContext.close();
  } else if (action === "inspect-checkout") {
    await page.goto(`${baseUrl}/organisations/select?next=%2Fadmin%2Fbilling`, { waitUntil: "networkidle" });
    await page.getByLabel("Checkout Acceptance Staging").check();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.waitForURL(/\/admin\/billing/, { timeout: 30_000 });
    await page.getByRole("button", { name: "Set up payment" }).click();
    await page.waitForURL(/checkout\.stripe\.com/, { timeout: 30_000 });
    await page.waitForLoadState("networkidle");
    await page.getByText("I am an AI agent acting on behalf of someone else", { exact: true }).evaluate((element) => element.click());
    await page.locator('input[name="payment-method-accordion-item-title"]').first().evaluate((element) => element.click());
    await page.waitForTimeout(750);
    process.stdout.write(`CHECKOUT_HOST ${new URL(page.url()).host}\n`);
    process.stdout.write(`CHECKOUT_TITLE ${(await page.title()).trim()}\n`);
    await page.screenshot({ path: join(tmpdir(), "commercial-staging-checkout.png"), fullPage: true });
  } else if (action === "visual-acceptance") {
    await selectOrganisation("Northstar Staging Operations", "/admin");
    const routes = [
      "/commercial/welcome", "/admin", "/admin/staff", "/rota", "/attendance",
      "/leave/requests", "/payroll", "/admin/sites", "/admin/access", "/admin/devices",
      "/admin/settings", "/admin/billing", "/onboarding/readiness",
    ];
    const viewports = [
      { label: "desktop", width: 1440, height: 1000 },
      { label: "tablet", width: 1024, height: 768 },
      { label: "mobile", width: 390, height: 844 },
    ];
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      for (const route of routes) {
        await page.goto(`${baseUrl}${route}`, { waitUntil: "networkidle" });
        const result = await page.evaluate(() => ({
          overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
          heading: document.querySelector("h1")?.textContent?.trim() ?? "",
          hasInternalError: /internal server error|application error|stack trace/i.test(document.body.innerText),
        }));
        if (!result.heading || result.overflow || result.hasInternalError) {
          throw new Error(`${viewport.label} ${route} failed visual acceptance: ${JSON.stringify(result)}`);
        }
      }
      await page.goto(`${baseUrl}/admin/devices`, { waitUntil: "networkidle" });
      await page.screenshot({
        path: join(tmpdir(), `commercial-staging-${viewport.label}.png`),
        fullPage: true,
      });
      process.stdout.write(`VISUAL_${viewport.label.toUpperCase()} ${routes.length} routes passed\n`);
    }
  } else {
    throw new Error(`Unknown staging acceptance action: ${action ?? "missing"}`);
  }
} finally {
  await browser.close();
}

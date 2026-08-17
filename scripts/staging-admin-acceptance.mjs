import { chromium } from "playwright";

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
    await page.goto(`${baseUrl}/admin/staff`, { waitUntil: "networkidle" });
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
    await page.goto(`${baseUrl}/admin`, { waitUntil: "networkidle" });
    process.stdout.write(`ADMIN_TITLE ${(await page.locator("h1").first().innerText()).trim()}\n`);
  } else if (action === "replace-device") {
    const originalName = `Closure Test Tablet ${Date.now()}`;
    const replacementName = `${originalName} replacement`;
    await page.goto(`${baseUrl}/admin/devices`, { waitUntil: "networkidle" });
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
    await form.locator("code").waitFor({ timeout: 30_000 });
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
    await form.locator("code").waitFor({ timeout: 30_000 });
    const replacementCode = (await form.locator("code").innerText()).trim();

    await original.kioskPage.reload({ waitUntil: "networkidle" });
    await original.kioskPage.getByRole("heading", { name: "Staff Clock could not load" }).waitFor({ timeout: 30_000 });
    const oldRejected = await original.kioskPage.getByText("it is no longer active", { exact: false }).isVisible();
    const replacement = await claimDevice(replacementCode);
    process.stdout.write(`OLD_DEVICE_REJECTED ${oldRejected}\n`);
    process.stdout.write("REPLACEMENT_DEVICE_CLAIMED true\n");
    await original.kioskContext.close();
    await replacement.kioskContext.close();
  } else {
    throw new Error(`Unknown staging acceptance action: ${action ?? "missing"}`);
  }
} finally {
  await browser.close();
}

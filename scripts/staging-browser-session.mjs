import { createHmac, randomBytes } from "node:crypto";
import { chromium } from "playwright";
import readline from "node:readline/promises";

const baseUrl = process.env.STAGING_BASE_URL;
const fixtureLabel = process.env.STAGING_FIXTURE_LABEL ?? "owner";
const storagePath = process.env.STAGING_STORAGE_PATH;
if (!baseUrl || !storagePath) throw new Error("STAGING_BASE_URL and STAGING_STORAGE_PATH are required.");

const email = `closure-${fixtureLabel}-${Date.now()}@mailinator.com`;
const password = `F!c${randomBytes(24).toString("base64url")}9a`;
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();

function decodeBase32(value) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const character of value.replaceAll(" ", "").replaceAll("=", "").toUpperCase()) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error("Unexpected authenticator key format.");
    bits += index.toString(2).padStart(5, "0");
  }
  return Buffer.from(bits.match(/.{8}/g)?.map((byte) => Number.parseInt(byte, 2)) ?? []);
}

function totp(secret, now = Date.now()) {
  const counter = Math.floor(now / 30_000);
  const input = Buffer.alloc(8);
  input.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", decodeBase32(secret)).update(input).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}

try {
  await page.goto(`${baseUrl}/signup?next=%2Fadmin`, { waitUntil: "networkidle" });
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByText(/check your inbox|account could not be created/i).waitFor({ timeout: 30_000 });
  if (await page.getByText(/account could not be created/i).count()) throw new Error("Staging signup failed.");
  process.stdout.write(`FIXTURE_READY ${email}\n`);

  const input = readline.createInterface({ input: process.stdin, output: process.stdout });
  await input.question("");
  input.close();

  await page.goto(`${baseUrl}/login?next=%2Fadmin`, { waitUntil: "networkidle" });
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/(admin|onboarding|mfa)/, { timeout: 30_000 });

  await page.goto(`${baseUrl}/mfa?next=%2Fadmin`, { waitUntil: "networkidle" });
  if (await page.getByRole("button", { name: "Set up authenticator" }).count()) {
    await page.getByRole("button", { name: "Set up authenticator" }).click();
    const secret = (await page.locator(".onboarding-qr code").textContent())?.trim();
    if (!secret) throw new Error("Authenticator enrolment did not return a setup key.");
    await page.getByLabel("Six-digit authenticator code").fill(totp(secret));
    await page.getByRole("button", { name: "Verify and continue" }).click();
    await page.waitForURL(/\/onboarding/, { timeout: 30_000 });
  }
  await page.goto(`${baseUrl}/admin`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: /commercial operations|organisation|overview/i }).first().waitFor({ timeout: 30_000 });
  await context.storageState({ path: storagePath });
  process.stdout.write(`SESSION_READY ${fixtureLabel}\n`);
} finally {
  await browser.close();
}

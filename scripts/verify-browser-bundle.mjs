import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

function filesUnder(root) {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(root, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  });
}

export function findSensitiveBrowserMarkers(root, markers) {
  if (!existsSync(root) || !statSync(root).isDirectory()) return [resolve(root, "[browser bundle missing]")];
  return filesUnder(root).filter((path) => {
    const content = readFileSync(path);
    return markers.some((marker) => marker && content.includes(Buffer.from(marker)));
  });
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  const configured = (process.env.BROWSER_BUNDLE_SENSITIVE_MARKERS ?? "").split(",").map((item) => item.trim()).filter(Boolean);
  const markers = [
    "SUPABASE_SERVICE_ROLE_KEY",
    "COMMERCIAL_SESSION_SECRET",
    "sb_secret_",
    ...configured,
    ...(process.env.COMMERCIAL_SESSION_SECRET ? [process.env.COMMERCIAL_SESSION_SECRET] : []),
  ];
  const matches = findSensitiveBrowserMarkers(resolve(".next/static"), markers);
  if (matches.length) {
    console.error(`Sensitive server marker found in browser output:\n${matches.join("\n")}`);
    process.exitCode = 1;
  } else {
    console.log("Browser bundle sensitive-marker scan passed.");
  }
}

// npm runs this on every `npm install` (incl. CI/Vercel). The real husky
// setup lives at the repo root in scripts/setup-husky.mjs, which is outside
// this package and absent on Vercel (Root Directory = site/). Delegate to it
// only when present; otherwise no-op so CI installs don't fail.
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const target = fileURLToPath(
  new URL("../../scripts/setup-husky.mjs", import.meta.url),
);

if (existsSync(target)) {
  execFileSync(process.execPath, [target], { stdio: "inherit" });
} else {
  console.log("husky: setup script not found (CI/standalone install), skipping");
}

import fs from "node:fs/promises";
import path from "node:path";
import { loadDesiredSites } from "./lib.mjs";

function getCurrentCompatibilityDate() {
  return new Date().toISOString().slice(0, 10);
}

function buildWranglerConfig(site, existing = null) {
  return {
    name: site.project,
    pages_build_output_dir: existing?.pages_build_output_dir || site.build_output_dir || "public",
    compatibility_date: existing?.compatibility_date || getCurrentCompatibilityDate(),
    r2_buckets: existing?.r2_buckets || [
      {
        binding: site.r2_binding_name || "MEDIA",
        bucket_name: site.r2_bucket || "emd"
      }
    ]
  };
}

async function readJsonIfExists(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeJsonc(filePath, data) {
  const content = JSON.stringify(data, null, 2) + "\n";
  await fs.writeFile(filePath, content, "utf8");
}

async function main() {
  const { sites } = await loadDesiredSites();

  for (const site of sites) {
    const filePath = path.join(site.root_dir, "wrangler.jsonc");
    const existing = await readJsonIfExists(filePath);

    const needsWrite =
      !existing ||
      existing.name !== site.project ||
      !existing.pages_build_output_dir ||
      !existing.compatibility_date ||
      !Array.isArray(existing.r2_buckets) ||
      existing.r2_buckets.length === 0;

    if (!needsWrite) {
      console.log(`Keeping existing ${filePath}`);
      continue;
    }

    const config = buildWranglerConfig(site, existing);
    await writeJsonc(filePath, config);
    console.log(`Wrote ${filePath}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
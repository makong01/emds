import fs from "node:fs/promises";
import path from "node:path";
import { loadDesiredSites } from "./lib.mjs";

function getCurrentCompatibilityDate() {
  return new Date().toISOString().slice(0, 10);
}

function buildWranglerConfig(site) {
  return {
    name: site.project,
    pages_build_output_dir: site.build_output_dir || "public",
    compatibility_date: getCurrentCompatibilityDate(),
    r2_buckets: [
      {
        binding: site.r2_binding_name || "MEDIA",
        bucket_name: site.r2_bucket || "emd"
      }
    ]
  };
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
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
    const exists = await fileExists(filePath);

    if (exists) {
      console.log(`Skipping existing ${filePath}`);
      continue;
    }

    const config = buildWranglerConfig(site);
    await writeJsonc(filePath, config);

    console.log(`Generated ${filePath}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
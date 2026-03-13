import { execFileSync } from "node:child_process";
import { loadDesiredSites, ensureSiteInfra, runWrangler } from "./lib.mjs";

function gitDiffNames(base, head) {
  const out = execFileSync("git", ["diff", "--name-only", base, head], {
    encoding: "utf8"
  });

  return out
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

function extractChangedDomains(files) {
  const result = new Set();

  for (const file of files) {
    const match = file.match(/^sites\/([^/]+)\//);
    if (match) result.add(match[1]);
  }

  return [...result].sort();
}

async function deploySite(site) {
  await ensureSiteInfra(site);

  console.log(`Deploying ${site.domain} from ${site.root_dir}/${site.build_output_dir}`);

  runWrangler(
    [
      "pages",
      "deploy",
      site.build_output_dir || "public",
      "--project-name",
      site.project,
      "--branch",
      site.production_branch || "main"
    ],
    site.root_dir
  );
}

async function main() {
  const { sites } = await loadDesiredSites();
  const byDomain = new Map(sites.map((s) => [s.domain, s]));

  const onlyDomain = process.env.ONLY_DOMAIN?.trim();
  const baseSha = process.env.GITHUB_BASE_SHA?.trim();
  const headSha = process.env.GITHUB_SHA?.trim();

  let targetDomains = [];

  if (onlyDomain) {
    targetDomains = [onlyDomain];
  } else if (baseSha && headSha) {
    const changedFiles = gitDiffNames(baseSha, headSha);
    const changedDomains = extractChangedDomains(changedFiles);

    if (changedDomains.length === 0) {
      console.log("No site changes detected.");
      return;
    }

    targetDomains = changedDomains;
  } else {
    console.log("No diff context available. Skipping deploy.");
    return;
  }

  for (const domain of targetDomains) {
    const site = byDomain.get(domain);

    if (!site) {
      throw new Error(`Changed site ${domain} not found in discovered sites list`);
    }

    console.log(`\n=== Deploy ${domain} ===`);
    await deploySite(site);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
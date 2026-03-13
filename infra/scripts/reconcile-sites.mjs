import { loadDesiredSites, ensureSiteInfra } from "./lib.mjs";

async function main() {
  const { sites } = await loadDesiredSites();

  if (!sites.length) {
    console.log("No sites found in /sites");
    return;
  }

  for (const site of sites) {
    console.log(`\n=== Reconciling ${site.domain} ===`);
    await ensureSiteInfra(site);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
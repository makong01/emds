import fs from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { parse as parseDomain } from "tldts";

export const API = "https://api.cloudflare.com/client/v4";

function getCloudflareEnv() {
  const accountId = process.env.CF_ACCOUNT_ID;
  const token = process.env.CF_API_TOKEN;

  if (!accountId || !token) {
    throw new Error("Missing CF_ACCOUNT_ID or CF_API_TOKEN");
  }

  return { accountId, token };
}

function getHeaders(extraHeaders = {}) {
  const { token } = getCloudflareEnv();

  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    ...extraHeaders
  };
}

export async function cf(pathname, init = {}) {
  const { accountId } = getCloudflareEnv();

  const res = await fetch(`${API}${pathname}`, {
    ...init,
    headers: getHeaders(init.headers || {})
  });

  const json = await res.json();

  if (!json.success) {
    throw new Error(
      `Cloudflare API error on ${pathname}: ${JSON.stringify(json.errors)}`
    );
  }

  return json.result;
}

export async function readJson(file) {
  const raw = await fs.readFile(file, "utf8");
  return JSON.parse(raw);
}

export function slugProjectName(domain) {
  return domain
    .toLowerCase()
    .replace(/[^a-z0-9.-]/g, "-")
    .replace(/\./g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function inferSiteFromFolder(folderName) {
  const parsed = parseDomain(folderName);

  if (!parsed.domain) {
    throw new Error(
      `Cannot infer zone/domain from folder "${folderName}". Use a valid domain-like folder name.`
    );
  }

  return {
    domain: folderName,
    project: slugProjectName(folderName),
    root_dir: `sites/${folderName}`,
    zone_name: parsed.domain,
    is_apex: !parsed.subdomain
  };
}

export async function listSiteFolders() {
  const entries = await fs.readdir("sites", { withFileTypes: true });

  return entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

export async function loadDesiredSites() {
  const manifest = await readJson("infra/sites.json");
  const defaults = manifest.defaults || {};
  const overrides = manifest.overrides || {};

  const folders = await listSiteFolders();

  const sites = folders.map((folder) => {
    const inferred = inferSiteFromFolder(folder);
    const override = overrides[inferred.domain] || {};

    return {
      ...defaults,
      ...inferred,
      ...override
    };
  });

  return { defaults, sites };
}

export function runWrangler(args, cwd = process.cwd()) {
  const { accountId, token } = getCloudflareEnv();

  execFileSync("npx", ["wrangler", ...args], {
    cwd,
    stdio: "inherit",
    env: {
      ...process.env,
      CLOUDFLARE_API_TOKEN: token,
      CLOUDFLARE_ACCOUNT_ID: accountId
    }
  });
}

export async function listPagesProjects() {
  const { accountId } = getCloudflareEnv();
  return await cf(`/accounts/${accountId}/pages/projects`);
}

export async function getPagesProject(projectName) {
  const projects = await listPagesProjects();
  return projects.find((p) => p.name === projectName) || null;
}

/*
export function createPagesProject(projectName, productionBranch) {
  runWrangler([
    "pages",
    "project",
    "create",
    projectName,
    "--production-branch",
    productionBranch
  ]);
}*/

export async function listProjectDomains(projectName) {
  const { accountId } = getCloudflareEnv();
  return await cf(`/accounts/${accountId}/pages/projects/${projectName}/domains`);
}

/*
export async function ensureProject(site) {
  const existing = await getPagesProject(site.project);

  if (existing) {
    console.log(`Pages project exists: ${site.project}`);
    return;
  }

  console.log(`Creating Pages project: ${site.project}`);
  createPagesProject(site.project, site.production_branch || "main");
}*/

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createPagesProject(projectName, productionBranch) {
  runWrangler([
    "pages",
    "project",
    "create",
    projectName,
    "--production-branch",
    productionBranch
  ]);
}

export async function ensureProject(site) {
  const existing = await getPagesProject(site.project);

  if (existing) {
    console.log(`Pages project exists: ${site.project}`);
    return;
  }

  const maxAttempts = 4;
  const delays = [5000, 10000, 20000, 30000];

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      console.log(
        `Creating Pages project: ${site.project} (attempt ${attempt}/${maxAttempts})`
      );

      createPagesProject(site.project, site.production_branch || "main");

      const created = await getPagesProject(site.project);
      if (created) {
        console.log(`Pages project created: ${site.project}`);
        return;
      }

      console.log(
        `Create command finished but project not visible yet: ${site.project}`
      );
    } catch (error) {
      console.error(
        `Pages project create failed for ${site.project} on attempt ${attempt}:`,
        error.message
      );
    }

    const maybeExists = await getPagesProject(site.project);
    if (maybeExists) {
      console.log(`Pages project appeared after retry check: ${site.project}`);
      return;
    }

    if (attempt < maxAttempts) {
      const delay = delays[attempt - 1] || 10000;
      console.log(`Waiting ${delay}ms before retry...`);
      await sleep(delay);
    }
  }

  throw new Error(
    `Failed to create Pages project after retries: ${site.project}`
  );
}

export async function ensureCustomDomain(projectName, domain) {
  const { accountId } = getCloudflareEnv();
  const domains = await listProjectDomains(projectName);
  const exists = domains.some((d) => d.name === domain);

  if (exists) {
    console.log(`Custom domain already attached: ${domain}`);
    return;
  }

  await cf(`/accounts/${accountId}/pages/projects/${projectName}/domains`, {
    method: "POST",
    body: JSON.stringify({ name: domain })
  });

  console.log(`Attached custom domain ${domain} -> ${projectName}`);
}

export async function getZone(zoneName) {
  const zones = await cf(`/zones?name=${encodeURIComponent(zoneName)}`);
  return zones[0] || null;
}
/*
export async function createZone(zoneName) {
  return await cf(`/zones`, {
    method: "POST",
    body: JSON.stringify({
      name: zoneName,
      type: "full",
      jump_start: true
    })
  });
}*/

export async function createZone(zoneName) {
  const delays = [5000, 10000, 20000, 30000];
  const { accountId } = getCloudflareEnv();
  let lastError;

  for (let attempt = 1; attempt <= delays.length + 1; attempt++) {
    try {
      console.log(`Creating zone ${zoneName} (attempt ${attempt}/${delays.length + 1})`);

      return await cf(`/zones`, {
        method: "POST",
        body: JSON.stringify({
          name: zoneName,
          account:{
            id: accountId
          },
          type: "full",
          jump_start: true
        })
      });
    } catch (error) {
      lastError = error;
      console.error(`createZone failed for ${zoneName} ${accountId} on attempt ${attempt}: ${error.message}`);

      if (attempt <= delays.length) {
        const delay = delays[attempt - 1];
        console.log(`Waiting ${delay}ms before retry...`);
        await sleep(delay);
      }
    }
  }

  throw lastError;
}

export async function listDnsRecords(zoneId, name) {
  return await cf(`/zones/${zoneId}/dns_records?name=${encodeURIComponent(name)}`);
}

export async function createDnsRecord(zoneId, payload) {
  return await cf(`/zones/${zoneId}/dns_records`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function updateDnsRecord(zoneId, recordId, payload) {
  return await cf(`/zones/${zoneId}/dns_records/${recordId}`, {
    method: "PATCH",
    body: JSON.stringify(payload)
  });
}

export async function ensureZoneForSite(site) {
  let zone = await getZone(site.zone_name);

  if (zone) {
    console.log(`Zone exists: ${site.zone_name} [status=${zone.status}]`);
    return zone;
  }

  if (!site.is_apex) {
    throw new Error(
      `Parent zone ${site.zone_name} not found for subdomain ${site.domain}`
    );
  }

  console.log(`Creating zone for apex site: ${site.zone_name}`);
  zone = await createZone(site.zone_name);

  console.log(`Zone created: ${site.zone_name} [status=${zone.status}]`);
  console.log(
    `IMPORTANT: apex site may remain pending until nameservers are delegated at registrar.`
  );

  return zone;
}

export async function ensureSubdomainCname(site) {
  const zone = await getZone(site.zone_name);

  if (!zone) {
    throw new Error(
      `Parent zone ${site.zone_name} not found for subdomain ${site.domain}`
    );
  }

  const records = await listDnsRecords(zone.id, site.domain);
  const existing = records.find((r) => r.type === "CNAME");
  const desiredContent = `${site.project}.pages.dev`;

  if (!existing) {
    await createDnsRecord(zone.id, {
      type: "CNAME",
      name: site.domain,
      content: desiredContent,
      proxied: true
    });

    console.log(`Created CNAME ${site.domain} -> ${desiredContent}`);
    return;
  }

  const needsUpdate =
    existing.content !== desiredContent || existing.proxied !== true;

  if (!needsUpdate) {
    console.log(`DNS CNAME already correct for ${site.domain}`);
    return;
  }

  await updateDnsRecord(zone.id, existing.id, {
    content: desiredContent,
    proxied: true
  });

  console.log(`Updated CNAME ${site.domain} -> ${desiredContent}`);
}

export async function ensureSiteInfra(site) {
  await ensureProject(site);
  await ensureZoneForSite(site);
  await ensureCustomDomain(site.project, site.domain);

  if (!site.is_apex) {
    await ensureSubdomainCname(site);
  } else {
    console.log(
      `Apex site ${site.domain}: zone has been ensured in this account.`
    );
  }
}
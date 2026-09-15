'use strict';

// Read-only by default. Uses the operator's existing gcloud session; never
// prints or saves its token, private keys, or Firebase user/test-number data.
// node scripts/configure-firebase-phone-auth.js --project PROJECT_ID
// Add --apply to sync the country policy and explicitly supplied --domain(s).
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { PHONE_COUNTRIES } = require('../utils/phoneCountries');

function readArgs(args) {
  const options = { apply: false, domains: [] };
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--apply') options.apply = true;
    else if (args[i] === '--project') options.project = args[++i];
    else if (args[i] === '--domain') options.domains.push(args[++i]);
    else throw new Error(`Unknown argument: ${args[i]}`);
  }
  if (!/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(options.project || '')) {
    throw new Error('Pass the intended Firebase project with --project PROJECT_ID.');
  }
  if (options.domains.some((domain) => !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(domain || ''))) {
    throw new Error('Each --domain must be an explicit hostname, without protocol or path.');
  }
  return options;
}

function publicSettings(config) {
  return {
    phoneProviderEnabled: Boolean(config.signIn?.phoneNumber?.enabled),
    smsRegionConfig: config.smsRegionConfig || {},
    authorizedDomains: config.authorizedDomains || [],
  };
}

async function main(args) {
  const options = readArgs(args);
  let token;
  try {
    token = execFileSync('gcloud', ['auth', 'print-access-token'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch {
    throw new Error('An existing gcloud login is required. Sign in to the intended account first.');
  }
  const request = async (url, init = {}) => {
    const result = await fetch(url, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, 'x-goog-user-project': options.project,
        'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(30_000),
    });
    const data = await result.json();
    if (!result.ok) throw new Error(`Google API returned ${result.status}: ${data.error?.message || 'request failed'}`);
    return data;
  };
  const url = `https://identitytoolkit.googleapis.com/admin/v2/projects/${options.project}/config`;
  const before = await request(url);
  // gcloud uses its own quota project for this read, so checking billing does
  // not require enabling the Cloud Billing API on the application project.
  const billing = JSON.parse(execFileSync('gcloud', ['billing', 'projects', 'describe', options.project, '--format=json'], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }));
  // Do not silently activate a new identity provider or a billing account.
  if (!before.signIn?.phoneNumber?.enabled) throw new Error('Enable the Firebase Phone provider before applying this configuration.');
  const wanted = {
    smsRegionConfig: { allowlistOnly: { allowedRegions: PHONE_COUNTRIES.map((country) => country.iso).sort() } },
    authorizedDomains: [...new Set([...(before.authorizedDomains || []), ...options.domains])].sort(),
  };
  console.log(JSON.stringify({ project: options.project, billingEnabled: Boolean(billing.billingEnabled),
    apply: options.apply, before: publicSettings(before), planned: wanted }, null, 2));
  if (!options.apply) return;
  if (!billing.billingEnabled) throw new Error('The project has no active billing account; no changes applied.');
  const backupDir = path.join(__dirname, '..', '.migrations');
  fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  const backup = path.join(backupDir, `firebase-phone-settings-${options.project}-${Date.now()}.json`);
  fs.writeFileSync(backup, JSON.stringify({ project: options.project,
    smsRegionConfig: before.smsRegionConfig || {}, authorizedDomains: before.authorizedDomains || [] }, null, 2), { mode: 0o600 });
  await request(`${url}?updateMask=smsRegionConfig,authorizedDomains`, { method: 'PATCH', body: JSON.stringify(wanted) });
  const after = await request(url);
  const regions = [...(after.smsRegionConfig?.allowlistOnly?.allowedRegions || [])].sort();
  if (JSON.stringify(regions) !== JSON.stringify(wanted.smsRegionConfig.allowlistOnly.allowedRegions)
    || wanted.authorizedDomains.some((domain) => !after.authorizedDomains?.includes(domain))) {
    throw new Error(`Configuration verification failed. Prior settings are saved in ${backup}.`);
  }
  console.log(JSON.stringify({ verified: true, settings: publicSettings(after), backup }, null, 2));
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((error) => { console.error(error.message); process.exitCode = 1; });
}

module.exports = { readArgs, publicSettings };

#!/usr/bin/env node
// Generates a MapKit JS JWT valid for 1 year.
//
// Setup (one-time, in Apple Developer portal — developer.apple.com):
//   1. Certificates, IDs & Profiles → Identifiers → + → Maps IDs → create one (e.g. "maps.com.yourname.travelitinerary")
//   2. Keys → + → check "MapKit JS" → associate the Maps ID you just made → Download the .p8 file (save it somewhere safe)
//   3. On the Keys list page, copy the 10-character Key ID shown next to your key
//   4. Your 10-character Team ID is shown in the top-right corner of any developer.apple.com page
//
// Usage:
//   node generate-mapkit-token.js <TeamID> <KeyID> <path-to-AuthKey.p8> [origin]
//
// Example:
//   node generate-mapkit-token.js AB12CD34EF GH56IJ78KL ~/Downloads/AuthKey_GH56IJ78KL.p8 https://troyh.github.io
//
// Paste the printed token into the app's Settings → Apple MapKit JS Token field.

import fs     from "fs";
import crypto from "crypto";

const [,, teamId, keyId, keyPath, origin] = process.argv;

if (!teamId || !keyId || !keyPath) {
  console.error("Usage: node generate-mapkit-token.js <TeamID> <KeyID> <path-to-key.p8> [origin]");
  console.error("  TeamID  — 10-char string from top-right of developer.apple.com");
  console.error("  KeyID   — 10-char string from Keys list page");
  console.error("  key.p8  — path to the .p8 file you downloaded from Keys");
  console.error("  origin  — optional: restrict to one URL (e.g. https://troyh.github.io)");
  console.error("            omit to allow any origin (fine for personal use)");
  process.exit(1);
}

if (!fs.existsSync(keyPath)) {
  console.error(`Key file not found: ${keyPath}`);
  process.exit(1);
}

const privateKey = fs.readFileSync(keyPath, "utf8");
const now = Math.floor(Date.now() / 1000);
const exp = now + 365 * 24 * 60 * 60; // 1 year

const header  = Buffer.from(JSON.stringify({ alg: "ES256", kid: keyId, typ: "JWT" })).toString("base64url");
const claims  = { iss: teamId, iat: now, exp, ...(origin ? { origin } : {}) };
const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
const message = `${header}.${payload}`;

const sign = crypto.createSign("SHA256");
sign.update(message);
// dsaEncoding: "ieee-p1363" outputs the raw R||S format required by JWT (vs default DER)
const sig = sign.sign({ key: privateKey, dsaEncoding: "ieee-p1363" }, "base64url");

const token = `${message}.${sig}`;
console.log("\n✓ Your MapKit JS token (valid for 1 year):\n");
console.log(token);
console.log("\nPaste this into Settings → Apple MapKit JS Token, then reload the app.\n");
console.log(`Expires: ${new Date(exp * 1000).toLocaleDateString()}`);

/**
 * Generates src/app/auth.generated.ts from environment variables at build time.
 *
 * Set these in Vercel (Project Settings -> Environment Variables):
 *   DASHBOARD_USER      default: Admin
 *   DASHBOARD_PASSWORD  default: Admin@123
 *
 * The password itself is never written into the bundle — only a salted
 * SHA-256 hash is. That matters because people reuse passwords, and anything
 * shipped to a browser is readable.
 *
 * Be clear about what this does and does not achieve: the sign-in check runs
 * in the browser, so it keeps casual visitors out of a demo but it is not
 * access control. Anyone willing to edit the JavaScript can get past it, and
 * the data files under /assets stay directly fetchable either way. For real
 * protection the check has to happen server-side, before any asset is served.
 */

import { createHash, randomBytes } from 'node:crypto';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outFile = join(here, '..', 'src', 'app', 'auth.generated.ts');

const user = process.env.DASHBOARD_USER || 'Admin';
const password = process.env.DASHBOARD_PASSWORD || 'Admin@123';
const usingDefaultPassword = !process.env.DASHBOARD_PASSWORD;

// A stable salt keeps the generated file reproducible between builds, so a
// rebuild doesn't invalidate sessions for no reason. Reuse the existing salt
// when one is already present.
let salt = process.env.DASHBOARD_SALT || '';
if (!salt && existsSync(outFile)) {
  const prev = readFileSync(outFile, 'utf8');
  salt = /AUTH_SALT = '([^']*)'/.exec(prev)?.[1] ?? '';
}
if (!salt) salt = randomBytes(16).toString('hex');

const hash = createHash('sha256').update(`${salt}:${password}`).digest('hex');

const body = `/**
 * GENERATED FILE — do not edit, and do not commit.
 *
 * Written by scripts/gen-auth.mjs from DASHBOARD_USER / DASHBOARD_PASSWORD.
 * Only a salted SHA-256 hash of the password reaches the browser.
 */

export const AUTH_USER = '${user}';
export const AUTH_SALT = '${salt}';
export const AUTH_HASH = '${hash}';
`;

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, body, 'utf8');

console.log(`[gen-auth] wrote ${outFile}`);
console.log(`[gen-auth] user: ${user}`);
console.log(`[gen-auth] password: ${'*'.repeat(password.length)} (hashed, not bundled)`);
console.log('[gen-auth] note: browser-side gate only — not server-side access control');

if (usingDefaultPassword) {
  console.warn(
    '\n[gen-auth] WARNING: DASHBOARD_PASSWORD is not set, so the default is in use.\n'
    + '           That default is documented in the repository, so it is public.\n'
    + '           Set DASHBOARD_PASSWORD in Vercel and redeploy before sharing a link.\n',
  );
}

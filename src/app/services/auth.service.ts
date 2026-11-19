import { Injectable, computed, signal } from '@angular/core';
import { AUTH_USER, AUTH_SALT, AUTH_HASH } from '../auth.generated';

const SESSION_KEY = 'emis.session';

/**
 * Display-only role picker for the signed-in-user badge (top right of both
 * the main dashboard and the "At a glance" page). Purely cosmetic: picking a
 * role changes the name/scope shown next to the user icon, nothing else —
 * it does not restrict or re-scope any data. There is only one real login
 * (see AuthService doc comment); this does not add role-based access control.
 */
export interface DashboardRole { id: string; label: string; scope: string; }
export const DASHBOARD_ROLES: DashboardRole[] = [
  { id: 'secretary', label: 'Secretary', scope: 'State' },
  { id: 'collector', label: 'District Collector', scope: 'District' },
  { id: 'ceo', label: 'CEO', scope: 'District' },
  { id: 'deo-elem', label: 'DEO (Elementary)', scope: 'Educational district' },
  { id: 'deo-sec', label: 'DEO (Secondary)', scope: 'Educational district' },
  { id: 'beo', label: 'BEO', scope: 'Block' },
  { id: 'school', label: 'School', scope: 'GHSS Melur' },
];

/**
 * Sign-in gate for the dashboard.
 *
 * The credentials come from DASHBOARD_USER / DASHBOARD_PASSWORD at build time
 * (see scripts/gen-auth.mjs); only a salted hash is shipped.
 *
 * Scope of protection: this runs in the browser, so it hides the dashboard from
 * casual visitors but does not restrict access. The JavaScript can be edited
 * and the JSON under /assets fetched directly. Treat it as a front door on a
 * demo, not as authentication.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly _authed = signal(false);
  private readonly _error = signal('');
  private readonly _busy = signal(false);

  readonly isAuthenticated = this._authed.asReadonly();
  readonly error = this._error.asReadonly();
  readonly busy = this._busy.asReadonly();
  readonly user = computed(() => (this._authed() ? AUTH_USER : ''));

  // ---- display-only role badge (see DASHBOARD_ROLES doc comment above) ----
  readonly roles = DASHBOARD_ROLES;
  private readonly _role = signal<DashboardRole>(DASHBOARD_ROLES[0]);
  readonly role = this._role.asReadonly();
  setRole(id: string): void {
    const r = DASHBOARD_ROLES.find((x) => x.id === id);
    if (r) this._role.set(r);
  }

  constructor() {
    // restore a session from this tab if one is present
    try {
      if (sessionStorage.getItem(SESSION_KEY) === AUTH_HASH) this._authed.set(true);
    } catch {
      // storage can be unavailable in private modes; sign-in still works
    }
  }

  /** SHA-256 of `salt:value`, matching what the build script produced. */
  private async digest(value: string): Promise<string> {
    const bytes = new TextEncoder().encode(`${AUTH_SALT}:${value}`);
    const buf = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  /** Length-independent comparison, so timing doesn't leak the hash. */
  private matches(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
  }

  async signIn(username: string, password: string): Promise<boolean> {
    this._error.set('');
    this._busy.set(true);
    try {
      if (!username.trim() || !password) {
        this._error.set('Enter both username and password.');
        return false;
      }
      if (!crypto?.subtle) {
        // SubtleCrypto needs a secure context: https or localhost
        this._error.set('Secure context required. Open the site over HTTPS.');
        return false;
      }

      const hash = await this.digest(password);
      const ok = username.trim() === AUTH_USER && this.matches(hash, AUTH_HASH);
      if (!ok) {
        this._error.set('Incorrect username or password.');
        return false;
      }

      this._authed.set(true);
      try {
        sessionStorage.setItem(SESSION_KEY, AUTH_HASH);
      } catch {
        // session simply won't survive a reload
      }
      return true;
    } finally {
      this._busy.set(false);
    }
  }

  signOut(): void {
    this._authed.set(false);
    this._error.set('');
    this._role.set(DASHBOARD_ROLES[0]);
    try {
      sessionStorage.removeItem(SESSION_KEY);
    } catch {
      // nothing to clear
    }
  }
}

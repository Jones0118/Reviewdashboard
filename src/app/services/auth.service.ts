import { Injectable, computed, signal } from '@angular/core';
import { AUTH_USER, AUTH_SALT, AUTH_HASH } from '../auth.generated';

const SESSION_KEY = 'emis.session';

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
    try {
      sessionStorage.removeItem(SESSION_KEY);
    } catch {
      // nothing to clear
    }
  }
}

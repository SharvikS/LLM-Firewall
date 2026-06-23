// Client helpers for the current session identity.

export type Role = 'viewer' | 'compliance' | 'security' | 'admin';

export type Edition = 'community' | 'enterprise';

// Commercial features, mirrors gateway internal/edition.Feature.
export type Feature =
  | 'billing' | 'alerts' | 'plugins' | 'sso' | 'compliance' | 'groundedness';

export interface Me {
  authenticated: boolean;
  email?: string;
  role?: Role;
  machine?: boolean;
  edition?: Edition;
  features?: Feature[];
}

// hasFeature reports whether the current session's edition entitles a feature.
export function hasFeature(me: Me | null | undefined, f: Feature): boolean {
  return !!me?.features?.includes(f);
}

// isEnterprise reports whether the active edition is Enterprise.
export function isEnterprise(me: Me | null | undefined): boolean {
  return me?.edition === 'enterprise';
}

const ROLE_LEVEL: Record<Role, number> = { viewer: 1, compliance: 2, security: 3, admin: 4 };

// roleAtLeast reports whether `role` meets or exceeds `min`.
export function roleAtLeast(role: Role | undefined, min: Role): boolean {
  if (!role) return false;
  return ROLE_LEVEL[role] >= ROLE_LEVEL[min];
}

export async function fetchMe(): Promise<Me> {
  try {
    const res = await fetch('/api/auth/me', { cache: 'no-store' });
    if (!res.ok) return { authenticated: false };
    return (await res.json()) as Me;
  } catch {
    return { authenticated: false };
  }
}

export async function logout(): Promise<void> {
  try {
    await fetch('/api/auth/logout', { method: 'POST' });
  } catch {
    /* ignore */
  }
}

export const ROLE_LABEL: Record<Role, string> = {
  viewer: 'Viewer',
  compliance: 'Compliance Officer',
  security: 'Security Engineer',
  admin: 'Enterprise Admin',
};

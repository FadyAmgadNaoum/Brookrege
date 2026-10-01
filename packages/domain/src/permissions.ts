export const ROLES = ["SUPER_ADMIN", "CONTENT_ADMIN", "MODERATOR"] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  "property:read",
  "property:write",
  "property:delete",
  "property:lifecycle", // publish, renew, expire, mark sold
  "catalog:write", // regions, compounds, projects
  "inquiry:read",
  "inquiry:write",
  "submission:read",
  "submission:write",
  "team:manage",
  "audit:read",
  "media:read",
  "media:write",
  "analytics:read",
  "notifications:manage",
  "security:manage", // sessions, 2FA resets, IP allowlist, security policy
  "privacy:manage", // data-subject lookups, exports and erasure
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const MATRIX: Record<Role, readonly Permission[]> = {
  SUPER_ADMIN: PERMISSIONS,
  CONTENT_ADMIN: [
    "property:read",
    "property:write",
    "property:delete",
    "property:lifecycle",
    "catalog:write",
    "inquiry:read",
    "inquiry:write",
    "submission:read",
    "submission:write",
    "media:read",
    "media:write",
    "analytics:read",
  ],
  MODERATOR: ["property:read", "property:lifecycle", "inquiry:read", "inquiry:write", "submission:read", "media:read"],
};

export function can(role: Role, permission: Permission): boolean {
  return MATRIX[role].includes(permission);
}

export function permissionsFor(role: Role): readonly Permission[] {
  return MATRIX[role];
}

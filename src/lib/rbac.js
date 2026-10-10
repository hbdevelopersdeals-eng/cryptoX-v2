/* RBAC: roles, permissions and the authorization decision.
 *
 * Section 10 asks for a model of User → Organization → Role → Permissions →
 * Resource, and warns against building authorization around UI visibility.
 * This module is the single place that answers "may this person do this?".
 *
 * Invariants, each covered by a test:
 *  1. Deny by default. An unknown role, an unknown permission or a missing
 *     organisation all mean "no".
 *  2. An explicit deny always beats a grant, including for platform_admin.
 *     A security rule that the most powerful role can ignore is not a rule.
 *  3. Roles are scoped to one organisation. Holding `organization_admin` in
 *     one tenant grants nothing in another.
 *  4. Inheritance is transitive and cycle-safe.
 *  5. A grant is never implied by a role name — only by the permission list.
 */

export const RESOURCES = [
  'organization', 'members', 'workspaces', 'billing', 'portfolio', 'alerts',
  'strategies', 'reports', 'settings', 'audit', 'api_keys', 'integrations',
  'market_data', 'orders'
];

export const ACTIONS = ['read', 'create', 'update', 'delete', 'manage', 'export', 'approve'];

/** Canonical permission string. */
export const perm = (resource, action) => `${resource}:${action}`;

/** Every permission the platform defines. */
export const PERMISSIONS = RESOURCES.flatMap((r) => ACTIONS.map((a) => perm(r, a)));

/* ---------------------------------------------------------------------------
 * Roles
 *
 * A role is a NAME for a set of permissions. Nothing anywhere may check a role
 * name to decide access — that is how "temporarily grant manager" turns into
 * permanent admin. Checks go through can().
 * ------------------------------------------------------------------------ */

const readOnly = (resources) => resources.map((r) => perm(r, 'read'));

export const ROLES = {
  platform_admin: {
    label: 'Platform administrator',
    scope: 'platform',
    description: 'Operates the platform itself. Grants are broad but still subject to explicit deny.',
    permissions: ['*']
  },
  organization_owner: {
    label: 'Organization owner',
    scope: 'organization',
    inherits: ['organization_admin'],
    permissions: [
      perm('organization', 'manage'), perm('organization', 'delete'),
      perm('billing', 'manage'), perm('billing', 'approve'),
      perm('members', 'manage'), perm('api_keys', 'manage'), perm('integrations', 'manage')
    ]
  },
  organization_admin: {
    label: 'Organization administrator',
    scope: 'organization',
    inherits: ['manager'],
    permissions: [
      perm('organization', 'read'), perm('organization', 'update'),
      perm('members', 'create'), perm('members', 'update'), perm('members', 'delete'),
      perm('workspaces', 'manage'), perm('settings', 'manage'),
      perm('audit', 'read'), perm('billing', 'read'), perm('api_keys', 'read')
    ]
  },
  manager: {
    label: 'Manager',
    scope: 'workspace',
    inherits: ['analyst', 'editor'],
    permissions: [
      perm('members', 'read'), perm('reports', 'approve'),
      perm('orders', 'approve'), perm('strategies', 'manage'), perm('alerts', 'manage')
    ]
  },
  finance: {
    label: 'Finance',
    scope: 'organization',
    permissions: [
      ...readOnly(['organization', 'reports', 'market_data']),
      perm('billing', 'read'), perm('billing', 'update'), perm('billing', 'export'),
      // Approving a charge is a finance function; without it the role cannot do
      // the thing it exists for.
      perm('billing', 'approve'),
      perm('orders', 'read'), perm('orders', 'approve'), perm('portfolio', 'export')
    ]
  },
  support: {
    label: 'Support',
    scope: 'organization',
    permissions: [
      ...readOnly(['organization', 'members', 'portfolio', 'alerts', 'orders']),
      perm('reports', 'read'), perm('audit', 'read')
    ]
  },
  analyst: {
    label: 'Analyst',
    scope: 'workspace',
    permissions: [
      ...readOnly(['market_data', 'portfolio', 'alerts', 'strategies', 'reports', 'organization']),
      perm('reports', 'create'), perm('reports', 'export'), perm('portfolio', 'update')
    ]
  },
  editor: {
    label: 'Editor',
    scope: 'workspace',
    permissions: [
      ...readOnly(['market_data', 'strategies', 'reports']),
      perm('strategies', 'create'), perm('strategies', 'update'),
      perm('alerts', 'create'), perm('alerts', 'update'), perm('reports', 'create')
    ]
  },
  viewer: {
    label: 'Viewer',
    scope: 'workspace',
    permissions: readOnly(['market_data', 'portfolio', 'alerts', 'strategies', 'reports', 'organization'])
  },
  user: {
    label: 'User',
    scope: 'self',
    permissions: [
      ...readOnly(['market_data', 'portfolio', 'alerts', 'reports']),
      perm('settings', 'read'), perm('settings', 'update')
    ]
  }
};

export const ROLE_IDS = Object.keys(ROLES);
export const isKnownRole = (role) => Object.prototype.hasOwnProperty.call(ROLES, role);

/** Does a permission pattern match an actual permission? Supports `*` and `resource:*`. */
export function matchesPermission(pattern, permission) {
  if (pattern === '*') return true;
  if (pattern === permission) return true;
  if (pattern.endsWith(':*')) return permission.startsWith(`${pattern.slice(0, -1)}`);
  return false;
}

/**
 * Flatten a role, following inheritance. Visited-set makes a cycle safe rather
 * than an infinite loop.
 */
export function rolePermissions(role, seen = new Set()) {
  if (!isKnownRole(role) || seen.has(role)) return [];
  seen.add(role);
  const def = ROLES[role];
  const inherited = (def.inherits || []).flatMap((parent) => rolePermissions(parent, seen));
  return [...new Set([...inherited, ...(def.permissions || [])])];
}

/** The effective permission set for a list of roles, as concrete permissions. */
export function effectivePermissions(roles = []) {
  const patterns = [...new Set(roles.flatMap((r) => rolePermissions(r)))];
  if (patterns.includes('*')) return { all: true, permissions: PERMISSIONS.slice(), patterns };
  const concrete = PERMISSIONS.filter((p) => patterns.some((pattern) => matchesPermission(pattern, p)));
  return { all: false, permissions: concrete, patterns };
}

/* ---------------------------------------------------------------------------
 * Authorization
 * ------------------------------------------------------------------------ */

/**
 * @param subject  { userId, roles: [], grants: [], denies: [], organizationId, workspaceIds }
 * @param required permission string, e.g. 'billing:approve'
 * @param context  { organizationId, workspaceId, resourceOwnerId }
 */
export function authorize(subject, required, context = {}) {
  const deny = () => ({ allowed: false, reason: 'denied' });
  if (!subject || !subject.userId) return { allowed: false, reason: 'no-subject' };
  if (!required || typeof required !== 'string') return { allowed: false, reason: 'no-permission' };

  const roles = Array.isArray(subject.roles) ? subject.roles.filter(isKnownRole) : [];
  if (!roles.length) return { allowed: false, reason: 'no-role' };

  const denies = subject.denies || [];
  const grants = subject.grants || [];
  const { permissions, all } = effectivePermissions(roles);

  // 1. An explicit deny wins over everything, including platform_admin.
  if (denies.some((d) => matchesPermission(d, required))) return { allowed: false, reason: 'explicit-deny' };

  /*
   * `permissions` is already the FULL vocabulary when `all` is set, so testing
   * membership denies a requirement that is not a real permission even for a
   * wildcard role. Testing `all ||` instead let platform_admin be authorized
   * for an invented string such as 'made:up', so a typo in a permission name
   * succeeded for exactly one role — the most powerful one — and failed for
   * every other. Unknown permissions must fail closed for everyone.
   */
  const grantedByRole = permissions.includes(required);
  const grantedExplicitly = grants.some((g) => matchesPermission(g, required));
  if (!grantedByRole && !grantedExplicitly) return { allowed: false, reason: 'not-permitted' };

  // 2. Organisation scoping: a scoped role only acts inside its own tenant.
  if (isPlatformWide(roles)) return { allowed: true, reason: 'platform-scope' };

  /*
   * Only organization- and workspace-scoped roles need an organization. A
   * self-scoped role (a personal account holding `user`) has none, and the
   * earlier unconditional check denied every personal user their own settings.
   */
  const orgScoped = roles.some((r) => ['organization', 'workspace'].includes(ROLES[r]?.scope));
  const targetOrg = context.organizationId || subject.organizationId;
  if (orgScoped) {
    if (!subject.organizationId) return { allowed: false, reason: 'no-organization' };
    if (targetOrg && targetOrg !== subject.organizationId) return { allowed: false, reason: 'cross-organization' };
  } else if (targetOrg && subject.organizationId && targetOrg !== subject.organizationId) {
    return { allowed: false, reason: 'cross-organization' };
  }

  // 3. Workspace scoping, when the context names one and the subject is limited.
  if (context.workspaceId && Array.isArray(subject.workspaceIds) && subject.workspaceIds.length &&
      !subject.workspaceIds.includes(context.workspaceId)) {
    return { allowed: false, reason: 'outside-workspace' };
  }

  // 4. Self-scope, when the resource belongs to a user.
  if (context.resourceOwnerId && requiresOwnership(roles) && context.resourceOwnerId !== subject.userId) {
    return { allowed: false, reason: 'not-owner' };
  }

  return { allowed: true, reason: 'role-grant' };
}

const isPlatformWide = (roles) => roles.includes('platform_admin');
const requiresOwnership = (roles) => roles.length > 0 && roles.every((r) => ROLES[r]?.scope === 'self');

/** Boolean convenience wrapper. */
export const can = (subject, required, context) => authorize(subject, required, context).allowed;

/**
 * Filter a list of resources to those the subject may act on.
 * The UI uses this to decide what to render, but the decision that matters is
 * still the server-side `authorize` call on the actual request.
 */
export function filterAuthorized(subject, items, permission, contextOf = () => ({})) {
  return (items || []).filter((item) => can(subject, permission, contextOf(item)));
}

/**
 * The roles a subject may hand out. Prevents privilege escalation: nobody can
 * invite someone at a level above their own.
 */
export function assignableRoles(subject) {
  if (!subject || !subject.userId) return [];
  if (isPlatformWide(subject.roles || [])) return ROLE_IDS.slice();
  const mine = effectivePermissions(subject.roles || []);
  return ROLE_IDS.filter((role) => {
    if (role === 'platform_admin') return false; // never grantable by a tenant
    const theirs = rolePermissions(role);
    if (theirs.includes('*')) return false;
    return theirs.every((p) => mine.all || mine.permissions.includes(p));
  });
}

/** A human-readable reason, for the audit log and the UI. */
export const DENY_REASONS = {
  'no-subject': 'Not signed in.',
  'no-permission': 'No permission was requested.',
  'no-role': 'This account holds no role.',
  'explicit-deny': 'An explicit deny overrides the role.',
  'not-permitted': 'The role does not include this permission.',
  'no-organization': 'The account is not a member of an organisation.',
  'cross-organization': 'This action belongs to a different organisation.',
  'outside-workspace': 'Outside the workspaces this role is limited to.',
  'not-owner': 'This resource belongs to another user.',
  'denied': 'Denied.'
};

export const explain = (decision) => DENY_REASONS[decision.reason] || decision.reason;

/** The permission matrix, for the admin UI and for documentation. */
export function permissionMatrix() {
  return ROLE_IDS.map((role) => {
    const { permissions, all } = effectivePermissions([role]);
    return {
      role,
      label: ROLES[role].label,
      scope: ROLES[role].scope,
      inherits: ROLES[role].inherits || [],
      all,
      permissions,
      count: permissions.length
    };
  });
}

export enum TokenType {
  VERIFY_EMAIL = "VERIFY_EMAIL",
  RESET_PASSWORD = "RESET_PASSWORD",
  CHANGE_EMAIL = "CHANGE_EMAIL",
}

export enum AuditAction {
  USER_CREATED = "USER_CREATED",
  LOGIN_SUCCESS = "LOGIN_SUCCESS",
  LOGIN_FAILED = "LOGIN_FAILED",
  LOGOUT = "LOGOUT",
  PASSWORD_CHANGED = "PASSWORD_CHANGED",
  EMAIL_VERIFIED = "EMAIL_VERIFIED",
  ROLE_CHANGED = "ROLE_CHANGED",
}

export type Permission = {
  id: string;
  code: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type Role = {
  id: string;
  name: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type UserRole = {
  userId: string;
  roleId: string;
  createdAt: Date;
};

export type RolePermission = {
  roleId: string;
  permissionId: string;
  createdAt: Date;
};

export type User = {
  id: string;
  email: string;
  emailNormalized: string;
  emailVerifiedAt: Date | null;
  passwordHash: string | null;
  isDisabled: boolean;
  disabledAt: Date | null;
  disabledReason: string | null;
  failedLoginCount: number;
  lockedUntil: Date | null;
  lastLoginAt: Date | null;
  lastLoginIp: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type AuthToken = {
  id: string;
  userId: string;
  type: TokenType;
  tokenHash: string;
  expiresAt: Date;
  consumedAt: Date | null;
  metadata: unknown | null;
  createdAt: Date;
  updatedAt: Date;
};

export type AuditLog = {
  id: string;
  userId: string | null;
  action: AuditAction;
  ip: string | null;
  userAgent: string | null;
  details: unknown | null;
  createdAt: Date;
};

export type AuthenticatedUser = {
  id: string;
  email: string;
  displayName: string | null;
  roles: string[];
  permissions: string[];
};

export type RegisterInput = {
  email: string;
  password: string;
  displayName?: string;
};

export type LoginInput = {
  email: string;
  password: string;
};

export type CreateUserInput = {
  email: string;
  displayName?: string;
  roleIds?: string[];
};

export type SetPasswordInput = {
  token: string;
  password: string;
};

import { Passwords } from "../user/auth.js";
import { AuthTokenStore, RoleStore, UserStore } from "../store/prisma.js";

const BOOTSTRAP_EMAIL = "bootstrap-admin@example.com";

export async function runPrestart() {
  const emailNormalized = BOOTSTRAP_EMAIL.toLowerCase();

  const hasExistingAdmin = await UserStore.hasCredentialedAdminExcludingEmail(emailNormalized);
  if (hasExistingAdmin) {
    const bootstrapUser = await UserStore.findByEmail(emailNormalized);
    if (bootstrapUser) {
      await UserStore.deleteById(bootstrapUser.id);
      console.log("[bootstrap] Removed bootstrap admin shell account because an admin user already exists.");
    }
    return;
  }

  let adminUser = await UserStore.findByEmail(emailNormalized);
  if (!adminUser) {
    const createdAdmin = await UserStore.createShellUser({
      email: BOOTSTRAP_EMAIL,
      displayName: "Admin",
    });
    adminUser = await UserStore.findById(createdAdmin.id);
  }

  if (!adminUser) {
    throw new Error("failed to initialize bootstrap admin user");
  }

  if (adminUser.passwordHash) {
    return;
  }

  const adminRole = await RoleStore.ensureRole("admin", "Full administrative access");
  await RoleStore.assignRole(adminUser.id, adminRole.id);

  const existingToken = await AuthTokenStore.findActiveResetTokenByUser(adminUser.id);
  const existingMetadata =
    existingToken?.metadata && typeof existingToken.metadata === "object"
      ? (existingToken.metadata as { bootstrapToken?: unknown })
      : null;
  const existingBootstrapToken =
    typeof existingMetadata?.bootstrapToken === "string" ? existingMetadata.bootstrapToken : null;

  if (existingToken && existingBootstrapToken) {
    console.log("[bootstrap] Admin bootstrap still pending. Claim via POST /auth/bootstrap/claim");
    console.log(`[bootstrap] token=${existingBootstrapToken}`);
    console.log(`[bootstrap] expiresAt=${existingToken.expiresAt.toISOString()}`);
    return;
  }

  const resetToken = await Passwords.resetPasswordToken();
  await AuthTokenStore.rotateResetTokenWithMetadata(adminUser.id, resetToken.tokenHash, resetToken.expiresAt, {
    bootstrapToken: resetToken.token,
  });

  console.log("[bootstrap] Admin bootstrap token generated. Claim via POST /auth/bootstrap/claim");
  console.log(`[bootstrap] token=${resetToken.token}`);
  console.log(`[bootstrap] expiresAt=${resetToken.expiresAt.toISOString()}`);
}

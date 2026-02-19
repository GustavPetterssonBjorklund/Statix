import argon2 from "argon2";
import { randomBytes, createHash } from "node:crypto";

namespace Config {
    export namespace Passwords {
        // Sane defaults
        export const HASHING_OPTIONS = {
            type: argon2.argon2id,
            timeCost: 3,
            memoryCost: 2 ** 16, // 64 MiB
            parallelism: 1,
        };

        export const RESET_PASSWORD_TOKEN = {
            BYTE_LENGTH: 32,
            EXPIRES_IN: 60 * 60 * 1000, // 1 hour
        };
    }

    export namespace Sessions {
        export const SESSION_TOKEN = {
            BYTE_LENGTH: 32,
            EXPIRES_IN: 7 * 24 * 60 * 60 * 1000, // 7 days
        };
    }
}

export namespace Passwords { 
    export type ResetPasswordToken = {
        token: string;
        tokenHash: string;
        expiresAt: Date;
    }

    export async function hashPassword(password: string): Promise<string> {
        return await argon2.hash(password, Config.Passwords.HASHING_OPTIONS);
    }

    export async function verifyPassword(password: string, hash: string): Promise<boolean> {
        return await argon2.verify(hash, password);
    }

    export async function resetPasswordToken(): Promise<ResetPasswordToken> {
        const token = randomBytes(Config.Passwords.RESET_PASSWORD_TOKEN.BYTE_LENGTH).toString("base64url");
        const tokenHash = createHash("sha256").update(token).digest("hex");
        const expiresAt = new Date(Date.now() + Config.Passwords.RESET_PASSWORD_TOKEN.EXPIRES_IN);

        return {
            token,
            tokenHash,
            expiresAt
        };
    }

    /**
     * @warning This function does not consume the token.
     * @warning This function does not check if the token is expired. It will ONLY verify the token hash
     */
    export async function verifyResetPasswordToken(token: string, tokenHash: string): Promise<boolean> {
        const tokenHashToVerify = createHash("sha256").update(token).digest("hex");
        return tokenHash === tokenHashToVerify;
    }

    export async function hashToken(token: string): Promise<string> {
        return createHash("sha256").update(token).digest("hex");
    }

    export async function createTemporaryPassword(): Promise<string> {
        return randomBytes(12).toString("base64url"); // 16 characters
    }
}

export namespace Sessions {
    export type SessionToken = {
        token: string;
        tokenHash: string;
        expiresAt: Date;
    }

    async function createSessionToken(): Promise<{ token: string; tokenHash: string }> {
        const token = randomBytes(Config.Sessions.SESSION_TOKEN.BYTE_LENGTH).toString("base64url");
        const tokenHash = createHash("sha256").update(token).digest("hex");
        return { token, tokenHash };
    }

    export async function createSession(): Promise<SessionToken> {
        const { token, tokenHash } = await createSessionToken();
        const expiresAt = new Date(Date.now() + Config.Sessions.SESSION_TOKEN.EXPIRES_IN);

        return {
            token,
            tokenHash,
            expiresAt
        };
    }
}

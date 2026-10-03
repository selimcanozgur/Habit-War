/**
 * Sign-up, sign-in, refresh, sign-out, and the two email flows.
 *
 * Three rules run through all of it:
 *
 *  1. **Nothing here reveals whether an address has an account.** Sign-in returns one
 *     message for a wrong password and for an unknown email, and spends the same CPU
 *     either way. Password reset says "if there is an account, we sent a mail"
 *     regardless. Signup is the one unavoidable exception — it has to refuse a
 *     duplicate — which is why the rate limiter on it matters.
 *
 *  2. **A refresh token is used once.** Every refresh issues a new one and marks the
 *     old one replaced. If a replaced token comes back, the family is revoked: that
 *     is either theft or a client retry, the two are indistinguishable from here,
 *     and revoking costs a sign-in while not revoking costs the account.
 *
 *  3. **Email is the identity join.** A Google sign-in for an address that already
 *     has a password account links to that account rather than creating a second
 *     one — the alternative is a user who cannot find their habits because they
 *     tapped a different button than last time. The link is only made when the
 *     provider asserts the address is verified, since an unverified provider email
 *     would otherwise be an account takeover.
 */

import type { AuthProvider, PrismaClient, User } from '@prisma/client';

import { AppError } from '../../lib/errors.js';
import { createUser, findUserByEmail, type NewIdentity } from '../users/service.js';
import {
  burnVerificationTime,
  checkPasswordStrength,
  hashPassword,
  verifyPassword,
} from './password.js';
import {
  emailTokenExpiry,
  generateEmailToken,
  generateRefreshToken,
  hashEmailToken,
  hashRefreshToken,
  refreshTokenExpiry,
  signAccessToken,
  ACCESS_TOKEN_TTL_SECONDS,
} from './tokens.js';

/** What a successful sign-in, sign-up or refresh hands back. */
export interface AuthResult {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresIn: number;
  readonly user: User;
}

/** Where a session came from, for the user's own device list. */
export interface DeviceContext {
  readonly userAgent?: string | undefined;
  readonly ipAddress?: string | undefined;
}

/**
 * Delivers an email. Injected because this module must not know about a mail vendor,
 * and because tests need to read the token rather than an inbox.
 */
export type MailSender = (message: {
  readonly to: string;
  readonly kind: 'EMAIL_VERIFICATION' | 'PASSWORD_RESET';
  readonly token: string;
}) => Promise<void>;

export interface AuthServiceOptions {
  readonly prisma: PrismaClient;
  /** Secret the access tokens are signed with. */
  readonly jwtSecret: Uint8Array;
  readonly sendMail: MailSender;
  /** Clock, injected so expiry tests do not have to wait. */
  readonly now?: () => Date;
  /**
   * Whether a password account must verify its address before signing in.
   *
   * Off in development, where there is no mail server and being locked out of your
   * own test account helps nobody.
   */
  readonly requireEmailVerification?: boolean;
}

export class AuthService {
  readonly #prisma: PrismaClient;
  readonly #jwtSecret: Uint8Array;
  readonly #sendMail: MailSender;
  readonly #now: () => Date;
  readonly #requireVerification: boolean;

  constructor(options: AuthServiceOptions) {
    this.#prisma = options.prisma;
    this.#jwtSecret = options.jwtSecret;
    this.#sendMail = options.sendMail;
    this.#now = options.now ?? ((): Date => new Date());
    this.#requireVerification = options.requireEmailVerification ?? false;
  }

  // -------------------------------------------------------------- sign up

  async signUp(input: {
    readonly email: string;
    readonly password: string;
    readonly device: DeviceContext;
  }): Promise<AuthResult> {
    const email = input.email.trim().toLowerCase();

    const problem = checkPasswordStrength(input.password);
    if (problem) {
      throw new AppError('UNPROCESSABLE', passwordMessage(problem));
    }

    const existing = await this.#prisma.user.findFirst({ where: { email } });
    if (existing) {
      // Unavoidably an account-existence oracle. The alternative — accepting the
      // signup and mailing "you already have an account" — is what large providers
      // do, and it is a worse experience for the overwhelmingly common case of
      // someone who simply forgot they had registered.
      throw new AppError('CONFLICT', 'Bu e-posta adresi zaten kayıtlı.');
    }

    const passwordHash = await hashPassword(input.password);

    let user: User;
    try {
      user = await createUser(
        this.#prisma,
        { email },
        { passwordHash, emailVerified: !this.#requireVerification },
      );
    } catch {
      // Two signups for the same address can both pass the check above and race to
      // the insert. The unique constraint is what actually decides.
      throw new AppError('CONFLICT', 'Bu e-posta adresi zaten kayıtlı.');
    }

    if (this.#requireVerification) {
      await this.#issueEmailToken(user, 'EMAIL_VERIFICATION');
    }

    return (await this.#startSession(user, input.device)).result;
  }

  // -------------------------------------------------------------- sign in

  async signIn(input: {
    readonly email: string;
    readonly password: string;
    readonly device: DeviceContext;
  }): Promise<AuthResult> {
    const email = input.email.trim().toLowerCase();
    const user = await findUserByEmail(this.#prisma, email);

    // Same message, same work, whether the address is unknown or the password is
    // wrong. Returning early here would turn response time into a user enumerator.
    if (!user?.passwordHash) {
      await burnVerificationTime(input.password);
      throw new AppError('UNAUTHORIZED', 'E-posta veya şifre hatalı.');
    }

    const matches = await verifyPassword(user.passwordHash, input.password);
    if (!matches) {
      throw new AppError('UNAUTHORIZED', 'E-posta veya şifre hatalı.');
    }

    if (this.#requireVerification && !user.emailVerifiedAt) {
      throw new AppError('FORBIDDEN', 'Önce e-posta adresini doğrulaman gerekiyor.');
    }

    return (await this.#startSession(user, input.device)).result;
  }

  // ----------------------------------------------------- google / apple

  /**
   * Signs in or signs up through a provider.
   *
   * The caller has already verified the provider's token; what arrives here is the
   * claims it contained. `emailVerified` is passed through from those claims rather
   * than assumed — an unverified provider address must not be allowed to attach
   * itself to an existing account, because anyone can put any address on a profile
   * at some providers.
   */
  async signInWithProvider(input: {
    readonly provider: AuthProvider;
    readonly providerAccountId: string;
    readonly email: string;
    readonly emailVerified: boolean;
    readonly firstName?: string | null;
    readonly lastName?: string | null;
    readonly imageUrl?: string | null;
    readonly device: DeviceContext;
  }): Promise<AuthResult> {
    const email = input.email.trim().toLowerCase();

    // 1. Seen this provider account before — the common case after the first run.
    const link = await this.#prisma.authIdentity.findUnique({
      where: {
        provider_providerAccountId: {
          provider: input.provider,
          providerAccountId: input.providerAccountId,
        },
      },
      include: { user: true },
    });
    if (link) {
      if (link.user.deletedAt) {
        throw new AppError('FORBIDDEN', 'Bu hesap silinmiş.');
      }
      return (await this.#startSession(link.user, input.device)).result;
    }

    // 2. An account already exists for this address: link, do not duplicate.
    const byEmail = await findUserByEmail(this.#prisma, email);
    if (byEmail) {
      if (!input.emailVerified) {
        throw new AppError(
          'FORBIDDEN',
          'Bu e-posta ile zaten bir hesap var. Şifrenle giriş yap.',
        );
      }
      await this.#prisma.authIdentity.create({
        data: {
          userId: byEmail.id,
          provider: input.provider,
          providerAccountId: input.providerAccountId,
          email,
        },
      });
      // Signing in through a provider that verified the address also settles a
      // password account that never confirmed its own email.
      if (!byEmail.emailVerifiedAt) {
        await this.#prisma.user.update({
          where: { id: byEmail.id },
          data: { emailVerifiedAt: this.#now() },
        });
      }
      return (await this.#startSession(byEmail, input.device)).result;
    }

    // 3. Brand new person.
    const identity: NewIdentity = {
      email,
      firstName: input.firstName ?? null,
      lastName: input.lastName ?? null,
      imageUrl: input.imageUrl ?? null,
    };
    const user = await createUser(this.#prisma, identity, {
      passwordHash: null,
      emailVerified: input.emailVerified,
    });
    await this.#prisma.authIdentity.create({
      data: {
        userId: user.id,
        provider: input.provider,
        providerAccountId: input.providerAccountId,
        email,
      },
    });

    return (await this.#startSession(user, input.device)).result;
  }

  // -------------------------------------------------------------- refresh

  /**
   * Exchanges a refresh token for a new pair.
   *
   * A token that was already replaced coming back means one of two things: the
   * client retried after a lost response, or someone is replaying a stolen token.
   * They cannot be told apart here, so the whole family is revoked and the user
   * signs in again — cheap if it was a retry, and the only correct answer if it
   * was not.
   */
  async refresh(input: {
    readonly refreshToken: string;
    readonly device: DeviceContext;
  }): Promise<AuthResult> {
    const tokenHash = hashRefreshToken(input.refreshToken);
    const session = await this.#prisma.authSession.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!session) {
      throw new AppError('UNAUTHORIZED', 'Oturum geçersiz. Tekrar giriş yap.');
    }

    const now = this.#now();

    if (session.revokedAt) {
      await this.#revokeAllSessions(session.userId);
      throw new AppError('UNAUTHORIZED', 'Oturum geçersiz. Tekrar giriş yap.');
    }
    if (session.expiresAt <= now) {
      throw new AppError('UNAUTHORIZED', 'Oturumun süresi doldu. Tekrar giriş yap.');
    }
    if (session.user.deletedAt) {
      throw new AppError('FORBIDDEN', 'Bu hesap silinmiş.');
    }

    const next = await this.#startSession(session.user, input.device);
    await this.#prisma.authSession.update({
      where: { id: session.id },
      data: { revokedAt: now, replacedById: next.sessionId },
    });
    return next.result;
  }

  // ------------------------------------------------------------- sign out

  /** Ends one device's session. Unknown tokens succeed silently — the goal is reached. */
  async signOut(refreshToken: string): Promise<void> {
    const tokenHash = hashRefreshToken(refreshToken);
    await this.#prisma.authSession.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: this.#now() },
    });
  }

  /** Ends every session. What "log out everywhere" after a stolen phone has to do. */
  async signOutEverywhere(userId: string): Promise<void> {
    await this.#revokeAllSessions(userId);
  }

  // ------------------------------------------------------ email flows

  /**
   * Starts a password reset.
   *
   * Always resolves, whether or not the address has an account, and says nothing in
   * the response about which it was. The mail is the only channel that reveals it,
   * and only to whoever controls the inbox.
   */
  async requestPasswordReset(email: string): Promise<void> {
    const user = await findUserByEmail(this.#prisma, email.trim().toLowerCase());
    if (!user) return;

    // Invalidate any outstanding reset, so the newest mail is the only one that
    // works; otherwise an older link in the user's inbox stays live.
    await this.#prisma.authToken.updateMany({
      where: { userId: user.id, kind: 'PASSWORD_RESET', consumedAt: null },
      data: { consumedAt: this.#now() },
    });

    await this.#issueEmailToken(user, 'PASSWORD_RESET');
  }

  /**
   * Completes a password reset.
   *
   * Every session is revoked afterwards. If the reset was done because the account
   * was compromised, leaving the attacker's session alive would defeat the point.
   */
  async resetPassword(input: {
    readonly token: string;
    readonly password: string;
  }): Promise<void> {
    const problem = checkPasswordStrength(input.password);
    if (problem) {
      throw new AppError('UNPROCESSABLE', passwordMessage(problem));
    }

    const record = await this.#consumeToken(input.token, 'PASSWORD_RESET');
    const passwordHash = await hashPassword(input.password);

    await this.#prisma.user.update({
      where: { id: record.userId },
      data: {
        passwordHash,
        // Holding a link sent to the address proves control of it.
        emailVerifiedAt: this.#now(),
      },
    });

    await this.#revokeAllSessions(record.userId);
  }

  async verifyEmail(token: string): Promise<void> {
    const record = await this.#consumeToken(token, 'EMAIL_VERIFICATION');
    await this.#prisma.user.update({
      where: { id: record.userId },
      data: { emailVerifiedAt: this.#now() },
    });
  }

  /** Re-sends a verification mail. Silent for unknown or already-verified addresses. */
  async resendVerification(email: string): Promise<void> {
    const user = await findUserByEmail(this.#prisma, email.trim().toLowerCase());
    if (!user || user.emailVerifiedAt) return;
    await this.#issueEmailToken(user, 'EMAIL_VERIFICATION');
  }

  // --------------------------------------------------------------- internals

  async #startSession(
    user: User,
    device: DeviceContext,
  ): Promise<{ readonly result: AuthResult; readonly sessionId: string }> {
    const refreshToken = generateRefreshToken();
    const now = this.#now();

    const session = await this.#prisma.authSession.create({
      data: {
        userId: user.id,
        tokenHash: hashRefreshToken(refreshToken),
        expiresAt: refreshTokenExpiry(now),
        userAgent: device.userAgent?.slice(0, 200) ?? null,
        ipAddress: device.ipAddress?.slice(0, 45) ?? null,
      },
    });

    const accessToken = await signAccessToken(
      { userId: user.id, sessionId: session.id },
      this.#jwtSecret,
      now,
    );

    // The sessionId is returned alongside rather than inside the result: `refresh`
    // needs it to record what the old row was replaced by, and it has no business in
    // a response body.
    return {
      result: {
        accessToken,
        refreshToken,
        expiresIn: ACCESS_TOKEN_TTL_SECONDS,
        user,
      },
      sessionId: session.id,
    };
  }

  async #revokeAllSessions(userId: string): Promise<void> {
    await this.#prisma.authSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: this.#now() },
    });
  }

  async #issueEmailToken(
    user: User,
    kind: 'EMAIL_VERIFICATION' | 'PASSWORD_RESET',
  ): Promise<void> {
    const token = generateEmailToken();
    await this.#prisma.authToken.create({
      data: {
        userId: user.id,
        kind,
        tokenHash: hashEmailToken(token),
        expiresAt: emailTokenExpiry(this.#now()),
      },
    });
    await this.#sendMail({ to: user.email, kind, token });
  }

  /**
   * Validates a one-time token and marks it used in the same breath.
   *
   * `updateMany` with `consumedAt: null` in the filter is what makes this atomic:
   * two requests racing with the same token both match the row, but only one update
   * reports a row changed, so the second is refused rather than both succeeding.
   */
  async #consumeToken(
    token: string,
    kind: 'EMAIL_VERIFICATION' | 'PASSWORD_RESET',
  ): Promise<{ readonly userId: string }> {
    const tokenHash = hashEmailToken(token);
    const now = this.#now();

    const record = await this.#prisma.authToken.findUnique({ where: { tokenHash } });
    if (!record || record.kind !== kind || record.consumedAt || record.expiresAt <= now) {
      throw new AppError('UNAUTHORIZED', 'Bağlantı geçersiz veya süresi dolmuş.');
    }

    const claimed = await this.#prisma.authToken.updateMany({
      where: { id: record.id, consumedAt: null },
      data: { consumedAt: now },
    });
    if (claimed.count === 0) {
      throw new AppError('UNAUTHORIZED', 'Bağlantı geçersiz veya süresi dolmuş.');
    }

    return { userId: record.userId };
  }
}

function passwordMessage(problem: 'TOO_SHORT' | 'TOO_LONG' | 'TOO_COMMON'): string {
  switch (problem) {
    case 'TOO_SHORT':
      return 'Şifre en az 8 karakter olmalı.';
    case 'TOO_LONG':
      return 'Şifre en fazla 128 karakter olabilir.';
    case 'TOO_COMMON':
      return 'Bu şifre çok yaygın. Daha az tahmin edilebilir bir şey seç.';
  }
}

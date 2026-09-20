/**
 * Notification copy.
 *
 * Every string in this file is USER-FACING and therefore Turkish; the code and the
 * comments around it stay English, which is the split the rest of the codebase keeps.
 *
 * WHY THE COPY IS RENDERED AT WRITE TIME rather than templated and expanded by the
 * client: push delivery reads the stored `Notification` row and hands `title`/`body`
 * straight to Expo. A template would arrive on a lock screen as
 * "{{actor}} gönderini beğendi", because the push payload never passes through a
 * client renderer. The in-app inbox still joins the actor (see `NotificationService.list`),
 * so avatars and handles are live; only the sentence is frozen.
 *
 * LENGTH IS A CORRECTNESS CONCERN, not a style one. `Notification.title` is
 * `VarChar(120)` and `body` is `VarChar(500)`; Postgres REJECTS an over-long value
 * rather than truncating it, so an unbounded display name would turn "someone liked
 * your post" into a failed write. Everything interpolated from user-controlled text
 * goes through `clamp`.
 */

import type { Category } from '@prisma/client';

export interface NotificationCopy {
  readonly title: string;
  readonly body: string | null;
}

/** Schema limits, mirrored here so the builders cannot drift from the columns. */
const TITLE_MAX = 120;
const BODY_MAX = 500;

/**
 * How much of a display name a sentence may spend.
 *
 * Deliberately far below TITLE_MAX: the rest of the sentence has to fit too, and a
 * 90-character "name" is either a joke handle or an attempt to push the real content
 * of the notification off the lock screen.
 */
const NAME_MAX = 40;

/** Comment excerpt shown under "X gönderine yorum yaptı". */
const EXCERPT_MAX = 140;

/**
 * Shortens with an ellipsis, never mid-surrogate.
 *
 * `Array.from` iterates by code point, so an emoji or a combining sequence is not
 * cut in half into an invalid string — which Postgres would store and the client
 * would render as a replacement character.
 */
export function clamp(value: string, max: number): string {
  const trimmed = value.trim().replace(/\s+/g, ' ');
  const points = Array.from(trimmed);
  if (points.length <= max) return trimmed;
  return `${points.slice(0, max - 1).join('')}…`;
}

function name(displayName: string): string {
  const clamped = clamp(displayName, NAME_MAX);
  // A blank display name would produce " gönderini beğendi". The fallback matches the
  // one the actor-less (system) notifications use.
  return clamped.length > 0 ? clamped : 'Bir kullanıcı';
}

function title(value: string): string {
  return clamp(value, TITLE_MAX);
}

function body(value: string | null): string | null {
  if (value === null) return null;
  const clamped = clamp(value, BODY_MAX);
  return clamped.length > 0 ? clamped : null;
}

/**
 * Turkish labels for the habit categories.
 *
 * `satisfies` rather than a bare object: adding a Category to the schema without a
 * label here becomes a type error instead of an "undefined kategorisinde" duel
 * invitation in production.
 */
const CATEGORY_LABELS = {
  FITNESS: 'Spor',
  STUDY: 'Çalışma',
  MINDFULNESS: 'Zihin',
  CREATIVE: 'Yaratıcılık',
  SOCIAL: 'Sosyal',
  HEALTH: 'Sağlık',
  SKILL: 'Beceri',
} satisfies Record<Category, string>;

export function categoryLabel(category: Category | null): string {
  return category ? CATEGORY_LABELS[category] : 'Genel';
}

/** How a finished duel went, from the recipient's own side. */
export type DuelOutcome = 'WON' | 'LOST' | 'DRAW';

/**
 * A date the user can read, in their own timezone.
 *
 * The timezone is passed in rather than assumed, for the same reason streaks compute
 * a local date key: "12 Ekim'e kadar askıya alındı" must mean the user's 12 October.
 * An unknown timezone falls back to the schema's default rather than throwing —
 * a malformed tz string must not be able to block a suspension notice.
 */
function formatDate(at: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('tr-TR', { dateStyle: 'long', timeZone }).format(at);
  } catch {
    return new Intl.DateTimeFormat('tr-TR', {
      dateStyle: 'long',
      timeZone: 'Europe/Istanbul',
    }).format(at);
  }
}

export const copy = {
  // --- Social graph --------------------------------------------------------

  friendRequest(actorName: string): NotificationCopy {
    return { title: title(`${name(actorName)} sana arkadaşlık isteği gönderdi`), body: null };
  },

  friendAccepted(actorName: string): NotificationCopy {
    return {
      title: title(`${name(actorName)} arkadaşlık isteğini kabul etti`),
      body: body('Artık arkadaşsınız — akışta ve düellolarda birbirinizi görebilirsiniz.'),
    };
  },

  newFollower(actorName: string): NotificationCopy {
    return { title: title(`${name(actorName)} seni takip etmeye başladı`), body: null };
  },

  // --- Feed ----------------------------------------------------------------

  postLike(actorName: string): NotificationCopy {
    return { title: title(`${name(actorName)} gönderini beğendi`), body: null };
  },

  postComment(actorName: string, comment: string | null): NotificationCopy {
    return {
      title: title(`${name(actorName)} gönderine yorum yaptı`),
      // The excerpt is the point of the notification: "someone commented" without the
      // comment forces the user to open the app to learn whether it mattered.
      body: body(comment === null ? null : clamp(comment, EXCERPT_MAX)),
    };
  },

  // --- Duels ---------------------------------------------------------------

  challengeInvite(actorName: string, category: Category | null, days: number): NotificationCopy {
    return {
      title: title(`${name(actorName)} seni düelloya davet etti`),
      body: body(`${categoryLabel(category)} kategorisinde ${days} günlük düello.`),
    };
  },

  challengeAccepted(actorName: string, category: Category | null, days: number): NotificationCopy {
    return {
      title: title(`${name(actorName)} düello davetini kabul etti`),
      body: body(`${categoryLabel(category)} düellosu başladı, ${days} gün sürüyor.`),
    };
  },

  /**
   * Result of a finished duel. System copy: no actor name, so the sentence is the
   * same whether or not the opponent has since blocked, deleted or been purged.
   */
  challengeEnded(outcome: DuelOutcome, ownXp: number, opponentXp: number): NotificationCopy {
    const score = `${ownXp} XP – ${opponentXp} XP`;
    if (outcome === 'WON') {
      return { title: title('Düelloyu kazandın'), body: body(`Sonuç: ${score}.`) };
    }
    if (outcome === 'LOST') {
      return { title: title('Düello sona erdi'), body: body(`Kaybettin. Sonuç: ${score}.`) };
    }
    return { title: title('Düello berabere bitti'), body: body(`Sonuç: ${score}.`) };
  },

  // --- Moderation ----------------------------------------------------------
  //
  // None of these name the moderator. The actor is left null on the row as well: a
  // user who learns which staff member sanctioned them has a target, and that is how
  // moderation teams get harassed. The user learns WHAT happened, WHY, and for HOW
  // LONG — which is the whole of what they need to appeal.

  postHidden(reason: string): NotificationCopy {
    return {
      title: title('Gönderin topluluk kurallarına aykırı bulundu'),
      body: body(
        `Gönderin diğer kullanıcılardan gizlendi. Gerekçe: ${reason} ` +
          'Karara itiraz etmek istersen destek üzerinden başvurabilirsin.',
      ),
    };
  },

  postRestored(): NotificationCopy {
    return {
      title: title('Gönderin yeniden yayında'),
      body: body('İnceleme sonucunda gönderin üzerindeki kısıtlama kaldırıldı.'),
    };
  },

  userSuspended(until: Date, reason: string, timeZone: string): NotificationCopy {
    return {
      title: title('Hesabın geçici olarak askıya alındı'),
      body: body(
        `Hesabın ${formatDate(until, timeZone)} tarihine kadar askıda. Gerekçe: ${reason} ` +
          'Bu süre boyunca profilini görebilir ve verilerini dışa aktarabilirsin.',
      ),
    };
  },

  userReinstated(): NotificationCopy {
    return {
      title: title('Hesabının askısı kaldırıldı'),
      body: body('Hesabın yeniden tam olarak kullanılabilir durumda.'),
    };
  },

  userWarned(reason: string): NotificationCopy {
    return {
      title: title('Topluluk kuralları uyarısı aldın'),
      body: body(
        `Gerekçe: ${reason} Tekrarı halinde hesabına yaptırım uygulanabilir.`,
      ),
    };
  },
};

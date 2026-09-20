/**
 * Development seed.
 *
 * Builds a small but COMPLETE world: five users with their own habits and session
 * history, a friend graph with a request still pending, a feed with posts, likes and
 * replies, one finished duel and one still running, the badge catalogue, earned
 * badges, and an active season.
 *
 * WHY MORE THAN ONE USER. Every social screen in the app — feed, friends,
 * leaderboard, duels — renders nothing at all against a single-user database, so a
 * one-user seed makes exactly the surfaces that are hardest to get right impossible
 * to look at. The point of this script is that opening the app shows a world.
 *
 * WHAT IS NEVER HAND-WRITTEN HERE.
 *  - XP comes from `calculateSessionXp`, session by session, with the same daily-cap
 *    and streak bookkeeping the runtime write path performs.
 *  - Levels come from `levelProgress(cycleXp)`.
 *  - Badges are granted by `evaluateAchievements`, so a user holds exactly the ones
 *    their seeded history actually earns.
 *  - `likeCount` / `commentCount` are moved by `FeedService`, inside the same
 *    transactions the API uses, so the counters cannot disagree with the rows.
 *  - Duel scores are produced by `ChallengeService`, which re-derives them from
 *    XpLedger on every read — a hand-set number would be overwritten the first time
 *    the duel screen loaded.
 *  - `Friendship.pairKey` comes from `pairKeyFor`; the normalisation rule is never
 *    respelled.
 * A seed that invents its own numbers is worse than no seed: it hides precisely the
 * counter and cap bugs this data exists to expose.
 *
 * Idempotent: re-running deletes every `seed_*` account first (cascades take their
 * habits, sessions, ledger, posts, likes, friendships, duels and badges with them),
 * upserts the season by its stable code, and re-syncs the badge catalogue.
 */

import { PrismaClient } from '@prisma/client';
import {
  calculateSessionXp,
  deriveStatSheet,
  localDateKey,
  levelProgress,
  resolveStat,
  suggestClass,
  type Category,
  type Stat,
} from '@habitwar/domain';

import { FeedService } from '../src/modules/feed/service.js';
import { pairKeyFor } from '../src/modules/friends/service.js';
import { evaluateAchievements, syncAchievementCatalog } from '../src/modules/game/achievements.js';
import { ChallengeService } from '../src/modules/game/challenges.js';

const prisma = new PrismaClient();

/**
 * One frozen instant for the whole run. Every relative offset below is measured from
 * it, so "two days ago" means the same thing in the session history, the duel window
 * and the feed timestamps — a seed that read the clock repeatedly would drift across
 * a midnight boundary mid-run and produce a world that disagrees with itself.
 */
const RUN_AT = new Date();
const CLOCK = (): Date => RUN_AT;

/**
 * The real services, driven by the frozen clock. Using them rather than writing
 * their tables directly is what keeps the seeded world self-consistent: the same
 * transactions that maintain `likeCount`, `commentCount` and the duel score caches
 * at runtime maintain them here.
 */
const feed = new FeedService({ prisma, now: CLOCK });
const challenges = new ChallengeService({ prisma, now: CLOCK });

const MS_PER_DAY = 86_400_000;
const MS_PER_HOUR = 3_600_000;

/** Every seeded account shares one timezone, so local day keys line up across users. */
const TIMEZONE = 'Europe/Istanbul';

/** Accounts this script owns. Anything matching is deleted and rebuilt on every run. */
const SEED_CLERK_PREFIX = 'seed_';

/**
 * How many of the most recent days get a DAILY_DIGEST post.
 *
 * The runtime path digests EVERY completed session, so a faithful replay of three
 * weeks of history would bury the feed under sixty generated posts and leave nothing
 * else visible. Two days is enough to prove the aggregation works and to keep the
 * top of the feed readable.
 */
const DIGEST_DAYS = 2;

/**
 * The active season.
 *
 * `isActive` AND `startsAt <= now < endsAt` is what `SeasonService.findActive`
 * matches, so the window is built around RUN_AT. It starts a week back rather than
 * before all the history on purpose: sessions on either side of the boundary are
 * then scored differently, which is the only way to see that the multiplier is
 * actually being applied.
 */
const SEASON = {
  code: '2026-guz-kusatmasi',
  name: 'Güz Kuşatması',
  theme: 'Disiplin',
  description:
    'Sonbahar boyunca her seans biraz daha fazla değerli. Sezon sonunda seriyi ayakta tutanlar kazanır.',
  eventMultiplier: 1.25,
  startsAt: new Date(RUN_AT.getTime() - 7 * MS_PER_DAY),
  endsAt: new Date(RUN_AT.getTime() + 83 * MS_PER_DAY),
} as const;

interface SeedHabit {
  readonly name: string;
  readonly category: Category;
  readonly stat: Stat;
  readonly targetMinutes: number;
  readonly colorHex: string;
  /** Minutes logged per day, oldest first; 0 means the habit was skipped that day. */
  readonly dailyMinutes: readonly number[];
}

interface SeedPersona {
  readonly clerkId: string;
  /** Staff role. Omitted for ordinary accounts. */
  readonly role?: 'MODERATOR' | 'ADMIN';
  readonly username: string;
  readonly displayName: string;
  readonly email: string;
  readonly bio: string;
  /** Must equal every habit's `dailyMinutes` length — asserted before any write. */
  readonly daysOfHistory: number;
  readonly habits: readonly SeedHabit[];
}

/**
 * Five personas at deliberately different depths of history, so the friends
 * leaderboard has an order worth reading rather than five accounts on one level.
 *
 * Each history is uneven on purpose — a perfect streak, a broken one, and at least
 * one day that blows past a daily cap. Tidy seed data hides exactly the bugs the cap
 * and streak logic exist to prevent.
 */
const PERSONAS: readonly SeedPersona[] = [
  {
    clerkId: 'seed_selimcan',
    username: 'selimcan',
    displayName: 'Selimcan',
    email: 'selimcan@example.com',
    bio: 'Gerçek hayattaki seviyemi yükseltiyorum.',
    daysOfHistory: 14,
    habits: [
      {
        name: 'Kitap okuma',
        category: 'STUDY',
        stat: 'INT',
        targetMinutes: 30,
        colorHex: '#6366F1',
        dailyMinutes: [30, 45, 30, 30, 60, 30, 30, 45, 30, 30, 30, 40, 30, 35],
      },
      {
        name: 'Ağırlık antrenmanı',
        category: 'FITNESS',
        stat: 'STR',
        targetMinutes: 60,
        colorHex: '#EF4444',
        dailyMinutes: [60, 0, 60, 0, 60, 0, 0, 60, 0, 60, 0, 60, 0, 55],
      },
      {
        name: 'Meditasyon',
        category: 'MINDFULNESS',
        stat: 'WIS',
        targetMinutes: 15,
        colorHex: '#10B981',
        dailyMinutes: [15, 15, 15, 0, 0, 15, 15, 15, 15, 15, 0, 15, 15, 20],
      },
      {
        name: 'Gitar pratiği',
        category: 'SKILL',
        stat: 'DEX',
        targetMinutes: 45,
        colorHex: '#F59E0B',
        // Day 5 is a 200-minute binge: exceeds the 150-minute SKILL cap on purpose.
        dailyMinutes: [45, 45, 0, 45, 200, 45, 0, 45, 45, 0, 45, 45, 45, 50],
      },
    ],
  },
  {
    clerkId: 'seed_elifkaya',
    username: 'elifkaya',
    displayName: 'Elif Kaya',
    email: 'elif.kaya@example.com',
    bio: 'Sabah 6 kalkıyorum, kimse beni durduramıyor. Almanca B2 yolunda.',
    // The longest history in the set: she is meant to sit at the top of the board.
    daysOfHistory: 21,
    habits: [
      {
        name: 'Sabah koşusu',
        category: 'FITNESS',
        stat: 'END',
        targetMinutes: 45,
        colorHex: '#F97316',
        dailyMinutes: [
          45, 45, 0, 50, 45, 45, 0, 45, 50, 45, 0, 45, 45, 50, 45, 0, 45, 45, 45, 50, 40,
        ],
      },
      {
        name: 'Almanca çalışma',
        category: 'STUDY',
        stat: 'INT',
        targetMinutes: 60,
        colorHex: '#6366F1',
        dailyMinutes: [
          60, 60, 45, 60, 75, 60, 60, 60, 45, 60, 60, 75, 60, 60, 45, 60, 60, 60, 75, 60, 50,
        ],
      },
      {
        name: 'Nefes egzersizi',
        category: 'MINDFULNESS',
        stat: 'WIS',
        targetMinutes: 10,
        colorHex: '#10B981',
        dailyMinutes: [
          10, 10, 10, 10, 0, 10, 10, 15, 10, 10, 10, 0, 10, 10, 10, 15, 10, 10, 10, 10, 15,
        ],
      },
      {
        name: 'Dijital illüstrasyon',
        category: 'CREATIVE',
        stat: 'DEX',
        targetMinutes: 45,
        colorHex: '#A855F7',
        dailyMinutes: [0, 45, 45, 0, 45, 45, 0, 45, 0, 45, 45, 0, 45, 45, 0, 45, 45, 0, 45, 45, 60],
      },
    ],
  },
  {
    clerkId: 'seed_burakdemir',
    username: 'burakdemir',
    displayName: 'Burak Demir',
    email: 'burak.demir@example.com',
    bio: 'Akşamcı tip. Kod ve kettlebell.',
    daysOfHistory: 14,
    habits: [
      {
        name: 'Akşam yürüyüşü',
        category: 'HEALTH',
        stat: 'END',
        targetMinutes: 30,
        colorHex: '#14B8A6',
        dailyMinutes: [30, 30, 0, 30, 0, 30, 30, 0, 30, 30, 0, 30, 0, 35],
      },
      {
        name: 'Yazılım çalışması',
        category: 'STUDY',
        stat: 'INT',
        targetMinutes: 45,
        colorHex: '#6366F1',
        dailyMinutes: [45, 0, 45, 45, 0, 45, 0, 45, 45, 0, 45, 45, 0, 40],
      },
      {
        name: 'Kettlebell seti',
        category: 'FITNESS',
        stat: 'STR',
        targetMinutes: 30,
        colorHex: '#EF4444',
        dailyMinutes: [0, 30, 0, 30, 0, 0, 30, 0, 30, 0, 0, 30, 0, 25],
      },
    ],
  },
  {
    clerkId: 'seed_zeynep',
    username: 'zeynepars',
    displayName: 'Zeynep Arslan',
    email: 'zeynep.arslan@example.com',
    bio: 'Yeni başladım. Telefonu bırakıp bir şey üretmeye çalışıyorum.',
    daysOfHistory: 10,
    habits: [
      {
        name: 'Yoga',
        category: 'MINDFULNESS',
        stat: 'WIS',
        targetMinutes: 30,
        colorHex: '#10B981',
        dailyMinutes: [30, 30, 0, 30, 30, 30, 0, 30, 30, 25],
      },
      {
        name: 'Suluboya',
        category: 'CREATIVE',
        stat: 'DEX',
        targetMinutes: 45,
        colorHex: '#A855F7',
        dailyMinutes: [0, 45, 45, 0, 45, 0, 45, 45, 0, 45],
      },
      {
        name: 'Podcast kaydı',
        category: 'SOCIAL',
        stat: 'CHA',
        targetMinutes: 60,
        colorHex: '#3B82F6',
        dailyMinutes: [0, 0, 60, 0, 0, 60, 0, 0, 60, 0],
      },
    ],
  },
  {
    clerkId: 'seed_mert',
    username: 'mertaydin',
    displayName: 'Mert Aydın',
    email: 'mert.aydin@example.com',
    bio: 'Bir haftadır buradayım. Bisiklet ve kelime kartları.',
    daysOfHistory: 7,
    habits: [
      {
        name: 'Bisiklet',
        category: 'FITNESS',
        stat: 'END',
        targetMinutes: 40,
        colorHex: '#F97316',
        dailyMinutes: [40, 0, 40, 40, 0, 40, 45],
      },
      {
        name: 'İngilizce kelime',
        category: 'STUDY',
        stat: 'INT',
        targetMinutes: 20,
        colorHex: '#6366F1',
        dailyMinutes: [20, 20, 20, 0, 20, 20, 25],
      },
    ],
  },
  /**
   * The staff account. Without one, nothing can open the moderation queue, so a seed
   * that omits it leaves the entire enforcement surface untestable by hand.
   *
   * Deliberately an ordinary-looking account with habits and a level: staff are users
   * with a role, and seeding one that way is what proves the two coexist.
   */
  {
    clerkId: 'seed_moderator',
    username: 'moderator',
    displayName: 'Deniz (Moderatör)',
    email: 'moderator@example.com',
    bio: 'Topluluk kurallarını uyguluyorum.',
    role: 'MODERATOR',
    daysOfHistory: 7,
    habits: [
      {
        name: 'Günlük tutma',
        category: 'MINDFULNESS',
        stat: 'WIS',
        targetMinutes: 20,
        colorHex: '#8B5CF6',
        dailyMinutes: [20, 20, 0, 20, 25, 20, 20],
      },
    ],
  },
];

const STAT_COLUMN: Readonly<Record<Stat, keyof SeedTotals>> = {
  STR: 'strengthXp',
  END: 'enduranceXp',
  INT: 'intelligenceXp',
  WIS: 'wisdomXp',
  CHA: 'charismaXp',
  DEX: 'dexterityXp',
};

interface SeedTotals {
  strengthXp: number;
  enduranceXp: number;
  intelligenceXp: number;
  wisdomXp: number;
  charismaXp: number;
  dexterityXp: number;
}

/** What one seeded session contributes to its author's daily digest. */
interface DigestSeed {
  readonly userId: string;
  /** The author's local day, the same key `upsertDailyDigest` will derive. */
  readonly dateKey: string;
  readonly xp: number;
  readonly minutes: number;
  readonly category: Category;
  readonly at: Date;
}

/** A persona after its history has been written. `cycleXp`/`level` move again once
 *  badge rewards land, so they are not readonly. */
interface SeededUser {
  readonly id: string;
  readonly username: string;
  readonly displayName: string;
  readonly habitCount: number;
  readonly sessionCount: number;
  /** Newest COMPLETED session — the one the manual "share this session" path uses. */
  readonly latestSessionId: string;
  cycleXp: number;
  level: number;
}

async function main(): Promise<void> {
  // -------------------------------------------------------------------------
  // 1. Reset
  // -------------------------------------------------------------------------

  // Matched on the clerkId prefix rather than an exact list, so a persona removed
  // from this file in a later edit is still cleaned up instead of lingering as a
  // ghost account in every developer's database.
  const removed = await prisma.user.deleteMany({
    where: { clerkId: { startsWith: SEED_CLERK_PREFIX } },
  });
  if (removed.count > 0) console.log(`Removed ${removed.count} previous seed user(s)`);

  // -------------------------------------------------------------------------
  // 2. Season and badge catalogue
  // -------------------------------------------------------------------------

  // Upserted by `code`, the stable identity, so the row's cuid survives a re-run.
  const season = await prisma.season.upsert({
    where: { code: SEASON.code },
    create: { ...SEASON, isActive: true },
    update: { ...SEASON, isActive: true },
  });

  // `findActive` picks the newest overlapping season, so a leftover season from an
  // earlier experiment could quietly win. Retiring the others keeps "the season in
  // effect" unambiguous without deleting anyone's data.
  await prisma.season.updateMany({
    where: { code: { not: SEASON.code }, isActive: true },
    data: { isActive: false },
  });

  // Without this the Achievement table is empty, every UserAchievement foreign key
  // has nothing to point at, and `evaluateAchievements` can award nothing at all.
  const catalog = await syncAchievementCatalog(prisma);

  // -------------------------------------------------------------------------
  // 3. Users, habits, sessions
  // -------------------------------------------------------------------------

  const digestSeeds: DigestSeed[] = [];
  const users = new Map<string, SeededUser>();

  for (const persona of PERSONAS) {
    const seeded = await seedPersona(persona, digestSeeds);
    users.set(persona.username, seeded);
  }

  const selimcan = userOf(users, 'selimcan');
  const elif = userOf(users, 'elifkaya');
  const burak = userOf(users, 'burakdemir');
  const zeynep = userOf(users, 'zeynepars');
  const mert = userOf(users, 'mertaydin');

  // -------------------------------------------------------------------------
  // 4. Social graph
  // -------------------------------------------------------------------------

  // A triangle around selimcan plus a pair on the side, so no account has an empty
  // friends feed. `pairKey` is never spelled out here — `pairKeyFor` owns the rule,
  // and a second spelling would produce two rows for a pair the rest of the system
  // counts once.
  await acceptedFriendship(selimcan, elif, 12);
  await acceptedFriendship(burak, selimcan, 8);
  await acceptedFriendship(elif, burak, 5);
  await acceptedFriendship(zeynep, mert, 4);

  // Both pending directions are represented: without an INCOMING request the
  // requests screen renders its empty state and the accept/decline path cannot be
  // exercised at all.
  await pendingFriendship(zeynep, selimcan, 1);
  await pendingFriendship(selimcan, mert, 0.25);

  // Follows are what the "Keşfet" feed reads, and they are deliberately not a
  // by-product of friendship — without a few, that tab shows only your own posts.
  await follow(selimcan, zeynep);
  await follow(selimcan, mert);
  await follow(elif, zeynep);
  await follow(zeynep, selimcan);
  await follow(zeynep, elif);
  await follow(mert, selimcan);
  await follow(burak, mert);

  // -------------------------------------------------------------------------
  // 5. Duels
  // -------------------------------------------------------------------------

  // One finished duel, so the past list and the "first duel win" badge are both
  // reachable. Scores come from `scoreFor` — the same ledger aggregation the service
  // settles with — so the stored result is one the app would have computed itself.
  const pastStartsAt = daysAgo(10);
  const pastEndsAt = daysAgo(5);
  const pastChallengerXp = await challenges.scoreFor(selimcan.id, 'FITNESS', pastStartsAt, pastEndsAt);
  const pastOpponentXp = await challenges.scoreFor(burak.id, 'FITNESS', pastStartsAt, pastEndsAt);
  await prisma.challenge.create({
    data: {
      challengerId: selimcan.id,
      opponentId: burak.id,
      category: 'FITNESS',
      status: 'COMPLETED',
      startsAt: pastStartsAt,
      endsAt: pastEndsAt,
      challengerXp: pastChallengerXp,
      opponentXp: pastOpponentXp,
      // A draw leaves winnerId null; `status` is the authority on "did this finish".
      winnerId:
        pastChallengerXp > pastOpponentXp
          ? selimcan.id
          : pastOpponentXp > pastChallengerXp
            ? burak.id
            : null,
      settledAt: pastEndsAt,
      createdAt: daysAgo(11),
    },
  });

  // One running duel, three days left. STUDY because both sides study daily, so the
  // progress bars are non-empty on both ends the moment the screen opens.
  const liveDuel = await prisma.challenge.create({
    data: {
      challengerId: selimcan.id,
      opponentId: elif.id,
      category: 'STUDY',
      status: 'ACTIVE',
      startsAt: daysAgo(2),
      endsAt: daysAhead(3),
      createdAt: daysAgo(2.05),
    },
  });
  // The duel screen re-scores ACTIVE duels from XpLedger on every read, so the cached
  // totals are filled by the service itself. Writing numbers by hand here would look
  // right until the first GET overwrote them.
  const liveScores = await challenges.refreshScores(liveDuel);

  // -------------------------------------------------------------------------
  // 6. Badges
  // -------------------------------------------------------------------------

  // Run after the friendships and the settled duel exist: `first_friend` and
  // `first_duel_win` are measured against those tables, so an earlier pass would
  // silently under-award.
  let unlockedTotal = 0;
  for (const user of users.values()) {
    const result = await evaluateAchievements(prisma, user.id, RUN_AT);
    unlockedTotal += result.unlocked.length;

    // Badge rewards go through XpLedger and cycleXp but deliberately leave
    // `User.level` alone (see `grantAchievement`). That column is a sort cache, and
    // a seed that left it stale would show a level in the friends list that
    // disagrees with the one on the profile screen.
    const fresh = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { cycleXp: true },
    });
    const progress = levelProgress(fresh.cycleXp);
    await prisma.user.update({ where: { id: user.id }, data: { level: progress.level } });
    user.cycleXp = fresh.cycleXp;
    user.level = progress.level;
  }

  // -------------------------------------------------------------------------
  // 7. Feed
  // -------------------------------------------------------------------------

  // DAILY_DIGEST is the DEFAULT automatic post, so it is produced the way the runtime
  // path produces it: one `upsertDailyDigest` call per completed session, merged by
  // the unique (authorId, digestDate) into a single row per author per local day.
  for (const seed of digestSeeds) {
    await feed.upsertDailyDigest({
      userId: seed.userId,
      sessions: 1,
      xp: seed.xp,
      minutes: seed.minutes,
      category: seed.category,
      at: seed.at,
    });
  }
  await stampDigests(digestSeeds);

  // Hand-written posts, spread over the last few days so the feed reads
  // chronologically instead of arriving as one block at the top.
  const elifStreakPost = await textPost(
    elif,
    '21 gündür sabah koşusunu kaçırmadım. En zoru ilk haftaydı, gerisi kendiliğinden geliyor.',
    62,
  );
  const burakPost = await textPost(
    burak,
    "Yazılım çalışmasını akşam 21:00'e sabitledim. Takvime yazınca bahane üretmek zorlaşıyor.",
    40,
  );
  const selimcanLevelPost = await levelUpPost(
    selimcan,
    `Seviye ${selimcan.level}! Gitar pratiği bu hafta gerçekten işe yaradı.`,
    30,
  );
  const elifLevelPost = await levelUpPost(
    elif,
    `Seviye ${elif.level}. Almanca seansları olmasa bunun yarısındaydım.`,
    20,
  );
  const zeynepPost = await textPost(
    zeynep,
    'İlk suluboya denememi bitirdim. Sonuç felaket ama 45 dakika boyunca telefona bakmadım.',
    8,
  );
  const selimcanTauntPost = await textPost(
    selimcan,
    'Düello başladı Elif. Almanca çalışmana güveniyorsan görüşürüz.',
    5,
  );

  // The manual "share this session" path — deliberately a different function from the
  // digest, because the aggregate is the default and the single post is a choice.
  const sharedSessionPost = await feed.publishSessionPost({
    userId: selimcan.id,
    sessionId: selimcan.latestSessionId,
    content: 'Bugünün kitap seansı tamam. Hiç bölünmeden.',
  });

  // Likes go through the service so the PostLike row and the `likeCount` increment
  // move in one transaction. Seeding a counter by hand is how a counter bug survives
  // a whole release: the data already agrees with itself, whatever the code does.
  await like(elifStreakPost.id, [selimcan, burak, zeynep]);
  await like(burakPost.id, [selimcan, elif]);
  await like(selimcanLevelPost.id, [elif, burak, zeynep, mert]);
  await like(elifLevelPost.id, [selimcan, burak]);
  await like(zeynepPost.id, [elif]);
  await like(selimcanTauntPost.id, [elif]);
  await like(sharedSessionPost.id, [elif, zeynep]);

  // A generated post must be likeable too, or the digest path ships untested.
  const selimcanDigest = await latestDigestPost(selimcan.id);
  if (selimcanDigest) await like(selimcanDigest.id, [elif, burak]);

  // Replies are Posts with `parentId` set, and `createReply` moves the parent's
  // `commentCount` in the same transaction.
  await reply(elif, selimcanLevelPost.id, 'Tebrikler! Bir sonraki seviyede görüşürüz.');
  await reply(burak, selimcanLevelPost.id, "Helal olsun. Ben hâlâ 9'u bekliyorum.");
  await reply(selimcan, elifStreakPost.id, 'İlk hafta gerçekten en zoru. 21 gün ciddi iş.');

  // -------------------------------------------------------------------------
  // 8. Summary
  // -------------------------------------------------------------------------

  await report({ season: season.name, catalog, unlockedTotal, liveScores, users });
}

// ---------------------------------------------------------------------------
// Users, habits and sessions
// ---------------------------------------------------------------------------

/**
 * Writes one persona's account, habits and full session history.
 *
 * The per-day loop mirrors the session service: it tracks minutes already spent per
 * category and in total so `calculateSessionXp` applies the daily caps exactly as it
 * would at runtime, and it writes the same three rows every real completion writes —
 * Session, XpLedger and DailyUsage.
 */
async function seedPersona(persona: SeedPersona, digestSeeds: DigestSeed[]): Promise<SeededUser> {
  for (const habit of persona.habits) {
    // Fails loudly rather than scoring a silent zero: a `dailyMinutes` array that has
    // drifted out of step with `daysOfHistory` would just quietly drop days.
    if (habit.dailyMinutes.length !== persona.daysOfHistory) {
      throw new Error(
        `${persona.username} / ${habit.name}: dailyMinutes has ${habit.dailyMinutes.length} entries, expected ${persona.daysOfHistory}`,
      );
    }
  }

  const user = await prisma.user.create({
    data: {
      id: seedUserId(persona.username),
      clerkId: persona.clerkId,
      username: persona.username,
      displayName: persona.displayName,
      email: persona.email,
      bio: persona.bio,
      timezone: TIMEZONE,
      ...(persona.role ? { role: persona.role } : {}),
    },
  });

  const habits = await Promise.all(
    persona.habits.map((habit) =>
      prisma.habit.create({
        data: {
          userId: user.id,
          name: habit.name,
          category: habit.category,
          stat: habit.stat,
          targetMinutes: habit.targetMinutes,
          colorHex: habit.colorHex,
        },
      }),
    ),
  );

  const totals: SeedTotals = {
    strengthXp: 0,
    enduranceXp: 0,
    intelligenceXp: 0,
    wisdomXp: 0,
    charismaXp: 0,
    dexterityXp: 0,
  };
  // Longest streak is tracked here rather than read back off the habit row: the row
  // in hand is the one created above, so `Math.max(streak, habit.longestStreak)`
  // against it would compare every run against zero and leave the LAST streak in the
  // column instead of the longest one.
  const longestStreaks = habits.map(() => 0);
  let cycleXp = 0;
  let sessionCount = 0;
  let latestSessionId = '';

  for (let dayOffset = persona.daysOfHistory - 1; dayOffset >= 0; dayOffset--) {
    const day = new Date(RUN_AT.getTime() - dayOffset * MS_PER_DAY);
    const dateKey = localDateKey(day, TIMEZONE);
    const dayIndex = persona.daysOfHistory - 1 - dayOffset;

    // Per-day, per-category minute tallies drive the daily cap the same way the
    // service does at runtime.
    const minutesByCategory = new Map<Category, number>();
    let minutesTotal = 0;

    for (const [index, seedHabit] of persona.habits.entries()) {
      const minutes = seedHabit.dailyMinutes[dayIndex] ?? 0;
      if (minutes === 0) continue;

      const habit = habits[index];
      if (!habit) continue;

      const category = seedHabit.category;
      const stat = resolveStat(category, seedHabit.stat);
      const streakDays = countStreak(seedHabit.dailyMinutes, dayIndex);
      const interruptions = dayIndex % 4 === 0 ? 2 : 0;

      // 19:00 local-ish start, staggered per habit so sessions never overlap.
      const startedAt = new Date(day);
      startedAt.setHours(19 + index, 0, 0, 0);
      const endedAt = new Date(startedAt.getTime() + minutes * 60_000);

      const result = calculateSessionXp({
        durationSec: minutes * 60,
        category,
        stat,
        verification: 'TIMER_ONLY',
        streakDays,
        interruptions,
        characterClass: null,
        prestige: 0,
        // The season multiplier is server-owned and resolved per session, which is
        // why it is read from the window rather than pinned at 1: history that
        // straddles a season boundary must be scored on both sides of it.
        eventMultiplier: eventMultiplierAt(startedAt),
        minutesTodayInCategory: minutesByCategory.get(category) ?? 0,
        minutesTodayTotal: minutesTotal,
      });

      const session = await prisma.session.create({
        data: {
          userId: user.id,
          habitId: habit.id,
          clientRequestId: `seed-${dateKey}-${habit.id}`,
          startedAt,
          endedAt,
          durationSec: minutes * 60,
          status: 'COMPLETED',
          interruptions,
          xpAwarded: result.xp,
          statXp: result.statXp,
          multiplierData: result.breakdown as unknown as object,
          verification: 'TIMER_ONLY',
        },
      });
      latestSessionId = session.id;

      await prisma.xpLedger.create({
        data: {
          userId: user.id,
          amount: result.xp,
          reason: 'SESSION_AWARD',
          // Linking the award to its session is not cosmetic: duel scoring aggregates
          // XpLedger through `session.habit.category`, so an unlinked SESSION_AWARD
          // row scores zero and every seeded duel would read 0-0.
          sessionId: session.id,
          note: `${seedHabit.name} · ${result.breakdown.fullRateMinutes} min`,
          createdAt: endedAt,
        },
      });

      await prisma.dailyUsage.upsert({
        where: { userId_dateKey_category: { userId: user.id, dateKey, category } },
        create: {
          userId: user.id,
          dateKey,
          category,
          fullRateMinutes: result.breakdown.fullRateMinutes,
          overCapMinutes: result.breakdown.overCapMinutes,
        },
        update: {
          fullRateMinutes: { increment: result.breakdown.fullRateMinutes },
          overCapMinutes: { increment: result.breakdown.overCapMinutes },
        },
      });

      minutesByCategory.set(
        category,
        (minutesByCategory.get(category) ?? 0) + result.breakdown.fullRateMinutes,
      );
      minutesTotal += result.breakdown.fullRateMinutes;

      cycleXp += result.xp;
      totals[STAT_COLUMN[stat]] += result.statXp;
      sessionCount++;

      const streakAfter = streakDays + 1;
      longestStreaks[index] = Math.max(longestStreaks[index] ?? 0, streakAfter);
      await prisma.habit.update({
        where: { id: habit.id },
        data: {
          currentStreak: streakAfter,
          longestStreak: longestStreaks[index] ?? streakAfter,
          lastCompletedDate: dateKey,
        },
      });

      if (dayOffset < DIGEST_DAYS) {
        digestSeeds.push({
          userId: user.id,
          dateKey,
          xp: result.xp,
          minutes,
          category,
          at: endedAt,
        });
      }
    }
  }

  const progress = levelProgress(cycleXp);
  const statSheet = deriveStatSheet({
    STR: totals.strengthXp,
    END: totals.enduranceXp,
    INT: totals.intelligenceXp,
    WIS: totals.wisdomXp,
    CHA: totals.charismaXp,
    DEX: totals.dexterityXp,
  });

  await prisma.user.update({
    where: { id: user.id },
    data: {
      ...totals,
      cycleXp,
      lifetimeXp: BigInt(cycleXp),
      level: progress.level,
      classType: suggestClass(statSheet, progress.level),
    },
  });

  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    habitCount: habits.length,
    sessionCount,
    latestSessionId,
    cycleXp,
    level: progress.level,
  };
}

// ---------------------------------------------------------------------------
// Social graph helpers
// ---------------------------------------------------------------------------

async function acceptedFriendship(
  requester: SeededUser,
  addressee: SeededUser,
  daysSince: number,
): Promise<void> {
  const at = daysAgo(daysSince);
  await prisma.friendship.create({
    data: {
      requesterId: requester.id,
      addresseeId: addressee.id,
      pairKey: pairKeyFor(requester.id, addressee.id),
      status: 'ACCEPTED',
      acceptedAt: at,
      createdAt: at,
    },
  });
}

async function pendingFriendship(
  requester: SeededUser,
  addressee: SeededUser,
  daysSince: number,
): Promise<void> {
  await prisma.friendship.create({
    data: {
      requesterId: requester.id,
      addresseeId: addressee.id,
      pairKey: pairKeyFor(requester.id, addressee.id),
      status: 'PENDING',
      createdAt: daysAgo(daysSince),
    },
  });
}

async function follow(follower: SeededUser, following: SeededUser): Promise<void> {
  await prisma.follow.create({
    data: { followerId: follower.id, followingId: following.id },
  });
}

// ---------------------------------------------------------------------------
// Feed helpers
// ---------------------------------------------------------------------------

/**
 * Posts are written directly rather than through `createPost` for one reason only:
 * the service stamps `createdAt` with the clock, and a feed whose every row landed in
 * the same second cannot demonstrate ordering or cursor pagination. Everything the
 * service owns — counters, visibility — is still left to the service.
 */
async function textPost(author: SeededUser, content: string, hoursAgo: number) {
  return prisma.post.create({
    data: { authorId: author.id, type: 'TEXT', content, createdAt: hoursBack(hoursAgo) },
  });
}

async function levelUpPost(author: SeededUser, content: string, hoursAgo: number) {
  return prisma.post.create({
    data: { authorId: author.id, type: 'LEVEL_UP', content, createdAt: hoursBack(hoursAgo) },
  });
}

async function like(postId: string, likers: readonly SeededUser[]): Promise<void> {
  for (const liker of likers) {
    await feed.like(liker.id, postId);
  }
}

async function reply(author: SeededUser, parentId: string, content: string): Promise<void> {
  await feed.createReply({ userId: author.id, parentId, content });
}

/** The author's newest DAILY_DIGEST row, if the history reached far enough to make one. */
async function latestDigestPost(authorId: string) {
  return prisma.post.findFirst({
    where: { authorId, type: 'DAILY_DIGEST' },
    orderBy: { digestDate: 'desc' },
    select: { id: true },
  });
}

/**
 * Backdates each digest post to the last session it summarises.
 *
 * At runtime the upsert happens as the day is lived, so the post's timestamp and the
 * day it describes agree. Replaying history in one pass breaks that: without this,
 * yesterday's digest would carry today's timestamp and sit above posts written after
 * it. Clamped to RUN_AT so nothing is stamped in the future.
 */
async function stampDigests(seeds: readonly DigestSeed[]): Promise<void> {
  const latest = new Map<string, { authorId: string; digestDate: string; at: Date }>();

  for (const seed of seeds) {
    const at = seed.at.getTime() > RUN_AT.getTime() ? RUN_AT : seed.at;
    const key = `${seed.userId}\u0000${seed.dateKey}`;
    const current = latest.get(key);
    if (!current || at.getTime() > current.at.getTime()) {
      latest.set(key, { authorId: seed.userId, digestDate: seed.dateKey, at });
    }
  }

  for (const entry of latest.values()) {
    await prisma.post.update({
      where: {
        authorId_digestDate: { authorId: entry.authorId, digestDate: entry.digestDate },
      },
      data: { createdAt: entry.at },
    });
  }
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/**
 * A stable id for a seeded account, derived from its username.
 *
 * Prisma would mint a fresh cuid on every run, so each re-seed invalidates whatever
 * id the developer pasted into `apps/mobile/app.json` (`extra.devUserId`) or into a
 * REST client — which makes an "idempotent" seed feel anything but. Pinning the ids
 * means the world is rebuilt while the handles into it stay put.
 *
 * Shaped like a cuid (leading `c`, 25 characters, no separators) so it still
 * satisfies anything that validates an id by format. Only USER ids are pinned;
 * habits, sessions, posts and duels keep real generated cuids, because those ids are
 * the ones the API validates and hands out.
 */
function seedUserId(username: string): string {
  const body = `seed${username}`.replace(/[^a-z0-9]/g, '');
  return `c${body}`.padEnd(25, '0').slice(0, 25);
}

/** Consecutive non-zero days immediately before `dayIndex`. */
function countStreak(dailyMinutes: readonly number[], dayIndex: number): number {
  let streak = 0;
  for (let i = dayIndex - 1; i >= 0; i--) {
    if ((dailyMinutes[i] ?? 0) === 0) break;
    streak++;
  }
  return streak;
}

/** The season multiplier in force at `at`, matching `isActive AND startsAt <= at < endsAt`. */
function eventMultiplierAt(at: Date): number {
  return at >= SEASON.startsAt && at < SEASON.endsAt ? SEASON.eventMultiplier : 1;
}

function daysAgo(days: number): Date {
  return new Date(RUN_AT.getTime() - days * MS_PER_DAY);
}

function daysAhead(days: number): Date {
  return new Date(RUN_AT.getTime() + days * MS_PER_DAY);
}

function hoursBack(hours: number): Date {
  return new Date(RUN_AT.getTime() - hours * MS_PER_HOUR);
}

/** Looks a persona up by username, failing loudly if a rename left a reference behind. */
function userOf(users: ReadonlyMap<string, SeededUser>, username: string): SeededUser {
  const user = users.get(username);
  if (!user) throw new Error(`Seed persona "${username}" was not created`);
  return user;
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

interface ReportInput {
  readonly season: string;
  readonly catalog: { readonly synced: number; readonly retired: number };
  readonly unlockedTotal: number;
  readonly liveScores: { readonly challengerXp: number; readonly opponentXp: number };
  readonly users: ReadonlyMap<string, SeededUser>;
}

/**
 * Prints what was built, counted from the database rather than from local tallies —
 * a summary that reports its own intentions would still look right if a write failed.
 */
async function report(input: ReportInput): Promise<void> {
  const ids = [...input.users.values()].map((user) => user.id);

  const [topLevelPosts, replies, likes, friendships, pending, duels, badges] = await Promise.all([
    prisma.post.count({ where: { authorId: { in: ids }, parentId: null } }),
    prisma.post.count({ where: { authorId: { in: ids }, parentId: { not: null } } }),
    prisma.postLike.count({ where: { userId: { in: ids } } }),
    prisma.friendship.count({ where: { status: 'ACCEPTED', requesterId: { in: ids } } }),
    prisma.friendship.count({ where: { status: 'PENDING', requesterId: { in: ids } } }),
    prisma.challenge.count({ where: { challengerId: { in: ids } } }),
    prisma.userAchievement.count({ where: { userId: { in: ids } } }),
  ]);

  const lines = [
    `Season: ${input.season} (x${SEASON.eventMultiplier})`,
    `Badge catalogue: ${input.catalog.synced} synced, ${input.catalog.retired} retired`,
    '',
    'Users (x-dev-user-id header value on the right):',
  ];

  for (const user of input.users.values()) {
    lines.push(
      `  ${user.displayName.padEnd(14)} @${user.username.padEnd(12)} ` +
        `lvl ${String(user.level).padStart(2)}  ${String(user.cycleXp).padStart(5)} XP  ` +
        `${user.habitCount} habits  ${String(user.sessionCount).padStart(3)} sessions  ${user.id}`,
    );
  }

  lines.push(
    '',
    `Feed: ${topLevelPosts} posts, ${replies} replies, ${likes} likes`,
    `Friends: ${friendships} accepted, ${pending} pending`,
    `Duels: ${duels} (live score ${input.liveScores.challengerXp}-${input.liveScores.opponentXp})`,
    `Badges unlocked: ${input.unlockedTotal} (${badges} rows held)`,
  );

  console.log(lines.join('\n'));
}

main()
  .catch((error: unknown) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });

/**
 * Development seed.
 *
 * Two accounts:
 *  - `selimcan` — three weeks of reading: one finished book, one in progress, one
 *    not started, with a forgiven single missed day and an earlier break.
 *  - `yeni` — a brand-new account that has not been through onboarding, for working
 *    on the first-run flow.
 *
 * NOTHING NUMERIC IS HAND-WRITTEN. Every page is logged through ReadingService, the
 * same code the API runs, with a clock set to the day being replayed. XP, levels,
 * streaks, goal bonuses and finished books therefore come out exactly as they would
 * at runtime — a seed that invents its own numbers hides the bugs it exists to show.
 *
 * Idempotent: re-running deletes every seed account first; cascades take their
 * books, logs and ledger with them. User ids are fixed so the dev client
 * (apps/mobile/app.json `devUserId`) and the tests address the same rows.
 */

import { randomUUID } from 'node:crypto';

import { PrismaClient } from '@prisma/client';

import { hashPassword } from '../src/modules/auth/password.js';
import { ReadingService } from '../src/modules/reading/service.js';

if (process.env['NODE_ENV'] === 'production') {
  throw new Error('Refusing to seed a production database');
}

const prisma = new PrismaClient();

/** One frozen instant for the whole run; every "N days ago" is measured from it. */
const RUN_AT = new Date();
const MS_PER_DAY = 86_400_000;
const TIMEZONE = 'Europe/Istanbul';

/** Shared by every seed account so the sign-in screen can be worked on. */
const SEED_PASSWORD = 'habitwar123';

/** Anything with this id prefix is deleted and rebuilt on every run. */
const SEED_ID_PREFIX = 'cseed';

function seedUserId(username: string): string {
  return `c${`seed${username}`.replace(/[^a-z0-9]/g, '')}`.padEnd(25, '0').slice(0, 25);
}

function daysAgo(days: number): Date {
  return new Date(RUN_AT.getTime() - days * MS_PER_DAY);
}

interface SeedBook {
  readonly title: string;
  readonly author: string;
  readonly pageCount: number;
  readonly coverUrl: string;
  /** When it was added to the shelf. */
  readonly addedDaysAgo: number;
}

/** Read in order: pages roll over into the next book once one is finished. */
const BOOKS: readonly SeedBook[] = [
  {
    title: 'Simyacı',
    author: 'Paulo Coelho',
    pageCount: 188,
    coverUrl: 'https://covers.openlibrary.org/b/id/12296155-M.jpg',
    addedDaysAgo: 21,
  },
  {
    title: 'Suç ve Ceza',
    author: 'Fyodor Dostoyevski',
    pageCount: 687,
    coverUrl: 'https://covers.openlibrary.org/b/id/10736127-M.jpg',
    addedDaysAgo: 10,
  },
  {
    title: 'Küçük Prens',
    author: 'Antoine de Saint-Exupéry',
    pageCount: 96,
    coverUrl: 'https://covers.openlibrary.org/b/id/12219639-M.jpg',
    addedDaysAgo: 3,
  },
];

/** Notes the reader wrote, by index into DAILY_PAGES. */
const DAILY_NOTES: Readonly<Record<number, string>> = {
  0: 'Santiago rüyasının peşine düşüyor. Başlangıç sade ama sarıcı.',
  6: '"Bir şeyi gerçekten istediğinde bütün evren onu gerçekleştirmek için işbirliği yapar."',
  11: 'Simyacıyla karşılaşma sahnesi kitabın en güzel yeri.',
  17: "Raskolnikov'un iç sesi yorucu ama bırakamıyorum.",
  20: "Marmeladov'un meyhanedeki konuşması çok etkileyici.",
};

/**
 * Pages read per day, oldest first, ending today. Zeros are missed days: the pair
 * early on breaks the streak, the single one later is forgiven. Today stops short of
 * the goal so the main screen has something left to do.
 */
const DAILY_PAGES: readonly number[] = [
  12, 10, 15, 0, 0, 10, 22, 10, 11, 18, 10, 12, 0, 14, 10, 25, 10, 16, 10, 12, 20, 4,
];

async function main(): Promise<void> {
  const passwordHash = await hashPassword(SEED_PASSWORD);

  const removed = await prisma.user.deleteMany({ where: { id: { startsWith: SEED_ID_PREFIX } } });
  if (removed.count > 0) console.log(`Removed ${removed.count} previous seed user(s)`);

  // --- selimcan --------------------------------------------------------------
  const startedDaysAgo = DAILY_PAGES.length - 1;
  const reader = await prisma.user.create({
    data: {
      id: seedUserId('selimcan'),
      username: 'selimcan',
      displayName: 'Selimcan',
      email: 'selimcan@example.com',
      passwordHash,
      emailVerifiedAt: daysAgo(startedDaysAgo),
      timezone: TIMEZONE,
      locale: 'TR',
      dailyGoal: 10,
      goalSetAt: daysAgo(startedDaysAgo),
      reminderTime: '21:00',
      yearlyBookGoal: 12,
      onboardedAt: daysAgo(startedDaysAgo),
      createdAt: daysAgo(startedDaysAgo),
    },
  });

  const books = [];
  for (const book of BOOKS) {
    books.push(
      await prisma.book.create({
        data: {
          userId: reader.id,
          title: book.title,
          author: book.author,
          pageCount: book.pageCount,
          coverUrl: book.coverUrl,
          createdAt: daysAgo(book.addedDaysAgo),
        },
      }),
    );
  }

  let bookIndex = 0;
  let logs = 0;
  for (const [index, pagesForDay] of DAILY_PAGES.entries()) {
    const day = startedDaysAgo - index;
    const reading = new ReadingService({ prisma, now: () => daysAgo(day) });
    let remaining = pagesForDay;
    let note: string | null = DAILY_NOTES[index] ?? null;
    while (remaining > 0 && bookIndex < books.length) {
      const book = books[bookIndex];
      if (!book) break;
      const result = await reading.logPages({
        userId: reader.id,
        bookId: book.id,
        pages: remaining,
        clientRequestId: randomUUID(),
        note,
      });
      note = null;
      logs += 1;
      remaining -= result.pages;
      if (result.book.progress.defeated) bookIndex += 1;
    }
  }

  // The verdict on the finished book, as the reader would write it on its card.
  const [finished] = books;
  if (finished) {
    await prisma.book.update({
      where: { id: finished.id },
      data: {
        rating: 5,
        review: 'Kısa, sade ve insanın içini açan bir kitap.',
        takeaways: [
          'Bir şeyi gerçekten istediğinde yola çıkmak gerekir.',
          'Yolculuğun kendisi de hazinenin bir parçası.',
          'İşaretleri okumayı öğren.',
        ],
      },
    });
  }

  const seeded = await prisma.user.findUniqueOrThrow({ where: { id: reader.id } });
  console.log(
    `Seeded ${seeded.username}: ${logs} logs, ${seeded.xp} XP, level ${seeded.level}, ` +
      `streak ${seeded.currentStreak} (longest ${seeded.longestStreak})`,
  );

  // --- yeni --------------------------------------------------------------------
  const fresh = await prisma.user.create({
    data: {
      id: seedUserId('yeni'),
      username: 'yeni',
      displayName: 'Yeni Okur',
      email: 'yeni@example.com',
      passwordHash,
      emailVerifiedAt: RUN_AT,
      timezone: TIMEZONE,
    },
  });
  console.log(`Seeded ${fresh.username}: not onboarded`);

  console.log(`\nSign in with any seed email and the password "${SEED_PASSWORD}".`);
  console.log(`Dev auth header: x-dev-user-id: ${reader.id}`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

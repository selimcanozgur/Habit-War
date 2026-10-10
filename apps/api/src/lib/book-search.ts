/**
 * Book search, for adding a book by name instead of typing its page count.
 *
 * Two providers, tried in order: Google Books, whose catalogue covers Turkish
 * editions best, then Open Library when Google fails or finds nothing. Neither needs
 * a key at low volume (GOOGLE_BOOKS_API_KEY raises Google's quota). The call goes
 * through the server so the app never depends on a third party's shape.
 *
 * Best-effort: when both fail, search returns nothing and the reader types the book
 * in by hand, exactly as before search existed.
 */

export interface BookSearchResult {
  readonly title: string;
  readonly author: string | null;
  readonly pageCount: number | null;
  readonly coverUrl: string | null;
}

export type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<{
  ok: boolean;
  json(): Promise<unknown>;
}>;

export interface BookSearchOptions {
  readonly fetchFn?: FetchLike;
  readonly apiKey?: string | undefined;
  readonly limit?: number;
}

const TIMEOUT_MS = 5000;

async function getJson(fetchFn: FetchLike, url: string): Promise<unknown> {
  const response = await fetchFn(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) throw new Error(`book search provider answered with an error: ${url.split('?')[0]}`);
  return response.json();
}

const positivePages = (value: unknown): number | null =>
  Number.isInteger(value) && (value as number) > 0 ? (value as number) : null;

// --- Google Books --------------------------------------------------------------

interface GoogleVolume {
  volumeInfo?: {
    title?: string;
    subtitle?: string;
    authors?: string[];
    pageCount?: number;
    imageLinks?: { thumbnail?: string; smallThumbnail?: string };
  };
}

async function searchGoogle(query: string, fetchFn: FetchLike, limit: number, apiKey?: string) {
  const params = new URLSearchParams({ q: query, maxResults: String(limit), printType: 'books' });
  if (apiKey) params.set('key', apiKey);
  const body = (await getJson(fetchFn, `https://www.googleapis.com/books/v1/volumes?${params}`)) as {
    items?: GoogleVolume[];
  };
  return (body.items ?? []).flatMap((item): BookSearchResult[] => {
    const info = item.volumeInfo;
    const title = info?.title?.trim();
    if (!info || !title) return [];
    const cover = info.imageLinks?.thumbnail ?? info.imageLinks?.smallThumbnail ?? null;
    return [
      {
        title: info.subtitle ? `${title}: ${info.subtitle}` : title,
        author: info.authors?.filter(Boolean).join(', ') || null,
        pageCount: positivePages(info.pageCount),
        // Google hands out http:// links, which iOS refuses to load.
        coverUrl: cover ? cover.replace(/^http:\/\//, 'https://') : null,
      },
    ];
  });
}

// --- Open Library --------------------------------------------------------------

interface OpenLibraryDoc {
  title?: string;
  author_name?: string[];
  number_of_pages_median?: number;
  cover_i?: number;
}

async function searchOpenLibrary(query: string, fetchFn: FetchLike, limit: number) {
  const params = new URLSearchParams({
    q: query,
    limit: String(limit),
    fields: 'title,author_name,number_of_pages_median,cover_i',
  });
  const body = (await getJson(fetchFn, `https://openlibrary.org/search.json?${params}`)) as {
    docs?: OpenLibraryDoc[];
  };
  return (body.docs ?? []).flatMap((doc): BookSearchResult[] => {
    const title = doc.title?.trim();
    if (!title) return [];
    return [
      {
        title,
        author: doc.author_name?.filter(Boolean).join(', ') || null,
        pageCount: positivePages(doc.number_of_pages_median),
        coverUrl: doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg` : null,
      },
    ];
  });
}

// --- Search ----------------------------------------------------------------------

/** The same book in several editions is one choice to the reader. */
function dedupe(results: readonly BookSearchResult[]): BookSearchResult[] {
  const seen = new Set<string>();
  return results.filter((result) => {
    const key = `${result.title.toLowerCase()}|${(result.author ?? '').toLowerCase()}|${result.pageCount ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Searches Google Books, falling back to Open Library. Throws only when every
 * provider failed, so the route can tell "nothing found" from "search is down".
 */
export async function searchBooks(query: string, options: BookSearchOptions = {}): Promise<BookSearchResult[]> {
  const fetchFn = options.fetchFn ?? (fetch as unknown as FetchLike);
  const limit = options.limit ?? 10;
  const providers = [
    () => searchGoogle(query, fetchFn, limit, options.apiKey),
    () => searchOpenLibrary(query, fetchFn, limit),
  ];

  let lastError: unknown = null;
  for (const provider of providers) {
    try {
      const results = dedupe(await provider());
      if (results.length > 0) return results;
    } catch (error) {
      lastError = error;
    }
  }
  // Nothing found anywhere. If a provider actually failed, say so.
  if (lastError) throw lastError;
  return [];
}

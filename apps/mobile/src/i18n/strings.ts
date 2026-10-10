/**
 * Every user-facing string, in both languages.
 *
 * `en` is typed as `Strings`, the shape of `tr`, so a string added to one language
 * and forgotten in the other is a compile error rather than a blank label on a
 * phone. Strings that carry a number are functions, so word order and plurals stay
 * each language's own business.
 */

const tr = {
  common: {
    save: 'Kaydet',
    cancel: 'Vazgeç',
    delete: 'Sil',
    back: 'Geri',
    continue: 'Devam',
    retry: 'Tekrar dene',
    pages: (count: number) => `${count} sayfa`,
    loadError: 'Yüklenemedi.',
    networkError: 'Bağlantı hatası. İnternet bağlantını kontrol et.',
    genericError: 'Bir şeyler ters gitti. Tekrar dene.',
  },

  tabs: {
    today: 'Bugün',
    shelf: 'Raf',
    profile: 'Profil',
  },

  today: {
    title: 'Bugün',
    greeting: (name: string) => `Merhaba, ${name}`,
    goalOverline: 'GÜNLÜK HEDEF',
    goalProgress: (read: number, goal: number) => `${read} / ${goal} sayfa`,
    goalDone: 'Bugünün hedefi tamam!',
    goalLeft: (left: number) => `Hedefe ${left} sayfa kaldı`,
    streak: 'Seri',
    streakDays: (days: number) => `${days} gün`,
    consistency: (window: number) => `Son ${window} gün`,
    consistencyValue: (days: number, window: number) => `${days}/${window}`,
    booksOverline: 'OKUDUĞUN KİTAPLAR',
    emptyTitle: 'Henüz kitap yok',
    emptyBody: 'Okuduğun kitabı ekle. Okuduğun her sayfa onu biraz daha yenecek.',
    addBook: 'Kitap ekle',
    suggestionTitle: 'Hedefin biraz büyük olabilir',
    suggestionBody: (goal: number) =>
      `Geçen hafta hedefini çoğu gün tutturamadın. Bu senin değil, hedefin suçu. ` +
      `Günde ${goal} sayfayla devam etmeye ne dersin? Her gün biraz okumak, ara sıra çok okumaktan güçlüdür.`,
    suggestionAccept: (goal: number) => `Hedefi ${goal} sayfa yap`,
    suggestionDismiss: 'Şimdilik kalsın',
  },

  book: {
    hpLeft: (hp: number) => `${hp} sayfa kaldı`,
    progress: (read: number, total: number) => `${read} / ${total}`,
    logPages: 'Sayfa gir',
    defeated: 'Yenildi',
    finishedOn: (date: string) => `${date} tarihinde bitti`,
  },

  log: {
    title: 'Kaç sayfa okudun?',
    pagesLabel: 'Sayfa',
    invalid: 'En az 1 sayfa gir.',
    save: 'Kaydet',
    finishedConflict: 'Bu kitap zaten bitmiş.',
  },

  reward: {
    xp: (xp: number) => `+${xp} XP`,
    goalReached: (bonus: number) => `Günlük hedef tamam! +${bonus} XP bonus`,
    bookDefeated: (title: string) => `${title} yenildi! Kupa rafına eklendi.`,
    levelUp: (level: number) => `Seviye ${level}!`,
    streak: (days: number) => `${days} günlük seri`,
  },

  shelf: {
    title: 'Raf',
    subtitle: 'Okuduğun ve yendiğin kitaplar',
    reading: 'OKUNUYOR',
    finished: 'BİTİRİLENLER',
    emptyFinished: 'Bitirdiğin kitaplar burada kupa olarak duracak.',
  },

  bookForm: {
    newTitle: 'Yeni kitap',
    editTitle: 'Kitabı düzenle',
    titleLabel: 'Kitap adı',
    authorLabel: 'Yazar (isteğe bağlı)',
    pagesLabel: 'Sayfa sayısı',
    titleRequired: 'Kitap adını gir.',
    pagesInvalid: (max: number) => `1 ile ${max} arasında bir sayfa sayısı gir.`,
    pagesBelowRead: 'Sayfa sayısı okuduğun sayfalardan az olamaz.',
    deleteTitle: 'Kitap silinsin mi?',
    deleteBody: 'Bu kitabın kayıtları silinir. Kazandığın XP sende kalır.',
  },

  profile: {
    level: (level: number) => `Seviye ${level}`,
    levelShort: (level: number) => `Sv ${level}`,
    xpToNext: (xp: number) => `Sonraki seviyeye ${xp} XP`,
    maxLevel: 'En yüksek seviye',
    statsOverline: 'İSTATİSTİKLER',
    totalPages: 'Toplam sayfa',
    booksFinished: 'Biten kitap',
    longestStreak: 'En uzun seri',
    settingsOverline: 'AYARLAR',
    dailyGoal: 'Günlük hedef',
    reminder: 'Hatırlatma',
    reminderOff: 'Kapalı',
    language: 'Dil',
    signOut: 'Çıkış yap',
    deleteAccount: 'Hesabı sil',
    deleteTitle: 'Hesabın silinsin mi?',
    deleteBody: 'Hesabın hemen kapanır ve verilerin 30 gün içinde kalıcı olarak silinir.',
  },

  onboarding: {
    welcomeTitle: "Habit War'a hoş geldin",
    welcomeBody: 'Her kitap yenilecek bir düşman. Okuduğun her sayfa karakterini büyütür.',
    start: 'Başla',
    goalTitle: 'Günlük hedefini seç',
    goalBody:
      'Küçük başla. Her gün biraz okumak, ara sıra çok okumaktan daha güçlü bir alışkanlık kurar.',
    goalHint: 'İstediğin zaman değiştirebilirsin.',
    reminderTitle: 'Ne zaman okursun?',
    reminderBody:
      'O saatte tek bir hatırlatma gönderelim. En iyisi her gün yaptığın bir şeyin hemen ardı: yemekten sonra ya da yatağa girince.',
    bookTitle: 'Şu an ne okuyorsun?',
    bookBody: 'İlk düşmanını ekle. Sayfa sayısı onun canı olacak.',
    finish: 'Bitir',
    skip: 'Bu adımı atla',
  },

  auth: {
    email: 'E-posta',
    emailPlaceholder: 'ornek@mail.com',
    password: 'Şifre',
    confirmPassword: 'Şifreyi onayla',
    showPassword: 'Şifreyi göster',
    hidePassword: 'Şifreyi gizle',
    emailRequired: 'E-posta adresini gir.',
    emailInvalid: 'Geçerli bir e-posta adresi gir.',
    passwordRequired: 'Şifreni gir.',
    passwordTooShort: 'Şifren en az 8 karakter olmalı.',
    passwordTooLong: 'Şifren çok uzun.',
    passwordTooCommon: 'Bu şifre çok yaygın, başka bir şifre seç.',
    passwordsDontMatch: 'Şifreler eşleşmiyor.',
    signInTitle: 'Tekrar hoş geldin',
    signInSubtitle: 'Hesabına giriş yap',
    signIn: 'Giriş yap',
    wrongCredentials: 'E-posta veya şifre hatalı.',
    unverified: 'E-posta adresini doğrulamadan giriş yapamazsın.',
    signInFailed: 'Giriş yapılamadı. Lütfen tekrar dene.',
    forgotPassword: 'Şifremi unuttum',
    noAccount: 'Hesabın yok mu? ',
    signUp: 'Kayıt ol',
    signUpTitle: "Habit War'a katıl",
    signUpSubtitle: 'Ücretsiz hesap oluştur',
    emailTaken: 'Bu e-posta adresiyle zaten bir hesap var.',
    signUpFailed: 'Kayıt olunamadı. Lütfen tekrar dene.',
    haveAccount: 'Zaten hesabın var mı? ',
    resetTitle: 'Şifreni sıfırla',
    resetSubtitle: 'E-posta adresini gir, sıfırlama bağlantısı gönderelim.',
    sendLink: 'Bağlantı gönder',
    linkSentTitle: 'Bağlantı gönderildi',
    linkSentBody:
      'Bu adresle bir hesap varsa sıfırlama bağlantısı birkaç dakika içinde gelecek. Spam klasörünü de kontrol et.',
    backToSignIn: 'Giriş ekranına dön',
  },
};

export type Strings = typeof tr;

const en: Strings = {
  common: {
    save: 'Save',
    cancel: 'Cancel',
    delete: 'Delete',
    back: 'Back',
    continue: 'Continue',
    retry: 'Try again',
    pages: (count) => (count === 1 ? '1 page' : `${count} pages`),
    loadError: 'Could not load.',
    networkError: 'Connection problem. Check your internet.',
    genericError: 'Something went wrong. Try again.',
  },

  tabs: {
    today: 'Today',
    shelf: 'Shelf',
    profile: 'Profile',
  },

  today: {
    title: 'Today',
    greeting: (name) => `Hi, ${name}`,
    goalOverline: 'DAILY GOAL',
    goalProgress: (read, goal) => `${read} / ${goal} pages`,
    goalDone: "Today's goal is done!",
    goalLeft: (left) => (left === 1 ? '1 page to go' : `${left} pages to go`),
    streak: 'Streak',
    streakDays: (days) => (days === 1 ? '1 day' : `${days} days`),
    consistency: (window) => `Last ${window} days`,
    consistencyValue: (days, window) => `${days}/${window}`,
    booksOverline: 'YOUR BOOKS',
    emptyTitle: 'No books yet',
    emptyBody: 'Add the book you are reading. Every page you read wears it down.',
    addBook: 'Add a book',
    suggestionTitle: 'Your goal may be too big',
    suggestionBody: (goal) =>
      `Last week you missed your goal on most days. That is the goal's fault, not yours. ` +
      `How about ${goal} pages a day? Reading a little every day beats reading a lot now and then.`,
    suggestionAccept: (goal) => `Make it ${goal} pages`,
    suggestionDismiss: 'Not now',
  },

  book: {
    hpLeft: (hp) => (hp === 1 ? '1 page left' : `${hp} pages left`),
    progress: (read, total) => `${read} / ${total}`,
    logPages: 'Log pages',
    defeated: 'Defeated',
    finishedOn: (date) => `Finished on ${date}`,
  },

  log: {
    title: 'How many pages did you read?',
    pagesLabel: 'Pages',
    invalid: 'Enter at least 1 page.',
    save: 'Save',
    finishedConflict: 'This book is already finished.',
  },

  reward: {
    xp: (xp) => `+${xp} XP`,
    goalReached: (bonus) => `Daily goal done! +${bonus} XP bonus`,
    bookDefeated: (title) => `${title} defeated! Added to your trophies.`,
    levelUp: (level) => `Level ${level}!`,
    streak: (days) => `${days}-day streak`,
  },

  shelf: {
    title: 'Shelf',
    subtitle: 'Books you are reading and have beaten',
    reading: 'READING',
    finished: 'FINISHED',
    emptyFinished: 'Books you finish will stand here as trophies.',
  },

  bookForm: {
    newTitle: 'New book',
    editTitle: 'Edit book',
    titleLabel: 'Title',
    authorLabel: 'Author (optional)',
    pagesLabel: 'Page count',
    titleRequired: 'Enter the title.',
    pagesInvalid: (max) => `Enter a page count between 1 and ${max}.`,
    pagesBelowRead: 'The page count cannot be lower than the pages you have read.',
    deleteTitle: 'Delete this book?',
    deleteBody: "This book's logs are deleted. The XP you earned stays with you.",
  },

  profile: {
    level: (level) => `Level ${level}`,
    levelShort: (level) => `Lv ${level}`,
    xpToNext: (xp) => `${xp} XP to the next level`,
    maxLevel: 'Highest level',
    statsOverline: 'STATS',
    totalPages: 'Total pages',
    booksFinished: 'Books finished',
    longestStreak: 'Longest streak',
    settingsOverline: 'SETTINGS',
    dailyGoal: 'Daily goal',
    reminder: 'Reminder',
    reminderOff: 'Off',
    language: 'Language',
    signOut: 'Sign out',
    deleteAccount: 'Delete account',
    deleteTitle: 'Delete your account?',
    deleteBody: 'Your account closes now and your data is permanently erased within 30 days.',
  },

  onboarding: {
    welcomeTitle: 'Welcome to Habit War',
    welcomeBody: 'Every book is an enemy to beat. Every page you read grows your character.',
    start: 'Start',
    goalTitle: 'Pick your daily goal',
    goalBody: 'Start small. Reading a little every day builds a stronger habit than reading a lot now and then.',
    goalHint: 'You can change it any time.',
    reminderTitle: 'When do you read?',
    reminderBody:
      'We will send one reminder at that time. Best is right after something you already do every day: after dinner, or getting into bed.',
    bookTitle: 'What are you reading now?',
    bookBody: 'Add your first enemy. Its page count is its health.',
    finish: 'Finish',
    skip: 'Skip for now',
  },

  auth: {
    email: 'Email',
    emailPlaceholder: 'you@example.com',
    password: 'Password',
    confirmPassword: 'Confirm password',
    showPassword: 'Show password',
    hidePassword: 'Hide password',
    emailRequired: 'Enter your email.',
    emailInvalid: 'Enter a valid email address.',
    passwordRequired: 'Enter your password.',
    passwordTooShort: 'Your password must be at least 8 characters.',
    passwordTooLong: 'Your password is too long.',
    passwordTooCommon: 'This password is too common. Choose another one.',
    passwordsDontMatch: 'Passwords do not match.',
    signInTitle: 'Welcome back',
    signInSubtitle: 'Sign in to your account',
    signIn: 'Sign in',
    wrongCredentials: 'Wrong email or password.',
    unverified: 'Verify your email address before signing in.',
    signInFailed: 'Could not sign in. Please try again.',
    forgotPassword: 'Forgot password',
    noAccount: "Don't have an account? ",
    signUp: 'Sign up',
    signUpTitle: 'Join Habit War',
    signUpSubtitle: 'Create a free account',
    emailTaken: 'An account with this email already exists.',
    signUpFailed: 'Could not sign up. Please try again.',
    haveAccount: 'Already have an account? ',
    resetTitle: 'Reset your password',
    resetSubtitle: "Enter your email and we'll send you a reset link.",
    sendLink: 'Send link',
    linkSentTitle: 'Link sent',
    linkSentBody:
      'If an account exists for this address, the reset link arrives in a few minutes. Check your spam folder too.',
    backToSignIn: 'Back to sign in',
  },
};

export const STRINGS = { tr, en } as const;

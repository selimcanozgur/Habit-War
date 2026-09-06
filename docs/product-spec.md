# Habit War — Teknik ve Ürün Dökümantasyonu

**Versiyon:** 1.0 (Taslak)
**Tarih:** Eylül 2026
**Hazırlayan:** Ürün & Mühendislik

---

## 1. Ürün Özeti

Habit War, gerçek hayattaki alışkanlıkları bir MMORPG karakter gelişim sistemine bağlayan sosyal bir mobil uygulamadır. Kullanıcılar alışkanlık seansları tamamlar, XP kazanır, seviye atlar; arkadaşlarıyla rekabet eder, birbirlerini takip eder ve bir sosyal akış üzerinden ilerlemelerini paylaşır.

**Üç katmanlı ürün kimliği:**

| Katman | Karşılığı | Temel Fonksiyon |
|---|---|---|
| Takip (Tracker) | Habitica / Streaks | Alışkanlık tanımlama, seans başlatma, süre ölçümü |
| Sosyal (Feed) | Twitter / Strava | Paylaşım, yorum, takip, keşfet |
| Oyun (RPG) | WoW / Solo Leveling | XP, seviye, stat, sınıf, lonca, sezon |

**Temel farklılaştırıcı:** Seviye uydurma bir sayı değil, gerçek hayatta harcanan doğrulanabilir zamanın karşılığıdır. "Gerçek hayattaki seviyen" iddiası ancak XP'nin manipüle edilemez olmasıyla anlam kazanır — bu yüzden anti-abuse sistemi bu üründe opsiyonel değil, çekirdek özelliktir.

---

## 2. Hedef Kitle ve Kullanım Senaryoları

**Birincil persona — "Selimcan, 22, üniversite öğrencisi"**
Kendini geliştirmek istiyor, tek başına disiplin kuramıyor, arkadaşlarıyla rekabet onu motive ediyor. Solo Leveling / Discord / Duolingo streak kültürüne aşina.

**İkincil persona — "Zeynep, 29, yazılımcı"**
Zaten Notion'da alışkanlık takip ediyor ama sıkıldı. Sosyal hesap verebilirlik (accountability) arıyor.

**Anti-persona:** Yalnızca sıkı bir veri analitiği isteyen, sosyal özellik istemeyen kullanıcı. Bu ürün onun için değil.

**Çekirdek kullanım döngüsü:**
1. Uygulamayı aç → bugünkü görevlerini gör
2. Bir alışkanlık seansı başlat (örn. 30 dk kitap)
3. Seans bitince XP + stat kazan, seviye barı dolsun
4. Akışta arkadaşlarının ne yaptığını gör, tepki ver
5. Haftalık lig sıralamasını kontrol et

---

## 3. XP ve Seviye Sistemi

### 3.1 Temel XP Formülü

Ham XP, süre bazlıdır ancak çarpanlarla ölçeklenir:

```
xpKazanci = floor(
    tabanXP
  × zorlukCarpani
  × streakCarpani
  × zamanKalitesiCarpani
  × etkinlikCarpani
)
```

**Bileşenler:**

| Bileşen | Değer Aralığı | Açıklama |
|---|---|---|
| `tabanXP` | dakika × 1.0 | 30 dk okuma = 30 taban XP |
| `zorlukCarpani` | 0.8 – 1.5 | Alışkanlık kategorisine göre sabit |
| `streakCarpani` | 1.0 – 1.5 | `min(1 + streakGun × 0.01, 1.5)` |
| `zamanKalitesiCarpani` | 0.5 – 1.2 | Kesintisiz seans ödülü |
| `etkinlikCarpani` | 1.0 – 2.0 | Sezon etkinliği, hafta sonu boost vb. |

**Kritik tasarım kararı — günlük tavan:**
Kategori başına günlük XP tavanı olmalı (örn. okuma için 120 dk/gün). Aksi halde 8 saat "meditasyon" iddia eden kullanıcı ekonomiyi bozar. Tavan sonrası XP %20 verimle akmaya devam eder (tamamen sıfırlamak cezalandırıcı hisse verir).

### 3.2 Seviye Eğrisi

Doğrusal eğri kullanmayın; erken seviyeler hızlı, sonrakiler yavaş olmalı:

```
gerekliXP(n) = floor(100 × n^1.6)
```

| Seviye | Gerekli XP (o seviye için) | Kümülatif XP | Yaklaşık Süre* |
|---|---|---|---|
| 1 → 2 | 100 | 100 | ~2 gün |
| 5 → 6 | 1.174 | ~2.900 | ~1 hafta |
| 10 → 11 | 3.981 | ~15.800 | ~1 ay |
| 25 → 26 | 17.099 | ~150.000 | ~6 ay |
| 50 → 51 | 51.800 | ~900.000 | ~2.5 yıl |

\* Günde ~60 dk aktif alışkanlık varsayımıyla.

**Prestij / Sezon sıfırlaması:** Seviye 50 sonrası kullanıcı "Ascend" edip yeni bir sezona 1. seviyeden başlayabilir, kalıcı bir rozet ve küçük bir XP çarpanı (%2, maksimum %10) kazanır. Bu, uzun vadeli oyuncuları elde tutar.

### 3.3 Stat Sistemi (RPG Derinliği)

XP'nin yanında kategori bazlı statlar birikir — bu, karakter kimliğini yaratan şeydir:

| Stat | Beslendiği Alışkanlıklar |
|---|---|
| **STR** (Güç) | Ağırlık antrenmanı, kalistenik |
| **END** (Dayanıklılık) | Koşu, yüzme, bisiklet |
| **INT** (Zeka) | Okuma, ders çalışma, kurs |
| **WIS** (Bilgelik) | Meditasyon, günlük tutma, uyku hijyeni |
| **CHA** (Karizma) | Sosyalleşme, sunum, dil pratiği |
| **DEX** (Beceri) | Müzik aleti, çizim, el becerisi, kod yazma |

**Sınıf (Class) sistemi:** Kullanıcı seviye 10'a ulaştığında en yüksek 2 statına göre otomatik sınıf önerisi alır — *Scholar* (INT+WIS), *Berserker* (STR+END), *Bard* (CHA+DEX), *Monk* (WIS+END). Sınıf sadece kozmetik değil, o statlara %10 XP bonusu verir. Bu, kullanıcıyı doğal eğilimini derinleştirmeye teşvik eder.

**Stat çürümesi (decay) — dikkatli olun:**
7 gün dokunulmayan bir stat haftada %1 azalabilir. Bu gerçekçilik katar ama *kaygı yaratma riski yüksektir*. Öneri: v1'de decay'i kapatın, sadece "bu stat pasif" rozeti gösterin. Kullanıcı davranışını ölçüp v2'de karar verin.

---

## 4. Anti-Abuse ve Doğrulama (Kritik Bölüm)

Bu sistem olmadan tüm seviye ekonomisi çöker. Katmanlı savunma:

**Katman 1 — Zorunlu aktif seans**
XP yalnızca uygulama içi timer ile kazanılır. "30 dk okudum" diye manuel giriş yapılamaz (veya yapılırsa %30 XP verir ve "doğrulanmamış" etiketi alır).

**Katman 2 — Cihaz sinyalleri**
- Ekran kapalı + hareketsizlik → meditasyon/uyku için pozitif sinyal
- HealthKit / Google Fit adım + nabız verisi → spor seansları için doğrulama
- Aynı anda tek seans (paralel timer engeli)

**Katman 3 — İstatistiksel anomali tespiti**
Arka planda çalışan bir job şunları işaretler:
- Günlük toplam aktif süre > 14 saat
- Aynı saniyede biten tekrarlayan seanslar (bot imzası)
- Yeni hesabın ilk haftada üst %1 XP'ye girmesi

**Katman 4 — Sosyal doğrulama**
Yüksek değerli seanslar (>90 dk) için opsiyonel foto/ekran görüntüsü kanıtı. Arkadaşlar "onayla" verebilir. Loncalar kendi doğrulama standardını belirleyebilir.

**Yaptırım:** Anında ban yerine gölge düzeltme (shadow correction) — şüpheli XP sıralamalara yansımaz ama kullanıcı hemen fark etmez. Bu, oyunlaştırma sistemlerinde kaçış yarışını yavaşlatır.

---

## 5. Sosyal Katman

### 5.1 Akış (Feed)

**Gönderi tipleri:**
- `SESSION_COMPLETE` — otomatik üretilen, "30 dk okudu, +42 XP" (kullanıcı yorum ekleyebilir)
- `LEVEL_UP` — seviye atlama kutlaması
- `TEXT` / `IMAGE` — serbest paylaşım
- `ACHIEVEMENT` — rozet kazanımı
- `CHALLENGE_RESULT` — düello sonucu

**Feed algoritması (v1 — basit tutun):**
```
Skor = 0.5 × yakinlik + 0.3 × tazelik + 0.2 × etkilesim
```
Kronolojik + arkadaş filtresi ile başlayın. ML tabanlı sıralamaya 10k DAU öncesi girmeyin.

**Gürültü riski:** Her seans otomatik post olursa feed spam'e döner. Çözüm — otomatik postlar varsayılan olarak *sadece günlük özet* şeklinde toplanır ("Selimcan bugün 3 seans, 145 XP"). Kullanıcı tekil paylaşımı manuel seçer.

### 5.2 Sosyal Grafik

- **Arkadaşlık:** çift taraflı onay (rekabet için)
- **Takip:** tek taraflı (içerik keşfi için)
- Her ikisini destekleyin; farklı ihtiyaçlara hizmet ederler

### 5.3 Mesajlaşma

- 1:1 DM ve lonca grup sohbeti
- WebSocket (Socket.io) üzerinden gerçek zamanlı
- Mesaj geçmişi PostgreSQL'de, aktif oturum durumu Redis'te
- v1'de uçtan uca şifreleme yok; ancak KVKK gereği aktarımda TLS ve veritabanında sütun bazlı şifreleme uygulayın

### 5.4 Rekabet Mekanikleri

| Mekanik | Açıklama | Süre |
|---|---|---|
| **Düello** | 1v1, belirlenen kategoride kim daha çok XP toplar | 3–7 gün |
| **Lonca (Guild)** | 5–30 kişilik takım, ortak hedef | Sürekli |
| **Lonca Savaşı** | İki lonca toplam XP yarışı | 1 hafta |
| **Lig Sistemi** | Bronz→Gümüş→Altın→Platin→Elmas, haftalık 30 kişilik gruplar | Haftalık |
| **Sezon** | Tema, özel rozet, sıralama sıfırlaması | 3 ay |

**Lig sistemi neden önemli:** Global sıralama demotive edicidir (kimse #47.000 olmak istemez). Duolingo modeli — 30 kişilik grupta üst 7 yükselir, alt 5 düşer — herkese kazanma ihtimali verir. Bu, retention'ı en çok artıran tek mekanizmadır.

---

## 6. Teknoloji Yığını

### 6.1 Seçiminizin Değerlendirmesi

React Native + Node/Express + Prisma + PostgreSQL sağlam ve tutarlı bir seçim. Tek dil (TypeScript), geniş ekosistem, hızlı işe alım. Aşağıdaki değişiklikleri öneriyorum:

**Kesinlikle değiştirin:**

| Sizin Seçiminiz | Öneri | Gerekçe |
|---|---|---|
| React Native CLI | **Expo (bare workflow'a geçiş opsiyonlu)** | OTA güncelleme, push notification, build pipeline hazır. Manuel native yapılandırma haftalar yer. |
| Express | **Fastify** veya **NestJS** | Express bakım modunda. Fastify 2-3× hızlı + şema doğrulama yerleşik. NestJS ise büyüyen ekip için yapı sağlar. |

**Ekleyin (opsiyonel değil):**

- **Redis** — leaderboard (Sorted Set), oturum, rate limiting, aktif timer durumu. Sıralamayı her istekte PostgreSQL'den `ORDER BY xp` ile çekmek 10k kullanıcıda çöker.
- **BullMQ** — arka plan işleri: streak hesaplama, lig rotasyonu, bildirim gönderimi, anomali taraması
- **Zustand + TanStack Query** — istemci durum yönetimi (Redux'a gerek yok)
- **Sentry + PostHog** — hata takibi ve ürün analitiği
- **Zod** — uçtan uca şema doğrulama (Prisma tipleriyle uyumlu)

**Kimlik doğrulama:** Kendiniz yazmayın. **Clerk** veya **Supabase Auth** kullanın. Sosyal giriş, e-posta doğrulama, token rotasyonu hazır gelir. 3 hafta kazanırsınız.

**Neden GraphQL değil:** Feed ve profil sorguları için cazip görünür ama tek geliştiriciyle karmaşıklık maliyeti faydayı aşar. REST + iyi tasarlanmış endpoint'lerle başlayın.

### 6.2 Nihai Yığın

```
Mobil          React Native (Expo) + TypeScript
               Zustand · TanStack Query · React Navigation
               Reanimated 3 (XP animasyonları için kritik)

Backend        Node.js 22 + Fastify + TypeScript
               Prisma ORM · Zod · Socket.io

Veri           PostgreSQL 16 (birincil)
               Redis 7 (cache, leaderboard, pub/sub)
               S3 / Cloudflare R2 (medya)

İş Kuyruğu     BullMQ

Altyapı        Railway veya Fly.io (başlangıç)
               Cloudflare (CDN + DDoS)
               GitHub Actions (CI/CD)

Servisler      Clerk (auth) · Expo Push (bildirim)
               Sentry (hata) · PostHog (analitik)
```

---

## 7. Veri Modeli (Prisma Şeması — Çekirdek)

```prisma
model User {
  id            String   @id @default(cuid())
  username      String   @unique
  displayName   String
  email         String   @unique
  avatarUrl     String?
  bio           String?  @db.VarChar(160)

  level         Int      @default(1)
  totalXp       BigInt   @default(0)
  currentXp     Int      @default(0)
  prestige      Int      @default(0)
  classType     ClassType?

  strength      Int      @default(0)
  endurance     Int      @default(0)
  intelligence  Int      @default(0)
  wisdom        Int      @default(0)
  charisma      Int      @default(0)
  dexterity     Int      @default(0)

  timezone      String   @default("Europe/Istanbul")
  createdAt     DateTime @default(now())

  habits        Habit[]
  sessions      Session[]
  posts         Post[]
  guildMember   GuildMember?

  @@index([totalXp(sort: Desc)])
  @@index([username])
}

model Habit {
  id            String    @id @default(cuid())
  userId        String
  name          String
  category      Category
  targetMinutes Int
  frequency     Frequency @default(DAILY)
  colorHex      String    @default("#6366F1")

  currentStreak Int       @default(0)
  longestStreak Int       @default(0)
  lastCompleted DateTime?
  isArchived    Boolean   @default(false)

  user          User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  sessions      Session[]

  @@index([userId, isArchived])
}

model Session {
  id             String        @id @default(cuid())
  userId         String
  habitId        String

  startedAt      DateTime
  endedAt        DateTime?
  durationSec    Int?
  status         SessionStatus @default(ACTIVE)

  xpAwarded      Int           @default(0)
  multiplierData Json?         // hangi çarpanların uygulandığı — denetim için
  verification   Verification  @default(TIMER_ONLY)
  proofUrl       String?
  isFlagged      Boolean       @default(false)

  user           User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  habit          Habit         @relation(fields: [habitId], references: [id], onDelete: Cascade)

  @@index([userId, startedAt(sort: Desc)])
  @@index([status])
}

model Post {
  id          String    @id @default(cuid())
  authorId    String
  type        PostType
  content     String?   @db.VarChar(500)
  mediaUrls   String[]
  sessionId   String?   @unique

  likeCount   Int       @default(0)
  replyCount  Int       @default(0)
  parentId    String?

  createdAt   DateTime  @default(now())
  author      User      @relation(fields: [authorId], references: [id], onDelete: Cascade)

  @@index([authorId, createdAt(sort: Desc)])
  @@index([parentId])
}

model Friendship {
  id          String           @id @default(cuid())
  requesterId String
  addresseeId String
  status      FriendshipStatus @default(PENDING)
  createdAt   DateTime         @default(now())

  @@unique([requesterId, addresseeId])
  @@index([addresseeId, status])
}

model Guild {
  id          String        @id @default(cuid())
  name        String        @unique
  tag         String        @unique @db.VarChar(5)
  description String?
  emblemUrl   String?
  totalXp     BigInt        @default(0)
  maxMembers  Int           @default(30)
  isPublic    Boolean       @default(true)

  members     GuildMember[]

  @@index([totalXp(sort: Desc)])
}

model LeagueEntry {
  id        String    @id @default(cuid())
  userId    String
  tier      LeagueTier
  groupId   String
  weekStart DateTime
  weeklyXp  Int       @default(0)
  finalRank Int?

  @@unique([userId, weekStart])
  @@index([groupId, weeklyXp(sort: Desc)])
}

enum Category { FITNESS STUDY MINDFULNESS CREATIVE SOCIAL HEALTH SKILL }
enum ClassType { SCHOLAR BERSERKER BARD MONK RANGER ARTISAN }
enum SessionStatus { ACTIVE COMPLETED ABANDONED INVALIDATED }
enum Verification { TIMER_ONLY HEALTH_DATA PHOTO_PROOF PEER_VERIFIED }
enum PostType { SESSION_COMPLETE LEVEL_UP TEXT IMAGE ACHIEVEMENT CHALLENGE_RESULT }
enum FriendshipStatus { PENDING ACCEPTED BLOCKED }
enum Frequency { DAILY WEEKLY CUSTOM }
enum LeagueTier { BRONZE SILVER GOLD PLATINUM DIAMOND }
```

---

## 8. API Tasarımı

**Base URL:** `https://api.habitwar.app/v1`
**Auth:** `Authorization: Bearer <jwt>`

### Alışkanlık & Seans
```
GET    /habits                      Kullanıcının alışkanlıkları
POST   /habits                      Yeni alışkanlık
PATCH  /habits/:id                  Güncelle
DELETE /habits/:id                  Arşivle

POST   /sessions/start              { habitId } → aktif seans
POST   /sessions/:id/complete       { proofUrl? } → XP hesaplanır
POST   /sessions/:id/abandon        İptal
GET    /sessions/active             Aktif seans (cihaz senkronu)
GET    /sessions?from=&to=          Geçmiş
```

### Profil & Sıralama
```
GET    /users/me                    Tam profil + statlar
GET    /users/:username             Herkese açık profil
GET    /users/me/stats?period=week  Analitik

GET    /leaderboard/friends
GET    /leaderboard/league          Mevcut lig grubu
GET    /leaderboard/global?limit=100
```

### Sosyal
```
GET    /feed?cursor=&type=          Cursor tabanlı sayfalama
POST   /posts
POST   /posts/:id/like
POST   /posts/:id/replies

GET    /friends
POST   /friends/request             { username }
POST   /friends/:id/accept
DELETE /friends/:id

GET    /conversations
GET    /conversations/:id/messages?cursor=
POST   /conversations/:id/messages
```

### Oyun
```
GET    /guilds/:id
POST   /guilds/:id/join
GET    /challenges
POST   /challenges                  { opponentId, category, days }
POST   /challenges/:id/accept
GET    /achievements
```

**WebSocket olayları:**
```
session:tick        Aktif timer senkronu
xp:gained           Anlık XP bildirimi
level:up            Seviye atlama
message:new         Yeni mesaj
friend:online       Çevrimiçi durumu
challenge:update    Düello skor güncellemesi
```

**Sayfalama:** Feed ve mesajlar için offset değil **cursor tabanlı** kullanın. Sürekli değişen listelerde offset yinelenen kayıtlara yol açar.

---

## 9. Ekran Yapısı (Bilgi Mimarisi)

```
Tab 1  ANA SAYFA
       ├─ Karakter kartı (seviye, XP bar, sınıf)
       ├─ Bugünün alışkanlıkları
       ├─ Aktif seans widget'ı
       └─ Streak takvimi

Tab 2  AKIŞ
       ├─ Arkadaşlar / Keşfet sekmeleri
       ├─ Gönderi oluştur
       └─ Bildirimler

Tab 3  SAVAŞ  (merkez, vurgulu buton)
       ├─ Lig sıralaması
       ├─ Aktif düellolar
       ├─ Lonca paneli
       └─ Sezon etkinliği

Tab 4  MESAJLAR
       ├─ DM listesi
       └─ Lonca sohbeti

Tab 5  PROFİL
       ├─ Stat radar grafiği
       ├─ Rozet vitrini
       ├─ İstatistikler & grafikler
       └─ Ayarlar
```

**UX notu — XP animasyonu ürünün kalbidir.** Seans bitiminde XP barının dolması, seviye atlama efekti ve haptik geri bildirim rastgele bir detay değil, alışkanlık döngüsünün ödül aşamasıdır. Reanimated 3 + expo-haptics ile bunu erken ve iyi yapın. Kötü bir XP animasyonu tüm oyunlaştırmayı ucuz hissettirir.

---

## 10. Ek Özellik Önerileri

**Yüksek etki / Düşük maliyet:**

- **Boss Fight** — Haftalık grup hedefi: "Lonca olarak 5.000 XP toplayın." Ortak düşman, işbirliğini rekabetle dengeler.
- **Accountability Partner** — İki kullanıcı eşleşir; biri hedefini kaçırırsa diğerine bildirim gider. Sosyal baskı en güçlü retention aracıdır.
- **Focus Mode** — Seans sırasında bildirimleri kapat, telefon kilitli kalırsa %20 bonus XP.
- **Widget** — iOS/Android ana ekran widget'ı: seviye barı + bugünkü streak. Uygulama açmadan görünürlük.

**Orta vadeli:**

- **Ekipman Sistemi** — Rozet yerine "Kitap Kurdunun Gözlüğü (+%5 INT XP)" gibi kozmetik/fonksiyonel item'lar. Koleksiyon güdüsü güçlüdür.
- **Skill Tree** — Her stat için dallanan yetenek ağacı, seviye başına puan.
- **Wrapped / Yıllık Özet** — Spotify Wrapped benzeri paylaşılabilir yıl özeti. Organik büyümenin en ucuz kaynağı.
- **Alışkanlık Şablonları** — "Sabah Rutini", "Sınav Hazırlık" hazır paketler; onboarding sürtünmesini azaltır.

**Dikkatli yaklaşın:**

- **Ceza mekanikleri (HP kaybı)** — Habitica'nın en çok terk edilme sebebi. Kaçırılan gün ceza değil, "streak dondurma" (donut kullanımı) olsun.
- **Halka açık global sıralama** — Motivasyon yerine yılgınlık üretir. Lig sistemi ile sınırlayın.
- **NFT / kripto** — Hedef kitlenizde net negatif.

---

## 11. Yol Haritası

**Faz 0 — Temel (4 hafta)**
Auth, veri modeli, alışkanlık CRUD, timer, XP motoru, temel profil. *Çıktı: tek kişilik çalışan tracker.*

**Faz 1 — MVP (6 hafta)**
Arkadaş sistemi, akış, beğeni/yorum, arkadaş sıralaması, push bildirim. *Çıktı: kapalı beta, 50 kullanıcı.*

**Faz 2 — Oyun (6 hafta)**
Statlar, sınıflar, rozetler, düello, lig sistemi, sezon 1. *Çıktı: açık beta.*

**Faz 3 — Topluluk (6 hafta)**
Loncalar, mesajlaşma, lonca savaşları, keşfet sekmesi. *Çıktı: genel yayın.*

**Faz 4 — Ölçek**
Sağlık verisi entegrasyonu, widget, Wrapped, premium katman.

---

## 12. Başarı Metrikleri

| Metrik | Hedef (3. ay) | Neden Önemli |
|---|---|---|
| D1 Retention | %40 | Onboarding kalitesi |
| D7 Retention | %20 | Alışkanlık oluştu mu |
| D30 Retention | %10 | Gerçek ürün-pazar uyumu |
| Günlük seans/aktif kullanıcı | 2.0+ | Çekirdek döngü sağlığı |
| Arkadaşı olan kullanıcı oranı | %60 | **En kritik metrik** |
| Ortalama arkadaş sayısı | 5+ | Ağ etkisi eşiği |

**Not:** Sosyal uygulamalarda retention ile sosyal grafik yoğunluğu arasındaki korelasyon diğer tüm faktörlerden güçlüdür. İlk 7 günde en az 3 arkadaş edinmiş kullanıcının 30. günde kalma ihtimali 4–5 kat yüksektir. Onboarding'i buna göre tasarlayın: kayıt sonrası ilk ekran arkadaş bulma olmalı, alışkanlık oluşturma değil.

---

## 13. Riskler

| Risk | Etki | Azaltma |
|---|---|---|
| Boş topluluk (cold start) | Kritik | Kapalı davetli beta; tek üniversite/topluluktan başla |
| XP manipülasyonu | Yüksek | Bölüm 4'teki katmanlı savunma |
| Feed spam'i | Orta | Otomatik post toplama, günlük özet |
| Bildirim yorgunluğu | Orta | Günlük maks. 3 bildirim, akıllı zamanlama |
| KVKK/GDPR uyumu | Yüksek | Veri silme endpoint'i, açık rıza, TR veri lokasyonu |
| Tükenmişlik/kaygı | Orta | Ceza yok, mola modu, "streak dondurma" |

---

## 14. Nereden Başlamalı

En sık yapılan hata her şeyi birden inşa etmeye çalışmaktır. Sıra:

1. **Bu hafta:** Prisma şemasını yaz, migrate et, seed data üret. Sadece `User`, `Habit`, `Session`.
2. **Sonraki:** XP motorunu saf bir TypeScript fonksiyonu olarak yaz ve birim testlerini yaz. Bu, ürünün matematiksel çekirdeği — API'den önce doğru olmalı.
3. **Sonra:** Timer ekranı + XP animasyonu. Tek ekran, ama mükemmel hissettirsin.
4. **Ancak o zaman:** Sosyal katman.

Uygulamayı kendiniz 2 hafta boyunca tek kullanıcı olarak kullanın. Sıkıcı geliyorsa sosyal özellikler bunu kurtarmaz.

export const meta = {
  name: 'habit-war-audit-completion',
  description: 'Habit War denetimini tamamla: eksik 2 lens, 64 kurtarilmis bulgunun adversarial dogrulamasi, bosluk analizi ve sentez',
  phases: [
    { title: 'Eksik Lensler', detail: 'veri modeli ve olcek/operasyon lensleri' },
    { title: 'Dogrulama', detail: '64 kurtarilmis bulgu 3 farkli supheci tarafindan curutulmeye calisilir' },
    { title: 'Bosluk Analizi', detail: 'eksiklik elestirmeni' },
    { title: 'Sentez', detail: 'tekillestirme, onceliklendirme, uygulama durumu' },
  ],
}

const DOC = 'c:/Users/User/Desktop/HabitWar/docs/product-spec.md'
const FINDINGS_FILE =
  'C:/Users/User/AppData/Local/Temp/claude/c--Users-User-Desktop-HabitWar/30bda142-9e3e-4b2a-8eb9-3d417acaff47/scratchpad/recovered-findings.json'

const CONTEXT = [
  'PROJE: Habit War - aliskanlik takibi + sosyal akis + MMORPG karakter gelisimi birlestiren mobil uygulama.',
  'DOKUMAN: ' + DOC + ' (Turkce, 570 satir, v1.0 taslak urun+teknik spesifikasyonu).',
  'ILK ISIN: bu dosyayi Read araciyla BASTAN SONA oku. Okumadan hicbir sey iddia etme.',
  '',
  'ONEMLI: Bu spesifikasyonun BIR KISMI ARTIK KODLANMIS DURUMDA. Repo:',
  '  packages/domain/  - saf oyun kurallari (balance.ts, leveling.ts, scoring.ts, stats.ts, streaks.ts)',
  '  apps/api/         - Fastify + Prisma (prisma/schema.prisma, src/modules/)',
  '  docs/adr/, docs/audit/ - alinan kararlar ve onceki denetim',
  'Denetimin HEDEFI SPESIFIKASYONDUR, kod degil. Ama bir kusurun kodda zaten cozulup cozulmedigini',
  'kontrol etmek isini kolaylastirir - README.md ve docs/audit/2026-09-spec-audit.md cozulenleri listeliyor.',
  '',
  'KRITIK BAGLAM - her bulguda filtre olarak kullan:',
  '- Gelistirici TEK KISI. Ekip yok, kucuk butce, sinirli zaman.',
  '- Bir oneri "buyuk ekip icin dogru ama tek kisi icin gerceklesemez" ise bu BASLI BASINA bir bulgudur.',
  '- Teknoloji yigini kararlari tartismaya acik.',
  '- Bugunun tarihi: 11 Eylul 2026.',
  '',
  'DIL: Tum ciktin TURKCE olacak.',
  '',
  'KURALLAR:',
  '- Uydurma yok. Her bulgu dokumandaki somut bir bolume dayanmali; evidence alaninda alintila.',
  '- Sayisal iddialari GERCEKTEN HESAPLA. Bash ile "node -e" veya python calistir, sonucu evidence icine yaz.',
  '- Uslup/yazim hatalari bulgu DEGILDIR. Yalnizca urunu, ekonomiyi, mimariyi, hukuku veya kullaniciyi',
  '  maddi olarak etkileyen kusurlari raporla.',
  '- Her bulgu icin SOMUT duzeltme oner: yeni formul, yeni sema alani, yeni bolum metni, yeni sayi.',
].join('\n')

const FINDINGS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', description: 'kisa kebab-case slug, bu ajan icinde benzersiz' },
          section: { type: 'string', description: 'dokuman bolum numarasi, orn "7 - Prisma semasi"' },
          title: { type: 'string' },
          severity: { type: 'string', enum: ['kritik', 'yuksek', 'orta', 'dusuk'] },
          claim: { type: 'string' },
          evidence: { type: 'string' },
          impact: { type: 'string' },
          fix: { type: 'string' },
        },
        required: ['id', 'section', 'title', 'severity', 'claim', 'evidence', 'impact', 'fix'],
      },
    },
  },
  required: ['findings'],
}

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', description: 'degerlendirilen bulgunun id alani, birebir ayni' },
          real: { type: 'boolean', description: 'true = bulgu gecerli; false = curutuldu' },
          reason: { type: 'string' },
          severityAdjust: { type: 'string', enum: ['kritik', 'yuksek', 'orta', 'dusuk', 'ayni'] },
        },
        required: ['id', 'real', 'reason'],
      },
    },
  },
  required: ['verdicts'],
}

// ---------------------------------------------------------------------------
// FAZ 1: onceki denetimde hic calisamayan 2 lens
// ---------------------------------------------------------------------------

const MISSING_LENSES = [
  {
    key: 'veri-modeli',
    title: 'Prisma veri modeli',
    prompt: [
      'LENS: Bolum 7, Prisma semasi. Semayi bir veritabani tasarimcisi titizliginde denetle.',
      '',
      'EKSIK MODEL TARAMASI: Dokumanin DIGER bolumlerinde bahsedilen her varliga semada karsilik var mi?',
      'Sistematik kontrol et: GuildMember (User.guildMember ve Guild.members buna referans veriyor - model tanimli mi?),',
      'Message, Conversation, Challenge/Duello, Achievement/Rozet, Like/Begeni, Notification, Season,',
      'Follow (tek tarafli takip - Friendship ayri), Comment/Reply, DailyUsage, XpLedger, Report/Moderasyon,',
      'PushToken, Block. Her biri icin: hangi bolum gerektiriyor, semada var mi?',
      '',
      'ILISKI VE BUTUNLUK:',
      '- Friendship modelinde User ile relation TANIMLI MI? LeagueEntry de? Prisma bunu nasil karsilar?',
      '- Post.parentId var ama self-relation tanimi var mi? Post.sessionId @unique ama Session tarafinda karsilik var mi?',
      '- @@unique([requesterId, addresseeId]) ters yonlu ikinci istegi (B->A) engeller mi? Somut senaryo yaz.',
      '- onDelete davranislari: hesap silinince Friendship, LeagueEntry, GuildMember ne oluyor? KVKK silme talebi.',
      '',
      'TIP VE DOGRULUK:',
      '- User.totalXp BigInt ama currentXp Int, Guild.totalXp BigInt, LeagueEntry.weeklyXp Int.',
      '  Bu karisiklik JS/TS tarafinda ne sorun cikarir? BigInt JSON serilestirme sorunu var mi? HESAPLA/ARASTIR.',
      '- level/totalXp/statlar User tablosunda denormalize. Kaynak gercek nedir, yeniden hesaplanabilir mi?',
      '- Habit.currentStreak/lastCompleted: streak hesabi timezone bagimli; sema bunu destekliyor mu?',
      '  (lastCompleted DateTime - kullanicinin yerel gunu bundan nasil turetiliyor?)',
      '- Session.durationSec Int? nullable ama xpAwarded hesabi buna bagli.',
      '',
      'INDEKS VE PERFORMANS:',
      '- Feed sorgusu (arkadaslarin postlari, cursor tabanli) mevcut indekslerle nasil calisir? Eksik indeks var mi?',
      '- @@index([totalXp(sort: Desc)]) global siralama icin - ama Bolum 10 global siralamayi onermiyor. Celiski mi?',
      '- Bolum 5.3 "veritabaninda sutun bazli sifreleme" diyor ama semada hicbir alan sifreli isaretlenmemis.',
      '- Gunluk XP tavani icin gereken "bugun bu kategoride kac dakika" sorgusu mevcut semayla nasil cevaplanir?',
      '  Her seans tamamlamada tum gecmisi taramak gerekir mi?',
    ].join('\n'),
  },
  {
    key: 'olcek-operasyon',
    title: 'Olcek, altyapi ve operasyon',
    prompt: [
      'LENS: Bolum 6 altyapi + Bolum 5.4 lig/sezon mekaniklerinin operasyonel gercekleri.',
      '',
      'ZAMANLANMIS ISLER VE ZAMAN DILIMI:',
      '- Lig rotasyonu haftalik 30 kisilik gruplar: gruplar nasil olusur? Kullanici sayisi 30un kati degilse?',
      '  47 kullanici varken ne olur? Hafta ortasinda katilan?',
      '- "Ust 7 yukselir, alt 5 duser" 30 kisilik grupta: Elmas ligin ustu ne olur, Bronzun alti ne olur?',
      '  Kademeler arasi akis dengeli mi? HESAPLA: 5 kademe, her hafta 7 yukari 5 asagi - kararli durum var mi?',
      '- Streak hesabi ve gunluk sifirlama: kullanicilar farkli timezonelarda. Gun sinirini kim belirler?',
      '  Gece yarisi kosan job her timezone icin ayri mi calisir? Kac kez?',
      '- Sezon (3 ay) sifirlamasi: hangi veriler sifirlanir, hangileri kalir? Sema bunu destekliyor mu?',
      '- BullMQ isleri listelenmis ama her birinin sikligi, idempotencysi, basarisizlik/tekrar politikasi tanimli mi?',
      '',
      'REDIS VE ONBELLEK:',
      '- Redis Sorted Set leaderboard ile PostgreSQL tutarliligi: Redis verisi kaybolursa nasil yeniden insa edilir?',
      '- "Aktif timer durumu Rediste" - Redis kalici degil. Timer durumu kaybolursa kullanicinin seansi ne olur?',
      '',
      'MALIYET VE OPERASYON (tek gelistirici!):',
      '- PostgreSQL + Redis + BullMQ worker + S3/R2 + Socket.io + Clerk + Sentry + PostHog + Cloudflare.',
      '  Railway/Fly.io uzerinde 50 kullanicilik kapali beta icin aylik maliyet? HESAPLA, guncel fiyatlari arastir.',
      '- Kac ayri calisan surec gerekiyor? Tek gelistirici bunlari deploy edip izleyebilir mi?',
      '- Yedekleme, felaket kurtarma, migration stratejisi, staging ortami dokumanda gecmis mi?',
      '- Test stratejisi dokumanda var mi? Bolum 14 sadece XP motoru testinden bahsediyor.',
      '- Gozlemlenebilirlik: Sentry hata icin var ama loglama, metrik, uyari (alerting) yok.',
      '- 10k DAUda hangi bilesen once kirilir? Somut ol.',
    ].join('\n'),
  },
]

log('Eksik 2 lens calisiyor: veri modeli, olcek/operasyon')

const newFindings = (
  await parallel(
    MISSING_LENSES.map((lens) => () =>
      agent(CONTEXT + '\n\n=== GOREV: DENETIM ===\n' + lens.prompt + '\n\nEn fazla 8 bulgu dondur, en onemliden baslayarak.', {
        label: 'lens:' + lens.key,
        phase: 'Eksik Lensler',
        schema: FINDINGS_SCHEMA,
      }),
    ),
  )
)
  .filter(Boolean)
  .flatMap((r, i) =>
    (r.findings || []).map((f) => ({ ...f, id: MISSING_LENSES[i].key + '-' + f.id, lens: MISSING_LENSES[i].key })),
  )

log('Eksik lensler ' + newFindings.length + ' yeni bulgu uretti.')

// ---------------------------------------------------------------------------
// FAZ 2: kurtarilmis 64 bulgu + yeni bulgular icin adversarial dogrulama
// ---------------------------------------------------------------------------

const VERIFY_LENSES = [
  {
    key: 'olgu',
    instruction: [
      'ROLUN: Olgusal denetci. Her bulgunun TEKNIK VE OLGUSAL dogrulugunu bagimsiz kontrol et.',
      '- Hesaplamaya dayaniyorsa hesabi SIFIRDAN kendin yap (bash + node -e). Tutmuyorsa real=false.',
      '- Dokumandan alinti yapiyorsa alintinin gercekten orada oldugunu Read/grep ile dogrula. Carpitilmissa real=false.',
      '- Platform/kutuphane/hukuk iddiasi iceriyorsa (orn "iOS bunu yapamaz", "Express bakim modunda",',
      '  "bu ozel nitelikli veridir", "Google Fit kapandi") dogrulugunu ARASTIR. Yanlissa real=false.',
      '- Sadece "olabilir/riskli olabilir" diyen, dogrulanabilir cekirdegi olmayan bulgular icin real=false.',
    ].join('\n'),
  },
  {
    key: 'tek-gelistirici',
    instruction: [
      'ROLUN: Pragmatizm denetcisi. Bu TEK KISILIK bir ekibin v1.0 TASLAK dokumani. Kusursuzluk beklenmiyor.',
      '- Duzeltilmezse urunu, ekonomiyi, kullaniciyi veya gelistiricinin zamanini maddi olarak zarara ugratir mi?',
      '  Hayirsa real=false.',
      '- Bulgu aslinda "kurumsal olgunluk" talebi mi (detayli SLA, mimari karar kayitlari, kapsamli surec dokumani)?',
      '  Tek gelistirici icin gereksizse real=false.',
      '- Taslakta makul olan detay eksikligini kusur gibi sunuyorsa real=false.',
      '- ANCAK: eksiklik ILERIDE GERI DONULMESI PAHALI bir karara yol aciyorsa (veri modeli, XP ekonomisi,',
      '  hukuki uyum, platform kisiti) real=true - taslak olmasi mazeret degildir.',
    ].join('\n'),
  },
  {
    key: 'zaten-ele-alinmis',
    instruction: [
      'ROLUN: Dokuman avukati. Bulgulari dokumanin KENDI ICERIGIYLE curutmeye calis.',
      '- Dokumanin BASKA bir bolumu bu konuyu zaten ele almis mi? grep ile TUM dokumani ara,',
      '  sadece bulgunun isaret ettigi bolume bakma. Ele alinmissa real=false.',
      '- Dokuman bunu BILINCLI bir tasarim karari olarak gerekcelendirmis mi (orn "v1de kapatin",',
      '  "10k DAU oncesi girmeyin", "basit tutun")? Oyleyse kusur degil kapsam karari - real=false.',
      '- Bulgu, ayni denetimdeki baska bir bulgunun tekrari/alt kumesi mi? reason alaninda belirt, real=true birak.',
      '- ANCAK: dokuman konuyu sadece TEK CUMLEYLE anip gecmisse ve o konu urunun cekirdegiyse',
      '  (orn "KVKK: veri silme endpointi" deyip endpointi tanimlamamak), bu YETERLI ele alis DEGILDIR - real=true.',
    ].join('\n'),
  },
]

/**
 * Kurtarilmis 64 bulgu 233 KB tutuyor - ne tek prompta sigar ne de bu scriptin
 * icinden gecirilmeye deger. Script dosya okuyamaz ama AJANLAR okuyabilir, bu yuzden
 * dogrulayicilara dosya yolu + indeks araligi verilir ve her biri kendi dilimini
 * dosyadan okur. Script yalnizca id -> karar eslemesini tutar.
 *
 * Parcalar 3 supheci lensten gecer. pipeline kullaniliyor: bir parca dogrulanirken
 * digerinin beklemesi gerekmez.
 */
const CHUNK_SIZE = 8

function ranges(count, size) {
  const out = []
  for (let start = 0; start < count; start += size) {
    out.push({ start, end: Math.min(start + size, count) })
  }
  return out
}

/** Dosyadaki bir dilimi dogrulatan prompt. */
function verifyRangePrompt(range, lens) {
  return [
    CONTEXT,
    '',
    '=== GOREV: ADVERSARIAL DOGRULAMA ===',
    'Onceki denetim turunda uretilmis bulgulari CURUTMEYE calisiyorsun. Varsayilanin supheci olmak.',
    '',
    lens.instruction,
    '',
    'BULGULARI NEREDEN ALACAKSIN:',
    'Su dosya bir JSON dizisidir: ' + FINDINGS_FILE,
    'SENIN DILIMIN: dizinin ' + range.start + '. indeksinden ' + (range.end - 1) + '. indeksine kadar',
    '(toplam ' + (range.end - range.start) + ' bulgu, 0-tabanli, her iki uc dahil).',
    '',
    'Dilimini su komutla al:',
    '  node -e "const a=require(\'' + FINDINGS_FILE + '\');console.log(JSON.stringify(a.slice(' +
      range.start +
      ',' +
      range.end +
      '),null,1))"',
    'Dosyanin TAMAMINI okuma - sadece kendi dilimini al.',
    '',
    'YONTEM: Once ' + DOC + ' dosyasini oku. Sonra HER bulgu icin bagimsiz kontrolunu yap.',
    'Bulguyu ureten ajana guvenme - o ajan hatali olabilir.',
    'Kararsiz kaldigin bulgular icin real=false ver; baska denetciler de oy veriyor, tek basina karar vermiyorsun.',
    'Dilimindeki her bulgu icin TAM OLARAK BIR karar dondur ve "id" alanini (F01, F02, ... bicimi) BIREBIR kopyala.',
  ].join('\n')
}

/** Script icinde uretilmis bulgulari dogrulatan prompt (yeni lensler ve bosluklar). */
function verifyInlinePrompt(findings, lens) {
  return [
    CONTEXT,
    '',
    '=== GOREV: ADVERSARIAL DOGRULAMA ===',
    'Asagida bu denetim turunda uretilmis bulgular var. Sen bunlari CURUTMEYE calisiyorsun.',
    'Varsayilanin supheci olmak.',
    '',
    lens.instruction,
    '',
    'YONTEM: Once dokumani oku. Sonra HER bulgu icin bagimsiz kontrolunu yap.',
    'Bulguyu ureten ajana guvenme - o ajan hatali olabilir.',
    'Kararsiz kaldigin bulgular icin real=false ver; baska denetciler de oy veriyor, tek basina karar vermiyorsun.',
    'Her bulgu icin TAM OLARAK BIR karar dondur, id alanini birebir kopyala.',
    '',
    'BULGULAR:',
    JSON.stringify(findings, null, 1),
  ].join('\n')
}

/**
 * Oylari tek karara indirger. `base` ya tam bulgu nesnesi (inline yol) ya da yalnizca
 * {id} (dosya yolu) olabilir - her iki durumda da karar alanlari uzerine eklenir.
 * REDDEDILDI olanlar dusurulur.
 */
function consolidate(base, voteResults) {
  const votes = voteResults.filter(Boolean)
  const out = []
  for (const f of base) {
    let yes = 0
    let total = 0
    const objections = []
    const adjustments = []
    for (const v of votes) {
      const match = (v.verdicts || []).find((x) => x.id === f.id)
      if (!match) continue
      total++
      if (match.real) yes++
      else objections.push(match.reason)
      if (match.severityAdjust && match.severityAdjust !== 'ayni') adjustments.push(match.severityAdjust)
    }
    let verdict
    if (total === 0) verdict = 'DOGRULANMADI'
    else if (yes >= 2) verdict = 'ONAYLANDI'
    else if (yes === 1) verdict = 'OLASI'
    else verdict = 'REDDEDILDI'
    if (verdict === 'REDDEDILDI') continue
    out.push({
      ...f,
      ...(adjustments.length && yes >= 2 ? { severity: mostCommon(adjustments) } : {}),
      verdict,
      oy: yes + '/' + total,
      itirazlar: objections.slice(0, 2),
    })
  }
  return out
}

function mostCommon(arr) {
  const counts = {}
  let best = arr[0]
  for (const a of arr) {
    counts[a] = (counts[a] || 0) + 1
    if (counts[a] > (counts[best] || 0)) best = a
  }
  return best
}

const recoveredCount = args && Number.isInteger(args.recoveredCount) ? args.recoveredCount : 0
const recoveredIds = Array.from({ length: recoveredCount }, (_, i) => ({
  id: 'F' + String(i + 1).padStart(2, '0'),
}))

log('Kurtarilmis bulgu: ' + recoveredCount + ' (dosyadan), yeni bulgu: ' + newFindings.length)

const recoveredBatches = ranges(recoveredCount, CHUNK_SIZE)
log(recoveredBatches.length + ' dilim + 1 inline parca dogrulaniyor (her biri 3 supheci).')

// Kurtarilmis bulgular: her dogrulayici kendi dilimini dosyadan okur.
const verifiedRecovered = (
  await pipeline(recoveredBatches, (range, _item, index) =>
    parallel(
      VERIFY_LENSES.map((lens) => () =>
        agent(verifyRangePrompt(range, lens), {
          label: 'dogrula:' + (index + 1) + ':' + lens.key,
          phase: 'Dogrulama',
          schema: VERDICT_SCHEMA,
        }),
      ),
    ).then((votes) => consolidate(recoveredIds.slice(range.start, range.end), votes)),
  )
)
  .filter(Boolean)
  .flat()

// Yeni lenslerin bulgulari: script icinde uretildi, inline dogrulanir.
const verifiedNew = newFindings.length
  ? consolidate(
      newFindings,
      (
        await parallel(
          VERIFY_LENSES.map((lens) => () =>
            agent(verifyInlinePrompt(newFindings, lens), {
              label: 'dogrula:yeni-lensler:' + lens.key,
              phase: 'Dogrulama',
              schema: VERDICT_SCHEMA,
            }),
          ),
        )
      ).filter(Boolean),
    )
  : []

const verified = verifiedRecovered.concat(verifiedNew)

const confirmed = verified.filter((f) => f.verdict === 'ONAYLANDI')
log('Dogrulama sonucu: ' + verified.length + ' bulgu hayatta (' + confirmed.length + ' onaylandi, ' + (verified.length - confirmed.length) + ' olasi).')

// ---------------------------------------------------------------------------
// FAZ 3: eksiklik elestirmeni
// ---------------------------------------------------------------------------

const GAP_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    gaps: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          key: { type: 'string' },
          title: { type: 'string' },
          why: { type: 'string', description: 'neden onemli ve neden hicbir lens bunu yakalamamis' },
          probe: { type: 'string', description: 'bu boslugu inceleyecek ajana verilecek somut talimatlar' },
        },
        required: ['key', 'title', 'why', 'probe'],
      },
    },
  },
  required: ['gaps'],
}

phase('Bosluk Analizi')

const critic = await agent(
  [
    CONTEXT,
    '',
    '=== GOREV: EKSIKLIK ELESTIRMENI ===',
    'Bu dokuman su 10 lensle denetlendi: XP ekonomisi, anti-abuse, veri modeli, API/realtime,',
    'mobil platform gercekleri, olcek/operasyon, hukuk/gizlilik, urun/retention, kapsam/yigin, ic tutarlilik.',
    '',
    'SORU: Bu 10 lensin HICBIRININ bakmadigi ne var?',
    'Dokumani yeniden oku ve sor: bu urunun basarisiz olmasina yol acabilecek, asagidaki onaylanmis',
    'bulgu listesinde HIC gecmeyen konu nedir?',
    '',
    'Ornek dusunme yonleri (bunlarla sinirli kalma, kendi acilarini uret): rekabet analizi ve pazar',
    'konumlandirmasi, kullanici edinme kanali, erisilebilirlik, uluslararasilastirma, marka/isim riski',
    '("Habit War" - savas metaforu, app store ve hedef kitle uzerindeki etkisi), urunun terk edilme anlari,',
    'basarisizlik senaryolari, dokumanin kendi yapisal eksikleri, destek ve kullanici iletisimi.',
    '',
    'En fazla 5 GERCEK bosluk dondur. Zorlama bosluk uretme - 3 saglam bosluk 5 zayiftan iyidir.',
    '',
    'ZATEN ONAYLANMIS BULGULARI SU SEKILDE GOR (ayni konuyu tekrar bulma):',
    'Bu dosya tum bulgularin JSON dizisidir: ' + FINDINGS_FILE,
    'Onaylanan idler: ' + confirmed.map((f) => f.id).join(', '),
    'Basliklari almak icin:',
    '  node -e "const a=require(\'' + FINDINGS_FILE + '\');a.forEach(f=>console.log(f.id, f.severity, f.title))"',
    '',
    'Ayrica bu turda uretilen ek bulgular (dosyada YOK):',
    newFindings.map((f) => '- [' + f.severity + '] ' + f.title).join('\n') || '  (yok)',
  ].join('\n'),
  { label: 'eksiklik-elestirmeni', phase: 'Bosluk Analizi', schema: GAP_SCHEMA },
)

const gaps = critic && critic.gaps ? critic.gaps.slice(0, 5) : []
log('Eksiklik elestirmeni ' + gaps.length + ' bosluk buldu: ' + gaps.map((g) => g.title).join(' | '))

const gapFindings = gaps.length
  ? (
      await pipeline(
        gaps,
        (gap) =>
          agent(
            [
              CONTEXT,
              '',
              '=== GOREV: BOSLUK DENETIMI ===',
              'LENS: ' + gap.title,
              'NEDEN ONEMLI: ' + gap.why,
              '',
              'INCELEME TALIMATLARI:',
              gap.probe,
              '',
              'En fazla 5 bulgu dondur.',
            ].join('\n'),
            { label: 'bosluk:' + gap.key, phase: 'Bosluk Analizi', schema: FINDINGS_SCHEMA },
          ),
        (found, gap) => {
          const items = (found && found.findings ? found.findings : []).map((f) => ({
            ...f,
            id: 'bosluk-' + gap.key + '-' + f.id,
            lens: 'bosluk-' + gap.key,
          }))
          if (!items.length) return Promise.resolve([])
          return parallel(
            VERIFY_LENSES.slice(0, 2).map((lens) => () =>
              agent(verifyInlinePrompt(items, lens), {
                label: 'bosluk-dogrula:' + gap.key + ':' + lens.key,
                phase: 'Bosluk Analizi',
                schema: VERDICT_SCHEMA,
              }),
            ),
          ).then((votes) => consolidate(items, votes))
        },
      )
    )
      .filter(Boolean)
      .flat()
  : []

log('Bosluk turu: ' + gapFindings.length + ' ek bulgu hayatta kaldi.')

const everything = verified.concat(gapFindings)

// ---------------------------------------------------------------------------
// FAZ 4: sentez
// ---------------------------------------------------------------------------

const SYNTH_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ozet: { type: 'string', description: '4-6 cumlelik yonetici ozeti: dokumanin sagligi ve en buyuk tehdit' },
    dogruYapilanlar: { type: 'array', items: { type: 'string' }, description: 'dokumanin gercekten iyi yaptigi 3-5 nokta' },
    oncelikli: {
      type: 'array',
      description: 'tekillestirilmis, onceliklendirilmis nihai liste - en fazla 30 madde',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          sira: { type: 'number' },
          baslik: { type: 'string' },
          bolum: { type: 'string' },
          severity: { type: 'string', enum: ['kritik', 'yuksek', 'orta', 'dusuk'] },
          verdict: { type: 'string', enum: ['ONAYLANDI', 'OLASI'] },
          sorun: { type: 'string', description: 'birlestirilmis problem tanimi, 1-3 cumle' },
          kanit: { type: 'string', description: 'hesaplama sonucu veya dokuman alintisi' },
          duzeltme: { type: 'string', description: 'somut, uygulanabilir duzeltme' },
          kodDurumu: {
            type: 'string',
            enum: ['cozuldu', 'kismen', 'acik'],
            description: 'mevcut repoda durumu - README ve docs/audit dosyasina VE gerekirse koda bakarak karar ver',
          },
          faz: {
            type: 'string',
            enum: ['simdi', 'faz1', 'faz2', 'yayin-oncesi', 'sonra'],
            description: 'ne zaman ele alinmali',
          },
        },
        required: ['sira', 'baslik', 'bolum', 'severity', 'verdict', 'sorun', 'kanit', 'duzeltme', 'kodDurumu', 'faz'],
      },
    },
    sonrakiUcIs: {
      type: 'array',
      items: { type: 'string' },
      description: 'tek gelistiricinin SIRADAKI ucunu yapmasi gereken somut is, gerekce ile',
    },
  },
  required: ['ozet', 'dogruYapilanlar', 'oncelikli', 'sonrakiUcIs'],
}

phase('Sentez')

const synthesis = await agent(
  [
    CONTEXT,
    '',
    '=== GOREV: SENTEZ ===',
    'Adversarial dogrulamadan ' + everything.length + ' bulgu sag cikti.',
    'verdict alani: ONAYLANDI (supheci cogunlugu gecerli buldu) veya OLASI (bolunmus oy).',
    '',
    'BULGU METINLERINI NEREDEN ALACAKSIN:',
    'Idsi F01..F' + String(recoveredCount).padStart(2, '0') + ' olan bulgularin TAM metni su dosyada:',
    '  ' + FINDINGS_FILE,
    'Su komutla oku (id ile eslestir):',
    '  node -e "const a=require(\'' + FINDINGS_FILE + '\');console.log(JSON.stringify(a,null,1))"',
    'Diger idli bulgularin tam metni asagida, JSON icinde zaten var.',
    'SADECE asagidaki listede yer alan idleri sentezle - dosyada olup listede olmayanlar CURUTULMUSTUR.',
    '',
    'YAPACAKLARIN:',
    '1. TEKILLESTIR: farkli lensler ayni sorunu farkli kelimelerle bulmus olabilir. Ortusenleri TEK bulguda',
    '   birlestir; en guclu kanit ve en somut duzeltmeyi koru.',
    '2. KOD DURUMUNU BELIRLE: her bulgu icin repoda durumu ne? README.md ve docs/audit/2026-09-spec-audit.md',
    '   cozulenleri listeliyor; emin olamadiginda packages/domain/src ve apps/api/src icine BAK.',
    '   kodDurumu = cozuldu | kismen | acik.',
    '3. ONCELIKLENDIR: olcut = (geri donulmezlik x etki x tek gelistirici icin maliyet).',
    '   Veri modeli ve XP ekonomisi kararlari gec duzeltilirse pahalidir - one al.',
    '   Hukuki riskler yayin oncesi zorunludur. Zaten cozulmus olanlar sona.',
    '4. AYIKLA: zayif OLASI bulgulari listeye alma. En fazla 30 madde. Az ve keskin olsun.',
    '5. sonrakiUcIs: tek gelistiricinin SIRADAKI uc somut isi ne olmali? Her biri icin kisa gerekce.',
    '   Mevcut durum: Faz 0 bitti (domain motoru + API iskeleti + sema), auth sahte, sosyal katman yok, mobil yok.',
    '',
    'DIL: Turkce. Duzeltme alanlari SOMUT olsun (sayi, formul, sema alani, endpoint adi).',
    '',
    'BULGULAR:',
    JSON.stringify(everything, null, 1),
  ].join('\n'),
  { label: 'sentez', phase: 'Sentez', schema: SYNTH_SCHEMA, effort: 'high' },
)

log('Sentez tamam: ' + ((synthesis && synthesis.oncelikli) || []).length + ' oncelikli bulgu.')

return {
  istatistik: {
    kurtarilmis: recoveredCount,
    bulguDosyasi: FINDINGS_FILE,
    yeniLensBulgusu: newFindings.length,
    bosluklar: gaps.map((g) => g.title),
    boslukBulgusu: gapFindings.length,
    dogrulamaSonrasi: everything.length,
    onaylanan: everything.filter((f) => f.verdict === 'ONAYLANDI').length,
    olasi: everything.filter((f) => f.verdict === 'OLASI').length,
  },
  sentez: synthesis,
  tumBulgular: everything,
}

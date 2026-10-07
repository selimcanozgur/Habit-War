# Habit War — Oyun Tasarımı (v1, tek oyunculu)

> **Durum:** Onaylandı ve uygulandı (v1). Kural değişiklikleri önce burada yapılır, sonra
> koda geçer. Kodla bu belge çeliştiğinde belge doğrudur ve kod düzeltilir.
>
> **Kodda nerede:** kurallar `packages/domain/src/story.ts` (hasar, can tablosu, ilerleme,
> odak barı) ve `balance.ts`; sunucu `apps/api/src/modules/game/story.ts`; ekranlar
> `apps/mobile/app/(tabs)/story.tsx`, `chapter/[n].tsx`, `monsters.tsx`, `monster/[key].tsx`
> ve `src/components/BattleView.tsx`, `VersusIntro.tsx`.

---

## 0. Kapsam

v1 tamamen **tek oyunculu**: kişisel gelişim + hikaye.

| Sekme | Durum | İçerik |
|---|---|---|
| **Bugün** | Görünür | Alışkanlıklar, sayılı hızlı girişler, seans başlatma |
| **Hikaye** | Görünür (Savaş sekmesinin yerine) | Yol haritası, bölümler, canavar ansiklopedisi |
| **Arkadaşlar** | Görünür | Sadece arkadaş ekleme, silme ve istekler. Arkadaşlarla oyun yok |
| **Profil** | Görünür | Karakter, stat'lar, unvanlar, kupalar, ayarlar |
| Akış | Gizli (bayrak) | — |
| Düellolar, arkadaş sıralaması | Gizli (bayrak) | — |

Gizlenen özelliklerin API'si çalışmaya devam eder; sadece uygulamada görünmezler.

---

## 1. Temel ilke: iki ayrı ekonomi

| | **XP** | **Hasar** |
|---|---|---|
| Neyi büyütür | Karakteri: seviye, stat'lar, sınıf | Hikayedeki savaşı |
| Nereden gelir | Mevcut XP formülü (kategori zorluğu, seri, sezon, odak, günlük limitler) | **Sadece çalışılan süre** |
| Değişiyor mu | Hayır, olduğu gibi kalır | Yeni kural (aşağıda) |

**Neden ayrı?** Önceki sürümde hasar XP'den türetiliyordu. Bu yüzden ekrandaki canlı
hasar sadece bir tahmindi ve sunucunun hesapladığı gerçek hasarla tutmuyordu. Ayrıca seri
ve sezon gibi çarpanlar savaşı bulanıklaştırıyordu. Hasar süreye bağlanınca ekranda
görülen sayı ile sunucunun hesapladığı sayı **birebir aynı** olur.

---

## 2. Savaş kuralları

### 2.1 Kime vuruluyor?
Hikayedeki **sıradaki savaşa** (aktif savaş). Aynı anda tek aktif savaş vardır; oyuncu
canavar seçmez. Her tamamlanan seans ve her sayılı giriş o canavara vurur.

### 2.2 Hasar
- **Süreli alışkanlık:** her aktif saniye **1 hasar**. Duraklatılan süre sayılmaz.
- **Zayıflık:** canavarın zayıf olduğu stat'ı çalıştıran alışkanlık saniyede **1.5 hasar**
  verir. Hasar = `floor(aktif saniye × çarpan)`.
- **Sayılı alışkanlık:** her giriş, kredilendiği süre × 60 × çarpan kadar hasar verir.
  Günlük hedefin tamamı 15 dakika = **900 hasar** eder. Hedefin ötesi hasar vermez.
- **Sınırlar:** tek seans en fazla 240 dakika (14.400 hasar). Şüpheli olarak işaretlenen
  (flagged) seanslar hasar vermez.
- **Can kalıcıdır.** Bir canavarın canı seanslar ve günler arasında korunur; büyük
  boss'lar birkaç günde yenilir.
- **Taşan hasar sıradaki savaşa geçer.** Seans sürerken canavarın canı biterse zafer
  animasyonu oynar, sıradaki canavar gelir ve kalan saniyeler ona vurur. Çalışılan zaman
  asla boşa gitmez.
- **Bitir:** seansın XP'si verilir, hasar kalıcılaşır.
- **Vazgeç:** seans hiç sayılmaz; o seansın hasarı geri alınır. Onay metni bunu söyler:
  "Bu seanstaki 754 hasar geri alınacak."

### 2.3 Zayıflık tablosu
Alışkanlığın stat'ı kategorisinden gelir (sunucu da aynı eşlemeyi kullanır):

| Kategori | Stat |
|---|---|
| Spor | Güç (STR) |
| Ders | Zekâ (INT) |
| Zihin, Sağlık | Bilgelik (WIS) |
| Yaratıcılık, Beceri | Beceri (DEX) |
| Sosyal | Karizma (CHA) |

Her canavar bu beş stat'tan birine zayıftır. Zayıflık sadece hızlandırır; hangi
alışkanlığı yaparsan yap, her canavar yenilebilir.

### 2.4 Odak barı (oyuncu tarafı)
VS ekranında oyuncunun tarafında **4 dilimli bir odak barı** bulunur. Bar her seansa dolu
başlar. Seans sırasında uygulamadan çıkmak ya da duraklatmak bir **kesinti** sayılır;
kesintide canavar "karşı saldırır" ve bar düşer.

Bar, mevcut **XP odak çarpanının** görsel karşılığıdır:

| Kesinti | Bar | XP odak çarpanı |
|---|---|---|
| 0 | 4/4 · Kesintisiz | ×1.2 |
| 1–2 | 3/4 | ×1.0 |
| 3–5 | 2/4 | ×0.9 |
| 6+ | 1/4 | ×0.75 |

Odak barı **savaşı kaybettirmez** ve hasarı etkilemez; sadece o seansın XP bonusunu
etkiler. Bar hiçbir zaman sıfıra inmez.

### 2.5 Ödüller
- **Savaş kazanmak:** bölümde ilerletir.
- **Boss'u yenmek:** bölümü bitirir. Karşılığında o canavarın **unvanı**, bir **kupa** ve
  haritada bölgenin yeniden ışıklanması.
- Savaşlar **XP vermez**; XP zaten seansın kendisinden gelmiştir.

---

## 3. Hikaye yolu

### 3.1 Yapı
- **20 bölüm**, sırayla açılır. Seviye şartı yoktur; ilerlemenin tek ölçüsü hikayedir.
- Her bölüm: **3 savaş** (canavarın kendisi, giderek güçlenen) **+ 1 boss**. Toplam 80
  savaş.
- Bir bölümün boss'u yenilince sıradaki bölüm açılır.

### 3.2 Can tablosu
`taban(b) = round(5 + (b − 1) × 40 / 19)` dakika (1. bölüm: 5 dk, 20. bölüm: 45 dk)

| Savaş | Süre çarpanı |
|---|---|
| 1 | ×1 |
| 2 | ×1.5 |
| 3 | ×2 |
| Boss | ×4 |

`Can = round(taban × çarpan × 60)`

| Bölüm | Taban | Savaş 1 | Savaş 2 | Savaş 3 | Boss |
|---|---|---|---|---|---|
| 1 | 5 dk | 300 (5 dk) | 450 (7.5 dk) | 600 (10 dk) | 1.200 (20 dk) |
| 5 | 13 dk | 780 | 1.170 | 1.560 | 3.120 (52 dk) |
| 10 | 24 dk | 1.440 | 2.160 | 2.880 | 5.760 (1 sa 36 dk) |
| 15 | 34 dk | 2.040 | 3.060 | 4.080 | 8.160 (2 sa 16 dk) |
| 20 | 45 dk | 2.700 | 4.050 | 5.400 | 10.800 (3 sa) |

Hikayenin tamamı zayıflık bonusu olmadan yaklaşık **71 saatlik odak**. Günde 45 dakikayla
bu yaklaşık **3 ay** eder. Zayıflığa uygun alışkanlıklarla daha kısa sürer.

### 3.3 Bölüm akışı
1. Bölüme girince bir **giriş sahnesi** (Işıl konuşur, 2–4 kısa satır).
2. Savaş 1 → Savaş 2 → Savaş 3.
3. Boss'tan önce boss'un tek satırlık **meydan okuması**.
4. Boss yenilince **bitiş sahnesi**: bölge kurtulur, unvan kazanılır.
5. Haritada sıradaki bölüm açılır.

### 3.4 Tekrar dövüş
v1'de yok. Yenilen canavarlar ansiklopediye düşer, tekrar dövüşülmez.

---

## 4. Hikaye

### 4.1 Öncül
> Aydınlık Vadisi'nin kalbinde, Işık Kalesi'nde **İrade Ateşi** yanardı. Vadi halkı onu
> her gün küçük işlerle beslerdi: bir sayfa kitap, bir sabah koşusu, bir dost ziyareti.
> Sonra "yarın"lar birikti. Ertelenen her alışkanlıktan bir canavar doğdu; ateş kısıldı
> ve vadiyi gri bir sis kapladı.
>
> Ateşten geriye tek bir kıvılcım kaldı ve o kıvılcım **seni** seçti. Kıvılcımın ruhu
> **Işıl**'la birlikte bölge bölge ilerleyeceksin. Bu yolculukta kılıç yok: gerçek
> hayatta yaptığın her iyi alışkanlık, odaklandığın her saniye bir canavara inen bir
> darbe.
>
> Yenilen canavarlar ölmez; doğdukları iyi alışkanlığa geri dönüşür ve bölge yeniden
> ışıklanır. Yolun sonunda, Sönmüş Kule'de hepsinin kaynağı bekliyor:
> **Alışkanlık Yiyen**.

### 4.2 Karakterler
- **Oyuncu — Kıvılcım Taşıyıcısı:** Avucunda İrade Ateşi'nin son kıvılcımını taşıyan genç
  bir maceracı. Adı oyuncunun kendi adı.
- **Işıl:** Kıvılcımın ruhu; avuç içi büyüklüğünde, konuşan sıcak bir alev. Rehber ve
  anlatıcı. Neşeli, cesaretlendirici, asla yargılamayan.

### 4.3 Ton kuralları
- Sıcak, umutlu ve hafif esprili. Masalsı ama çocukça değil.
- **Oyuncuyu asla suçlamaz.** Canavarlar herkesin bildiği kötü alışkanlıkların ete kemiğe
  bürünmüş hali; düşman oyuncu değil, alışkanlık.
- Kısa satırlar: mobilde bir sahne en fazla 4 satır.
- Her bitiş sahnesi, o alışkanlıkla ilgili küçük ve gerçek bir fikirle kapanır.

### 4.4 Bölümler

| # | Bölge | Canavar · zayıflık | Boss | Unvan | Özet |
|---|---|---|---|---|---|
| 1 | Uyuklayan Köy | Uyuşukluk Balçığı · Güç | Kadim Balçık | Balçık Temizleyici | Kanepeye yapışmış bir köyü harekete geçir |
| 2 | Vızıltı Pazarı | Bildirim Sürüsü · Bilgelik | Sürü Kraliçesi | Sessizlik Ustası | Dikkati bölen sürüyü sustur |
| 3 | Bahaneler Köprüsü | Bahane Goblini · Karizma | Goblin Şefi | Goblin Avcısı | Bahane satan çeteyi dağıt, iki yakayı buluştur |
| 4 | Taş Geçit | Erteleme Golemi · Güç | Taş Dev | Golem Kıran | Ertelenen işlerden örülmüş golemi devir |
| 5 | Rüzgarlı Çarşı | Dağınıklık Cini · Bilgelik | Kaos Cini | Cin Mühürleyici | Her şeyi yarım bırakan cini mühürle |
| 6 | Silik Kütüphane | Unutkanlık Gölgesi · Zekâ | Hiçlik Gölgesi | Gölge Avcısı | Kitapların sayfalarını silen gölgeyi kov |
| 7 | Mavi Işık Malikânesi | Ekran Vampiri · Bilgelik | Vampir Lordu | Vampir Avcısı | Uykusuz bırakan ekran vampirini yen |
| 8 | Döner Değirmen | Rutin Trolü · Beceri | Trol Kral | Trol Deviren | Hep aynı yolda dönen trolü yeni yollara çek |
| 9 | Gri Çöl | Monotonluk Sfenksi · Beceri | Büyük Sfenks | Sfenks Bilgesi | Renkleri çalan sfenksin bilmecesini çöz |
| 10 | Sessiz Liman | Yalnızlık Hayaleti · Karizma | Hayalet Kraliçe | Hayalet Kovucu | Kimsenin uğramadığı limana insanları geri getir |
| 11 | Ağır Tepeler | Tembellik Devi · Güç | Dağ Devi | Dev Yıkan | Tepe olacak kadar uyuyan devi uyandır |
| 12 | Sisli Bataklık | Kafa Karışıklığı Sisi · Zekâ | Fırtına Sisi | Sis Dağıtan | Yolları birbirine karıştıran sisi dağıt |
| 13 | Dar Geçit | Kaygı Yılanı · Bilgelik | Basilisk | Yılan Terbiyecisi | Nefes kesen yılanı sakinlikle yen |
| 14 | Bitmemiş Atölye | Kusursuzluk Heykeli · Beceri | Altın Heykel | Heykel Kıran | "Daha iyi olmadan başlama" diyen heykeli kır |
| 15 | Fısıltı Koyu | Dedikodu Sireni · Karizma | Siren Kraliçesi | Siren Susturan | Dostları birbirinden uzaklaştıran fısıltıyı sustur |
| 16 | Şeker Mağarası | Abur Cubur Ejderi · Güç | Kadim Ejder | Ejderha Avcısı | Gece yarısı pusu kuran ejderle yüzleş |
| 17 | Yankı Vadisi | Şüphe Hidrası · Zekâ | Dokuz Başlı Hidra | Hidra Avcısı | Her cevaba iki soru doğuran hidrayı yen |
| 18 | Dağılmış Şehir | Kaos Elementali · Beceri | Kaos Titanı | Düzen Bekçisi | Darmadağın bir şehre düzen getir |
| 19 | Yarım Kalanlar Sarayı | Vazgeçiş Kralı · Karizma | Vazgeçiş İmparatoru | Kral Deviren | Yarım kalmış hedeflerin sarayını fethet |
| 20 | Sönmüş Kule | Alışkanlık Yiyen · Zekâ | Sonsuz Yiyen | Efsane | İrade Ateşi'ni yeniden yak |

### 4.5 Bölüm metinleri

**20 bölümün tüm metinleri** (bölge, giriş, boss sözü, bitiş, canavar hikayesi)
`apps/mobile/src/story/content.ts` içinde; metin değişiklikleri oradan yapılır. Aşağıdaki
ilk 5 bölüm, tonun referansı olarak burada da duruyor.

**Bölüm 1 — Uyuklayan Köy**
- *Giriş (Işıl):* "Hissediyor musun? Bu köyde herkes 'birazdan kalkarım' deyip kanepeye
  gömülmüş. Uyuşukluk Balçığı sokakları kaplamış; ne kadar uzun oturursan o kadar
  yapışıyor. Ama balçık harekete dayanamaz. Her saniye çalışman ona bir darbe!"
- *Boss — Kadim Balçık:* "Biraz daha otur... Yarın daha güzel bir gün olacak..."
- *Bitiş:* Balçık kuruyup yumuşak bir yosuna dönüşüyor; köylüler birer birer pencereleri
  açıyor. Işıl biraz daha parlak: "İlk kıvılcımı yaktık. Unutma: başlamak için hazır
  hissetmen gerekmiyor, başladıkça hazır oluyorsun."

**Bölüm 2 — Vızıltı Pazarı**
- *Giriş (Işıl):* "Burası vadinin en canlı pazarıydı. Şimdi kimse alışverişini
  bitiremiyor: her tezgâhın başında binlerce minik sinek 'Bak! Şuna da bak!' diye
  vızıldıyor. Dikkat dağıldıkça sürü büyüyor."
- *Boss — Sürü Kraliçesi:* "Bir saniye bak... Sadece bir saniye..."
- *Bitiş:* Pazara sessizlik dönüyor; satıcılar yıllardır ilk kez bir işi baştan sona
  bitiriyor. Işıl: "Dikkat bir kas gibidir. Sen onu çalıştırdıkça güçleniyor."

**Bölüm 3 — Bahaneler Köprüsü**
- *Giriş (Işıl):* "Nehrin iki yakasını bağlayan köprüye bir goblin çetesi gişe kurmuş.
  Geçmek isteyene bahane satıyorlar: 'Bugün hava kötü.' 'Zaten geç kaldın.' 'Pazartesi
  başlarsın.' Kimse karşıya geçemiyor."
- *Boss — Goblin Şefi:* "Bende her güne uygun bir bahane var. Sana da bir tane buluruz!"
- *Bitiş:* Bahaneler suya dökülüp eriyor; iki yakanın insanları yıllar sonra köprünün
  ortasında buluşuyor. Işıl: "Bahaneler insanı yalnız bırakır. Sen yalnız değilsin."

**Bölüm 4 — Taş Geçit**
- *Giriş (Işıl):* "Dağ yolunu dev bir taş golem kapatmış. Her gün biraz daha büyüyor,
  çünkü yapılmayan her iş ona bir taş daha ekliyor. 'Yarın,' diye fısıldıyor, 'yarın
  kaldırırsın beni.'"
- *Boss — Taş Dev:* "Bugün değil. Hiçbir zaman bugün değil."
- *Bitiş:* Golem un ufak olunca altından eski bir patika çıkıyor: yıllardır ertelenen
  yol. Işıl: "Aslında hiç bu kadar ağır değilmiş. Sadece ilk taşı kaldırman gerekiyordu."

**Bölüm 5 — Rüzgarlı Çarşı**
- *Giriş (Işıl):* "Bu çarşıda her şey yarım: yarım dokunmuş halılar, yarım yazılmış
  mektuplar. Dağınıklık Cini herkesin aklını aynı anda on yere savuruyor."
- *Boss — Kaos Cini:* "Neden tek bir şey yapasın? Hepsini birden yap... Hiçbirini
  bitirme."
- *Bitiş:* Rüzgâr diniyor; bir dokumacı halısının son ilmeğini atıyor. Işıl: "Tek bir
  işe verilen tam dikkat, bin yarım işten güçlüdür."

---

## 5. Ekranlar

### 5.0 İlk açılış (bir kez)
Kayıttan sonra sekmelerden önce gelir; bitince `User.onboardedAt` yazılır ve bir daha
görünmez (başka cihazda da). Beş adım:

1. **Işıl:** vadinin ateşi söndü, kıvılcım seni seçti — hikayenin kancası.
2. **Ad:** kahramanının adı (profil adı olarak kaydedilir).
3. **Nasıl savaşılır:** alışkanlık başlat → her saniye 1 hasar (zayıflıkta ×1.5) →
   canavarlar düşer, XP karakteri büyütür. Uygulamadan çıkmanın bedeli: odak.
4. **Ne kazanmak istiyorsun:** en fazla 3 hedef (hareket, kitap, odak, zihin, sağlık,
   öğrenme, üretme, sevdikleri). Her hedef hazır alışkanlıklarını ekler; her hedefte en
   az bir süreli alışkanlık vardır.
5. **İlk savaş:** Uyuşukluk Balçığı, 300 can, tahmini süre ve hangi alışkanlıkla
   savaşılacağı. **Savaşa başla** doğrudan VS girişine götürür; **Şimdi değil** Bugün'e.

### 5.1 Bugün
Yukarıdan aşağı "şimdi ne yapayım?" sorusunu cevaplar:

- **Karakter başlığı:** ad, unvan, seviye ve XP barı, gün serisi (art arda seans yapılan
  günler).
- **Görev kartı:** aktif savaş (bölüm, canavar, can barı), Işıl'ın o ana uygun tek cümlesi
  (boss, "az kaldı", seriyi koru, bugünün ilk darbesi, zayıflık ipucu) ve tek büyük buton:
  en uygun alışkanlıkla savaş (bugün yapılmamış olan, zayıflığa vuran önce) ve tahmini
  süre. "Başka alışkanlık" diğerlerini açar.
- **Bugün listesi:** alışkanlıklar ve "3 / 5". Süreli bir alışkanlığa dokunmak →
  **VS girişi** → **Savaş ekranı**. Sayılı alışkanlıkta **+N** butonu anında vurur; kısa
  bir bildirim çıkar, canavar düşerse zafer ekranı açılır.

### 5.2 VS girişi (2–3 saniye)
- Solda oyuncu: görseli, adı, seviyesi, unvanı ve odak barı.
- Sağda canavar: görseli, adı, "Bölüm 2 · Savaş 1" ya da **BOSS** etiketi, can barı.
- Ortada büyük **VS** ve kısa bir çarpışma animasyonu, titreşim.
- Kendiliğinden savaş ekranına geçer; dokununca hızlıca geçilebilir.

### 5.3 Savaş ekranı (zamanlayıcının yerini alır)
- **Üst:** iki taraf karşı karşıya. Oyuncunun altında odak barı, canavarın altında can
  barı ve sayısı ("1.240 / 1.800").
- **Orta:** büyük sayaç, "Bu seans: 754 hasar". Her saniye küçük bir "−1" (zayıflıkta
  "−1.5") uçar.
- **Kesinti olursa:** canavarın "karşı saldırı" animasyonu oynar ve odak barı düşer.
- **Can sıfıra inerse:** zafer animasyonu oynar, sıradaki canavar gelir, sayaç devam eder.
- **İlk bölüm boyunca:** sayacın altında Işıl'ın ipuçları döner (her saniye hasar,
  uygulamadan çıkma, artan hasar sıradakine geçer, Bitir'e bas).
- **Alt:** Duraklat / Devam et, Bitir, Vazgeç.
- **Diğer sekmelerde:** alttaki çubukta "Bildirim Sürüsü ile savaşıyorsun · 12:40".

### 5.4 Hikaye
- **Yol haritası:** dikey ve kıvrımlı, 20 bölüm. Bölüm durakları:
  - **Tamamlanmış:** altın renkli, bölge ışıklı.
  - **Aktif:** parlayan ve titreşen.
  - **Kilitli:** gri ve sisli.
- **Bölüme dokununca:** bölüm sayfası açılır. Başlık ve bölge, giriş sahnesi, 4 durak
  (3 savaş + boss), ilerleme ve **Savaşa başla** butonu.
- Sağ üstte **Canavar Kitabı** butonu.

### 5.5 Canavar Kitabı ve detay
- **Liste:** karşılaşılan canavarlar görünür. Henüz karşılaşılmayanlar siluet olarak
  "???" yazar.
- **Detay sayfası:**
  - Büyük görsel, adı ve boss formu.
  - Hikayesi (lore) ve hangi bölümde çıktığı.
  - Zayıflığı ve ona karşı etkili alışkanlık türleri.
  - Can puanları ("Boss: ~52 dakikalık odak").
  - Yendiğin savaşlar ve kazandırdığı unvan.

### 5.6 Profil
Karakter (seviye, stat'lar, sınıf), takılı unvan (en son kazanılan), kupalar (yenilen
boss'lar), ayarlar.

---

## 6. Mevcut koddan farklar (uygulama notu)

| Bugün | v1'de |
|---|---|
| Hasar = seans XP'si (sadece tahmin) | Hasar = saniye (kesin, ekranla aynı) |
| Canavar kitabından serbest "Avla" | Hikaye yolu; sıradaki savaş otomatik |
| Canavar başına 15 seviyelik merdiven | Bölüm başına 3 savaş + boss |
| Seviye şartıyla açılan canavarlar | Sırayla açılan bölümler |
| Zamanlayıcı ekranı + canavar paneli | VS girişi + savaş ekranı |
| Savaş sekmesi | Hikaye sekmesi |

Korunanlar: XP ekonomisi, sayılı alışkanlıklar ve kataloğu, duraklatma, odak çarpanı,
alttaki seans çubuğu.

---

## 7. Sonraya bırakılanlar
- Yenilen canavarlarla tekrar dövüş.
- Ses efektleri ve müzik.
- Bölüm ve savaş bildirimleri.
- Arkadaşlarla oyun (düello vb.).

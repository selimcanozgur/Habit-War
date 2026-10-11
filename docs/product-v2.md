# Habit War — Ürün Tanımı (v2: okuma)

> **Durum:** Taslak, 2026-10-10. Bu belge `product-spec.md` ve `game-design.md`'nin yerini
> alır. Kodla çeliştiğinde bu belge doğrudur.

## Tek cümle

**Okuduğun her sayfanın karakterini büyüttüğü, her kitabın yenilecek bir düşman olduğu
okuma uygulaması.**

"War", ertelemeye ve okunmamış kitap yığınına karşı verilen savaş.

**Uygulama her zaman sadece kitap için olacak.** Başka alışkanlık eklenmeyecek; yeni
fikirler okumayı derinleştirmeli, uygulamayı genişletmemeli.

## Kim için

Okumak isteyip bir türlü düzenli okuyamayan biri. İlk kullanıcı: ben.

## Ana döngü

1. **Kitap ekle.** Kitap bir düşmandır; sayfa sayısı onun canıdır.
2. **Günlük hedef seç.** Küçük: 5, 10 veya 20 sayfa. Seçilen saatte tek bir hatırlatma.
3. **Okuduktan sonra sayfayı gir.** 10 saniye. Düşmanın canı düşer, karakter XP alır.
4. **Kitap biter, düşman yenilir.** Rafına kupa olarak eklenir.
5. **Gelişimini gör.** Seviye, toplam sayfa, son 30 günde okunan gün sayısı.

Uygulama okumanın yapıldığı yer değil; okunanın kaydedildiği ve ödüllendirildiği yer.
Zamanlayıcı yok.

## Kurallar

- **Tutarlılık hacimden değerlidir.** Sayfa başına XP, günlük hedefi tutunca ek bonus.
  Her gün 5 sayfa okuyan, bir gün 100 sayfa okuyup bırakandan hızlı büyür.
- **Seri affedicidir.** Bir gün kaçırmak seriyi bozmaz, iki gün üst üste bozar.
- **Hedef tutmuyorsa hedef küçülür.** Bir haftada hedefin yarısından azı tutulduysa
  uygulama daha küçük bir hedef önerir.
- Sayılar (XP, bonus, seviye eğrisi) kendi kullanımımla ayarlanır.

## Ekranlar

| Ekran | İçerik |
|---|---|
| **Bugün** | Okunan kitap (düşman ve canı), bugünkü hedef, "sayfa gir" |
| **Raf** | Okunan ve bitirilen kitaplar (kupalar) |
| **Profil** | Karakter, seviye, istatistikler, ayarlar |

## v1'de olmayanlar

Arkadaşlar, lig, feed, düellolar. Bunlar ancak kullanırken eksikliği gerçekten
hissedilirse gelir. Kitap dışı alışkanlıklar hiçbir sürümde yok.

## Başarı ölçütü

1. Ben 3 hafta kullanınca düzenli okuyor muyum?
2. 10 kişilik testte, 7. günde kaç kişi hâlâ her gün kayıt giriyor?

## Gelir

Temel kullanım ücretsiz, premium abonelik. Premium'un içeriği test sonrasına kalır.

## Dil

Türkçe ve İngilizce, ilk sürümden itibaren. Uygulama cihaz dilini izler, ayarlardan
değiştirilebilir. Metinler kodda sabit yazılmaz, çeviri dosyalarından gelir.

## Karakter

Seviye atladıkça karakterin görüntüsü değişir. Karakterler özel olarak tasarlanacak.

- Görünüm **aşamalar** halinde değişir: her aşama bir seviye aralığını kapsar.
- Aşama sayısı ve seviye aralıkları tek bir yapılandırmada durur. Çizimler gelince
  sadece görseller ve bu yapılandırma güncellenir, kod değişmez.
- Çizimler gelene kadar her aşama için yer tutucu görsel kullanılır.
- Yeni aşamaya geçmek uygulamada ayrı bir an olarak kutlanır.

## Açık kararlar

- **Karakter aşamaları:** kaç aşama, hangi seviyelerde (karakter çizimleriyle birlikte).

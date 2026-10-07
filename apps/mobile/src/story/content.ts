/**
 * The story's words: each chapter's region, its scenes and its monster's lore.
 *
 * The rules — which monster, its weakness, its HP — live in `@habitwar/domain`; this
 * file is only what the player reads. Chapter N here is chapter N there, and its
 * monster is `chapterMonster(N)`.
 *
 * Tone (docs/game-design.md §4.3): warm, hopeful, lightly funny; never blames the
 * player — the enemy is the habit, not the person; a scene is at most four short
 * lines; every ending closes on one small true idea about the habit.
 */

export interface ChapterContent {
  /** The region the chapter restores. */
  readonly region: string;
  /** Işıl's opening scene. */
  readonly intro: string;
  /** The boss's one-line challenge before the fourth fight. */
  readonly bossLine: string;
  /** The scene after the boss falls. */
  readonly outro: string;
  /** What the chapter's monster is, for the monster book. */
  readonly lore: string;
}

export const STORY_PREMISE =
  'Aydınlık Vadisi\'nin kalbinde, Işık Kalesi\'nde İrade Ateşi yanardı. Vadi halkı onu her gün küçük işlerle beslerdi: bir sayfa kitap, bir sabah koşusu, bir dost ziyareti. Sonra "yarın"lar birikti; ertelenen her alışkanlıktan bir canavar doğdu ve ateş kısıldı. Ateşten geriye tek bir kıvılcım kaldı — ve o kıvılcım seni seçti. Bu yolculukta kılıç yok: gerçek hayatta yaptığın her iyi alışkanlık, odaklandığın her saniye bir canavara inen bir darbe.';

export const CHAPTERS: readonly ChapterContent[] = [
  {
    region: 'Uyuklayan Köy',
    intro:
      'Hissediyor musun? Bu köyde herkes "birazdan kalkarım" deyip kanepeye gömülmüş. Uyuşukluk Balçığı sokakları kaplamış; ne kadar uzun oturursan o kadar yapışıyor. Ama balçık harekete dayanamaz. Her saniye çalışman ona bir darbe!',
    bossLine: 'Biraz daha otur... Yarın daha güzel bir gün olacak...',
    outro:
      'Balçık kuruyup yumuşak bir yosuna dönüşüyor; köylüler birer birer pencereleri açıyor. Işıl biraz daha parlak: "İlk kıvılcımı yaktık. Unutma: başlamak için hazır hissetmen gerekmiyor, başladıkça hazır oluyorsun."',
    lore:
      'Uzun oturuşlardan ve "birazdan kalkarım"lardan doğmuş yapışkan bir balçık. Hareketsizlikle kalınlaşır; ter dökülen her dakika onu biraz daha kurutur.',
  },
  {
    region: 'Vızıltı Pazarı',
    intro:
      'Burası vadinin en canlı pazarıydı. Şimdi kimse alışverişini bitiremiyor: her tezgâhın başında binlerce minik sinek "Bak! Şuna da bak!" diye vızıldıyor. Dikkat dağıldıkça sürü büyüyor.',
    bossLine: 'Bir saniye bak... Sadece bir saniye...',
    outro:
      'Pazara sessizlik dönüyor; satıcılar yıllardır ilk kez bir işi baştan sona bitiriyor. Işıl: "Dikkat bir kas gibidir. Sen onu çalıştırdıkça güçleniyor."',
    lore:
      'Her biri küçük, her biri masum görünen binlerce sinek. Tek başlarına zararsızlar; bir araya gelince bütün bir günün dikkatini yiyebilirler. Sessiz ve odaklı bir zihin onları dağıtır.',
  },
  {
    region: 'Bahaneler Köprüsü',
    intro:
      'Nehrin iki yakasını bağlayan köprüye bir goblin çetesi gişe kurmuş. Geçmek isteyene bahane satıyorlar: "Bugün hava kötü." "Zaten geç kaldın." "Pazartesi başlarsın." Kimse karşıya geçemiyor.',
    bossLine: 'Bende her güne uygun bir bahane var. Sana da bir tane buluruz!',
    outro:
      'Bahaneler suya dökülüp eriyor; iki yakanın insanları yıllar sonra köprünün ortasında buluşuyor. Işıl: "Bahaneler insanı yalnız bırakır. Sen yalnız değilsin."',
    lore:
      'Bahane satarak geçinen kurnaz bir goblin. Her güne uygun bir bahanesi vardır ve en çok yalnız kalanları kandırır. Birlikte hareket edenlere bahanesi işlemez.',
  },
  {
    region: 'Taş Geçit',
    intro:
      'Dağ yolunu dev bir taş golem kapatmış. Her gün biraz daha büyüyor, çünkü yapılmayan her iş ona bir taş daha ekliyor. "Yarın," diye fısıldıyor, "yarın kaldırırsın beni."',
    bossLine: 'Bugün değil. Hiçbir zaman bugün değil.',
    outro:
      'Golem un ufak olunca altından eski bir patika çıkıyor: yıllardır ertelenen yol. Işıl: "Aslında hiç bu kadar ağır değilmiş. Sadece ilk taşı kaldırman gerekiyordu."',
    lore:
      'Yapılmayan her iş ona bir taş ekler. Göğsündeki kum saati hiç akmaz, çünkü onun için zaman hep "yarın"dır. Kas gücüyle ve atılan ilk adımla devrilir.',
  },
  {
    region: 'Rüzgarlı Çarşı',
    intro:
      'Bu çarşıda her şey yarım: yarım dokunmuş halılar, yarım yazılmış mektuplar. Dağınıklık Cini herkesin aklını aynı anda on yere savuruyor.',
    bossLine: 'Neden tek bir şey yapasın? Hepsini birden yap... Hiçbirini bitirme.',
    outro:
      'Rüzgâr diniyor; bir dokumacı halısının son ilmeğini atıyor. Işıl: "Tek bir işe verilen tam dikkat, bin yarım işten güçlüdür."',
    lore:
      'Altı koluyla altı işi aynı anda tutar ve hiçbirini bitirmez. Dikkat bölündükçe güçlenir. Tek bir işe verilen sakin bir zihin onu mühürler.',
  },
  {
    region: 'Silik Kütüphane',
    intro:
      'Vadinin en büyük kütüphanesindeyiz. Ama raflardaki kitapların sayfaları birer birer bembeyaz oluyor. Unutkanlık Gölgesi, okunup tekrar edilmeyen her şeyi sessizce siliyor.',
    bossLine: 'Neden hatırlayasın? Nasılsa yine unutacaksın.',
    outro:
      'Sayfalara mürekkep geri dönüyor; yaşlı kütüphaneci ilk kitabı titreyen elleriyle açıyor. Işıl: "Bilgi tekrar ettikçe kök salar. Her gün biraz, unutmaktan güçlüdür."',
    lore:
      'Okunup bir kenara bırakılan her bilgiden bir parça koparak büyür. Dokunduğu sayfalar beyazlar, dokunduğu anılar silikleşir. Tekrar eden ve merak eden zihinlerden kaçar.',
  },
  {
    region: 'Mavi Işık Malikânesi',
    intro:
      'Bu malikânede kimse uyumuyor. Gece yarısı bütün pencerelerden soğuk mavi bir ışık sızıyor. Ekran Vampiri, "bir video daha" diyenlerin saatlerini emiyor.',
    bossLine: 'Kapatma... Sıradaki daha da güzel.',
    outro:
      'Mavi ışık sönüyor, malikâneye sabahın ilk güneşi giriyor; sakinler yıllar sonra dinlenmiş uyanıyor. Işıl: "Dinlenmiş bir zihin, her savaşın yarısını baştan kazanmıştır."',
    lore:
      'Sonsuz kaydırmanın içinden doğmuştur. Kurbanlarının zamanını değil, dikkatini ve uykusunu emer. Ekranı karartan ve başını kaldıran her an onu zayıflatır.',
  },
  {
    region: 'Döner Değirmen',
    intro:
      'Bu değirmen hiç durmadan dönüyor ama hiçbir şey öğütmüyor. Rutin Trolü köy halkını yıllardır aynı yolda, aynı adımlarla yürütüyor. Kimse yeni bir şey denemeye cesaret edemiyor.',
    bossLine: 'Hep böyleydi, hep böyle kalacak.',
    outro:
      'Değirmen duruyor ve köylüler dereye yeni bir köprü kurmaya başlıyor. Işıl: "Küçük bir yenilik, koca bir alışkanlığı yeniden canlandırır."',
    lore:
      'Bir zamanlar iyi bir düzenin bekçisiydi; zamanla düzen bir kafese dönüştü. Yeni bir şey öğrenen ve elleriyle üreten herkes onun çemberini kırar.',
  },
  {
    region: 'Gri Çöl',
    intro:
      'Burası eskiden rengârenk bir bahçeymiş. Şimdi her şey gri, her gün bir öncekinin aynısı. Monotonluk Sfenksi yolculara tek bir bilmece soruyor: "Yarın bugünden farklı olacak mı?"',
    bossLine: 'Cevap ver yolcu. Yoksa sen de taşa dönüşürsün.',
    outro:
      'Sfenks cevabı duyunca kumlar çiçeğe dönüşüyor. Işıl: "Cevap basitmiş: bugün yeni bir şey yaparsan yarın farklı olur."',
    lore:
      'Aynılığın bekçisidir; renkleri ve merakı çalar. Yaratıcı her iş, çizilen her çizgi, öğrenilen her yeni hareket gövdesinde bir çatlak açar.',
  },
  {
    region: 'Sessiz Liman',
    intro:
      'Bu limana yıllardır gemi uğramıyor. Yalnızlık Hayaleti herkese "kimse seni aramaz" diye fısıldıyor; insanlar da kimseyi aramıyor. Liman sessizlikten donmuş.',
    bossLine: 'Kapını kapat. Burada kimse seni anlamaz.',
    outro:
      'Uzakta bir geminin ışığı beliriyor; iskelede biri birine el sallıyor. Işıl: "Bir mesaj, bir telefon... Bağ kurmak cesaret ister ve sen bunu yaptın."',
    lore:
      'Uzun süre kimseyle konuşulmayan evlerde doğar. Soğuğu kapıları kapatır, sesleri kısar. Bir dosta uzanan her el onun buzunu eritir.',
  },
  {
    region: 'Ağır Tepeler',
    intro:
      'Bu tepeler aslında tepe değil: üstünde ağaç bitecek kadar uzun süre uyumuş bir dev. Tembellik Devi her döndüğünde vadide bir sarsıntı oluyor ve herkes biraz daha ağırlaşıyor.',
    bossLine: 'Hıııh... Beş dakika daha...',
    outro:
      'Dev sonunda gözlerini açıyor, geriniyor ve ayağa kalkıp yürüyüp gidiyor. Işıl: "En ağır yük hiç kalkmamaktır. Sen kalktın."',
    lore:
      'Bir zamanlar küçük bir esneyişti. Ertelenen her hareket onu biraz daha büyüttü; şimdi bir dağ kadar ağır. Ter döken her beden onu sarsar.',
  },
  {
    region: 'Sisli Bataklık',
    intro:
      'Bataklığa girenler yolunu kaybediyor; burada her yol başka bir yere çıkıyor. Kafa Karışıklığı Sisi, düşünmeye vakit ayırmayanların aklını bulandırıyor.',
    bossLine: 'Ne aradığını bile hatırlamıyorsun, değil mi?',
    outro:
      'Sis dağılınca bataklığın ortasında düz ve net bir yol görünüyor. Işıl: "Öğrendikçe dünya netleşir. Sis, cehaletin değil, acelenin çocuğudur."',
    lore:
      'Yarım kalmış düşüncelerden ve okunmamış notlardan oluşur. Odaklı çalışan ve öğrendiğini sindiren zihinlerde barınamaz.',
  },
  {
    region: 'Dar Geçit',
    intro:
      'Bu geçit o kadar dar ki yürürken nefesin daralıyor. Kaygı Yılanı her taşın arkasından "Ya başaramazsan?" diye tıslıyor.',
    bossLine: 'Bana bak... Ve olabilecek her kötü şeyi düşün.',
    outro:
      'Derin bir nefes; geçidin duvarları genişliyor gibi. Yılan çözülüp bir sarmaşığa dönüşüyor. Işıl: "Sakinlik bir yetenek değil, bir pratik. Sen de pratik ettin."',
    lore:
      'Belirsizlikten beslenir ve sıkıca sarılır. Bir an durup nefes alan, sakinleşen ve şimdiye dönen her zihin onun halkalarını gevşetir.',
  },
  {
    region: 'Bitmemiş Atölye',
    intro:
      'Bu atölye harika başlangıçlarla dolu: yarım heykeller, bitmemiş tablolar. Kusursuzluk Heykeli her ustaya "Daha iyisini yapamıyorsan hiç yapma" diyor.',
    bossLine: 'Kusurlu bir eser, eser değildir.',
    outro:
      'Bir usta kusurlu ama bitmiş ilk eserini sergiliyor; atölye alkışlarla doluyor. Işıl: "Bitmiş, mükemmelden iyidir. Mükemmel, bitmişlerin üstüne kurulur."',
    lore:
      'Yüksek beklentilerden yontulmuş soğuk bir heykel. Kimseyi durdurmaz, sadece başlatmaz. Üretmeye devam eden her el onu çatlatır.',
  },
  {
    region: 'Fısıltı Koyu',
    intro:
      'Koyda herkes birbirini konuşuyor ama kimse birbiriyle konuşmuyor. Dedikodu Sireni\'nin şarkısı dostları birbirine düşürüyor.',
    bossLine: 'Duydun mu, senin hakkında ne diyorlar?',
    outro:
      'Şarkı susuyor; koyun insanları sahilde birlikte bir sofra kuruyor. Işıl: "Gerçek bağ, birinin arkasından değil, yüzüne söylenen güzel sözlerle kurulur."',
    lore:
      'Söylenen sözlerin yankısından doğmuştur. İnsanları birbirinden uzaklaştırarak güçlenir. İçten bir sohbet ve gerçek bir iyilik onu susturur.',
  },
  {
    region: 'Şeker Mağarası',
    intro:
      'Mağaranın duvarları şekerden; tatlı bir koku seni içeri çağırıyor. Abur Cubur Ejderi gece yarısı mutfaklara uçup herkesi "bir tane daha"ya ikna ediyor.',
    bossLine: 'Bir tane daha. Sadece bir tane. Kimse görmeyecek.',
    outro:
      'Ejder küçülüp sevimli bir kertenkeleye dönüşüyor; mağarada temiz bir pınar akmaya başlıyor. Işıl: "Bedenine iyi bakmak, ona verebileceğin en güzel hediye."',
    lore:
      'Yorgunluktan ve can sıkıntısından beslenir; en çok gece yarısı güçlenir. Hareket eden, su içen ve kendine özen gösteren bedenler onun şeker pullarını döker.',
  },
  {
    region: 'Yankı Vadisi',
    intro:
      'Bu vadide sorduğun her soru iki soru olarak geri yankılanıyor. Şüphe Hidrası\'nın başları "Ya yanlışsa?" diye birbirine bağırıyor ve kimse bir karar veremiyor.',
    bossLine: 'Emin misin? Gerçekten emin misin? Ya değilsen?',
    outro:
      'Hidranın başları susuyor ve vadi ilk kez sessiz. Işıl: "Öğrenmek şüpheyi yok etmez; ona cevap verir."',
    lore:
      'Bir başı kesilse yerine iki soru biter. Bilgiyle beslenen, araştıran ve karar veren zihin onun başlarını teker teker susturur.',
  },
  {
    region: 'Dağılmış Şehir',
    intro:
      'Şehrin sokaklarında her şey havada uçuşuyor: kitaplar, çorap tekleri, yarım planlar. Kaos Elementali düzen kurmaya çalışan herkesin elinden işini kapıyor.',
    bossLine: 'Toplasan ne olacak? Yarın yine dağılacak.',
    outro:
      'Uçuşan eşyalar birer birer yerine iniyor; şehrin meydanındaki saat yeniden çalışmaya başlıyor. Işıl: "Düzen bir kerede değil, her gün biraz kurulur."',
    lore:
      'Ertelenen toplama işlerinden ve yarım bırakılan planlardan doğmuştur. Elleriyle üreten ve ortalığı derleyen herkes onun çekirdeğini soğutur.',
  },
  {
    region: 'Yarım Kalanlar Sarayı',
    intro:
      'Sarayın her kulesi yarıda bırakılmış. Vazgeçiş Kralı tahtından herkese aynı şeyi söylüyor: "Bırak gitsin. Zaten olmayacaktı." Saraydakiler hedeflerini tek tek bırakmış.',
    bossLine: 'Buraya kadar gelmen etkileyici. Ama artık bırakma zamanı.',
    outro:
      'İmparator tahtından iniyor; yarım kulelerden birinde biri yeniden tuğla dizmeye başlıyor. Işıl: "Vazgeçmemek düşmemek değildir; her düştüğünde yeniden başlamaktır."',
    lore:
      'Yarım bırakılan her hedef onun tacına bir taş ekler. Yalnız kaldığında en güçlüdür; birlikte devam eden insanların önünde eğilir.',
  },
  {
    region: 'Sönmüş Kule',
    intro:
      'İşte geldik: Sönmüş Kule. İrade Ateşi\'nin kıvılcımlarını yutan, bütün canavarların kaynağı burada. Işıl ilk kez titriyor: "Ama sen artık o eski sen değilsin. Arkanda ışıklanan on dokuz bölge var."',
    bossLine: 'Her alışkanlık bir gün biter. Ben ise sonsuzum.',
    outro:
      'Kulenin tepesinde İrade Ateşi yeniden yanıyor; ışığı bütün vadiye yayılıyor. Işıl: "Hikaye burada bitmiyor Kıvılcım Taşıyıcısı. Ateşi her gün yeniden beslemek senin elinde."',
    lore:
      'Bütün ertelenen günlerin toplamıdır. Yuttuğu kıvılcımlarla beslenir; ama her gün sürdürülen bir alışkanlık, içindeki bir kıvılcımı özgür bırakır.',
  },
];

/** A chapter's words; chapter is 1-based. */
export function chapterContent(chapter: number): ChapterContent {
  const content = CHAPTERS[Math.min(CHAPTERS.length, Math.max(1, chapter)) - 1];
  if (!content) throw new RangeError(`chapterContent: no chapter ${chapter}`);
  return content;
}

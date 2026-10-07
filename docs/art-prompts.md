# Habit War — Görsel Promptları

Görseller, uygulamadaki mevcut hero illüstrasyonlarıyla (`assets/heroes/`) aynı dünyada
durmalı: Ghibli esintili, elle boyanmış anime tarzı, sıcak ve masalsı.

## Nasıl üretilmeli?

1. **Önce oyuncu karakterini üret** (aşağıdaki "Oyuncu"). Beğendiğin sonucu sonraki tüm
   üretimlerde **stil referansı** olarak ver. Midjourney'de `--sref`; ChatGPT ve Gemini'de
   "bu görselle aynı çizim stilinde" diyerek görseli ekle. Bu, 40 görselin aynı elden
   çıkmış gibi görünmesini sağlar.
2. **Her prompta aşağıdaki STİL bloğunu ekle.** Karakter ve canavarlarda STİL'in yanına
   KARAKTER bloğunu da ekle.
3. **Arka plan:** mümkünse şeffaf PNG iste. Araç desteklemiyorsa düz açık gri arka plan
   iste; arka planı ben kaldırırım.
4. **Yönler önemli:** oyuncu **sağa** bakmalı, canavarlar **sola** bakmalı. VS ekranında
   karşı karşıya duracaklar.
5. **Görselde yazı, logo ya da filigran olmasın.**

### STİL (her prompta ekle)
```
Studio Ghibli–inspired hand-painted anime illustration, soft painterly brushwork,
warm cinematic lighting, rich but harmonious colors, gentle fantasy storybook mood,
high detail, clean readable silhouette, no text, no letters, no watermark, no border.
```

### KARAKTER (karakter ve canavar promptlarına ekle)
```
Full-body character, centered, isolated on a transparent background (or a plain flat
light-grey background if transparency is not available), square 1024x1024, soft rim
light, slight three-quarter view, the whole body visible with a little margin around it.
Expressive and characterful but not scary — suitable for all ages, slightly whimsical.
```

### Dosya adları
Görselleri bu adlarla gönder; doğrudan yerlerine koyacağım:

| Ne | Dosya |
|---|---|
| Oyuncu | `characters/hero.png` |
| Işıl | `characters/isil.png` |
| Canavar | `monsters/<anahtar>.png` |
| Boss formu | `monsters/<anahtar>-boss.png` |
| VS arka planı | `story/vs-background.png` |
| Hikaye haritası | `story/map.png` |

---

## Karakterler

### Oyuncu — `characters/hero.png`
Mevcut hero görsellerindeki maceracının yakın çekim versiyonu.
```
A young adventurer of about 13 with messy dark brown hair, wearing a muted olive-grey
travel jacket with rolled-up sleeves, a brown leather belt with small pouches, dark
trousers and sturdy brown boots, carrying a large worn leather backpack. In one raised
hand he holds a small glowing golden spark, like a tiny living flame. Determined,
friendly expression, confident ready stance, body turned three-quarters to the RIGHT.
```
*İsteğe bağlı kız versiyonu — `characters/hero-b.png`:* aynı prompt, "a young adventurer
girl of about 13 with a messy dark brown ponytail" ile başlayarak.

### Işıl — `characters/isil.png`
```
A tiny friendly fire spirit the size of a hand: a floating warm golden flame with big
round expressive eyes and a soft smile, small wisps of light like little arms, gently
glowing, sparks drifting around it. Cute but not childish, warm and wise.
```

---

## Canavarlar (20 canavar + 20 boss)

Her canavar **sola bakıyor**. Boss formu aynı canavarın daha büyük, daha görkemli ve daha
tehditkâr hali; ikisini art arda üretirsen birbirine benzer çıkarlar.

### 1 · Uyuşukluk Balçığı — `sloth-slime`
```
A big lazy blob of greyish-green slime slumped like a melted couch cushion, half-closed
sleepy eyes, a TV remote and a small pillow stuck inside its jelly body, dripping
lazily, facing LEFT.
```
**Boss · Kadim Balçık — `sloth-slime-boss`**
```
An enormous ancient slime, mossy and layered like old swamp mud, an old armchair sunk
into its body like a throne, sleepy but massive and heavy, tiny glowing yellow eyes,
facing LEFT.
```

### 2 · Bildirim Sürüsü — `notification-swarm`
```
A buzzing swarm of a dozen small round fly-like creatures, each with a glowing red
notification dot on its back and tiny wings shaped like phone screens, forming a loose
cloud with many curious eyes, facing LEFT.
```
**Boss · Sürü Kraliçesi — `notification-swarm-boss`**
```
A large queen insect wearing a crown made of glowing red notification badges,
translucent wings like smartphone screens, commanding a cloud of tiny buzzing drones,
facing LEFT.
```

### 3 · Bahane Goblini — `excuse-goblin`
```
A small green goblin with a big nose and a sly grin, wearing a patched coat with many
pockets stuffed with crumpled paper notes, holding up one note as if selling it,
shifty eyes, facing LEFT.
```
**Boss · Goblin Şefi — `excuse-goblin-boss`**
```
A stout goblin chief sitting on a wobbly throne of stacked paper scrolls and notes,
wearing a crooked tin crown, holding a scroll as long as himself, smug grin, facing LEFT.
```

### 4 · Erteleme Golemi — `procrastination-golem`
```
A hulking stone golem made of stacked grey boulders with unopened letters and sticky
notes wedged between the stones, an old hourglass embedded in its chest with the sand
stuck and not flowing, slow and heavy, facing LEFT.
```
**Boss · Taş Dev — `procrastination-golem-boss`**
```
A colossal stone giant covered in moss and piled-up calendar pages, a huge cracked
hourglass in its chest, glowing amber eyes, looming and ancient, facing LEFT.
```

### 5 · Dağınıklık Cini — `distraction-djinn`
```
A mischievous blue-purple djinn whose lower body is a swirling whirlwind, with six arms
each juggling a different object (a book, a phone, a teacup, a ball, a letter, a key),
playful grin, facing LEFT.
```
**Boss · Kaos Cini — `distraction-djinn-boss`**
```
A towering storm djinn made of tornado winds filled with scattered unfinished things —
half-written pages, tangled yarn, spinning tools — crackling with purple energy, wild
hair made of wind, facing LEFT.
```

### 6 · Unutkanlık Gölgesi — `forgetting-shade`
```
A faint translucent shadow figure in a tattered hooded cloak, its body fading into mist
at the edges, holding a book whose pages turn blank where it touches them, pale glowing
eyes, facing LEFT.
```
**Boss · Hiçlik Gölgesi — `forgetting-shade-boss`**
```
A huge void-like shadow spirit with a hollow starless body, wisps of erased letters and
fading memories swirling around it, wearing a cracked mirror mask, facing LEFT.
```

### 7 · Ekran Vampiri — `screen-vampire`
```
An elegant pale vampire with dark circles under its eyes, lit only by the cold blue glow
of a glowing rectangular screen held close to its face, long black cape, thin fingers,
tired red eyes, facing LEFT.
```
**Boss · Vampir Lordu — `screen-vampire-boss`**
```
A regal vampire lord on a throne surrounded by dozens of floating glowing blue screens,
high-collared cape, cold blue light on its face, aristocratic and menacing, facing LEFT.
```

### 8 · Rutin Trolü — `rut-troll`
```
A bulky brown-grey troll trudging along a deep worn circular groove in the ground,
wearing a small wooden millstone around its neck, bored blank expression, moss on its
shoulders, facing LEFT.
```
**Boss · Trol Kral — `rut-troll-boss`**
```
A giant troll king pushing a massive wooden mill wheel, wearing a heavy stone crown and
chains, an expression of endless boredom, facing LEFT.
```

### 9 · Monotonluk Sfenksi — `monotony-sphinx`
```
A sphinx made of dull grey sandstone with a lion body and an expressionless face, all
colors drained around it, identical repeating patterns carved on its body, sitting
calmly, facing LEFT.
```
**Boss · Büyük Sfenks — `monotony-sphinx-boss`**
```
A colossal ancient grey sphinx half-buried in grey dunes, eyes glowing faintly, the same
scene carved again and again in repeating panels across its body, facing LEFT.
```

### 10 · Yalnızlık Hayaleti — `solitude-wraith`
```
A lonely ghostly figure in flowing pale-blue rags, hugging itself, drifting above the
ground with long trailing sleeves, a faint cold mist around it, sad hollow eyes,
facing LEFT.
```
**Boss · Hayalet Kraliçe — `solitude-wraith-boss`**
```
A tall ghost queen with a long veil and a crown of icicles, surrounded by floating empty
chairs and closed doors, cold blue aura, facing LEFT.
```

### 11 · Tembellik Devi — `laziness-ogre`
```
A huge round ogre half lying down, too heavy to stand up fully, big belly, holding a
pillow like a club, yawning widely, patched clothes, facing LEFT.
```
**Boss · Dağ Devi — `laziness-ogre-boss`**
```
A mountain-sized sleeping giant whose body has become a hill with small trees growing on
it, one enormous eye half open, rumbling, facing LEFT.
```

### 12 · Kafa Karışıklığı Sisi — `fog-of-confusion`
```
A living cloud of grey-violet fog with several confused swirling faces appearing and
disappearing in it, tangled threads and curling question-mark-shaped wisps floating
around, facing LEFT.
```
**Boss · Fırtına Sisi — `fog-of-confusion-boss`**
```
A massive storm-cloud elemental crackling with lightning, its body a maze of swirling
fog, glowing violet eyes at its center, facing LEFT.
```

### 13 · Kaygı Yılanı — `anxiety-serpent`
```
A long thin serpent with dark teal scales coiled tightly around itself, several small
worried eyes along its body, its tail tied in a tight knot, hissing, facing LEFT.
```
**Boss · Basilisk — `anxiety-serpent-boss`**
```
A giant basilisk with a crest of spikes, scales shimmering dark teal and black, glowing
hypnotic eyes, coiled around a crumbling stone pillar, facing LEFT.
```

### 14 · Kusursuzluk Heykeli — `perfection-statue`
```
A flawless white marble statue of a figure frozen mid-pose, one side perfectly polished
and the other side still rough uncarved stone, holding a chisel it never uses, cold
judging expression, facing LEFT.
```
**Boss · Altın Heykel — `perfection-statue-boss`**
```
A towering golden statue on a pedestal polished to a mirror shine, surrounded by
abandoned half-finished sculptures, imperious pose, glowing golden eyes, facing LEFT.
```

### 15 · Dedikodu Sireni — `echo-siren`
```
An eerie but beautiful siren with sea-green skin and long flowing hair, sitting on a
rock, whispering behind her hand, ripples of sound and whisper-shaped wisps floating
around her, facing LEFT.
```
**Boss · Siren Kraliçesi — `echo-siren-boss`**
```
A siren queen rising from dark waves, wearing a coral crown, many small whispering
mouths appearing in the sea foam around her, glowing sea-green eyes, facing LEFT.
```

### 16 · Abur Cubur Ejderi — `junk-drake`
```
A chubby small dragon covered in candy wrappers and crumbs, chips and sweets stuck to its
scales, licking its lips, sticky sugary glaze dripping, greedy eyes, facing LEFT.
```
**Boss · Kadim Ejder — `junk-drake-boss`**
```
An enormous ancient dragon coiled on a mountain of junk food, soda cans and candy, scales
glittering with sugar crystals, breathing a cloud of sweet pink smoke, facing LEFT.
```

### 17 · Şüphe Hidrası — `doubt-hydra`
```
A three-headed serpent hydra, each head looking in a different uncertain direction,
curled question-mark-shaped horns, dark indigo scales, facing LEFT.
```
**Boss · Dokuz Başlı Hidra — `doubt-hydra-boss`**
```
A gigantic nine-headed hydra rising from a dark lake, every head arguing with the
others, indigo and silver scales, menacing, facing LEFT.
```

### 18 · Kaos Elementali — `chaos-elemental`
```
A chaotic elemental creature made of mismatched floating debris — books, clothes, tools,
dishes — orbiting a crackling unstable orange-purple core, facing LEFT.
```
**Boss · Kaos Titanı — `chaos-elemental-boss`**
```
A colossal titan formed from a collapsing city of floating rubble and everyday objects,
a blazing chaotic core in its chest, arms of swirling wreckage, facing LEFT.
```

### 19 · Vazgeçiş Kralı — `quitting-king`
```
A gaunt, tired king slumped on a throne, wearing a crown made of broken trophies,
surrounded by half-built towers and abandoned projects, waving a hand dismissively,
facing LEFT.
```
**Boss · Vazgeçiş İmparatoru — `quitting-king-boss`**
```
An imposing emperor in heavy grey-and-gold robes on a throne of unfinished stairs, a
crown of shattered medals, a long scepter tipped with a small white flag, cold
indifferent stare, facing LEFT.
```

### 20 · Alışkanlık Yiyen — `habit-devourer`
```
The final enemy: a vast shadowy beast with a gaping maw that swallows light, its body
made of tangled dark smoke with countless dimmed golden sparks trapped inside it,
glowing hollow eyes, facing LEFT.
```
**Boss · Sonsuz Yiyen — `habit-devourer-boss`**
```
The true final form: a colossal void creature coiled around a dark extinguished tower,
its body a swirling galaxy of stolen golden sparks, many glowing eyes, overwhelming yet
beautiful, facing LEFT.
```

---

## Arka planlar
Arka planlarda KARAKTER bloğunu ekleme, sadece STİL bloğunu ekle.

### VS ekranı — `story/vs-background.png` (dikey, 1080×1920)
```
Dramatic battlefield background for a versus screen, vertical 1080x1920, split
diagonally: the left half bathed in warm golden morning light over a green valley with a
distant castle, the right half shrouded in cold grey-violet mist and shadow, a glowing
clash of light in the middle. The center and both sides left empty for characters to
stand on. No characters.
```

### Hikaye haritası — `story/map.png` (dikey, 1080×3840)
```
A hand-painted vertical fantasy world map, 1080x3840, seen from a high oblique angle.
A winding road climbs from the bottom (a sunny green valley with a castle and a small
village) to the top (a dark extinguished tower on a mountain wrapped in grey mist).
Along the road, from bottom to top, distinct small regions: a sleepy village, a busy
market, a stone bridge over a river, a rocky mountain pass, a windy bazaar, a faded
library, a manor glowing with blue light, a turning windmill, a grey desert, a quiet
harbor, heavy rolling hills, a misty swamp, a narrow canyon, an unfinished workshop, a
whispering sea cove, a cave glittering with sugar crystals, an echoing valley, a
scattered broken city, a palace of half-built towers, and the dark tower at the summit.
The lower regions are bright and colorful; the higher regions grow greyer and mistier.
No text, no labels.
```

### İsteğe bağlı: bölge sahneleri — `story/region-01.png` … `region-20.png`
Bölüm sayfasının üst görseli için. Mevcut hero görselleriyle aynı çerçeveyi kullan:
geniş manzara, 920×613, uzakta küçük maceracı. Bölge adlarını haritadaki sırayla
kullan. Bunlar sonraya kalabilir; uygulama yer tutucuyla çalışır.

---

## Öncelik sırası
1. `hero.png` ve `isil.png` (stil referansı olacak)
2. İlk 5 canavar ve boss'ları (ilk 5 bölüm)
3. `vs-background.png`
4. `map.png`
5. Kalan 15 canavar ve boss'ları
6. Bölge sahneleri (isteğe bağlı)

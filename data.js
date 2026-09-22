/* 魔王城リゾート データ定義
   施設・客・従業員・イベント・ランキング。数値の調整はここだけ触ればよい。 */

// 好みの属性: thrill=スリル heal=癒し food=グルメ rare=レア need=生理的欲求
const TAG_NAME = { thrill: 'スリル', heal: 'いやし', food: 'グルメ', rare: 'レア', need: 'ひつよう', deco: 'かざり' };

/* 施設
   w,h: タイル数 / cost: 建設費 / price: 料金 / upkeep: 月の維持費
   appeal: 客を引き寄せる力 / cap: 同時に入れる人数 / dur: 滞在秒数（ゲーム内 1日=3秒）
   sat: 基本満足度(-50..+50) / tags: 属性 / rp: アンロックに必要な研究ポイント(0=最初から)
   color: 仮素材の色 / icon: 仮素材の絵文字 */
const FACILITIES = [
  { id: 'golem_yaki', name: 'ゴーレム焼き', icon: '🍢', w: 1, h: 1, cost: 700, price: 40, upkeep: 60, appeal: 5, cap: 2, dur: 2, sat: 8, tags: ['food'], rp: 0, color: '#b5651d',
    desc: '魔界名物、石のように固いたい焼き。歯が折れても保証なし。' },
  { id: 'mimic_gacha', name: 'ミミックガチャ', icon: '🎁', w: 1, h: 1, cost: 800, price: 50, upkeep: 40, appeal: 6, cap: 1, dur: 1.5, sat: 10, tags: ['rare'], rp: 0, color: '#c9a227',
    desc: '宝箱を開けるとたまに噛まれる。景品は魔王グッズ。' },
  { id: 'souvenir', name: '魔界みやげ屋', icon: '🛍️', w: 1, h: 1, cost: 1000, price: 60, upkeep: 80, appeal: 5, cap: 3, dur: 2, sat: 6, tags: ['rare', 'food'], rp: 0, color: '#8e44ad',
    desc: '魔王まんじゅう、勇者の涙（水）など。' },
  { id: 'slime_bath', name: 'スライム風呂', icon: '🟢', w: 2, h: 2, cost: 1500, price: 80, upkeep: 100, appeal: 9, cap: 4, dur: 4, sat: 15, tags: ['heal'], rp: 0, color: '#2ecc71',
    desc: 'ぷるぷるのスライムに浸かる。美肌効果あり。たまに溶ける。' },
  { id: 'haunted_cell', name: '幽霊牢屋', icon: '👻', w: 2, h: 2, cost: 2000, price: 100, upkeep: 120, appeal: 10, cap: 3, dur: 4, sat: 15, tags: ['thrill'], rp: 0, color: '#5d6d7e',
    desc: '元・地下牢。幽霊は本物なので演出費ゼロ。' },
  { id: 'dungeon_tour', name: 'ダンジョン体験', icon: '🕯️', w: 2, h: 2, cost: 2500, price: 120, upkeep: 150, appeal: 12, cap: 4, dur: 5, sat: 18, tags: ['thrill', 'rare'], rp: 0, color: '#7f8c8d',
    desc: '罠は全部スイッチを切ってある……はず。' },
  { id: 'toilet', name: '魔界トイレ', icon: '🚻', w: 1, h: 1, cost: 500, price: 0, upkeep: 30, appeal: 0, cap: 2, dur: 1, sat: 5, tags: ['need'], rp: 0, color: '#3498db',
    desc: '無いと客が怒って帰る。地味に一番大事。' },
  { id: 'bench', name: '骨のベンチ', icon: '🪑', w: 1, h: 1, cost: 200, price: 0, upkeep: 5, appeal: 0, cap: 2, dur: 1.5, sat: 4, tags: ['heal', 'need'], rp: 0, color: '#d5d8dc',
    desc: '誰の骨かは聞かないのがマナー。休憩すると疲れが回復。' },
  { id: 'tree', name: '魔界の木', icon: '🌳', w: 1, h: 1, cost: 150, price: 0, upkeep: 0, appeal: 0, cap: 0, dur: 0, sat: 0, tags: ['deco'], rp: 0, color: '#1e8449',
    desc: '飾り。近くを通った客の気分がちょっと良くなる。' },
  { id: 'bat_cafe', name: 'コウモリカフェ', icon: '☕', w: 1, h: 1, cost: 1500, price: 60, upkeep: 90, appeal: 8, cap: 3, dur: 3, sat: 12, tags: ['food', 'heal'], rp: 10, color: '#6c3483',
    desc: 'コウモリが頭上を飛び交う癒し空間。飲み物はトマトジュース。' },
  { id: 'poison_pool', name: '毒沼プール', icon: '🏊', w: 2, h: 2, cost: 3000, price: 120, upkeep: 180, appeal: 13, cap: 5, dur: 5, sat: 18, tags: ['thrill', 'heal'], rp: 15, color: '#9b59b6',
    desc: '毒は抜いてあります（たぶん）。紫色に染まっても自己責任。' },
  { id: 'skull_live', name: '骸骨バンドライブ', icon: '🎸', w: 2, h: 2, cost: 3500, price: 150, upkeep: 200, appeal: 15, cap: 6, dur: 5, sat: 22, tags: ['thrill', 'rare'], rp: 20, color: '#e74c3c',
    desc: '骨を鳴らして演奏するデスメタル。ドラムは頭蓋骨。' },
  { id: 'lava_onsen', name: '溶岩温泉', icon: '♨️', w: 2, h: 2, cost: 4500, price: 180, upkeep: 250, appeal: 16, cap: 5, dur: 6, sat: 25, tags: ['heal'], rp: 25, color: '#e67e22',
    desc: '源泉かけ流し1200℃。魔物専用のはずだが人間も入りたがる。' },
  { id: 'dragon_ride', name: 'ドラゴン遊覧', icon: '🐉', w: 2, h: 2, cost: 6000, price: 250, upkeep: 350, appeal: 20, cap: 3, dur: 6, sat: 30, tags: ['thrill', 'rare'], rp: 30, color: '#c0392b',
    desc: '元四天王のドラゴンが背中に乗せてくれる。機嫌が悪いと火を吐く。' },
  { id: 'maou_photo', name: '魔王さま撮影会', icon: '📸', w: 1, h: 1, cost: 2500, price: 150, upkeep: 100, appeal: 14, cap: 1, dur: 2, sat: 22, tags: ['rare'], rp: 40, color: '#f1c40f',
    desc: '魔王と記念撮影。ピースサインはしてくれない。' },
  { id: 'hero_arena', name: '勇者コロシアム', icon: '⚔️', w: 3, h: 3, cost: 12000, price: 350, upkeep: 600, appeal: 30, cap: 10, dur: 8, sat: 35, tags: ['thrill', 'rare'], rp: 60, color: '#922b21',
    desc: '客が勇者役、従業員が魔王役で模擬戦。負けても景品あり。' },
];
const FAC = Object.fromEntries(FACILITIES.map(f => [f.id, f]));

/* 客の種類
   money: 所持金 / pref: 好みの属性と重み / visits: 帰るまでに回る施設数の目安
   rate: 出現の重み（人気が上がるほどレア客が増える） */
const GUEST_TYPES = [
  { id: 'adventurer', name: '冒険者', icon: '🧝', money: 900, pref: { thrill: 1.5, rare: 0.8, heal: 0.4, food: 0.6 }, visits: 4, rate: 30, minRep: 0 },
  { id: 'tourist', name: '観光客', icon: '🎒', money: 700, pref: { heal: 1.5, food: 1.0, rare: 0.6, thrill: 0.5 }, visits: 4, rate: 30, minRep: 0 },
  { id: 'monster_family', name: '魔物ファミリー', icon: '👹', money: 600, pref: { food: 1.6, thrill: 0.8, heal: 0.7, rare: 0.4 }, visits: 3, rate: 25, minRep: 0 },
  { id: 'noble', name: '貴族', icon: '🎩', money: 2500, pref: { rare: 1.8, heal: 1.0, food: 0.6, thrill: 0.3 }, visits: 5, rate: 10, minRep: 100 },
  { id: 'princess', name: '王女', icon: '👸', money: 4000, pref: { rare: 1.5, heal: 1.2, thrill: 1.2, food: 0.8 }, visits: 6, rate: 3, minRep: 300 },
  { id: 'hero', name: '勇者', icon: '🦸', money: 3000, pref: { thrill: 2.0, rare: 1.0, heal: 0.5, food: 0.8 }, visits: 6, rate: 0, minRep: 0 },
];
const GUEST = Object.fromEntries(GUEST_TYPES.map(g => [g.id, g]));

/* 従業員（元ボス魔物）
   salary: 月給 / hire: 契約金 / bonus: 配属した施設への効果
   appeal: 魅力+ / sat: 満足度+ / speed: 回転率(滞在時間短縮) / research: 研究ポイント倍率 / upkeep: 維持費割引 */
const STAFF_POOL = [
  { id: 'skeleton', name: 'スケルトン', icon: '💀', hire: 300, salary: 100, bonus: { appeal: 2, sat: 3 }, line: '骨身を惜しまず働きます。文字通り。' },
  { id: 'minotaur', name: 'ミノタウロス', icon: '🐂', hire: 1200, salary: 300, bonus: { appeal: 6, sat: 8, tag: 'thrill' }, line: '迷路担当でした。道案内は苦手です。' },
  { id: 'succubus', name: 'サキュバス', icon: '💋', hire: 1500, salary: 350, bonus: { appeal: 10, sat: 5 }, line: 'お客を魅了して財布を軽くします。' },
  { id: 'lich', name: 'リッチ', icon: '🧙', hire: 1800, salary: 400, bonus: { appeal: 3, sat: 5, research: 2 }, line: '千年の知識を研究に。実験台も募集中。' },
  { id: 'golem', name: 'ゴーレム', icon: '🗿', hire: 1000, salary: 250, bonus: { appeal: 2, sat: 6, upkeep: 0.5 }, line: '……（メンテナンスは任せろ、の意）' },
  { id: 'slime_king', name: 'キングスライム', icon: '👑', hire: 900, salary: 200, bonus: { appeal: 5, sat: 10, tag: 'heal' }, line: '触り心地には自信があります。' },
  { id: 'dragon', name: 'ドラゴン', icon: '🐲', hire: 4000, salary: 800, bonus: { appeal: 15, sat: 12, tag: 'thrill' }, line: '元四天王。今はバイト。' },
  { id: 'ghost_chef', name: 'ゴーストシェフ', icon: '🍳', hire: 1300, salary: 320, bonus: { appeal: 6, sat: 10, tag: 'food' }, line: '生前は宮廷料理人。味見ができないのが悩み。' },
];
const STAFF = Object.fromEntries(STAFF_POOL.map(s => [s.id, s]));

/* 月イベント（月初に抽選）。effect はゲーム側で解釈する */
const EVENTS = [
  { id: 'hero_party', name: '勇者パーティ来訪', icon: '🦸', weight: 15, minRep: 80,
    text: '勇者パーティが「偵察」に来た。全員を満足させれば推薦状がもらえるぞ。', effect: 'hero_party' },
  { id: 'storm', name: '魔界の嵐', icon: '🌩️', weight: 15, minRep: 0,
    text: '魔界の嵐が3日間続く。客足が途絶える……', effect: 'storm' },
  { id: 'tv', name: '魔界テレビ取材', icon: '📺', weight: 15, minRep: 120,
    text: '「魔界の歩き方」の取材が来た！今月は客が1.5倍。', effect: 'tv' },
  { id: 'inspection', name: '閻魔庁の立入検査', icon: '📋', weight: 10, minRep: 150,
    text: 'トイレとベンチが足りないと罰金。しっかり整えておこう。', effect: 'inspection' },
  { id: 'festival', name: '魔界フェス', icon: '🎆', weight: 10, minRep: 50,
    text: '魔界フェス開催！魔物ファミリーが大量に来る。', effect: 'festival' },
  { id: 'none', name: '平穏な月', icon: '🌙', weight: 35, minRep: 0, text: '', effect: 'none' },
];

/* ランキング（人気で決まる） */
const RANKS = [
  { min: 0, name: '圏外', title: '廃城' },
  { min: 60, name: '魔界観光地 50位', title: '無名スポット' },
  { min: 150, name: '魔界観光地 20位', title: '穴場スポット' },
  { min: 300, name: '魔界観光地 10位', title: '話題のスポット' },
  { min: 500, name: '魔界観光地 3位', title: '魔界の名所' },
  { min: 750, name: '魔界観光地 1位', title: '魔界一のリゾート' },
  { min: 1000, name: '殿堂入り', title: '伝説の魔王城' },
];

/* 客のつぶやき（気分に応じて） */
const MOODS = {
  happy: ['最高！', 'また来よう', 'すごい！', '魔王ばんざい'],
  ok: ['ふつう', 'まあまあ', 'ふむ'],
  angry: ['つまらん', '高い！', '待ちすぎ', 'トイレどこ'],
  need_toilet: ['トイレ…！'],
  tired: ['休みたい…'],
  hungry: ['腹へった'],
};

/* 魔王のひとこと（月末レポートなどで） */
const MAOU_LINES = {
  good: ['ふはは、我が城は魔界一よ！', '勇者め、見ているか。これが復興だ。', '客の笑顔……悪くない。'],
  bad: ['……客が来ぬ。呪いか？', '赤字とは。世界征服より難しい。', '勇者に負けた日より辛い。'],
  start: ['勇者に負けて無職になった。だが城は残っている。', 'テーマパーク？ 良いだろう、世界を笑顔で征服してやる。'],
};

// 時間の定義（ゲーム内）
const DAY_SEC = 3;       // 1日 = 3秒（等速）
const DAYS_PER_MONTH = 30;
const START_MONEY = 5000;

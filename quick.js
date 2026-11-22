// 빠른 추가: "12일 오전9시 다이소가기, 15일 오후7시 오징어먹기 빨강" 같은 글을 일정으로 바꿉니다.
// 한 줄(또는 쉼표)마다 일정 하나. 날짜가 없으면 오늘, 시간이 없으면 시간 없이, 색이 없으면 기본색.

const COLORS = [
  [['빨강', '빨간', '빨', '레드', '적색'], '#d23c3c'],
  [['주황', '오렌지'], '#e8572a'],
  [['노랑', '노란', '옐로', '황색'], '#d6a21f'],
  [['초록', '녹색', '그린', '연두'], '#1f9d6b'],
  [['하늘', '민트', '청록'], '#2aa6b8'],
  [['파랑', '파란', '블루', '청색', '남색'], '#2f6fdf'],
  [['보라', '퍼플', '자주'], '#9b4fd6'],
  [['분홍', '핑크'], '#d23c7a'],
  [['갈색', '브라운', '갈'], '#7a4b2a'],
  [['검정', '검은', '블랙', '까만', '검'], '#1f2723'],
];
const WD = '월화수목금토일';

const pad = n => String(n).padStart(2, '0');
export const ymdOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dayOnly = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());

function colorOf(word) {
  if (/^#[0-9a-f]{6}$/i.test(word)) return word.toLowerCase();
  const w = word.replace(/(색깔로|색깔|색으로|색|으로|로)$/, '');
  for (const [names, hex] of COLORS) if (names.includes(w)) return hex;
  return null;
}

function kindOf(text) {
  if (/공지/.test(text)) return '공지';
  if (/외출|외박|휴가|연가|병가/.test(text)) return '외출·외박';
  if (/교육|훈련|수업|강의/.test(text)) return '교육·훈련';
  if (/근무|당직|야간|주간|교대|출근/.test(text)) return '근무';
  return '개인';
}

export function parseOne(src, now = new Date()) {
  const today = dayOnly(now);
  let s = ' ' + src.trim() + ' ';
  let date = null, time = '', color = null, guessedDate = false;
  const cut = re => { const m = s.match(re); if (m) s = s.replace(m[0], ' '); return m; };

  // 색: 맨 끝 단어
  const words = src.trim().split(/\s+/);
  if (words.length > 1) {
    const c = colorOf(words[words.length - 1]);
    if (c) { color = c; s = ' ' + words.slice(0, -1).join(' ') + ' '; }
  }

  // 날짜
  let m;
  if ((m = cut(/(?:(\d{4})\s*년\s*)?(\d{1,2})\s*월\s*(\d{1,2})\s*일(?:\s*에)?/))) {
    const y = m[1] ? +m[1] : today.getFullYear();
    date = new Date(y, +m[2] - 1, +m[3]);
    if (!m[1] && date < today) date.setFullYear(y + 1);
  } else if ((m = cut(/(?<![\d:])(\d{1,2})\s*[\/.]\s*(\d{1,2})(?![\d:])(?:\s*에)?/))) {
    date = new Date(today.getFullYear(), +m[1] - 1, +m[2]);
    if (date < today) date.setFullYear(today.getFullYear() + 1);
  } else if ((m = cut(/(?<!\d)(\d{1,2})\s*일(?![가-힣]*요일)(?:\s*에)?/))) {
    date = new Date(today.getFullYear(), today.getMonth(), +m[1]);
    if (date < today) date = new Date(today.getFullYear(), today.getMonth() + 1, +m[1]);
  } else if ((m = cut(/(오늘|내일|낼|모레|글피)(?:\s*에)?/))) {
    date = new Date(today); date.setDate(date.getDate() + { 오늘: 0, 내일: 1, 낼: 1, 모레: 2, 글피: 3 }[m[1]]);
  } else if ((m = cut(/(다음\s*주|담주|다다음\s*주|이번\s*주)?\s*([월화수목금토일])요일(?:\s*에)?/))) {
    const wi = WD.indexOf(m[2]), mon = new Date(today); mon.setDate(mon.getDate() - ((mon.getDay() + 6) % 7));
    const wk = !m[1] ? null : /다다음/.test(m[1]) ? 2 : /다음|담/.test(m[1]) ? 1 : 0;
    if (wk === null) { date = new Date(mon); date.setDate(mon.getDate() + wi); if (date < today) date.setDate(date.getDate() + 7); }
    else { date = new Date(mon); date.setDate(mon.getDate() + wk * 7 + wi); }
  }
  if (date && (isNaN(date) || date.getDate() !== (date.getDate()))) date = null;

  // 시간
  const pm = w => /오후|저녁|밤|낮|점심/.test(w || '');
  const fix = (w, h) => {
    if (pm(w) && h < 12 && !(w === '점심' && h >= 11) && !(w === '밤' && h === 12)) h += 12;
    if (/오전|아침|새벽/.test(w || '') && h === 12) h = 0;
    if (w === '밤' && h === 12) h = 0;
    return h;
  };
  if ((m = cut(/(오전|오후|아침|점심|저녁|밤|새벽|낮)?\s*(\d{1,2})\s*:\s*(\d{2})(?:\s*에)?/))) {
    const h = fix(m[1], +m[2]), mi = +m[3];
    if (h < 24 && mi < 60) time = `${pad(h)}:${pad(mi)}`;
  } else if ((m = cut(/(오전|오후|아침|점심|저녁|밤|새벽|낮)?\s*(\d{1,2})\s*시\s*(?:(\d{1,2})\s*분|(반))?(?:\s*에)?/))) {
    const h = fix(m[1], +m[2]), mi = m[4] ? 30 : m[3] ? +m[3] : 0;
    if (h < 24 && mi < 60) time = `${pad(h)}:${pad(mi)}`;
  }

  const text = s.replace(/\s+/g, ' ').replace(/^\s*(에|에는)\s+/, '').trim();
  if (!date) { date = today; guessedDate = true; }
  const out = { src: src.trim(), date: ymdOf(date), time, text, color, kind: kindOf(text), guessedDate };
  if (!text) out.error = '내용이 없어요';
  return out;
}

export function parseQuick(input, now = new Date()) {
  return input.split(/[,，\n]+/).map(x => x.trim()).filter(Boolean).map(x => parseOne(x, now));
}

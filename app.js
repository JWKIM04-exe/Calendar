import { firebaseConfig, DEFAULT_GROUP } from './config.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const monday = d => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const DAYS = ['월', '화', '수', '목', '금', '토', '일'];
const STAY = [['in', '시설 합숙'], ['out', '외출'], ['over', '외박'], ['leave', '휴가'], ['home', '출퇴근']];
const STAY_L = Object.fromEntries(STAY);
const COLORS = ['#2f6fdf', '#e8572a', '#1f9d6b', '#9b4fd6', '#d6a21f', '#d23c7a', '#2aa6b8', '#6b7a1f', '#7a4b2a', '#4a5568'];
const lsGet = k => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

const group = (new URLSearchParams(location.search).get('g') || DEFAULT_GROUP).replace(/[^\w가-힣-]/g, '').slice(0, 40) || 'default';
const ME_KEY = `daechae-me-${group}`;

function banner(msg, err) { const b = $('banner'); b.textContent = msg; b.className = 'banner' + (err ? ' err' : ''); b.hidden = !msg; }
function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('on'), 1800); }

/* ---------- 저장소: Firebase ---------- */
async function firebaseStore(cfg) {
  const V = '10.12.2', base = `https://www.gstatic.com/firebasejs/${V}`;
  const { initializeApp } = await import(`${base}/firebase-app.js`);
  const fs = await import(`${base}/firebase-firestore.js`);
  const au = await import(`${base}/firebase-auth.js`);
  const app = initializeApp(cfg);
  await au.signInAnonymously(au.getAuth(app));
  const db = fs.getFirestore(app);
  const col = n => fs.collection(db, 'groups', group, n);
  const list = s => s.docs.map(d => ({ id: d.id, ...d.data() }));
  return {
    mode: 'firebase',
    watchMembers: cb => fs.onSnapshot(col('members'), s => cb(list(s)), e => banner('멤버 불러오기 실패: ' + e.message, true)),
    saveMember: m => fs.setDoc(fs.doc(col('members'), m.id), m, { merge: true }),
    watchWeek(start, end, cb) {
      const st = { events: [], stays: [], memos: [] };
      const fail = e => banner('일정 불러오기 실패: ' + e.message, true);
      const range = n => fs.query(col(n), fs.where('date', '>=', start), fs.where('date', '<=', end));
      const u = [
        fs.onSnapshot(range('events'), s => { st.events = list(s); cb(st); }, fail),
        fs.onSnapshot(range('stays'), s => { st.stays = list(s); cb(st); }, fail),
        fs.onSnapshot(fs.query(col('memos'), fs.where('week', '==', start)), s => { st.memos = list(s); cb(st); }, fail),
      ];
      return () => u.forEach(f => f());
    },
    addEvent: e => fs.addDoc(col('events'), { ...e, createdAt: fs.serverTimestamp() }),
    updateEvent: (id, p) => fs.updateDoc(fs.doc(col('events'), id), p),
    deleteEvent: id => fs.deleteDoc(fs.doc(col('events'), id)),
    setStay: (member, date, stay) => fs.setDoc(fs.doc(col('stays'), `${member}_${date}`), { member, date, stay }),
    setMemo: (member, week, data) => fs.setDoc(fs.doc(col('memos'), `${member}_${week}`), { member, week, ...data }, { merge: true }),
  };
}

/* ---------- 저장소: 로컬(설정 전 미리보기) ---------- */
function localStore() {
  const KEY = `daechae-local-${group}`;
  const load = () => { try { return JSON.parse(lsGet(KEY)) || {}; } catch { return {}; } };
  let d = Object.assign({ members: {}, events: {}, stays: {}, memos: {} }, load());
  const subs = new Set();
  const emit = () => subs.forEach(f => f());
  const put = () => { lsSet(KEY, JSON.stringify(d)); emit(); };
  addEventListener('storage', e => { if (e.key === KEY) { d = Object.assign({ members: {}, events: {}, stays: {}, memos: {} }, load()); emit(); } });
  const sub = f => { subs.add(f); f(); return () => subs.delete(f); };
  const vals = (o, id = true) => Object.entries(o).map(([k, v]) => (id ? { id: k, ...v } : v));
  return {
    mode: 'local',
    watchMembers: cb => sub(() => cb(vals(d.members))),
    saveMember: async m => { d.members[m.id] = { ...d.members[m.id], ...m }; put(); },
    watchWeek: (start, end, cb) => sub(() => cb({
      events: vals(d.events).filter(e => e.date >= start && e.date <= end),
      stays: vals(d.stays).filter(s => s.date >= start && s.date <= end),
      memos: vals(d.memos).filter(m => m.week === start),
    })),
    addEvent: async e => { d.events[uid()] = e; put(); },
    updateEvent: async (id, p) => { Object.assign(d.events[id], p); put(); },
    deleteEvent: async id => { delete d.events[id]; put(); },
    setStay: async (member, date, stay) => { d.stays[`${member}_${date}`] = { member, date, stay }; put(); },
    setMemo: async (member, week, data) => { const k = `${member}_${week}`; d.memos[k] = { ...d.memos[k], member, week, ...data }; put(); },
  };
}

/* ---------- 상태 ---------- */
let store, members = [], week = { events: [], stays: [], memos: [] };
let me = lsGet(ME_KEY), filter = 'all', cur = monday(new Date()), unWeek = null, target = null;
const colorOf = id => { const i = members.findIndex(m => m.id === id); return COLORS[(i < 0 ? 0 : i) % COLORS.length]; };
const nameOf = id => members.find(m => m.id === id)?.name || '알 수 없음';
const myInfo = () => members.find(m => m.id === me);

function prog() {
  const m = myInfo();
  if (!m || !m.st || !m.en) { $('dday').textContent = 'D-?'; $('pbar').style.width = '0'; $('ptxt').textContent = m ? '내 정보에서 복무 시작일을 입력하세요' : '내 정보를 등록하세요'; return; }
  const day = 864e5, t = new Date(ymd(new Date())), S = new Date(m.st), E = new Date(m.en);
  const total = Math.round((E - S) / day) + 1, done = Math.min(total, Math.max(0, Math.round((t - S) / day) + 1)), left = Math.round((E - t) / day);
  const p = total > 0 ? done / total * 100 : 0;
  $('dday').textContent = left > 0 ? `D-${left}` : left === 0 ? 'D-Day' : '복무 완료';
  $('pbar').style.width = p.toFixed(1) + '%';
  $('ptxt').textContent = `${m.name} · ${done}일 / ${total}일 (${p.toFixed(1)}%)`;
}

function renderMembers() {
  const dd = m => { if (!m.en) return ''; const l = Math.round((new Date(m.en) - new Date(ymd(new Date()))) / 864e5); return l >= 0 ? ` D-${l}` : ' 완료'; };
  $('members').innerHTML = `<button class="chip ${filter === 'all' ? 'on' : ''}" data-f="all">전체 ${members.length}명</button>` +
    members.map(m => `<button class="chip ${filter === m.id ? 'on' : ''}" data-f="${esc(m.id)}"><span class="dot" style="background:${colorOf(m.id)}"></span>${esc(m.name)}${m.id === me ? ' (나)' : ''}<small>${dd(m)}</small></button>`).join('');
}

function renderWeek() {
  const end = addDays(cur, 6), today = ymd(new Date());
  $('wk').textContent = `${cur.getFullYear()}년 ${cur.getMonth() + 1}월 ${cur.getDate()}일 – ${end.getMonth() + 1}월 ${end.getDate()}일`;
  const show = e => filter === 'all' || e.owner === filter || e.kind === '공지';
  $('week').innerHTML = DAYS.map((n, i) => {
    const date = ymd(addDays(cur, i)), d = addDays(cur, i);
    const myStay = week.stays.find(s => s.member === me && s.date === date)?.stay || 'in';
    const others = week.stays.filter(s => s.date === date && s.member !== me && s.stay !== 'in' && (filter === 'all' || s.member === filter));
    const evs = week.events.filter(e => e.date === date && show(e)).sort((a, b) => (a.time || '99').localeCompare(b.time || '99'));
    return `<section class="day ${date === today ? 'today' : ''} ${i === 5 ? 'sat' : i === 6 ? 'sun' : ''}">
      <div class="dh"><b>${n}</b><span>${d.getMonth() + 1}/${d.getDate()}</span></div>
      ${me ? `<select data-stay="${date}" aria-label="${n}요일 내 거주 형태">${STAY.map(([v, l]) => `<option value="${v}" ${myStay === v ? 'selected' : ''}>나: ${l}</option>`).join('')}</select>` : ''}
      ${others.length ? `<div class="stays">${others.map(s => `<span style="border-color:${colorOf(s.member)}">${esc(nameOf(s.member))} ${STAY_L[s.stay] || ''}</span>`).join('')}</div>` : ''}
      <ul>${evs.length ? evs.map(e => `<li class="${e.done ? 'done' : ''}" style="--c:${e.kind === '공지' ? 'var(--acc)' : colorOf(e.owner)}">
        ${e.owner === me ? `<input type="checkbox" data-chk="${esc(e.id)}" ${e.done ? 'checked' : ''} aria-label="완료">` : ''}
        <span class="m"><span class="who">${esc(nameOf(e.owner))} · ${esc(e.kind)}</span>${e.time ? `<span class="t">${esc(e.time)}</span> ` : ''}${esc(e.text)}</span>
        ${e.owner === me ? `<button class="x" data-del="${esc(e.id)}" aria-label="삭제">×</button>` : ''}</li>`).join('') : '<li class="empty">일정 없음</li>'}</ul>
      ${me ? `<button class="add" data-add="${date}">+ 일정 추가</button>` : ''}
    </section>`;
  }).join('');
  const mine = week.memos.find(m => m.member === me) || {};
  if (document.activeElement !== $('goal')) $('goal').value = mine.goal || '';
  if (document.activeElement !== $('memo')) $('memo').value = mine.memo || '';
  const os = week.memos.filter(m => m.member !== me && (m.goal || m.memo) && (filter === 'all' || m.member === filter));
  $('others').innerHTML = os.map(m => `<div><b><span class="dot" style="background:${colorOf(m.member)}"></span>${esc(nameOf(m.member))}의 이번 주</b>${m.goal ? '목표: ' + esc(m.goal) + '\n' : ''}${esc(m.memo || '')}</div>`).join('');
}

function render() { prog(); renderMembers(); renderWeek(); }

function watchWeek() {
  if (unWeek) unWeek();
  unWeek = store.watchWeek(ymd(cur), ymd(addDays(cur, 6)), w => { week = { ...w }; renderWeek(); });
  renderWeek();
}

/* ---------- 내 정보 ---------- */
function openJoin() {
  const m = myInfo() || {};
  const pick = members.filter(x => x.id !== me);
  $('pickWrap').hidden = !pick.length || !!me;
  $('pick').innerHTML = '<option value="">새로 등록</option>' + pick.map(x => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('');
  $('joinT').textContent = me ? '내 정보 수정' : '내 정보 등록';
  $('jName').value = m.name || ''; $('jOrg').value = m.org || ''; $('jRoom').value = m.room || ''; $('jSt').value = m.st || ''; $('jEn').value = m.en || '';
  $('joinDlg').showModal();
}
$('pick').addEventListener('change', () => {
  const m = members.find(x => x.id === $('pick').value) || {};
  ['name', 'org', 'room', 'st', 'en'].forEach(k => { $('j' + k[0].toUpperCase() + k.slice(1)).value = m[k] || ''; });
});
$('joinFrm').addEventListener('submit', async e => {
  e.preventDefault();
  const name = $('jName').value.trim(); if (!name) return;
  let en = $('jEn').value, st = $('jSt').value;
  if (st && !en) { const d = new Date(st); d.setMonth(d.getMonth() + 36); d.setDate(d.getDate() - 1); en = ymd(d); }
  const id = me || $('pick').value || uid();
  try {
    await store.saveMember({ id, name, org: $('jOrg').value.trim(), room: $('jRoom').value.trim(), st, en });
    me = id; lsSet(ME_KEY, id); $('joinDlg').close(); render(); toast('저장했어요');
  } catch (err) { banner('저장 실패: ' + err.message, true); }
});
$('joinCancel').addEventListener('click', () => $('joinDlg').close());
$('editMe').addEventListener('click', openJoin);

/* ---------- 일정 ---------- */
const run = p => Promise.resolve(p).catch(err => banner('저장 실패: ' + err.message, true));
$('week').addEventListener('change', e => {
  const t = e.target;
  if (t.dataset.stay) run(store.setStay(me, t.dataset.stay, t.value));
  if (t.dataset.chk) run(store.updateEvent(t.dataset.chk, { done: t.checked }));
});
$('week').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.add) { target = b.dataset.add; const d = new Date(target); $('evT').textContent = `${d.getMonth() + 1}/${d.getDate()} 일정 추가`; $('evFrm').reset(); $('evDlg').showModal(); $('fText').focus(); }
  if (b.dataset.del) run(store.deleteEvent(b.dataset.del));
});
$('evFrm').addEventListener('submit', e => {
  e.preventDefault(); const text = $('fText').value.trim(); if (!text) return;
  run(store.addEvent({ date: target, time: $('fTime').value, text, kind: $('fKind').value, owner: me, done: false }));
  $('evDlg').close();
});
$('evCancel').addEventListener('click', () => $('evDlg').close());

let memoT;
['goal', 'memo'].forEach(id => $(id).addEventListener('input', () => {
  if (!me) return;
  clearTimeout(memoT);
  memoT = setTimeout(() => run(store.setMemo(me, ymd(cur), { goal: $('goal').value, memo: $('memo').value })), 600);
}));

$('members').addEventListener('click', e => { const b = e.target.closest('[data-f]'); if (b) { filter = b.dataset.f; renderMembers(); renderWeek(); } });
$('prev').addEventListener('click', () => { cur = addDays(cur, -7); watchWeek(); });
$('next').addEventListener('click', () => { cur = addDays(cur, 7); watchWeek(); });
$('now').addEventListener('click', () => { cur = monday(new Date()); watchWeek(); });
$('invite').addEventListener('click', async () => {
  const url = `${location.origin}${location.pathname}?g=${encodeURIComponent(group)}`;
  try { await navigator.clipboard.writeText(url); toast('초대 링크를 복사했어요'); } catch { prompt('이 링크를 공유하세요', url); }
});

/* ---------- 시작 ---------- */
$('grp').textContent = `그룹: ${group}`;
const configured = firebaseConfig && firebaseConfig.apiKey && !firebaseConfig.apiKey.startsWith('YOUR');
try {
  store = configured ? await firebaseStore(firebaseConfig) : localStore();
  if (!configured) banner('로컬 모드: config.js에 Firebase 설정을 넣기 전까지는 이 브라우저에만 저장되고 다른 사람과 공유되지 않아요.');
} catch (err) {
  banner('Firebase 연결 실패 (' + err.message + ') — 로컬 모드로 실행합니다.', true);
  store = localStore();
}
let first = true;
store.watchMembers(list => {
  members = list.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ko'));
  if (me && !members.some(m => m.id === me) && !first) { /* 다른 기기에서 삭제된 경우 */ }
  render();
  if (first) { first = false; if (!me || !members.some(m => m.id === me)) { me = members.some(m => m.id === me) ? me : null; openJoin(); } }
});
watchWeek();

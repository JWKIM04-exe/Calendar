import { SUPABASE_URL, SUPABASE_KEY, DEFAULT_GROUP } from './config.js';

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

/* ---------- 저장소: Supabase ---------- */
async function supabaseStore(url, key) {
  const sb = async (path, opts = {}) => {
    const res = await fetch(url + '/rest/v1/' + path, { ...opts,
      headers: { apikey: key, 'Content-Type': 'application/json', ...(opts.headers || {}) } });
    if (!res.ok) {
      const t = (await res.text()).slice(0, 160);
      throw new Error(res.status === 404 || /cal_/.test(t) && /exist|schema cache/.test(t)
        ? '캘린더 테이블이 없어요. supabase.sql을 SQL Editor에서 실행해 주세요.' : `서버 오류 (${res.status}) ${t}`);
    }
    const t = await res.text(); return t ? JSON.parse(t) : null;
  };
  const G = 'grp=eq.' + encodeURIComponent(group);
  const upsert = (table, conflict, row) => sb(`${table}?on_conflict=${conflict}`, { method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ grp: group, ...row }) });
  // 주기적으로 새로고침 (10초) + 창으로 돌아올 때 + 내가 저장한 직후
  const watchers = new Set();
  const refreshAll = () => watchers.forEach(f => f());
  setInterval(() => { if (!document.hidden) refreshAll(); }, 10000);
  addEventListener('focus', refreshAll);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshAll(); });
  const watch = (load, cb) => {
    let alive = true, busy = false;
    const f = async () => {
      if (busy || !alive) return; busy = true;
      try { const v = await load(); if (alive) { cb(v); banner(''); } }
      catch (e) { banner(e.message, true); }
      busy = false;
    };
    watchers.add(f); f();
    return () => { alive = false; watchers.delete(f); };
  };
  const after = p => p.then(r => { refreshAll(); return r; });
  await sb(`cal_members?${G}&select=id&limit=1`); // 연결·테이블 확인
  return {
    mode: 'supabase',
    watchMembers: cb => watch(() => sb(`cal_members?${G}&select=id,name,org,room,st,en`), cb),
    saveMember: m => after(upsert('cal_members', 'grp,id', { id: m.id, name: m.name, org: m.org || null,
      room: m.room || null, st: m.st || null, en: m.en || null, updated_at: new Date().toISOString() })),
    watchWeek: (start, end, cb) => watch(async () => {
      const [events, stays, memos] = await Promise.all([
        sb(`cal_events?${G}&date=gte.${start}&date=lte.${end}&select=id,date,time,text,kind,owner,done&order=created_at`),
        sb(`cal_stays?${G}&date=gte.${start}&date=lte.${end}&select=member,date,stay`),
        sb(`cal_memos?${G}&week=eq.${start}&select=member,week,goal,memo`),
      ]);
      return { events, stays, memos };
    }, cb),
    addEvent: e => after(sb('cal_events', { method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ grp: group, date: e.date, time: e.time || null, text: e.text, kind: e.kind, owner: e.owner, done: false }) })),
    updateEvent: (id, p) => after(sb(`cal_events?id=eq.${encodeURIComponent(id)}&${G}`, { method: 'PATCH',
      headers: { Prefer: 'return=minimal' }, body: JSON.stringify(p) })),
    deleteEvent: id => after(sb(`cal_events?id=eq.${encodeURIComponent(id)}&${G}`, { method: 'DELETE' })),
    setStay: (member, date, stay) => after(upsert('cal_stays', 'grp,member,date', { member, date, stay })),
    setMemo: (member, week, data) => after(upsert('cal_memos', 'grp,member,week', { member, week, goal: data.goal, memo: data.memo })),
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

function stayCtl(date, n, myStay) {
  // 기본값(시설 합숙)은 빈칸으로 두고 안내 문구만 보여줌
  const v = myStay === 'in' ? '' : (STAY_L[myStay] || myStay);
  return `<input class="stayIn" data-stayin="${date}" maxlength="30" value="${esc(v)}" placeholder="어디서 지내요? (비우면 시설 합숙)" aria-label="${n}요일 내 거주 형태" enterkeyhint="done">`;
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
      ${me ? stayCtl(date, n, myStay) : ''}
      ${others.length ? `<div class="stays">${others.map(s => `<span style="border-color:${colorOf(s.member)}">${esc(nameOf(s.member))} ${esc(STAY_L[s.stay] || s.stay)}</span>`).join('')}</div>` : ''}
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
  unWeek = store.watchWeek(ymd(cur), ymd(addDays(cur, 6)), w => {
    week = { ...w };
    // 입력하는 중에 새로고침되면 글이 지워지니, 입력 중이면 다음 갱신 때 그림
    const a = document.activeElement;
    if (a && a.dataset?.stayin && $('week').contains(a)) return;
    renderWeek();
  });
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
  if (t.dataset.stayin) saveStay(t.dataset.stayin);
  if (t.dataset.chk) run(store.updateEvent(t.dataset.chk, { done: t.checked }));
});
$('week').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.add) { target = b.dataset.add; const d = new Date(target); $('evT').textContent = `${d.getMonth() + 1}/${d.getDate()} 일정 추가`; $('evFrm').reset(); $('evDlg').showModal(); $('fText').focus(); }
  if (b.dataset.del) run(store.deleteEvent(b.dataset.del));
});
function saveStay(date) {
  const v = (document.querySelector(`[data-stayin="${date}"]`)?.value || '').trim().slice(0, 30);
  const preset = STAY.find(([, l]) => l === v);
  const stay = !v ? 'in' : preset ? preset[0] : v;
  const prev = week.stays.find(x => x.member === me && x.date === date)?.stay || 'in';
  if (stay === prev) return;
  week.stays = week.stays.filter(x => !(x.member === me && x.date === date)).concat({ member: me, date, stay });
  run(store.setStay(me, date, stay).then(() => toast('저장했어요')));
}
$('week').addEventListener('keydown', e => {
  if (e.target.dataset.stayin && e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
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
const configured = !!(SUPABASE_URL && SUPABASE_KEY);
try {
  store = configured ? await supabaseStore(SUPABASE_URL, SUPABASE_KEY) : localStore();
  if (!configured) banner('로컬 모드: config.js에 Supabase 설정을 넣기 전까지는 이 브라우저에만 저장되고 다른 사람과 공유되지 않아요.');
} catch (err) {
  banner('서버 연결 실패: ' + err.message + ' (지금은 로컬 모드로 실행 중)', true);
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

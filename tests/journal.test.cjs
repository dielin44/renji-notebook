const {test} = require('node:test');
const assert = require('node:assert/strict');
const L = require('../app/src/main/assets/web/logic.js');

test('升級舊資料保留人物、還款、照片與既有設定，新增獨立隨筆資料', () => {
  const old = L.createDemoState();
  old.version = 3;
  old.settings.qualityThreshold = 92;
  old.settings.tagStyles = {同事:'neon'};
  delete old.journal;
  const restored = L.normalizeState(JSON.parse(JSON.stringify(old)));
  assert.equal(restored.people.length, old.people.length);
  assert.equal(restored.events.length, old.events.length);
  assert.equal(restored.loans[0].transactions[0].amount, 3000);
  assert.equal(restored.loans[0].reminderEnabled, true);
  assert.equal(restored.settings.qualityThreshold, 92);
  assert.equal(restored.settings.tagStyles.同事, 'neon');
  assert.deepEqual(restored.journal, []);
});

test('3天內待辦排除過期、已完成、無期限與筆記，依時間最多5筆', () => {
  const now = new Date('2026-09-20T12:00:00+08:00');
  const s=L.createDefaultState();
  const due=(ms)=>new Date(now.getTime()+ms).toISOString();
  const task=(id,ms,extra={})=>({id,kind:'todo',dueAt:due(ms),completed:false,...extra});
  s.journal=[task('expired',-1),task('boundary',3*86400000),task('too-late',3*86400000+1),
    task('done',1000,{completed:true}),task('note',1000,{kind:'note'}),{id:'no-date',kind:'todo'},
    ...[0,1,2,3,4,5].map((n)=>task(String(n),n*3600000))];
  assert.deepEqual(L.upcomingTodos(s,now).map(x=>x.id),['0','1','2','3','4']);
  assert.equal(L.journalStatus(s.journal[0],now),'overdue');
  assert.equal(L.journalStatus(s.journal[1],now),'upcoming');
  assert.equal(L.journalStatus(s.journal[2],now),'pending');
  assert.equal(L.journalStatus(s.journal[3],now),'done');
  assert.equal(L.journalStatus(s.journal[5],now),'pending');
});

test('隨筆共用搜尋同時尋找筆記與待辦，不混入人物事件', () => {
  const s=L.createDemoState();
  s.journal=[{id:'a',kind:'note',title:'假日',content:'咖啡靈感',updatedAt:'2026-09-15'},
    {id:'b',kind:'todo',title:'咖啡豆',content:'補貨',completed:false,updatedAt:'2026-09-16'}];
  assert.deepEqual(L.filterJournal(s,{query:'咖啡'}).map(x=>x.id),['b','a']);
  assert.deepEqual(L.filterJournal(s,{query:'咖啡',filter:'pending'}).map(x=>x.id),['b']);
  assert.deepEqual(L.filterJournal(s,{query:'代墊'}),[]);
  const score=L.personScore(s,s.people[0]);
  s.journal[1].completed=true;
  assert.equal(L.personScore(s,s.people[0]),score);
});

test('備份往返保留主題、標題配色、標籤色彩、待辦狀態，拒絕無效顏色', () => {
  const s=L.createDefaultState();
  Object.assign(s.settings,{theme:'rainbow',titleColorMode:'custom',titleColor:'#A123D0',subtitleColor:'#137449',tagColors:{同事:'#C28CFF'}});
  s.journal=[{id:'one',kind:'todo',title:'我的待辦',content:'內容',date:'2026-09-16',dueAt:'2026-09-17T18:00',completed:true,createdAt:'2026-09-15',updatedAt:'2026-09-16'}];
  const restored=L.normalizeState(JSON.parse(JSON.stringify(s)));
  assert.equal(restored.settings.theme,'rainbow');
  assert.equal(restored.settings.titleColor,'#a123d0');
  assert.equal(restored.settings.tagColors.同事,'#c28cff');
  assert.deepEqual(restored.journal,s.journal);
  assert.equal(L.validColor('red;display:none','fallback'),'fallback');
  assert.equal(L.contrastText('#ffffff'),'#101318');
  assert.equal(L.contrastText('#000000'),'#ffffff');
});

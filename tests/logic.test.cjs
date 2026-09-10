const test = require('node:test');
const assert = require('node:assert/strict');
const Logic = require('../app/src/main/assets/web/logic.js');

test('分數顏色邊界符合規格', () => {
  assert.equal(Logic.scoreBand(40).key, 'red');
  assert.equal(Logic.scoreBand(41).key, 'orange');
  assert.equal(Logic.scoreBand(60).key, 'orange');
  assert.equal(Logic.scoreBand(61).key, 'green');
  assert.equal(Logic.scoreBand(80).key, 'green');
  assert.equal(Logic.scoreBand(81).key, 'blue');
  assert.equal(Logic.scoreBand(94).key, 'blue');
  assert.equal(Logic.scoreBand(95).key, 'purple');
  assert.equal(Logic.scoreBand(100).key, 'purple');
});

test('加分與扣分方向可明確轉換', () => {
  assert.equal(Logic.signedDelta(1, 12), 12);
  assert.equal(Logic.signedDelta(-1, 12), -12);
  assert.equal(Logic.signedDelta(1, 999), 100);
  assert.equal(Logic.signedDelta(-1, -5), 0);
});

test('確認視窗表單不會被資料表單處理器攔截', () => {
  assert.equal(Logic.isManagedFormId('person-form'), true);
  assert.equal(Logic.isManagedFormId('event-form'), true);
  assert.equal(Logic.isManagedFormId('category-form'), true);
  assert.equal(Logic.isManagedFormId(''), false);
  assert.equal(Logic.isManagedFormId('confirm-form'), false);
});

test('人物總分與分類分數各自正確累積', () => {
  const state = Logic.createDefaultState();
  state.people.push({ id: 'p1', name: '測試', startScore: 80, categoryStarts: {}, tags: [] });
  state.events.push(
    { id: 'e1', personId: 'p1', delta: -10, categoryIds: ['credit'] },
    { id: 'e2', personId: 'p1', delta: 5, categoryIds: ['ability'] }
  );
  assert.equal(Logic.personScore(state, 'p1'), 75);
  assert.equal(Logic.categoryScore(state, 'p1', 'credit'), 70);
  assert.equal(Logic.categoryScore(state, 'p1', 'ability'), 85);
  assert.equal(Logic.categoryScore(state, 'p1', 'relationship'), 80);
});

test('金錢借貸支援部分還款並判定逾期', () => {
  const loan = {
    kind: 'money', amount: 10000, dueAt: '2026-09-01', waived: false,
    transactions: [{ amount: 3000, occurredAt: '2026-08-20' }]
  };
  assert.equal(Logic.loanRemaining(loan), 7000);
  assert.equal(Logic.loanStatus(loan, '2026-09-10T12:00:00Z'), 'overdue');
});

test('物品借貸可分批歸還並自動結清', () => {
  const loan = { kind: 'item', quantity: 3, dueAt: '', waived: false, transactions: [{ quantity: 1 }, { quantity: 2 }] };
  assert.equal(Logic.loanRemaining(loan), 0);
  assert.equal(Logic.loanStatus(loan), 'settled');
});

test('搜尋可穿透人物、事件與借貸內容', () => {
  const state = Logic.createDefaultState();
  state.people.push({ id: 'p1', name: '王建國', nickname: '', phone: '', otherContact: '', relation: '同事', notes: '', tags: [], startScore: 80, categoryStarts: {} });
  state.events.push({ id: 'e1', personId: 'p1', title: '答應代班後失聯', detail: '', delta: -5, categoryIds: ['responsibility'] });
  state.loans.push({ id: 'l1', personId: 'p1', kind: 'item', direction: 'lentItem', title: '安全帽', note: '', quantity: 1, transactions: [] });
  assert.equal(Logic.filterPeople(state, { query: '代班' }).length, 1);
  assert.equal(Logic.filterPeople(state, { query: '安全帽' }).length, 1);
  assert.equal(Logic.filterPeople(state, { query: '不存在' }).length, 0);
});

test('可依指定分類分數排序且不排除高分人物', () => {
  const state = Logic.createDefaultState();
  state.people.push(
    { id: 'p1', name: '甲', startScore: 80, categoryStarts: { credit: 95 }, tags: [] },
    { id: 'p2', name: '乙', startScore: 80, categoryStarts: { credit: 35 }, tags: [] }
  );
  const people = Logic.filterPeople(state, { categoryId: 'credit', sort: 'category' });
  assert.deepEqual(people.map((person) => person.id), ['p2', 'p1']);
});

test('示範資料呈現 58 分與 7000 元未還', () => {
  const state = Logic.createDemoState();
  assert.equal(Logic.personScore(state, 'demo_wang'), 58);
  assert.equal(Logic.categoryScore(state, 'demo_wang', 'credit'), 35);
  assert.equal(Logic.personDebtSummary(state, 'demo_wang').owedToMe, 7000);
});

test('首頁優質與劣質人數使用 90 與 40 分邊界', () => {
  const state = Logic.createDefaultState();
  state.people.push(
    { id: 'quality', name: '優質', startScore: 90, categoryStarts: {}, tags: [] },
    { id: 'poor', name: '劣質', startScore: 40, categoryStarts: {}, tags: [] },
    { id: 'middle-high', name: '中高', startScore: 89, categoryStarts: {}, tags: [] },
    { id: 'middle-low', name: '中低', startScore: 41, categoryStarts: {}, tags: [] }
  );
  const summary = Logic.dashboardSummary(state);
  assert.equal(summary.qualityCount, 1);
  assert.equal(summary.poorCount, 1);
});

test('生日可換算星座且邊界正確', () => {
  assert.equal(Logic.zodiacFromBirthday('1987-01-19'), '摩羯座');
  assert.equal(Logic.zodiacFromBirthday('1987-01-20'), '水瓶座');
  assert.equal(Logic.zodiacFromBirthday('1987-12-22'), '摩羯座');
  assert.equal(Logic.zodiacFromBirthday('not-a-date'), '');
});

test('舊人物資料正規化後可保留並補入新欄位', () => {
  const state = Logic.normalizeState({
    settings: {
      tags: ['同事', '朋友'],
      quickTags: ['朋友', '不存在']
    },
    people: [{
      id: 'p1', name: '測試', startScore: 80, tags: ['朋友'],
      birthday: '1990-06-18', bloodType: 'AB',
      avatar: { name: 'avatar.jpg', dataUrl: 'data:image/jpeg;base64,AA==' }
    }],
    events: [],
    loans: []
  });
  assert.equal(state.version, 2);
  assert.equal(state.people[0].zodiac, '雙子座');
  assert.equal(state.people[0].bloodType, 'AB');
  assert.equal(state.people[0].avatar.dataUrl, 'data:image/jpeg;base64,AA==');
  assert.deepEqual(state.settings.quickTags, ['朋友']);
});

test('首頁常用標籤可直接篩選人物', () => {
  const state = Logic.createDefaultState();
  state.people.push(
    { id: 'p1', name: '甲', relation: '同事', startScore: 80, categoryStarts: {}, tags: [] },
    { id: 'p2', name: '乙', relation: '', startScore: 80, categoryStarts: {}, tags: ['朋友'] }
  );
  assert.deepEqual(
    Logic.filterPeople(state, { filter: 'tag:朋友' }).map((person) => person.id),
    ['p2']
  );
});


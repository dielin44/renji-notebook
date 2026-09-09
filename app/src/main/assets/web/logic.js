(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.RenjiLogic = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DEFAULT_CATEGORIES = [
    { id: 'credit', name: '信用', builtIn: true, active: true },
    { id: 'responsibility', name: '責任', builtIn: true, active: true },
    { id: 'finance', name: '財力', builtIn: true, active: true },
    { id: 'ability', name: '能力', builtIn: true, active: true },
    { id: 'relationship', name: '相處', builtIn: true, active: true }
  ];

  const SCORE_BANDS = [
    { key: 'red', min: 0, max: 40, label: '高風險', color: '#ff5a5f' },
    { key: 'orange', min: 41, max: 60, label: '謹慎往來', color: '#ff9f2f' },
    { key: 'green', min: 61, max: 80, label: '一般觀察', color: '#57d889' },
    { key: 'blue', min: 81, max: 94, label: '穩定可信', color: '#5ea0ff' },
    { key: 'purple', min: 95, max: 100, label: '高度信任', color: '#a776ff' }
  ];

  const MANAGED_FORM_IDS = [
    'person-form', 'event-form', 'loan-form', 'transaction-form',
    'category-form', 'tag-form', 'pin-form', 'unlock-form'
  ];

  function nowIso() {
    return new Date().toISOString();
  }

  function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function uid(prefix) {
    const random = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36);
    return `${prefix || 'id'}_${random}`;
  }

  function clamp(value, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) return min;
    return Math.min(max, Math.max(min, number));
  }

  function clampScore(value) {
    return Math.round(clamp(value, 0, 100));
  }

  function signedDelta(sign, amount) {
    const direction = Number(sign) < 0 ? -1 : 1;
    const points = Math.round(clamp(amount, 0, 100));
    return points === 0 ? 0 : direction * points;
  }

  function isManagedFormId(value) {
    return MANAGED_FORM_IDS.includes(String(value || ''));
  }

  function scoreBand(value) {
    const score = clampScore(value);
    return SCORE_BANDS.find((band) => score >= band.min && score <= band.max) || SCORE_BANDS[0];
  }

  function createDefaultState() {
    const stamp = nowIso();
    return {
      version: 1,
      settings: {
        defaultStartScore: 80,
        categories: deepClone(DEFAULT_CATEGORIES),
        tags: ['同事', '朋友', '家人', '客戶', '需觀察', '可合作', '借貸中'],
        pinHash: '',
        autoLockMinutes: 5
      },
      people: [],
      events: [],
      loans: [],
      meta: { createdAt: stamp, updatedAt: stamp }
    };
  }

  function normalizeState(input) {
    const base = createDefaultState();
    if (!input || typeof input !== 'object') return base;
    const state = {
      version: 1,
      settings: Object.assign({}, base.settings, input.settings || {}),
      people: Array.isArray(input.people) ? input.people : [],
      events: Array.isArray(input.events) ? input.events : [],
      loans: Array.isArray(input.loans) ? input.loans : [],
      meta: Object.assign({}, base.meta, input.meta || {})
    };
    state.settings.defaultStartScore = clampScore(state.settings.defaultStartScore);
    state.settings.categories = Array.isArray(state.settings.categories) && state.settings.categories.length
      ? state.settings.categories.map((category) => ({
          id: String(category.id || uid('cat')),
          name: String(category.name || '未命名'),
          builtIn: Boolean(category.builtIn),
          active: category.active !== false
        }))
      : deepClone(DEFAULT_CATEGORIES);
    state.settings.tags = Array.from(new Set((state.settings.tags || []).map(String).filter(Boolean)));
    state.people = state.people.map((person) => Object.assign({
      id: uid('person'),
      name: '', nickname: '', phone: '', otherContact: '', relation: '',
      knownAt: '', tags: [], notes: '', startScore: state.settings.defaultStartScore,
      categoryStarts: {}, createdAt: nowIso(), updatedAt: nowIso()
    }, person, {
      tags: Array.isArray(person.tags) ? person.tags : [],
      categoryStarts: person.categoryStarts || {},
      startScore: clampScore(person.startScore == null ? state.settings.defaultStartScore : person.startScore)
    }));
    state.events = state.events.map((event) => Object.assign({
      id: uid('event'), personId: '', title: '', detail: '', delta: 0,
      categoryIds: [], important: false, followUp: false, attachments: [], createdAt: nowIso()
    }, event, {
      delta: Math.round(Number(event.delta) || 0),
      categoryIds: Array.isArray(event.categoryIds) ? event.categoryIds : [],
      attachments: Array.isArray(event.attachments) ? event.attachments : []
    }));
    state.loans = state.loans.map((loan) => Object.assign({
      id: uid('loan'), personId: '', kind: 'money', direction: 'owedToMe', title: '',
      amount: 0, quantity: 1, estimatedValue: 0, startAt: '', dueAt: '',
      note: '', attachments: [], transactions: [], waived: false, createdAt: nowIso(), updatedAt: nowIso()
    }, loan, {
      amount: Number(loan.amount) || 0,
      quantity: Number(loan.quantity) || 0,
      transactions: Array.isArray(loan.transactions) ? loan.transactions : [],
      attachments: Array.isArray(loan.attachments) ? loan.attachments : []
    }));
    return state;
  }

  function personEvents(state, personId) {
    return state.events
      .filter((event) => event.personId === personId)
      .sort((a, b) => new Date(b.occurredAt || b.createdAt) - new Date(a.occurredAt || a.createdAt));
  }

  function personLoans(state, personId) {
    return state.loans
      .filter((loan) => loan.personId === personId)
      .sort((a, b) => new Date(b.startAt || b.createdAt) - new Date(a.startAt || a.createdAt));
  }

  function personScore(state, personOrId) {
    const person = typeof personOrId === 'string'
      ? state.people.find((item) => item.id === personOrId)
      : personOrId;
    if (!person) return 0;
    const delta = state.events
      .filter((event) => event.personId === person.id)
      .reduce((sum, event) => sum + (Number(event.delta) || 0), 0);
    return clampScore((Number(person.startScore) || 0) + delta);
  }

  function categoryScore(state, personOrId, categoryId) {
    const person = typeof personOrId === 'string'
      ? state.people.find((item) => item.id === personOrId)
      : personOrId;
    if (!person) return 0;
    const base = person.categoryStarts && Number.isFinite(Number(person.categoryStarts[categoryId]))
      ? Number(person.categoryStarts[categoryId])
      : Number(person.startScore) || 0;
    const delta = state.events
      .filter((event) => event.personId === person.id && (event.categoryIds || []).includes(categoryId))
      .reduce((sum, event) => {
        if (event.categoryDeltas && Number.isFinite(Number(event.categoryDeltas[categoryId]))) {
          return sum + Number(event.categoryDeltas[categoryId]);
        }
        return sum + (Number(event.delta) || 0);
      }, 0);
    return clampScore(base + delta);
  }

  function categoryScores(state, personOrId) {
    return state.settings.categories
      .filter((category) => category.active !== false)
      .map((category) => Object.assign({}, category, {
        score: categoryScore(state, personOrId, category.id),
        band: scoreBand(categoryScore(state, personOrId, category.id))
      }));
  }

  function lowestCategories(state, personOrId, count) {
    return categoryScores(state, personOrId)
      .sort((a, b) => a.score - b.score || a.name.localeCompare(b.name, 'zh-Hant'))
      .slice(0, count == null ? 2 : count);
  }

  function transactionTotal(loan) {
    return (loan.transactions || []).reduce((sum, transaction) => {
      return sum + Math.max(0, Number(transaction.amount != null ? transaction.amount : transaction.quantity) || 0);
    }, 0);
  }

  function loanRemaining(loan) {
    if (!loan || loan.waived) return 0;
    const original = loan.kind === 'item' ? Number(loan.quantity) || 0 : Number(loan.amount) || 0;
    return Math.max(0, original - transactionTotal(loan));
  }

  function dateOnly(value) {
    if (!value) return null;
    const date = new Date(value.length <= 10 ? `${value}T23:59:59` : value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function loanStatus(loan, referenceDate) {
    if (loan.waived) return 'waived';
    if (loanRemaining(loan) <= 0) return 'settled';
    const due = dateOnly(loan.dueAt);
    const now = referenceDate ? new Date(referenceDate) : new Date();
    if (due && due.getTime() < now.getTime()) return 'overdue';
    if (transactionTotal(loan) > 0) return 'partial';
    return 'active';
  }

  function overdueDays(loan, referenceDate) {
    if (loanStatus(loan, referenceDate) !== 'overdue') return 0;
    const due = dateOnly(loan.dueAt);
    const now = referenceDate ? new Date(referenceDate) : new Date();
    return Math.max(1, Math.floor((now.getTime() - due.getTime()) / 86400000));
  }

  function activeLoans(state, personId) {
    return personLoans(state, personId).filter((loan) => !['settled', 'waived'].includes(loanStatus(loan)));
  }

  function personDebtSummary(state, personId) {
    const result = { owedToMe: 0, iOwe: 0, lentItems: 0, borrowedItems: 0, overdueCount: 0, activeCount: 0 };
    activeLoans(state, personId).forEach((loan) => {
      const remaining = loanRemaining(loan);
      result.activeCount += 1;
      if (loanStatus(loan) === 'overdue') result.overdueCount += 1;
      if (loan.kind === 'money' && loan.direction === 'owedToMe') result.owedToMe += remaining;
      if (loan.kind === 'money' && loan.direction === 'iOwe') result.iOwe += remaining;
      if (loan.kind === 'item' && loan.direction === 'lentItem') result.lentItems += remaining;
      if (loan.kind === 'item' && loan.direction === 'borrowedItem') result.borrowedItems += remaining;
    });
    return result;
  }

  function dashboardSummary(state) {
    return state.people.reduce((summary, person) => {
      const debt = personDebtSummary(state, person.id);
      summary.owedToMe += debt.owedToMe;
      summary.iOwe += debt.iOwe;
      summary.lentItems += debt.lentItems;
      summary.borrowedItems += debt.borrowedItems;
      summary.overdueCount += debt.overdueCount;
      return summary;
    }, {
      people: state.people.length,
      owedToMe: 0,
      iOwe: 0,
      lentItems: 0,
      borrowedItems: 0,
      overdueCount: 0
    });
  }

  function normalizeSearch(value) {
    return String(value || '').trim().toLocaleLowerCase('zh-Hant');
  }

  function searchablePersonText(state, person) {
    const events = personEvents(state, person.id);
    const loans = personLoans(state, person.id);
    const categoryNames = categoryScores(state, person).map((category) => category.name);
    return normalizeSearch([
      person.name, person.nickname, person.phone, person.otherContact, person.relation,
      person.notes, ...(person.tags || []), ...categoryNames,
      ...events.flatMap((event) => [event.title, event.detail]),
      ...loans.flatMap((loan) => [loan.title, loan.note, loan.itemCondition, loan.returnCondition])
    ].join(' '));
  }

  function filterPeople(state, options) {
    const settings = Object.assign({ query: '', filter: 'all', categoryId: '', sort: 'scoreLow' }, options || {});
    const query = normalizeSearch(settings.query);
    let people = state.people.filter((person) => !query || searchablePersonText(state, person).includes(query));
    people = people.filter((person) => {
      const score = personScore(state, person);
      const debt = personDebtSummary(state, person.id);
      if (settings.filter === 'highRisk') return score <= 60;
      if (settings.filter === 'activeLoans') return debt.activeCount > 0;
      if (settings.filter === 'overdue') return debt.overdueCount > 0;
      return true;
    });
    const compareUpdated = (person) => new Date(person.updatedAt || person.createdAt || 0).getTime();
    people.sort((a, b) => {
      if (settings.sort === 'scoreHigh') return personScore(state, b) - personScore(state, a);
      if (settings.sort === 'name') return String(a.name).localeCompare(String(b.name), 'zh-Hant');
      if (settings.sort === 'recent') return compareUpdated(b) - compareUpdated(a);
      if (settings.sort === 'category' && settings.categoryId) {
        return categoryScore(state, a, settings.categoryId) - categoryScore(state, b, settings.categoryId);
      }
      return personScore(state, a) - personScore(state, b);
    });
    return people;
  }

  function createDemoState() {
    const state = createDefaultState();
    const p1 = {
      id: 'demo_wang', name: '王建國', nickname: '建國', phone: '0912-345-678',
      otherContact: 'LINE：wang-demo', relation: '同事', knownAt: '2025-06-01',
      tags: ['同事', '需觀察', '借貸中'], notes: '展示用人物，可從設定刪除全部資料。',
      startScore: 80, categoryStarts: { credit: 57, responsibility: 60, ability: 86, relationship: 68, finance: 74 }, createdAt: '2026-08-01T10:00:00+08:00', updatedAt: '2026-09-09T10:00:00+08:00'
    };
    const p2 = {
      id: 'demo_lin', name: '林雅婷', nickname: '', phone: '', otherContact: '', relation: '朋友',
      knownAt: '2024-02-10', tags: ['朋友', '可合作'], notes: '', startScore: 88,
      categoryStarts: {}, createdAt: '2026-08-01T10:00:00+08:00', updatedAt: '2026-09-05T10:00:00+08:00'
    };
    state.people.push(p1, p2);
    state.events.push(
      { id: 'demo_event_1', personId: p1.id, title: '再次延後還款', detail: '到期前沒有主動通知，詢問後才表示延期。', delta: -8, categoryIds: ['credit', 'responsibility'], important: true, followUp: true, attachments: [], occurredAt: '2026-09-08T20:30:00+08:00', createdAt: '2026-09-08T20:30:00+08:00' },
      { id: 'demo_event_2', personId: p1.id, title: '第一次延後承諾', detail: '原訂日期未還。', delta: -7, categoryIds: ['credit'], important: false, followUp: false, attachments: [], occurredAt: '2026-08-25T18:00:00+08:00', createdAt: '2026-08-25T18:00:00+08:00' },
      { id: 'demo_event_3', personId: p1.id, title: '付款承諾再次落空', detail: '第二次約定日期仍未付款。', delta: -7, categoryIds: ['credit'], important: true, followUp: true, attachments: [], occurredAt: '2026-09-01T19:00:00+08:00', createdAt: '2026-09-01T19:00:00+08:00' },
      { id: 'demo_event_4', personId: p2.id, title: '主動完成共同工作', detail: '在期限前完成並主動補齊資料。', delta: 4, categoryIds: ['responsibility', 'ability'], important: true, followUp: false, attachments: [], occurredAt: '2026-09-05T12:00:00+08:00', createdAt: '2026-09-05T12:00:00+08:00' }
    );
    state.loans.push({
      id: 'demo_loan_1', personId: p1.id, kind: 'money', direction: 'owedToMe', title: '代墊修車款',
      amount: 10000, quantity: 0, estimatedValue: 0, startAt: '2026-07-15', dueAt: '2026-07-28',
      note: '已先歸還 3,000 元。', attachments: [],
      transactions: [{ id: 'demo_payment_1', amount: 3000, occurredAt: '2026-08-02', note: '轉帳' }],
      waived: false, createdAt: '2026-07-15T12:00:00+08:00', updatedAt: '2026-08-02T12:00:00+08:00'
    });
    state.meta.updatedAt = nowIso();
    return state;
  }

  return {
    DEFAULT_CATEGORIES,
    SCORE_BANDS,
    activeLoans,
    categoryScore,
    categoryScores,
    clampScore,
    createDefaultState,
    createDemoState,
    dashboardSummary,
    deepClone,
    filterPeople,
    isManagedFormId,
    loanRemaining,
    loanStatus,
    lowestCategories,
    normalizeState,
    overdueDays,
    personDebtSummary,
    personEvents,
    personLoans,
    personScore,
    scoreBand,
    signedDelta,
    searchablePersonText,
    transactionTotal,
    uid
  };
});

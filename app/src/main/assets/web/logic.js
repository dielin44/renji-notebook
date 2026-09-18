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

  const ZODIAC_SIGNS = ['牡羊座', '金牛座', '雙子座', '巨蟹座', '獅子座', '處女座', '天秤座', '天蠍座', '射手座', '摩羯座', '水瓶座', '雙魚座'];

  const TAG_STYLE_KEYS = ['normal', 'aurora', 'neon', 'electric', 'lava', 'ice', 'obsidian'];
  const THEMES = [
    ['black', '原始黑色', '經典黑金'], ['aurora', '極光流動', '藍綠光帶'],
    ['neon', '霓虹夜色', '紫粉漸層'], ['electric', '電光星河', '靛藍與青光'],
    ['lava', '日落熔岩', '莓紅與橘金'], ['ice', '冰晶銀藍', '銀白與冰藍'],
    ['obsidian', '曜石金輝', '黑金光澤'], ['rainbow', '晴空玫瑰', '粉紅與天藍'],
    ['custom', '自訂顏色', '自由搭配三色'],
    ['forest', '森林晨光', '翠綠・青藍・金黃'], ['coral', '珊瑚海岸', '珊瑚・碧綠・金黃'],
    ['berry', '莓果花園', '莓紅・紫藤・薄荷'], ['ocean', '海洋日出', '深藍・青綠・橘黃'],
    ['orchid', '蘭花月光', '紫藤・粉紅・冰藍'], ['citrus', '柑橘草原', '橘黃・草綠・天藍'],
    ['ruby', '紅寶星光', '紅寶・金黃・靛藍']
  ];

  function validColor(value, fallback) {
    return /^#[0-9a-f]{6}$/i.test(String(value || '')) ? String(value).toLowerCase() : fallback;
  }

  function contrastText(color) {
    const hex = validColor(color, '#d9ad4a').slice(1);
    const channels = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((n) => n <= 0.04045 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4));
    return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722 > .179 ? '#101318' : '#ffffff';
  }

  const MANAGED_FORM_IDS = [
    'person-form', 'event-form', 'loan-form', 'transaction-form',
    'category-form', 'tag-form', 'quick-tags-form', 'pin-form', 'unlock-form',
    'person-notes-form', 'quality-settings-form', 'title-settings-form', 'tag-style-form', 'journal-form'
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

  function zodiacFromBirthday(value) {
    const match = /^(?:\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
    if (!match) return '';
    const month = Number(match[1]);
    const day = Number(match[2]);
    const probe = new Date(Date.UTC(2000, month - 1, day));
    if (probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return '';
    const code = month * 100 + day;
    if (code >= 1222 || code <= 119) return '摩羯座';
    if (code <= 218) return '水瓶座';
    if (code <= 320) return '雙魚座';
    if (code <= 419) return '牡羊座';
    if (code <= 520) return '金牛座';
    if (code <= 621) return '雙子座';
    if (code <= 722) return '巨蟹座';
    if (code <= 822) return '獅子座';
    if (code <= 922) return '處女座';
    if (code <= 1023) return '天秤座';
    if (code <= 1122) return '天蠍座';
    return '射手座';
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
      version: 4,
      settings: {
        defaultStartScore: 80,
        categories: deepClone(DEFAULT_CATEGORIES),
        tags: ['同事', '朋友', '家人', '客戶', '需觀察', '可合作', '借貸中'],
        quickTags: ['同事', '朋友', '家人', '客戶'],
        tagStyles: {},
        tagColors: {},
        theme: 'black',
        titleColorMode: 'theme',
        titleColor: '#f5f7fa',
        subtitleColor: '#d9ad4a',
        customFields: [],
        qualityLabel: '優質',
        qualityThreshold: 90,
        poorLabel: '劣質',
        poorThreshold: 40,
        appTitle: '人際小本本',
        appSubtitle: '魔羯人際風控筆記｜INTJ',
        pinHash: '',
        autoLockMinutes: 5
      },
      people: [],
      events: [],
      loans: [],
      journal: [],
      meta: { createdAt: stamp, updatedAt: stamp }
    };
  }

  function normalizeState(input) {
    const base = createDefaultState();
    if (!input || typeof input !== 'object') return base;
    const state = {
      version: 4,
      settings: Object.assign({}, base.settings, input.settings || {}),
      people: Array.isArray(input.people) ? input.people : [],
      events: Array.isArray(input.events) ? input.events : [],
      loans: Array.isArray(input.loans) ? input.loans : [],
      journal: Array.isArray(input.journal) ? input.journal : [],
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
    state.settings.quickTags = Array.from(new Set((state.settings.quickTags || []).map(String).filter(Boolean)))
      .filter((tag) => state.settings.tags.includes(tag))
      .slice(0, 6);
    const tagStyles = state.settings.tagStyles && typeof state.settings.tagStyles === 'object'
      ? state.settings.tagStyles
      : {};
    state.settings.tagStyles = state.settings.tags.reduce((result, tag) => {
      const style = String(tagStyles[tag] || 'normal');
      result[tag] = TAG_STYLE_KEYS.includes(style) ? style : 'normal';
      return result;
    }, {});
    state.settings.qualityLabel = String(state.settings.qualityLabel || '優質').trim().slice(0, 12) || '優質';
    state.settings.poorLabel = String(state.settings.poorLabel || '劣質').trim().slice(0, 12) || '劣質';
    state.settings.qualityThreshold = clampScore(state.settings.qualityThreshold == null ? 90 : state.settings.qualityThreshold);
    state.settings.poorThreshold = clampScore(state.settings.poorThreshold == null ? 40 : state.settings.poorThreshold);
    if (state.settings.poorThreshold >= state.settings.qualityThreshold) {
      state.settings.qualityThreshold = 90;
      state.settings.poorThreshold = 40;
    }
    state.settings.appTitle = String(state.settings.appTitle || '人際小本本').trim().slice(0, 30) || '人際小本本';
    state.settings.appSubtitle = String(state.settings.appSubtitle || '魔羯人際風控筆記｜INTJ').trim().slice(0, 60) || '魔羯人際風控筆記｜INTJ';
    if (!THEMES.some(([id]) => id === state.settings.theme)) state.settings.theme = 'black';
    state.settings.customThemeColors = ['#68d9c4', '#92baff', '#f4bb79'].map((fallback, i) => validColor((state.settings.customThemeColors || [])[i], fallback));
    state.settings.titleColorMode = state.settings.titleColorMode === 'custom' ? 'custom' : 'theme';
    state.settings.titleColor = validColor(state.settings.titleColor, '#f5f7fa');
    state.settings.subtitleColor = validColor(state.settings.subtitleColor, '#d9ad4a');
    const colors = state.settings.tagColors || {};
    state.settings.tagColors = {};
    state.settings.tags.forEach((tag) => {
      const color = validColor(colors[tag], '');
      if (color) state.settings.tagColors[tag] = color;
    });
    state.journal = state.journal.filter((item) => item && typeof item === 'object').map((item) => ({
      id: String(item.id || uid('journal')), kind: item.kind === 'todo' ? 'todo' : 'note',
      title: String(item.title || ''), content: String(item.content || ''),
      date: String(item.date || ''), dueAt: String(item.dueAt || ''),
      completed: Boolean(item.completed), createdAt: item.createdAt || nowIso(), updatedAt: item.updatedAt || nowIso()
    }));
    state.people = state.people.map((person) => Object.assign({
      id: uid('person'),
      name: '', nickname: '', phone: '', otherContact: '', relation: '',
      birthday: '', zodiac: '', bloodType: '', avatar: null,
      tags: [], notes: '', customFields: [], startScore: state.settings.defaultStartScore,
      categoryStarts: {}, createdAt: nowIso(), updatedAt: nowIso()
    }, person, {
      tags: Array.isArray(person.tags) ? person.tags : [],
      birthday: String(person.birthday || ''),
      zodiac: String(person.zodiac || zodiacFromBirthday(person.birthday) || ''),
      bloodType: String(person.bloodType || ''),
      avatar: person.avatar && typeof person.avatar === 'object' && typeof person.avatar.dataUrl === 'string' ? person.avatar : null,
      customFields: Array.isArray(person.customFields) ? person.customFields.map((field) => ({
        id: String(field && field.id || uid('field')),
        label: String(field && field.label || '').trim().slice(0, 40),
        value: String(field && field.value || '').trim().slice(0, 500)
      })).filter((field) => field.label || field.value) : [],
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
      note: '', attachments: [], transactions: [], reminderEnabled: false, waived: false, createdAt: nowIso(), updatedAt: nowIso()
    }, loan, {
      amount: Number(loan.amount) || 0,
      quantity: Number(loan.quantity) || 0,
      transactions: Array.isArray(loan.transactions) ? loan.transactions.map((transaction) => Object.assign({
        id: uid('payment'), occurredAt: nowIso(), note: '', returnCondition: '', createdAt: nowIso(), updatedAt: nowIso()
      }, transaction, {
        ...(loan.kind === 'item'
          ? { quantity: Number(transaction && transaction.quantity) || 0 }
          : { amount: Number(transaction && transaction.amount) || 0 })
      })) : [],
      reminderEnabled: Boolean(loan.reminderEnabled),
      attachments: Array.isArray(loan.attachments) ? loan.attachments : []
    }));
    const definitions = Array.isArray(state.settings.customFields) ? state.settings.customFields : [];
    const shared = [];
    [...definitions, ...state.people.flatMap((person) => person.customFields)].forEach((field) => {
      const label = String(field && field.label || '').trim();
      if (label && !shared.some((entry) => entry.label === label)) shared.push({ id: String(field.id || uid('field')), label });
    });
    state.settings.customFields = shared;
    state.people.forEach((person) => {
      person.customFields = shared.map((definition) => {
        const stored = person.customFields.find((entry) => entry.id === definition.id || entry.label === definition.label);
        return Object.assign({}, definition, { value: stored ? stored.value : '' });
      });
    });
    return state;
  }

  function customFieldsFor(state, person) {
    return (state.settings.customFields || []).map((definition) => {
      const stored = (person.customFields || []).find((entry) => entry.id === definition.id);
      return Object.assign({}, definition, { value: stored ? stored.value : '' });
    });
  }

  function journalStatus(item, now) {
    const current = now == null ? Date.now() : new Date(now).getTime();
    if (item.kind !== 'todo') return 'note';
    if (item.completed) return 'done';
    const due = item.dueAt ? new Date(item.dueAt).getTime() : NaN;
    if (!Number.isFinite(due)) return 'pending';
    if (due < current) return 'overdue';
    return due <= current + 3 * 86400000 ? 'upcoming' : 'pending';
  }

  function journalTone(item, now) {
    if (item.kind !== 'todo') return 'note';
    if (item.completed) return 'done';
    const current = now == null ? Date.now() : new Date(now).getTime();
    const due = item.dueAt ? new Date(item.dueAt).getTime() : NaN;
    if (!Number.isFinite(due)) return 'pending';
    const remaining = due - current;
    if (remaining < 0) return 'overdue';
    if (remaining < 86400000) return 'urgent';
    if (remaining < 3 * 86400000) return 'soon';
    return remaining < 30 * 86400000 ? 'month' : 'later';
  }

  function upcomingTodos(state, now) {
    return (state.journal || []).filter((item) => journalStatus(item, now) === 'upcoming')
      .sort((a, b) => new Date(a.dueAt) - new Date(b.dueAt)).slice(0, 5);
  }

  function filterJournal(state, filters) {
    const options = filters || {};
    const query = String(options.query || '').trim().toLocaleLowerCase('zh-Hant');
    return (state.journal || []).filter((item) => {
      if (query && ![item.title, item.content, item.date, item.dueAt].join(' ').toLocaleLowerCase('zh-Hant').includes(query)) return false;
      if (options.filter === 'note' || options.filter === 'todo') return item.kind === options.filter;
      if (options.filter === 'pending') return item.kind === 'todo' && !item.completed;
      if (options.filter === 'done') return item.kind === 'todo' && item.completed;
      return true;
    }).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  }

  function updateCustomFields(state, person, fields) {
    const definitions = fields.map((field) => ({ id: field.id, label: field.label }));
    if (new Set(definitions.map((field) => field.label)).size !== definitions.length) throw new Error('自訂欄位名稱不可重複');
    if (definitions.some((field) => !field.label)) throw new Error('請填寫自訂欄位名稱');
    state.settings.customFields = definitions;
    state.people.forEach((other) => {
      const values = other.id === person.id ? fields : other.customFields || [];
      other.customFields = definitions.map((definition) => {
        const stored = values.find((entry) => entry.id === definition.id);
        return Object.assign({}, definition, { value: stored ? stored.value : '' });
      });
    });
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
      return sum + Math.max(0, Number(loan.kind === 'item' ? transaction.quantity : transaction.amount) || 0);
    }, 0);
  }

  function saveTransaction(loan, input, transactionId) {
    if (!loan) throw new Error('找不到這筆借貸');
    const transactions = loan.transactions || [];
    const existing = transactions.find((item) => item.id === transactionId);
    if (transactionId && !existing) throw new Error('找不到這筆還款／歸還紀錄');
    if (loan.waived && !existing) throw new Error('已免除的借貸不能新增還款');
    const key = loan.kind === 'item' ? 'quantity' : 'amount';
    const value = Number(input[key]);
    const original = Number(loan.kind === 'item' ? loan.quantity : loan.amount) || 0;
    const otherTotal = transactionTotal(loan) - (existing ? Number(existing[key]) || 0 : 0);
    if (!Number.isInteger(value) || value <= 0) throw new Error('請輸入大於 0 的整數');
    if (value > original - otherTotal) throw new Error('歸還金額或數量不能超過未還餘額');
    if (!input.occurredAt || Number.isNaN(new Date(input.occurredAt).getTime())) throw new Error('請輸入有效日期時間');
    const stamp = nowIso();
    const transaction = Object.assign({}, existing || {}, input, {
      id: existing ? existing.id : uid('payment'),
      createdAt: existing ? existing.createdAt : stamp,
      updatedAt: stamp,
      [key]: value
    });
    loan.transactions = existing ? transactions.map((item) => item.id === transaction.id ? transaction : item) : [...transactions, transaction];
    loan.updatedAt = stamp;
    return transaction;
  }

  function removeTransaction(loan, transactionId) {
    if (!loan || !(loan.transactions || []).some((item) => item.id === transactionId)) throw new Error('找不到這筆還款／歸還紀錄');
    loan.transactions = loan.transactions.filter((item) => item.id !== transactionId);
    loan.updatedAt = nowIso();
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
    const qualityThreshold = clampScore(state.settings.qualityThreshold == null ? 90 : state.settings.qualityThreshold);
    const poorThreshold = clampScore(state.settings.poorThreshold == null ? 40 : state.settings.poorThreshold);
    return state.people.reduce((summary, person) => {
      const debt = personDebtSummary(state, person.id);
      const score = personScore(state, person);
      if (score >= qualityThreshold) summary.qualityCount += 1;
      if (score <= poorThreshold) summary.poorCount += 1;
      summary.owedToMe += debt.owedToMe;
      summary.iOwe += debt.iOwe;
      summary.lentItems += debt.lentItems;
      summary.borrowedItems += debt.borrowedItems;
      summary.overdueCount += debt.overdueCount;
      return summary;
    }, {
      people: state.people.length,
      qualityCount: 0,
      poorCount: 0,
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
      person.birthday, person.zodiac, person.bloodType, person.notes, ...(person.tags || []), ...categoryNames,
      ...(person.customFields || []).flatMap((field) => [field.label, field.value]),
      ...events.flatMap((event) => [event.title, event.detail]),
      ...loans.flatMap((loan) => [loan.title, loan.note, loan.itemCondition, loan.returnCondition,
        ...(loan.transactions || []).flatMap((transaction) => [transaction.note, transaction.returnCondition])])
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
      if (String(settings.filter).startsWith('tag:')) {
        const tag = String(settings.filter).slice(4);
        return person.relation === tag || (person.tags || []).includes(tag);
      }
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
      otherContact: 'LINE：wang-demo', relation: '同事', birthday: '1988-01-15', zodiac: '摩羯座', bloodType: 'O', avatar: null,
      tags: ['同事', '需觀察', '借貸中'], notes: '展示用人物，可從設定刪除全部資料。',
      customFields: [{ id: 'demo_field_1', label: '公司', value: '展示企業' }],
      startScore: 80, categoryStarts: { credit: 57, responsibility: 60, ability: 86, relationship: 68, finance: 74 }, createdAt: '2026-08-01T10:00:00+08:00', updatedAt: '2026-09-09T10:00:00+08:00'
    };
    const p2 = {
      id: 'demo_lin', name: '林雅婷', nickname: '', phone: '', otherContact: '', relation: '朋友',
      birthday: '1992-06-18', zodiac: '雙子座', bloodType: 'A', avatar: null, tags: ['朋友', '可合作'], notes: '', startScore: 88,
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
      reminderEnabled: true, waived: false, createdAt: '2026-07-15T12:00:00+08:00', updatedAt: '2026-08-02T12:00:00+08:00'
    });
    const stamp = nowIso();
    const dateAfter = (days) => new Date(Date.now() + days * 86400000).toISOString();
    const samples = [
      ['chen', '陳沛清', '讀書會朋友', '喜歡歷史與手沖咖啡，聚會偏好安靜的座位。聯絡前先確認方便的時間。', '討論下次讀書會', '一起整理閱讀筆記，約定各帶一段喜歡的文字分享。'],
      ['liu', '劉星羽', '專案夥伴', '擅長整理簡報與攝影，溝通時喜歡先看清單。週末常安排戶外活動。', '完成活動分工', '確認場地、器材與交通安排，主動整理共用檢查清單。'],
      ['guo', '郭文德', '鄰居', '喜歡園藝與料理，習慣事先約好時間。借用物品時會記下配件與歸還日期。', '分享陽台種植心得', '交換香草照顧方式，記下澆水頻率與日照位置，約好下週交流成果。']
    ];
    samples.forEach(([key, name, relation, notes, title, detail], i) => {
      const id = `demo_${key}`;
      state.people.push({ id, name, nickname: name.slice(1), phone: '', otherContact: '', relation, birthday: '', zodiac: '', bloodType: '', avatar: null, tags: ['朋友'], notes: `【虛構示範人物，與真實人物無關】${notes}`, customFields: [{ id: `${id}_field`, label: '聯絡偏好', value: ['平日晚間文字訊息', '先傳議程再約時間', '週末下午'][i] }], startScore: 80 + i * 3, categoryStarts: {}, createdAt: stamp, updatedAt: stamp });
      [0, 1].forEach((n) => state.events.push({ id: `${id}_event_${n}`, personId: id, title: n ? '後續聯絡與確認' : title, detail: `【虛構示範】${n ? '已確認雙方時間，整理討論重點；下次聯絡時再詢問進度，不重複打擾。' : detail}`, delta: n ? 1 : 3, categoryIds: ['relationship'], important: !n, followUp: !!n, attachments: [], occurredAt: dateAfter(-i - n - 1), createdAt: stamp }));
    });
    state.journal.push(...[
      ['讀書會前確認書單', .5, false], ['整理活動器材清單', 2, false], ['回覆聚餐時間', 10, false],
      ['下季聚會規劃', 45, false], ['補寫上週交流筆記', -1, false], ['確認場地資訊', -2, true]
    ].map(([title, days, completed], i) => ({ id: `demo_todo_${i}`, kind: 'todo', title, content: '【虛構示範】先整理需要確認的問題，聯絡後記下結果與下一步。', date: stamp.slice(0, 10), dueAt: dateAfter(days), completed, createdAt: stamp, updatedAt: stamp })));
    state.journal.push({ id: 'demo_note', kind: 'note', title: '今天的人際觀察', content: '【虛構示範】\n好的交流不一定要很長，記得對方在意的小事就很有幫助。\n下次見面：詢問讀書進度、帶回借用的書，並分享這週的新發現。', date: stamp.slice(0, 10), dueAt: '', completed: false, createdAt: stamp, updatedAt: stamp });
    state.meta.updatedAt = nowIso();
    return state;
  }

  return {
    DEFAULT_CATEGORIES,
    SCORE_BANDS,
    TAG_STYLE_KEYS,
    THEMES,
    validColor,
    contrastText,
    journalStatus,
    journalTone,
    upcomingTodos,
    filterJournal,
    ZODIAC_SIGNS,
    activeLoans,
    categoryScore,
    categoryScores,
    clampScore,
    createDefaultState,
    customFieldsFor,
    updateCustomFields,
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
    saveTransaction,
    removeTransaction,
    signedDelta,
    searchablePersonText,
    transactionTotal,
    uid,
    zodiacFromBirthday
  };
});

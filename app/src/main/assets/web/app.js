(function () {
  'use strict';

  const Logic = window.RenjiLogic;
  const Store = window.RenjiStore;
  const app = document.getElementById('app');
  const sheet = document.getElementById('sheet');
  const sheetContent = document.getElementById('sheet-content');
  const confirmDialog = document.getElementById('confirm-dialog');
  const toastElement = document.getElementById('toast');

  let state = Logic.createDefaultState();
  let currentView = 'people';
  let unlocked = false;
  let toastTimer = null;
  let deferredInstallPrompt = null;
  let lastInteractionAt = Date.now();

  const filters = {
    people: { query: '', filter: 'all', categoryId: '', sort: 'scoreLow' },
    loans: { query: '', filter: 'active' },
    events: { query: '', filter: 'all' }
  };

  const viewMeta = {
    people: { title: '人物', addLabel: '新增人物' },
    loans: { title: '借貸帳本', addLabel: '新增借貸' },
    events: { title: '事件紀錄', addLabel: '新增事件' },
    settings: { title: '設定', addLabel: '新增人物' }
  };

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function attribute(value) {
    return escapeHtml(value).replace(/`/g, '&#096;');
  }

  function money(value) {
    return new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 }).format(Math.round(Number(value) || 0));
  }

  function signed(value) {
    const number = Math.round(Number(value) || 0);
    return `${number > 0 ? '+' : ''}${number}`;
  }

  function dateText(value, includeTime) {
    if (!value) return '未設定';
    const date = new Date(value.length <= 10 ? `${value}T12:00:00` : value);
    if (Number.isNaN(date.getTime())) return escapeHtml(value);
    const options = includeTime
      ? { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }
      : { year: 'numeric', month: '2-digit', day: '2-digit' };
    return new Intl.DateTimeFormat('zh-TW', options).format(date);
  }

  function localDateValue(value, withTime) {
    const date = value ? new Date(value) : new Date();
    const adjusted = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return withTime ? adjusted.toISOString().slice(0, 16) : adjusted.toISOString().slice(0, 10);
  }

  function personById(id) {
    return state.people.find((person) => person.id === id);
  }

  function loanById(id) {
    return state.loans.find((loan) => loan.id === id);
  }

  function eventById(id) {
    return state.events.find((event) => event.id === id);
  }

  function categoryName(id) {
    const category = state.settings.categories.find((item) => item.id === id);
    return category ? category.name : '已停用分類';
  }

  function initials(person) {
    const name = person.name || person.nickname || '?';
    return escapeHtml(Array.from(name)[0] || '?');
  }

  function tagHtml(tag, variant) {
    return `<span class="tag ${variant || ''}">${escapeHtml(tag)}</span>`;
  }

  function scoreBadgeHtml(score, personId, compact) {
    const band = Logic.scoreBand(score);
    return `<button class="score-badge band-${band.key}" data-action="show-score" data-person-id="${attribute(personId)}" aria-label="查看分數明細">${score}</button>${compact ? '' : `<span class="score-label">${escapeHtml(band.label)}</span>`}`;
  }

  function attachmentHtml(attachments) {
    if (!attachments || !attachments.length) return '';
    return `<div class="attachment-grid">${attachments.map((item) => `<img src="${attribute(item.dataUrl)}" alt="${attribute(item.name || '附件')}" loading="lazy">`).join('')}</div>`;
  }

  function directionLabel(loan) {
    const labels = {
      owedToMe: '他欠我',
      iOwe: '我欠他',
      lentItem: '我借給他',
      borrowedItem: '我向他借'
    };
    return labels[loan.direction] || '借貸';
  }

  function statusLabel(status) {
    const labels = { active: '進行中', partial: '部分歸還', overdue: '已逾期', settled: '已結清', waived: '已免除' };
    return labels[status] || status;
  }

  function currentTitle() {
    return viewMeta[currentView] ? viewMeta[currentView].title : '人物';
  }

  function topBarHtml() {
    return `
      <header class="topbar">
        <div class="brand">
          <h1>人際小本本</h1>
          <p>魔羯人際風控筆記｜INTJ</p>
        </div>
        <button class="icon-button" data-action="primary-add" aria-label="${viewMeta[currentView].addLabel}">＋</button>
      </header>`;
  }

  function navHtml() {
    const items = [
      ['people', '♟', '人物'],
      ['loans', '◉', '借貸'],
      ['events', '▤', '事件'],
      ['settings', '⚙', '設定']
    ];
    return `<nav class="bottom-nav" aria-label="主要功能">${items.map(([id, icon, label]) => `
      <button class="nav-button ${currentView === id ? 'active' : ''}" data-action="nav" data-view="${id}">
        <span class="nav-icon" aria-hidden="true">${icon}</span>
        <span class="nav-label">${label}</span>
      </button>`).join('')}</nav>`;
  }

  function fabHtml() {
    if (currentView === 'settings') return '';
    return `<button class="fab" data-action="primary-add" aria-label="${viewMeta[currentView].addLabel}">＋</button>`;
  }

  function render() {
    if (!unlocked && state.settings.pinHash) {
      renderLockScreen();
      return;
    }
    let content = '';
    if (currentView === 'people') content = renderPeopleView();
    if (currentView === 'loans') content = renderLoansView();
    if (currentView === 'events') content = renderEventsView();
    if (currentView === 'settings') content = renderSettingsView();
    app.innerHTML = `${topBarHtml()}<main class="page"><div class="section-head"><h2 class="section-title">${currentTitle()}</h2><span class="section-meta">資料僅存於本機</span></div>${content}</main>${navHtml()}${fabHtml()}`;
  }

  function summaryHtml() {
    const summary = Logic.dashboardSummary(state);
    return `<section class="summary-grid" aria-label="借貸摘要">
      <div class="summary-item"><span class="summary-label">人物</span><strong class="summary-value">${summary.people}</strong></div>
      <div class="summary-item"><span class="summary-label">他欠我</span><strong class="summary-value positive">$${money(summary.owedToMe)}</strong></div>
      <div class="summary-item"><span class="summary-label">我欠他</span><strong class="summary-value negative">$${money(summary.iOwe)}</strong></div>
    </section>`;
  }

  function searchHtml(view, placeholder) {
    return `<div class="search-wrap"><input class="search-input" type="search" autocomplete="off" data-role="search" data-view="${view}" value="${attribute(filters[view].query)}" placeholder="${attribute(placeholder)}" aria-label="搜尋"></div>`;
  }

  function peopleFiltersHtml() {
    const options = [
      ['all', '全部'], ['highRisk', '高風險'], ['activeLoans', '借貸中'], ['overdue', '已逾期']
    ];
    const categories = state.settings.categories.filter((category) => category.active !== false);
    return `
      <div class="chip-row">${options.map(([id, label]) => `<button class="chip ${filters.people.filter === id ? 'active' : ''}" data-action="people-filter" data-filter="${id}">${label}</button>`).join('')}</div>
      <div class="filter-tools">
        <select class="compact-select" data-role="people-category" aria-label="依分類篩選">
          <option value="">全部分類</option>
          ${categories.map((category) => `<option value="${attribute(category.id)}" ${filters.people.categoryId === category.id ? 'selected' : ''}>${escapeHtml(category.name)}</option>`).join('')}
        </select>
        <select class="compact-select" data-role="people-sort" aria-label="排序">
          <option value="scoreLow" ${filters.people.sort === 'scoreLow' ? 'selected' : ''}>總分：低到高</option>
          <option value="scoreHigh" ${filters.people.sort === 'scoreHigh' ? 'selected' : ''}>總分：高到低</option>
          <option value="category" ${filters.people.sort === 'category' ? 'selected' : ''}>所選分類排序</option>
          <option value="recent" ${filters.people.sort === 'recent' ? 'selected' : ''}>最近更新</option>
          <option value="name" ${filters.people.sort === 'name' ? 'selected' : ''}>姓名排序</option>
        </select>
      </div>`;
  }

  function renderPeopleView() {
    return `${summaryHtml()}${searchHtml('people', '搜尋姓名、事件、標籤、借貸')}${peopleFiltersHtml()}<div id="people-list">${renderPeopleListHtml()}</div>`;
  }

  function renderPeopleListHtml() {
    const people = Logic.filterPeople(state, filters.people);
    if (!people.length) {
      const isEmpty = state.people.length === 0;
      return `<div class="empty-state">
        <span class="empty-icon">${isEmpty ? '◇' : '⌕'}</span>
        <h2>${isEmpty ? '建立第一位人物' : '沒有符合條件的人物'}</h2>
        <p>${isEmpty ? '從人物、事件與借貸開始建立可追溯的人際風險紀錄。' : '調整搜尋文字或篩選條件後再查看。'}</p>
        ${isEmpty ? '<button class="button primary" data-action="add-person">新增人物</button>' : ''}
      </div>`;
    }
    return `<div class="list-stack">${people.map(personCardHtml).join('')}</div>`;
  }

  function debtKeyLine(person) {
    const debt = Logic.personDebtSummary(state, person.id);
    const parts = [];
    if (debt.owedToMe > 0) parts.push(`他欠我 <span class="amount-owed">$${money(debt.owedToMe)}</span>`);
    if (debt.iOwe > 0) parts.push(`我欠他 <span class="amount-i-owe">$${money(debt.iOwe)}</span>`);
    if (debt.lentItems > 0) parts.push(`借出物品 ${money(debt.lentItems)} 件`);
    if (debt.borrowedItems > 0) parts.push(`借入物品 ${money(debt.borrowedItems)} 件`);
    if (debt.overdueCount > 0) parts.push(`<span class="overdue">逾期 ${debt.overdueCount} 筆</span>`);
    if (!parts.length) return '';
    return `<div class="key-line"><span class="key-icon">$</span><button class="debt-link" data-action="show-person-loans" data-person-id="${attribute(person.id)}">${parts.join('｜')}</button></div>`;
  }

  function personCardHtml(person) {
    const score = Logic.personScore(state, person);
    const low = Logic.lowestCategories(state, person, 2);
    const selectedCategory = filters.people.categoryId
      ? Logic.categoryScores(state, person).find((category) => category.id === filters.people.categoryId)
      : null;
    const recent = Logic.personEvents(state, person.id)[0];
    const debt = Logic.personDebtSummary(state, person.id);
    const tags = Array.from(new Set([person.relation, ...(person.tags || []), debt.activeCount ? '借貸中' : ''].filter(Boolean))).slice(0, 4);
    return `<article class="person-card">
      <div class="person-head">
        <div class="avatar" aria-hidden="true">${initials(person)}</div>
        <div>
          <h3 class="person-name">${escapeHtml(person.name || '未命名')}</h3>
          ${person.nickname ? `<div class="person-alias">暱稱：${escapeHtml(person.nickname)}</div>` : ''}
        </div>
        <div class="score-cluster">${scoreBadgeHtml(score, person.id, false)}</div>
      </div>
      ${tags.length ? `<div class="tag-list">${tags.map((tag, index) => tagHtml(tag, tag === '借貸中' ? 'gold' : index === 1 && score <= 60 ? 'danger' : '')).join('')}</div>` : ''}
      <div class="key-lines">
        ${debtKeyLine(person)}
        <div class="key-line"><span class="key-icon">◇</span><button class="text-link" data-action="show-score" data-person-id="${attribute(person.id)}">${selectedCategory ? `所選分類：${escapeHtml(selectedCategory.name)} ${selectedCategory.score}｜總分 ${score}` : `主要風險：${low.map((item) => `${escapeHtml(item.name)} ${item.score}`).join('｜') || '尚無分類'}`}</button></div>
        ${recent ? `<div class="key-line"><span class="key-icon">▤</span><button class="event-link" data-action="show-event" data-event-id="${attribute(recent.id)}">最近事件：${escapeHtml(recent.title)} <span class="${recent.delta >= 0 ? 'delta-positive' : 'delta-negative'}">${signed(recent.delta)}</span></button></div>` : ''}
      </div>
      <div class="card-actions">
        <button class="action-button" data-action="add-event" data-person-id="${attribute(person.id)}">記事件</button>
        <button class="action-button" data-action="add-loan" data-person-id="${attribute(person.id)}">借貸</button>
        <button class="action-button" data-action="show-person" data-person-id="${attribute(person.id)}">查看</button>
      </div>
    </article>`;
  }

  function renderLoansView() {
    const summary = Logic.dashboardSummary(state);
    const filterOptions = [
      ['active', '未結清'], ['overdue', '已逾期'], ['money', '金錢'], ['item', '物品'], ['settled', '已結清'], ['all', '全部']
    ];
    return `
      <section class="summary-grid" aria-label="借貸摘要">
        <div class="summary-item"><span class="summary-label">他欠我</span><strong class="summary-value positive">$${money(summary.owedToMe)}</strong></div>
        <div class="summary-item"><span class="summary-label">我欠他</span><strong class="summary-value negative">$${money(summary.iOwe)}</strong></div>
        <div class="summary-item"><span class="summary-label">逾期</span><strong class="summary-value ${summary.overdueCount ? 'warning' : ''}">${summary.overdueCount}</strong></div>
      </section>
      ${searchHtml('loans', '搜尋人物、金額、物品或備註')}
      <div class="chip-row">${filterOptions.map(([id, label]) => `<button class="chip ${filters.loans.filter === id ? 'active' : ''}" data-action="loan-filter" data-filter="${id}">${label}</button>`).join('')}</div>
      <div id="loans-list">${renderLoansListHtml()}</div>`;
  }

  function filteredLoans() {
    const query = String(filters.loans.query || '').trim().toLocaleLowerCase('zh-Hant');
    return state.loans.filter((loan) => {
      const person = personById(loan.personId) || {};
      const status = Logic.loanStatus(loan);
      const text = [person.name, person.nickname, loan.title, loan.note, loan.itemCondition, loan.serialNumber, loan.amount, loan.quantity].join(' ').toLocaleLowerCase('zh-Hant');
      if (query && !text.includes(query)) return false;
      if (filters.loans.filter === 'active') return !['settled', 'waived'].includes(status);
      if (filters.loans.filter === 'overdue') return status === 'overdue';
      if (filters.loans.filter === 'settled') return ['settled', 'waived'].includes(status);
      if (filters.loans.filter === 'money') return loan.kind === 'money';
      if (filters.loans.filter === 'item') return loan.kind === 'item';
      return true;
    }).sort((a, b) => {
      const priority = { overdue: 0, active: 1, partial: 1, settled: 2, waived: 3 };
      const statusDifference = (priority[Logic.loanStatus(a)] || 0) - (priority[Logic.loanStatus(b)] || 0);
      if (statusDifference) return statusDifference;
      return new Date(b.startAt || b.createdAt) - new Date(a.startAt || a.createdAt);
    });
  }

  function renderLoansListHtml() {
    const loans = filteredLoans();
    if (!loans.length) {
      return `<div class="empty-state"><span class="empty-icon">◉</span><h2>沒有借貸紀錄</h2><p>記錄他欠你的、你欠他的，以及借出或借入的物品。</p><button class="button primary" data-action="add-loan">新增借貸</button></div>`;
    }
    return `<div class="list-stack">${loans.map(loanCardHtml).join('')}</div>`;
  }

  function loanCardHtml(loan) {
    const person = personById(loan.personId) || { name: '已刪除人物' };
    const status = Logic.loanStatus(loan);
    const remaining = Logic.loanRemaining(loan);
    const original = loan.kind === 'item' ? Number(loan.quantity) || 0 : Number(loan.amount) || 0;
    const completed = original > 0 ? Math.min(100, Math.round(((original - remaining) / original) * 100)) : 0;
    const overdueDays = Logic.overdueDays(loan);
    return `<article class="loan-card" role="button" data-action="show-loan" data-loan-id="${attribute(loan.id)}">
      <div class="loan-head">
        <div><h3>${escapeHtml(loan.title || (loan.kind === 'money' ? '金錢借貸' : '物品借貸'))}</h3><div class="loan-person">${escapeHtml(person.name)}｜${directionLabel(loan)}</div></div>
        <span class="loan-status ${status === 'overdue' ? 'overdue' : ''}">${statusLabel(status)}${overdueDays ? ` ${overdueDays}天` : ''}</span>
      </div>
      <div class="loan-amount ${loan.direction === 'owedToMe' ? 'amount-owed' : loan.direction === 'iOwe' ? 'amount-i-owe' : ''}">${loan.kind === 'money' ? `$${money(remaining)}` : `${money(remaining)} 件`}</div>
      <div class="small-muted">原始${loan.kind === 'money' ? '金額' : '數量'}：${loan.kind === 'money' ? `$${money(original)}` : `${money(original)} 件`}｜到期：${dateText(loan.dueAt, false)}</div>
      <div class="loan-progress"><span style="width:${completed}%"></span></div>
      ${loan.note ? `<div class="small-muted">${escapeHtml(loan.note)}</div>` : ''}
    </article>`;
  }

  function renderEventsView() {
    const plus = state.events.filter((event) => Number(event.delta) > 0).length;
    const minus = state.events.filter((event) => Number(event.delta) < 0).length;
    const filterOptions = [['all', '全部'], ['negative', '扣分'], ['positive', '加分'], ['followUp', '待追蹤'], ['important', '重要']];
    return `
      <section class="summary-grid" aria-label="事件摘要">
        <div class="summary-item"><span class="summary-label">事件</span><strong class="summary-value">${state.events.length}</strong></div>
        <div class="summary-item"><span class="summary-label">加分</span><strong class="summary-value positive">${plus}</strong></div>
        <div class="summary-item"><span class="summary-label">扣分</span><strong class="summary-value warning">${minus}</strong></div>
      </section>
      ${searchHtml('events', '搜尋人物、事件或內容')}
      <div class="chip-row">${filterOptions.map(([id, label]) => `<button class="chip ${filters.events.filter === id ? 'active' : ''}" data-action="event-filter" data-filter="${id}">${label}</button>`).join('')}</div>
      <div id="events-list">${renderEventsListHtml()}</div>`;
  }

  function filteredEvents() {
    const query = String(filters.events.query || '').trim().toLocaleLowerCase('zh-Hant');
    return state.events.filter((event) => {
      const person = personById(event.personId) || {};
      const text = [person.name, person.nickname, event.title, event.detail, ...(event.categoryIds || []).map(categoryName)].join(' ').toLocaleLowerCase('zh-Hant');
      if (query && !text.includes(query)) return false;
      if (filters.events.filter === 'negative') return Number(event.delta) < 0;
      if (filters.events.filter === 'positive') return Number(event.delta) > 0;
      if (filters.events.filter === 'followUp') return Boolean(event.followUp);
      if (filters.events.filter === 'important') return Boolean(event.important);
      return true;
    }).sort((a, b) => new Date(b.occurredAt || b.createdAt) - new Date(a.occurredAt || a.createdAt));
  }

  function renderEventsListHtml() {
    const events = filteredEvents();
    if (!events.length) {
      return `<div class="empty-state"><span class="empty-icon">▤</span><h2>沒有事件紀錄</h2><p>把實際行為記下來，分數才有可回溯的理由。</p><button class="button primary" data-action="add-event">新增事件</button></div>`;
    }
    return `<div class="list-stack">${events.map(eventCardHtml).join('')}</div>`;
  }

  function eventCardHtml(event) {
    const person = personById(event.personId) || { name: '已刪除人物' };
    const delta = Number(event.delta) || 0;
    return `<article class="event-card" role="button" data-action="show-event" data-event-id="${attribute(event.id)}">
      <div class="event-head">
        <div><h3>${escapeHtml(event.title || '未命名事件')}</h3><div class="event-person">${escapeHtml(person.name)}｜${dateText(event.occurredAt || event.createdAt, true)}</div></div>
        <div class="event-score ${delta >= 0 ? 'delta-positive' : 'delta-negative'}">${signed(delta)}</div>
      </div>
      ${event.detail ? `<p class="event-detail">${escapeHtml(event.detail.length > 120 ? `${event.detail.slice(0, 120)}…` : event.detail)}</p>` : ''}
      <div class="event-flags">
        ${(event.categoryIds || []).map((id) => tagHtml(categoryName(id), 'gold')).join('')}
        ${event.important ? tagHtml('重要事件', 'danger') : ''}
        ${event.followUp ? tagHtml('待追蹤', '') : ''}
      </div>
    </article>`;
  }

  function renderSettingsView() {
    const activeCategories = state.settings.categories.filter((category) => category.active !== false);
    const inactiveCategories = state.settings.categories.filter((category) => category.active === false);
    return `
      <section class="settings-card">
        <h3>評分設定</h3>
        <p>新增人物時預設從這個分數開始；既有人物不會被改動。</p>
        <div class="settings-line">
          <strong>新人物起始分</strong>
          <input class="inline-input" style="width:92px" type="number" min="0" max="100" value="${state.settings.defaultStartScore}" data-role="default-score" aria-label="新人物起始分">
        </div>
        <button class="button primary full" data-action="save-default-score">儲存起始分</button>
      </section>

      <section class="settings-card">
        <div class="settings-line"><strong>評分類別</strong><button class="button secondary" data-action="add-category">新增分類</button></div>
        ${activeCategories.map((category) => `<div class="settings-line"><span>${escapeHtml(category.name)}</span><span><button class="text-link" data-action="edit-category" data-category-id="${attribute(category.id)}">修改</button>　<button class="text-link" data-action="toggle-category" data-category-id="${attribute(category.id)}">停用</button></span></div>`).join('')}
        ${inactiveCategories.length ? `<div class="small-muted" style="margin-top:12px">已停用</div>${inactiveCategories.map((category) => `<div class="settings-line"><span class="small-muted">${escapeHtml(category.name)}</span><button class="text-link" data-action="toggle-category" data-category-id="${attribute(category.id)}">重新啟用</button></div>`).join('')}` : ''}
      </section>

      <section class="settings-card">
        <div class="settings-line"><strong>常用標籤</strong><button class="button secondary" data-action="add-tag">新增標籤</button></div>
        <div class="tag-list">${state.settings.tags.map((tag) => `<button class="tag" data-action="remove-tag" data-tag="${attribute(tag)}" title="點擊移除">${escapeHtml(tag)} ×</button>`).join('') || '<span class="small-muted">尚無常用標籤</span>'}</div>
      </section>

      <section class="settings-card">
        <h3>隱私鎖</h3>
        <p>PIN 只用來阻擋直接開啟介面，資料仍保存在本機，請勿把它視為加密保險箱。</p>
        <div class="settings-line"><strong>目前狀態</strong><span class="settings-value">${state.settings.pinHash ? '已啟用' : '未啟用'}</span></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:10px">
          <button class="button secondary" data-action="set-pin">${state.settings.pinHash ? '變更 PIN' : '設定 PIN'}</button>
          ${state.settings.pinHash ? '<button class="button danger" data-action="remove-pin">移除 PIN</button>' : '<button class="button secondary" disabled>移除 PIN</button>'}
        </div>
        ${state.settings.pinHash ? '<button class="button full" style="margin-top:9px" data-action="lock-now">立即鎖定</button>' : ''}
      </section>

      <section class="settings-card">
        <h3>資料與備份</h3>
        <p>備份會包含人物、事件、借貸、附件與設定。換手機前務必匯出。</p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:9px">
          <button class="button primary" data-action="export-backup">匯出備份</button>
          <button class="button secondary" data-action="import-backup">匯入備份</button>
        </div>
        <input id="backup-file" class="hidden" type="file" accept="application/json,.json">
        ${deferredInstallPrompt ? '<button class="button full" style="margin-top:9px" data-action="install-app">安裝到桌面</button>' : ''}
      </section>

      <section class="settings-card danger-zone">
        <h3>測試與清除</h3>
        <p>示範資料可以協助先看完整畫面；清除動作無法復原。</p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:9px">
          <button class="button secondary" data-action="load-demo">載入示範資料</button>
          <button class="button danger" data-action="clear-all">清除全部資料</button>
        </div>
      </section>`;
  }

  function sheetHead(title, subtitle) {
    return `<div class="sheet-head"><div><h2 class="sheet-title">${escapeHtml(title)}</h2>${subtitle ? `<p class="sheet-subtitle">${escapeHtml(subtitle)}</p>` : ''}</div><button class="sheet-close" data-action="close-sheet" aria-label="關閉">×</button></div>`;
  }

  function openSheet(html) {
    sheetContent.innerHTML = html;
    if (!sheet.open) sheet.showModal();
    sheet.scrollTop = 0;
    const frame = sheet.querySelector('.sheet-frame');
    if (frame) frame.scrollTop = 0;
    setTimeout(() => {
      const field = sheetContent.querySelector('[autofocus]');
      if (field) field.focus({ preventScroll: true });
    }, 100);
  }

  function closeSheet() {
    if (sheet.open) sheet.close();
    sheetContent.innerHTML = '';
  }

  function peopleOptions(selectedId) {
    return state.people
      .slice()
      .sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh-Hant'))
      .map((person) => `<option value="${attribute(person.id)}" ${person.id === selectedId ? 'selected' : ''}>${escapeHtml(person.name)}${person.nickname ? `（${escapeHtml(person.nickname)}）` : ''}</option>`)
      .join('');
  }

  function personFormHtml(person) {
    const editing = Boolean(person);
    const item = person || {
      id: '', name: '', nickname: '', phone: '', otherContact: '', relation: '',
      knownAt: localDateValue(null, false), tags: [], notes: '', startScore: state.settings.defaultStartScore
    };
    const selectedTags = new Set(item.tags || []);
    const customTags = (item.tags || []).filter((tag) => !state.settings.tags.includes(tag));
    return `${sheetHead(editing ? '修改人物' : '新增人物', '先記重要資料，其餘日後補充即可。')}
      <form id="person-form" class="form-stack">
        <input type="hidden" name="id" value="${attribute(item.id)}">
        <div class="form-grid">
          <label class="field"><span>姓名 *</span><input name="name" required maxlength="60" value="${attribute(item.name)}" autofocus></label>
          <label class="field"><span>暱稱</span><input name="nickname" maxlength="60" value="${attribute(item.nickname)}"></label>
          <label class="field"><span>關係</span><input name="relation" maxlength="40" placeholder="同事、朋友、客戶…" value="${attribute(item.relation)}"></label>
          <label class="field"><span>認識日期</span><input name="knownAt" type="date" value="${attribute(item.knownAt)}"></label>
          <label class="field"><span>電話</span><input name="phone" type="tel" maxlength="50" value="${attribute(item.phone)}"></label>
          <label class="field"><span>其他聯絡</span><input name="otherContact" maxlength="120" placeholder="LINE、Email、地址…" value="${attribute(item.otherContact)}"></label>
          <label class="field"><span>起始分數</span><input name="startScore" type="number" min="0" max="100" required value="${attribute(item.startScore)}"><small>建立後仍可修改，但不會改動事件紀錄。</small></label>
          <label class="field full"><span>備註</span><textarea name="notes" maxlength="2000" placeholder="身份、背景或需要記住的事">${escapeHtml(item.notes)}</textarea></label>
        </div>
        <div class="field"><span>常用標籤</span><div class="check-list">${state.settings.tags.map((tag) => `<label class="check-chip"><input type="checkbox" name="tags" value="${attribute(tag)}" ${selectedTags.has(tag) ? 'checked' : ''}><span>${escapeHtml(tag)}</span></label>`).join('')}</div></div>
        <label class="field"><span>其他標籤</span><input name="customTags" value="${attribute(customTags.join('、'))}" placeholder="以逗號或頓號分隔"></label>
        <div class="form-actions"><button type="button" class="button secondary" data-action="close-sheet">取消</button><button class="button primary" type="submit">${editing ? '儲存修改' : '建立人物'}</button></div>
      </form>`;
  }

  function personDetailHtml(person) {
    const score = Logic.personScore(state, person);
    const band = Logic.scoreBand(score);
    const debt = Logic.personDebtSummary(state, person.id);
    const events = Logic.personEvents(state, person.id).slice(0, 3);
    const warnings = [];
    if (debt.overdueCount) warnings.push(`${debt.overdueCount} 筆借貸已逾期`);
    const low = Logic.lowestCategories(state, person, 2);
    low.filter((category) => category.score <= 60).forEach((category) => warnings.push(`${category.name}僅 ${category.score} 分`));
    return `${sheetHead(person.name || '人物資料', person.nickname ? `暱稱：${person.nickname}` : band.label)}
      <div class="score-overview">${scoreBadgeHtml(score, person.id, true)}<div><strong style="font-size:19px">${escapeHtml(band.label)}</strong><div class="small-muted">起始 ${person.startScore} 分｜事件 ${Logic.personEvents(state, person.id).length} 筆</div></div></div>
      ${warnings.length ? `<div class="notice danger">${warnings.map(escapeHtml).join('｜')}</div>` : '<div class="notice">目前沒有逾期或 60 分以下的重大警示。</div>'}
      <div class="section-head"><h3 class="section-title">重要資料</h3></div>
      <div class="detail-list">
        <div class="detail-row"><span>關係</span><span>${escapeHtml(person.relation || '未設定')}</span></div>
        <div class="detail-row"><span>電話</span><span>${person.phone ? `<a href="tel:${attribute(person.phone)}">${escapeHtml(person.phone)}</a>` : '未設定'}</span></div>
        <div class="detail-row"><span>其他聯絡</span><span>${escapeHtml(person.otherContact || '未設定')}</span></div>
        <div class="detail-row"><span>認識日期</span><span>${dateText(person.knownAt, false)}</span></div>
        <div class="detail-row"><span>他欠我</span><span class="amount-owed">$${money(debt.owedToMe)}</span></div>
        <div class="detail-row"><span>我欠他</span><span class="amount-i-owe">$${money(debt.iOwe)}</span></div>
      </div>
      ${person.tags && person.tags.length ? `<div class="tag-list">${person.tags.map((tag) => tagHtml(tag)).join('')}</div>` : ''}
      ${person.notes ? `<div class="detail-card"><h3>備註</h3><p class="event-detail">${escapeHtml(person.notes)}</p></div>` : ''}
      <div class="section-head"><h3 class="section-title">最近事件</h3><button class="text-link" data-action="add-event" data-person-id="${attribute(person.id)}">＋ 新增</button></div>
      ${events.length ? `<div class="timeline">${events.map((event) => `<button class="timeline-item ${event.delta >= 0 ? 'positive' : 'negative'} text-link" data-action="show-event" data-event-id="${attribute(event.id)}"><h4>${escapeHtml(event.title)} <span class="${event.delta >= 0 ? 'delta-positive' : 'delta-negative'}">${signed(event.delta)}</span></h4><span class="small-muted">${dateText(event.occurredAt || event.createdAt, true)}</span></button>`).join('')}</div>` : '<div class="small-muted">尚無事件紀錄</div>'}
      <div class="card-actions" style="margin-top:18px"><button class="action-button" data-action="edit-person" data-person-id="${attribute(person.id)}">修改</button><button class="action-button" data-action="add-loan" data-person-id="${attribute(person.id)}">借貸</button><button class="action-button" data-action="show-person-loans" data-person-id="${attribute(person.id)}">往來明細</button></div>
      <button class="button danger full" style="margin-top:10px" data-action="delete-person" data-person-id="${attribute(person.id)}">刪除此人物</button>`;
  }

  function scoreDetailHtml(person) {
    const score = Logic.personScore(state, person);
    const band = Logic.scoreBand(score);
    const categories = Logic.categoryScores(state, person);
    return `${sheetHead(`${person.name}｜分數明細`, '總分由所有事件的加減分累積；分類分數只計入被標記的事件。')}
      <div class="score-overview">${scoreBadgeHtml(score, person.id, true)}<div><strong style="font-size:19px">${escapeHtml(band.label)}</strong><div class="small-muted">人物總分｜起始 ${person.startScore}</div></div></div>
      <div>${categories.map((category) => `<div class="score-row"><strong>${escapeHtml(category.name)}</strong><div class="score-track"><span class="score-fill band-${category.band.key}" style="width:${category.score}%"></span></div><strong style="color:${category.band.color}">${category.score}</strong></div>`).join('')}</div>
      <div class="notice" style="margin-top:15px">借錢或借物本身不會扣分；只有你建立事件，或在歸還紀錄中主動輸入加減分，才會改變評分。</div>
      <button class="button primary full" style="margin-top:14px" data-action="add-event" data-person-id="${attribute(person.id)}">新增評分事件</button>`;
  }

  function eventFormHtml(event, preselectedPersonId) {
    if (!state.people.length) return noPeopleSheet('新增事件');
    const editing = Boolean(event);
    const item = event || {
      id: '', personId: preselectedPersonId || state.people[0].id, title: '', detail: '', delta: 0,
      categoryIds: [], important: false, followUp: false, occurredAt: localDateValue(null, true), attachments: []
    };
    const chosen = new Set(item.categoryIds || []);
    const categories = state.settings.categories.filter((category) => category.active !== false || chosen.has(category.id));
    return `${sheetHead(editing ? '修改事件' : '新增事件', '一次事件只需輸入一個總分變動，可同時影響多個分類。')}
      <form id="event-form" class="form-stack">
        <input type="hidden" name="id" value="${attribute(item.id)}">
        <label class="field"><span>人物 *</span><select name="personId" required>${peopleOptions(item.personId)}</select></label>
        <div class="form-grid">
          <label class="field full"><span>事件標題 *</span><input name="title" required maxlength="100" autofocus value="${attribute(item.title)}" placeholder="例如：再次延後還款"></label>
          <label class="field"><span>日期時間 *</span><input name="occurredAt" type="datetime-local" required value="${attribute(localDateValue(item.occurredAt, true))}"></label>
          <label class="field"><span>加分／扣分 *</span><input name="delta" type="number" min="-100" max="100" required value="${attribute(item.delta)}" placeholder="扣分請輸入負數"><small>例如 +5 或 −10</small></label>
          <label class="field full"><span>事件經過</span><textarea name="detail" maxlength="5000" placeholder="記錄具體行為、承諾及結果">${escapeHtml(item.detail)}</textarea></label>
        </div>
        <div class="field"><span>影響分類</span><div class="check-list">${categories.map((category) => `<label class="check-chip"><input type="checkbox" name="categoryIds" value="${attribute(category.id)}" ${chosen.has(category.id) ? 'checked' : ''}><span>${escapeHtml(category.name)}</span></label>`).join('')}</div><small>未勾選時只影響人物總分。</small></div>
        <div class="choice-grid">
          <label class="choice"><input type="checkbox" name="important" ${item.important ? 'checked' : ''}><span>重要事件</span></label>
          <label class="choice"><input type="checkbox" name="followUp" ${item.followUp ? 'checked' : ''}><span>需要後續觀察</span></label>
        </div>
        <label class="field"><span>新增照片證據</span><input name="attachments" type="file" accept="image/*" multiple><small>每次最多 3 張，會壓縮後保存在本機。</small></label>
        ${attachmentHtml(item.attachments)}
        <div class="form-actions"><button type="button" class="button secondary" data-action="close-sheet">取消</button><button class="button primary" type="submit">${editing ? '儲存修改' : '儲存事件'}</button></div>
      </form>`;
  }

  function eventDetailHtml(event) {
    const person = personById(event.personId) || { name: '已刪除人物' };
    return `${sheetHead(event.title || '事件內容', `${person.name}｜${dateText(event.occurredAt || event.createdAt, true)}`)}
      <div class="score-overview"><div class="score-badge ${event.delta >= 0 ? 'band-green' : 'band-red'}">${signed(event.delta)}</div><div><strong>${event.delta >= 0 ? '加分事件' : '扣分事件'}</strong><div class="small-muted">影響人物總分${event.categoryIds && event.categoryIds.length ? '及所選分類' : ''}</div></div></div>
      <div class="tag-list">${(event.categoryIds || []).map((id) => tagHtml(categoryName(id), 'gold')).join('')}${event.important ? tagHtml('重要事件', 'danger') : ''}${event.followUp ? tagHtml('待追蹤') : ''}</div>
      <div class="detail-card"><h3>事件經過</h3><p class="event-detail">${escapeHtml(event.detail || '未填寫詳細內容')}</p>${attachmentHtml(event.attachments)}</div>
      <div class="card-actions" style="grid-template-columns:1fr 1fr;margin-top:15px"><button class="action-button" data-action="edit-event" data-event-id="${attribute(event.id)}">修改事件</button><button class="action-button" data-action="delete-event" data-event-id="${attribute(event.id)}">刪除事件</button></div>`;
  }

  function noPeopleSheet(actionName) {
    return `${sheetHead(actionName, '必須先建立一位人物，才能把紀錄正確歸屬。')}<div class="empty-state"><span class="empty-icon">◇</span><h2>尚無人物</h2><p>先建立人物，再新增事件或借貸。</p><button class="button primary" data-action="add-person">新增人物</button></div>`;
  }

  function loanDirectionOptions(kind, selected) {
    const options = kind === 'item'
      ? [['lentItem', '我借物品給他'], ['borrowedItem', '我向他借物品']]
      : [['owedToMe', '他欠我錢'], ['iOwe', '我欠他錢']];
    return options.map(([id, label]) => `<option value="${id}" ${selected === id ? 'selected' : ''}>${label}</option>`).join('');
  }

  function loanFormHtml(loan, preselectedPersonId) {
    if (!state.people.length) return noPeopleSheet('新增借貸');
    const editing = Boolean(loan);
    const item = loan || {
      id: '', personId: preselectedPersonId || state.people[0].id, kind: 'money', direction: 'owedToMe',
      title: '', amount: '', quantity: 1, estimatedValue: '', startAt: localDateValue(null, false), dueAt: '',
      interestNote: '', serialNumber: '', itemCondition: '', note: '', attachments: [], transactions: []
    };
    const isItem = item.kind === 'item';
    return `${sheetHead(editing ? '修改借貸' : '新增借貸', '金錢與物品分開記錄，部分歸還不會覆蓋原始資料。')}
      <form id="loan-form" class="form-stack">
        <input type="hidden" name="id" value="${attribute(item.id)}">
        <label class="field"><span>人物 *</span><select name="personId" required>${peopleOptions(item.personId)}</select></label>
        <div class="choice-grid">
          <label class="choice"><input type="radio" name="kind" value="money" ${!isItem ? 'checked' : ''}><span>金錢</span></label>
          <label class="choice"><input type="radio" name="kind" value="item" ${isItem ? 'checked' : ''}><span>物品</span></label>
        </div>
        <label class="field"><span>借貸方向 *</span><select name="direction" data-role="loan-direction" required>${loanDirectionOptions(item.kind, item.direction)}</select></label>
        <label class="field"><span>${isItem ? '物品名稱' : '借貸名稱'} *</span><input name="title" data-role="loan-title" required maxlength="100" value="${attribute(item.title)}" placeholder="${isItem ? '例如：安全帽' : '例如：代墊餐費'}" autofocus></label>
        <div class="form-grid ${isItem ? 'hidden' : ''}" data-money-fields>
          <label class="field"><span>原始金額 *</span><input name="amount" type="number" min="1" step="1" value="${attribute(item.amount)}" ${isItem ? '' : 'required'} inputmode="decimal"></label>
          <label class="field"><span>利息／約定</span><input name="interestNote" maxlength="100" value="${attribute(item.interestNote || '')}" placeholder="無息、每月…"></label>
        </div>
        <div class="form-grid ${isItem ? '' : 'hidden'}" data-item-fields>
          <label class="field"><span>數量 *</span><input name="quantity" type="number" min="1" step="1" value="${attribute(item.quantity || 1)}" ${isItem ? 'required' : ''}></label>
          <label class="field"><span>估計價值</span><input name="estimatedValue" type="number" min="0" step="1" value="${attribute(item.estimatedValue || '')}"></label>
          <label class="field"><span>品牌／型號／序號</span><input name="serialNumber" maxlength="150" value="${attribute(item.serialNumber || '')}"></label>
          <label class="field"><span>借出時狀況</span><input name="itemCondition" maxlength="200" value="${attribute(item.itemCondition || '')}" placeholder="外觀、功能、配件"></label>
        </div>
        <div class="form-grid">
          <label class="field"><span>借貸日期 *</span><input name="startAt" type="date" required value="${attribute(localDateValue(item.startAt, false))}"></label>
          <label class="field"><span>約定歸還日期</span><input name="dueAt" type="date" value="${attribute(item.dueAt || '')}"></label>
          <label class="field full"><span>備註</span><textarea name="note" maxlength="3000" placeholder="原因、付款方式、歸還約定等">${escapeHtml(item.note)}</textarea></label>
        </div>
        <label class="field"><span>新增照片／截圖</span><input name="attachments" type="file" accept="image/*" multiple><small>每次最多 3 張，會壓縮後保存在本機。</small></label>
        ${attachmentHtml(item.attachments)}
        ${editing && item.transactions && item.transactions.length ? '<div class="notice">修改原始金額或數量時，既有還款／歸還紀錄仍會保留。</div>' : ''}
        <div class="form-actions"><button type="button" class="button secondary" data-action="close-sheet">取消</button><button class="button primary" type="submit">${editing ? '儲存修改' : '建立借貸'}</button></div>
      </form>`;
  }

  function loanDetailHtml(loan) {
    const person = personById(loan.personId) || { name: '已刪除人物' };
    const status = Logic.loanStatus(loan);
    const remaining = Logic.loanRemaining(loan);
    const original = loan.kind === 'item' ? Number(loan.quantity) || 0 : Number(loan.amount) || 0;
    const isItem = loan.kind === 'item';
    return `${sheetHead(loan.title || (isItem ? '物品借貸' : '金錢借貸'), `${person.name}｜${directionLabel(loan)}`)}
      <div class="score-overview"><div><span class="small-muted">目前未${isItem ? '歸還' : '結清'}</span><div class="loan-amount ${loan.direction === 'owedToMe' ? 'amount-owed' : loan.direction === 'iOwe' ? 'amount-i-owe' : ''}" style="margin:3px 0 0">${isItem ? `${money(remaining)} 件` : `$${money(remaining)}`}</div></div><span class="loan-status ${status === 'overdue' ? 'overdue' : ''}" style="margin-left:auto">${statusLabel(status)}${Logic.overdueDays(loan) ? ` ${Logic.overdueDays(loan)}天` : ''}</span></div>
      <div class="detail-list">
        <div class="detail-row"><span>原始${isItem ? '數量' : '金額'}</span><span>${isItem ? `${money(original)} 件` : `$${money(original)}`}</span></div>
        <div class="detail-row"><span>借貸日期</span><span>${dateText(loan.startAt, false)}</span></div>
        <div class="detail-row"><span>約定歸還</span><span class="${status === 'overdue' ? 'overdue' : ''}">${dateText(loan.dueAt, false)}</span></div>
        ${!isItem && loan.interestNote ? `<div class="detail-row"><span>利息／約定</span><span>${escapeHtml(loan.interestNote)}</span></div>` : ''}
        ${isItem && loan.estimatedValue ? `<div class="detail-row"><span>估計價值</span><span>$${money(loan.estimatedValue)}</span></div>` : ''}
        ${isItem && loan.serialNumber ? `<div class="detail-row"><span>型號／序號</span><span>${escapeHtml(loan.serialNumber)}</span></div>` : ''}
        ${isItem && loan.itemCondition ? `<div class="detail-row"><span>原始狀況</span><span>${escapeHtml(loan.itemCondition)}</span></div>` : ''}
      </div>
      ${loan.note ? `<div class="detail-card" style="margin-top:12px"><h3>備註</h3><p class="event-detail">${escapeHtml(loan.note)}</p></div>` : ''}
      ${attachmentHtml(loan.attachments)}
      <div class="section-head"><h3 class="section-title">${isItem ? '歸還紀錄' : '還款紀錄'}</h3></div>
      ${(loan.transactions || []).length ? `<div class="timeline">${loan.transactions.slice().sort((a, b) => new Date(b.occurredAt) - new Date(a.occurredAt)).map((transaction) => `<div class="timeline-item positive"><h4>${isItem ? `歸還 ${money(transaction.quantity)} 件` : `還款 $${money(transaction.amount)}`}</h4><span class="small-muted">${dateText(transaction.occurredAt, true)}</span>${transaction.note ? `<p>${escapeHtml(transaction.note)}</p>` : ''}</div>`).join('')}</div>` : '<div class="small-muted">尚無歸還紀錄</div>'}
      <div class="card-actions" style="margin-top:17px">
        ${!['settled', 'waived'].includes(status) ? `<button class="action-button" data-action="add-transaction" data-loan-id="${attribute(loan.id)}">${isItem ? '記錄歸還' : '記錄還款'}</button>` : '<button class="action-button" disabled>已完成</button>'}
        <button class="action-button" data-action="edit-loan" data-loan-id="${attribute(loan.id)}">修改</button>
        <button class="action-button" data-action="export-statement" data-loan-id="${attribute(loan.id)}">匯出對帳</button>
      </div>
      ${!['settled', 'waived'].includes(status) ? `<button class="button secondary full" style="margin-top:9px" data-action="waive-loan" data-loan-id="${attribute(loan.id)}">免除／不再追蹤</button>` : ''}
      <button class="button danger full" style="margin-top:9px" data-action="delete-loan" data-loan-id="${attribute(loan.id)}">刪除借貸</button>`;
  }

  function personLoansHtml(person) {
    const loans = Logic.personLoans(state, person.id);
    const debt = Logic.personDebtSummary(state, person.id);
    return `${sheetHead(`${person.name}｜往來明細`, '金錢、物品與歷史紀錄集中查看。')}
      <section class="summary-grid">
        <div class="summary-item"><span class="summary-label">他欠我</span><strong class="summary-value positive">$${money(debt.owedToMe)}</strong></div>
        <div class="summary-item"><span class="summary-label">我欠他</span><strong class="summary-value negative">$${money(debt.iOwe)}</strong></div>
        <div class="summary-item"><span class="summary-label">逾期</span><strong class="summary-value ${debt.overdueCount ? 'warning' : ''}">${debt.overdueCount}</strong></div>
      </section>
      ${loans.length ? `<div class="list-stack">${loans.map(loanCardHtml).join('')}</div>` : '<div class="empty-state"><span class="empty-icon">◉</span><h2>沒有借貸紀錄</h2><p>目前與此人沒有已建立的金錢或物品往來。</p></div>'}
      <button class="button primary full" style="margin-top:14px" data-action="add-loan" data-person-id="${attribute(person.id)}">新增借貸</button>`;
  }

  function transactionFormHtml(loan) {
    const person = personById(loan.personId) || { name: '已刪除人物' };
    const remaining = Logic.loanRemaining(loan);
    const isItem = loan.kind === 'item';
    const suggestedCategory = isItem ? 'responsibility' : 'credit';
    return `${sheetHead(isItem ? '記錄物品歸還' : '記錄還款', `${person.name}｜剩餘 ${isItem ? `${money(remaining)} 件` : `$${money(remaining)}`}`)}
      <form id="transaction-form" class="form-stack">
        <input type="hidden" name="loanId" value="${attribute(loan.id)}">
        <div class="form-grid">
          <label class="field"><span>${isItem ? '歸還數量' : '還款金額'} *</span><input name="value" type="number" min="1" max="${remaining}" step="1" required value="${remaining}" autofocus></label>
          <label class="field"><span>日期時間 *</span><input name="occurredAt" type="datetime-local" required value="${localDateValue(null, true)}"></label>
          <label class="field full"><span>備註</span><textarea name="note" maxlength="1000" placeholder="付款方式、物品狀況或其他說明"></textarea></label>
          ${isItem ? '<label class="field full"><span>歸還時狀況</span><input name="returnCondition" maxlength="300" placeholder="是否完整、損壞或缺件"></label>' : ''}
        </div>
        <div class="notice">借貸不會自動影響評分。若這次行為值得加分或扣分，可在下方主動輸入。</div>
        <div class="form-grid">
          <label class="field"><span>同時加／扣分</span><input name="scoreDelta" type="number" min="-100" max="100" value="0"></label>
          <label class="field"><span>影響分類</span><select name="scoreCategory"><option value="">只改人物總分</option>${state.settings.categories.filter((category) => category.active !== false).map((category) => `<option value="${attribute(category.id)}" ${category.id === suggestedCategory ? 'selected' : ''}>${escapeHtml(category.name)}</option>`).join('')}</select></label>
        </div>
        <div class="form-actions"><button type="button" class="button secondary" data-action="close-sheet">取消</button><button class="button primary" type="submit">儲存紀錄</button></div>
      </form>`;
  }

  function categoryFormHtml(category) {
    return `${sheetHead(category ? '修改分類' : '新增分類', '分類會用來拆解人物風險，名稱應描述單一面向。')}
      <form id="category-form" class="form-stack"><input type="hidden" name="id" value="${attribute(category ? category.id : '')}"><label class="field"><span>分類名稱 *</span><input name="name" required maxlength="30" value="${attribute(category ? category.name : '')}" placeholder="例如：情緒穩定" autofocus></label><div class="form-actions"><button type="button" class="button secondary" data-action="close-sheet">取消</button><button class="button primary" type="submit">儲存分類</button></div></form>`;
  }

  function tagFormHtml() {
    return `${sheetHead('新增常用標籤', '常用標籤會出現在人物建立與修改畫面。')}<form id="tag-form" class="form-stack"><label class="field"><span>標籤名稱 *</span><input name="name" required maxlength="30" placeholder="例如：高情緒成本" autofocus></label><div class="form-actions"><button type="button" class="button secondary" data-action="close-sheet">取消</button><button class="button primary" type="submit">新增標籤</button></div></form>`;
  }

  function pinFormHtml() {
    return `${sheetHead(state.settings.pinHash ? '變更 PIN' : '設定 PIN', '請設定 4 至 8 位數字；忘記 PIN 無法從畫面內找回。')}<form id="pin-form" class="form-stack"><label class="field"><span>新 PIN *</span><input name="pin" type="password" inputmode="numeric" pattern="[0-9]{4,8}" minlength="4" maxlength="8" required autofocus></label><label class="field"><span>再次輸入 *</span><input name="confirmPin" type="password" inputmode="numeric" pattern="[0-9]{4,8}" minlength="4" maxlength="8" required></label><div class="form-actions"><button type="button" class="button secondary" data-action="close-sheet">取消</button><button class="button primary" type="submit">儲存 PIN</button></div></form>`;
  }

  function toast(message) {
    clearTimeout(toastTimer);
    toastElement.textContent = message;
    toastElement.classList.add('show');
    toastTimer = setTimeout(() => toastElement.classList.remove('show'), 2300);
  }

  async function persist(message, shouldCloseSheet) {
    state.meta.updatedAt = new Date().toISOString();
    await Store.saveState(state);
    if (shouldCloseSheet !== false) closeSheet();
    render();
    if (message) toast(message);
  }

  function confirmAction(title, message, confirmLabel) {
    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-message').textContent = message;
    const accept = document.getElementById('confirm-accept');
    accept.textContent = confirmLabel || '確認';
    confirmDialog.returnValue = '';
    confirmDialog.showModal();
    return new Promise((resolve) => {
      confirmDialog.addEventListener('close', () => resolve(confirmDialog.returnValue === 'confirm'), { once: true });
    });
  }

  function updateVisibleList(view) {
    if (view === 'people') {
      const target = document.getElementById('people-list');
      if (target) target.innerHTML = renderPeopleListHtml();
    }
    if (view === 'loans') {
      const target = document.getElementById('loans-list');
      if (target) target.innerHTML = renderLoansListHtml();
    }
    if (view === 'events') {
      const target = document.getElementById('events-list');
      if (target) target.innerHTML = renderEventsListHtml();
    }
  }

  function openAddForCurrentView() {
    if (currentView === 'loans') openSheet(loanFormHtml(null, ''));
    else if (currentView === 'events') openSheet(eventFormHtml(null, ''));
    else openSheet(personFormHtml(null));
  }

  async function handleAction(action, element) {
    const personId = element.dataset.personId || '';
    const eventId = element.dataset.eventId || '';
    const loanId = element.dataset.loanId || '';

    if (action === 'nav') {
      currentView = element.dataset.view;
      closeSheet();
      render();
      window.scrollTo({ top: 0, behavior: 'auto' });
      return;
    }
    if (action === 'primary-add') return openAddForCurrentView();
    if (action === 'close-sheet') return closeSheet();
    if (action === 'add-person') return openSheet(personFormHtml(null));
    if (action === 'edit-person') {
      const person = personById(personId);
      if (person) openSheet(personFormHtml(person));
      return;
    }
    if (action === 'show-person') {
      const person = personById(personId);
      if (person) openSheet(personDetailHtml(person));
      return;
    }
    if (action === 'show-score') {
      const person = personById(personId);
      if (person) openSheet(scoreDetailHtml(person));
      return;
    }
    if (action === 'add-event') return openSheet(eventFormHtml(null, personId));
    if (action === 'edit-event') {
      const item = eventById(eventId);
      if (item) openSheet(eventFormHtml(item, item.personId));
      return;
    }
    if (action === 'show-event') {
      const item = eventById(eventId);
      if (item) openSheet(eventDetailHtml(item));
      return;
    }
    if (action === 'add-loan') return openSheet(loanFormHtml(null, personId));
    if (action === 'edit-loan') {
      const item = loanById(loanId);
      if (item) openSheet(loanFormHtml(item, item.personId));
      return;
    }
    if (action === 'show-loan') {
      const item = loanById(loanId);
      if (item) openSheet(loanDetailHtml(item));
      return;
    }
    if (action === 'show-person-loans') {
      const person = personById(personId);
      if (person) openSheet(personLoansHtml(person));
      return;
    }
    if (action === 'add-transaction') {
      const item = loanById(loanId);
      if (item) openSheet(transactionFormHtml(item));
      return;
    }
    if (action === 'people-filter') {
      filters.people.filter = element.dataset.filter;
      render();
      return;
    }
    if (action === 'loan-filter') {
      filters.loans.filter = element.dataset.filter;
      render();
      return;
    }
    if (action === 'event-filter') {
      filters.events.filter = element.dataset.filter;
      render();
      return;
    }
    if (action === 'add-category') return openSheet(categoryFormHtml(null));
    if (action === 'edit-category') {
      const category = state.settings.categories.find((item) => item.id === element.dataset.categoryId);
      if (category) openSheet(categoryFormHtml(category));
      return;
    }
    if (action === 'add-tag') return openSheet(tagFormHtml());
    if (action === 'set-pin') return openSheet(pinFormHtml());
    if (action === 'lock-now') {
      unlocked = false;
      closeSheet();
      render();
      return;
    }
    if (action === 'save-default-score') {
      const input = document.querySelector('[data-role="default-score"]');
      state.settings.defaultStartScore = Logic.clampScore(input ? input.value : 80);
      return persist('起始分已儲存', false);
    }
    if (action === 'toggle-category') {
      const category = state.settings.categories.find((item) => item.id === element.dataset.categoryId);
      if (category) {
        category.active = category.active === false;
        await persist(category.active ? '分類已啟用' : '分類已停用', false);
      }
      return;
    }
    if (action === 'remove-tag') {
      state.settings.tags = state.settings.tags.filter((tag) => tag !== element.dataset.tag);
      return persist('已從常用標籤移除', false);
    }
    if (action === 'delete-person') {
      const person = personById(personId);
      if (!person) return;
      const accepted = await confirmAction('刪除人物？', `「${person.name}」的事件與借貸也會一起刪除，且無法復原。`, '全部刪除');
      if (!accepted) return;
      state.people = state.people.filter((item) => item.id !== personId);
      state.events = state.events.filter((item) => item.personId !== personId);
      state.loans = state.loans.filter((item) => item.personId !== personId);
      return persist('人物及相關紀錄已刪除');
    }
    if (action === 'delete-event') {
      const item = eventById(eventId);
      if (!item) return;
      const accepted = await confirmAction('刪除事件？', '刪除後，人物總分與分類分數會重新計算。', '刪除事件');
      if (!accepted) return;
      state.events = state.events.filter((event) => event.id !== eventId);
      return persist('事件已刪除');
    }
    if (action === 'delete-loan') {
      const item = loanById(loanId);
      if (!item) return;
      const accepted = await confirmAction('刪除借貸？', '原始借貸及所有還款／歸還紀錄都會刪除。', '刪除借貸');
      if (!accepted) return;
      state.loans = state.loans.filter((loan) => loan.id !== loanId);
      return persist('借貸已刪除');
    }
    if (action === 'waive-loan') {
      const item = loanById(loanId);
      if (!item) return;
      const accepted = await confirmAction('免除這筆借貸？', '剩餘金額或物品會標示為已免除，不再列入未結清與逾期統計。', '確認免除');
      if (!accepted) return;
      item.waived = true;
      item.updatedAt = new Date().toISOString();
      return persist('借貸已標示為免除');
    }
    if (action === 'export-statement') {
      const item = loanById(loanId);
      if (item) exportStatement(item);
      return;
    }
    if (action === 'export-backup') return exportBackup();
    if (action === 'import-backup') {
      const input = document.getElementById('backup-file');
      if (input) input.click();
      return;
    }
    if (action === 'install-app' && deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
      render();
      return;
    }
    if (action === 'load-demo') {
      const hasData = state.people.length || state.events.length || state.loans.length;
      if (hasData) {
        const accepted = await confirmAction('載入示範資料？', '目前的所有人物、事件及借貸會被示範資料取代。', '取代資料');
        if (!accepted) return;
      }
      const pinHash = state.settings.pinHash;
      state = Logic.createDemoState();
      state.settings.pinHash = pinHash;
      currentView = 'people';
      return persist('示範資料已載入');
    }
    if (action === 'clear-all') {
      const accepted = await confirmAction('清除全部紀錄？', '人物、事件與借貸將永久刪除；分類、常用標籤與 PIN 會保留。', '清除紀錄');
      if (!accepted) return;
      state.people = [];
      state.events = [];
      state.loans = [];
      return persist('人物與往來紀錄已清除', false);
    }
    if (action === 'remove-pin') {
      const accepted = await confirmAction('移除 PIN？', '之後開啟 App 將直接顯示所有紀錄。', '移除 PIN');
      if (!accepted) return;
      state.settings.pinHash = '';
      unlocked = true;
      return persist('PIN 已移除', false);
    }
  }

  function handleClick(event) {
    lastInteractionAt = Date.now();
    const element = event.target.closest('[data-action]');
    if (!element || element.disabled) return;
    event.preventDefault();
    handleAction(element.dataset.action, element).catch((error) => {
      console.error(error);
      toast('操作失敗，請稍後再試');
    });
  }

  function handleInput(event) {
    lastInteractionAt = Date.now();
    const input = event.target.closest('[data-role="search"]');
    if (!input) return;
    const view = input.dataset.view;
    if (!filters[view]) return;
    filters[view].query = input.value;
    updateVisibleList(view);
  }

  function handleChange(event) {
    lastInteractionAt = Date.now();
    const target = event.target;
    if (target.matches('[data-role="people-category"]')) {
      filters.people.categoryId = target.value;
      filters.people.sort = target.value ? 'category' : 'scoreLow';
      render();
      return;
    }
    if (target.matches('[data-role="people-sort"]')) {
      filters.people.sort = target.value;
      updateVisibleList('people');
      return;
    }
    if (target.matches('input[name="kind"]')) {
      updateLoanFormKind();
      return;
    }
    if (target.id === 'backup-file') {
      importBackupFile(target.files && target.files[0]);
    }
  }

  function updateLoanFormKind() {
    const form = document.getElementById('loan-form');
    if (!form) return;
    const kind = form.elements.kind.value;
    const direction = form.querySelector('[data-role="loan-direction"]');
    direction.innerHTML = loanDirectionOptions(kind, direction.value);
    form.querySelectorAll('[data-money-fields]').forEach((node) => node.classList.toggle('hidden', kind !== 'money'));
    form.querySelectorAll('[data-item-fields]').forEach((node) => node.classList.toggle('hidden', kind !== 'item'));
    if (form.elements.amount) form.elements.amount.required = kind === 'money';
    if (form.elements.quantity) form.elements.quantity.required = kind === 'item';
    const title = form.querySelector('[data-role="loan-title"]');
    if (title) title.placeholder = kind === 'item' ? '例如：安全帽' : '例如：代墊餐費';
  }

  function splitTags(value) {
    return String(value || '').split(/[,，、\n]+/).map((item) => item.trim()).filter(Boolean);
  }

  async function handleSubmit(event) {
    const form = event.target;
    if (!form.matches('form')) return;
    event.preventDefault();
    lastInteractionAt = Date.now();
    const submitButton = form.querySelector('[type="submit"]');
    if (submitButton) submitButton.disabled = true;
    try {
      if (form.id === 'person-form') await submitPerson(form);
      if (form.id === 'event-form') await submitEvent(form);
      if (form.id === 'loan-form') await submitLoan(form);
      if (form.id === 'transaction-form') await submitTransaction(form);
      if (form.id === 'category-form') await submitCategory(form);
      if (form.id === 'tag-form') await submitTag(form);
      if (form.id === 'pin-form') await submitPin(form);
      if (form.id === 'unlock-form') await submitUnlock(form);
    } catch (error) {
      console.error(error);
      toast(error && error.message ? error.message : '儲存失敗，請重試');
    } finally {
      if (submitButton && document.contains(submitButton)) submitButton.disabled = false;
    }
  }

  async function submitPerson(form) {
    const data = new FormData(form);
    const id = String(data.get('id') || '');
    const existing = personById(id);
    const chosenTags = data.getAll('tags').map(String);
    const customTags = splitTags(data.get('customTags'));
    const tags = Array.from(new Set([...chosenTags, ...customTags]));
    const stamp = new Date().toISOString();
    const person = Object.assign(existing || {}, {
      id: existing ? existing.id : Logic.uid('person'),
      name: String(data.get('name') || '').trim(),
      nickname: String(data.get('nickname') || '').trim(),
      phone: String(data.get('phone') || '').trim(),
      otherContact: String(data.get('otherContact') || '').trim(),
      relation: String(data.get('relation') || '').trim(),
      knownAt: String(data.get('knownAt') || ''),
      tags,
      notes: String(data.get('notes') || '').trim(),
      startScore: Logic.clampScore(data.get('startScore')),
      categoryStarts: existing ? existing.categoryStarts || {} : {},
      createdAt: existing ? existing.createdAt : stamp,
      updatedAt: stamp
    });
    if (!person.name) throw new Error('請輸入姓名');
    if (existing) Object.assign(existing, person);
    else state.people.push(person);
    state.settings.tags = Array.from(new Set([...state.settings.tags, ...customTags]));
    await persist(existing ? '人物資料已更新' : '人物已建立');
  }

  async function submitEvent(form) {
    const data = new FormData(form);
    const id = String(data.get('id') || '');
    const existing = eventById(id);
    const input = form.elements.attachments;
    const newAttachments = await imageAttachments(input && input.files);
    const stamp = new Date().toISOString();
    const occurredValue = String(data.get('occurredAt') || '');
    const item = Object.assign(existing || {}, {
      id: existing ? existing.id : Logic.uid('event'),
      personId: String(data.get('personId') || ''),
      title: String(data.get('title') || '').trim(),
      detail: String(data.get('detail') || '').trim(),
      delta: Math.round(Number(data.get('delta')) || 0),
      categoryIds: data.getAll('categoryIds').map(String),
      important: data.has('important'),
      followUp: data.has('followUp'),
      attachments: [...(existing && existing.attachments ? existing.attachments : []), ...newAttachments],
      occurredAt: occurredValue ? new Date(occurredValue).toISOString() : stamp,
      createdAt: existing ? existing.createdAt : stamp,
      updatedAt: stamp
    });
    if (!personById(item.personId)) throw new Error('找不到指定人物');
    if (!item.title) throw new Error('請輸入事件標題');
    if (existing) Object.assign(existing, item);
    else state.events.push(item);
    const person = personById(item.personId);
    if (person) person.updatedAt = stamp;
    await persist(existing ? '事件已更新' : '事件已記錄');
  }

  async function submitLoan(form) {
    const data = new FormData(form);
    const id = String(data.get('id') || '');
    const existing = loanById(id);
    const kind = String(data.get('kind') || 'money');
    if (existing && existing.transactions && existing.transactions.length && kind !== existing.kind) {
      throw new Error('已有還款／歸還紀錄，不能再變更金錢或物品類型');
    }
    const input = form.elements.attachments;
    const newAttachments = await imageAttachments(input && input.files);
    const stamp = new Date().toISOString();
    const item = Object.assign(existing || {}, {
      id: existing ? existing.id : Logic.uid('loan'),
      personId: String(data.get('personId') || ''),
      kind,
      direction: String(data.get('direction') || (kind === 'money' ? 'owedToMe' : 'lentItem')),
      title: String(data.get('title') || '').trim(),
      amount: kind === 'money' ? Math.max(0, Number(data.get('amount')) || 0) : 0,
      quantity: kind === 'item' ? Math.max(1, Math.round(Number(data.get('quantity')) || 1)) : 0,
      estimatedValue: kind === 'item' ? Math.max(0, Number(data.get('estimatedValue')) || 0) : 0,
      interestNote: kind === 'money' ? String(data.get('interestNote') || '').trim() : '',
      serialNumber: kind === 'item' ? String(data.get('serialNumber') || '').trim() : '',
      itemCondition: kind === 'item' ? String(data.get('itemCondition') || '').trim() : '',
      startAt: String(data.get('startAt') || ''),
      dueAt: String(data.get('dueAt') || ''),
      note: String(data.get('note') || '').trim(),
      attachments: [...(existing && existing.attachments ? existing.attachments : []), ...newAttachments],
      transactions: existing && existing.transactions ? existing.transactions : [],
      waived: existing ? Boolean(existing.waived) : false,
      createdAt: existing ? existing.createdAt : stamp,
      updatedAt: stamp
    });
    if (!personById(item.personId)) throw new Error('找不到指定人物');
    if (!item.title) throw new Error(`請輸入${kind === 'item' ? '物品' : '借貸'}名稱`);
    if (kind === 'money' && item.amount <= 0) throw new Error('借貸金額必須大於 0');
    if (existing) Object.assign(existing, item);
    else state.loans.push(item);
    const person = personById(item.personId);
    if (person) {
      person.updatedAt = stamp;
      if (!person.tags.includes('借貸中')) person.tags.push('借貸中');
    }
    await persist(existing ? '借貸已更新' : '借貸已建立');
  }

  async function submitTransaction(form) {
    const data = new FormData(form);
    const loan = loanById(String(data.get('loanId') || ''));
    if (!loan) throw new Error('找不到這筆借貸');
    const remaining = Logic.loanRemaining(loan);
    const value = Math.min(remaining, Math.max(0, Number(data.get('value')) || 0));
    if (value <= 0) throw new Error('歸還數量或金額必須大於 0');
    const stamp = new Date().toISOString();
    const occurredValue = String(data.get('occurredAt') || '');
    const transaction = {
      id: Logic.uid('payment'),
      occurredAt: occurredValue ? new Date(occurredValue).toISOString() : stamp,
      note: String(data.get('note') || '').trim(),
      returnCondition: String(data.get('returnCondition') || '').trim(),
      createdAt: stamp
    };
    if (loan.kind === 'item') transaction.quantity = value;
    else transaction.amount = value;
    loan.transactions.push(transaction);
    loan.updatedAt = stamp;

    const delta = Math.round(Number(data.get('scoreDelta')) || 0);
    if (delta !== 0) {
      const category = String(data.get('scoreCategory') || '');
      state.events.push({
        id: Logic.uid('event'),
        personId: loan.personId,
        title: loan.kind === 'item' ? '物品歸還表現' : '還款表現',
        detail: `${loan.title}：${loan.kind === 'item' ? `歸還 ${money(value)} 件` : `還款 $${money(value)}`}${transaction.note ? `。${transaction.note}` : ''}`,
        delta,
        categoryIds: category ? [category] : [],
        important: false,
        followUp: Logic.loanRemaining(loan) > 0,
        attachments: [],
        occurredAt: transaction.occurredAt,
        createdAt: stamp,
        updatedAt: stamp,
        linkedLoanId: loan.id
      });
    }
    const person = personById(loan.personId);
    if (person) {
      person.updatedAt = stamp;
      if (Logic.personDebtSummary(state, person.id).activeCount === 0) {
        person.tags = person.tags.filter((tag) => tag !== '借貸中');
      }
    }
    await persist(loan.kind === 'item' ? '歸還紀錄已儲存' : '還款紀錄已儲存');
  }

  async function submitCategory(form) {
    const data = new FormData(form);
    const id = String(data.get('id') || '');
    const name = String(data.get('name') || '').trim();
    if (!name) throw new Error('請輸入分類名稱');
    const duplicate = state.settings.categories.some((category) => category.name === name && category.id !== id);
    if (duplicate) throw new Error('已有相同名稱的分類');
    const existing = state.settings.categories.find((category) => category.id === id);
    if (existing) existing.name = name;
    else state.settings.categories.push({ id: Logic.uid('cat'), name, builtIn: false, active: true });
    await persist(existing ? '分類名稱已更新' : '分類已新增');
  }

  async function submitTag(form) {
    const data = new FormData(form);
    const name = String(data.get('name') || '').trim();
    if (!name) throw new Error('請輸入標籤名稱');
    if (!state.settings.tags.includes(name)) state.settings.tags.push(name);
    await persist('常用標籤已新增');
  }

  function hashPin(pin) {
    let first = 2166136261;
    let second = 2246822519;
    const text = `renji:${pin}:local`;
    for (let index = 0; index < text.length; index += 1) {
      first ^= text.charCodeAt(index);
      first = Math.imul(first, 16777619);
      second ^= text.charCodeAt(text.length - 1 - index);
      second = Math.imul(second, 3266489917);
    }
    return `v1-${(first >>> 0).toString(16)}${(second >>> 0).toString(16)}`;
  }

  async function submitPin(form) {
    const data = new FormData(form);
    const pin = String(data.get('pin') || '');
    const confirmation = String(data.get('confirmPin') || '');
    if (!/^\d{4,8}$/.test(pin)) throw new Error('PIN 必須是 4 至 8 位數字');
    if (pin !== confirmation) throw new Error('兩次輸入的 PIN 不一致');
    state.settings.pinHash = hashPin(pin);
    unlocked = true;
    await persist('PIN 已啟用');
  }

  async function submitUnlock(form) {
    const data = new FormData(form);
    const pin = String(data.get('pin') || '');
    if (hashPin(pin) !== state.settings.pinHash) {
      form.reset();
      const input = form.elements.pin;
      if (input) input.focus();
      throw new Error('PIN 不正確');
    }
    unlocked = true;
    lastInteractionAt = Date.now();
    render();
  }

  function imageAttachments(fileList) {
    const files = Array.from(fileList || []).filter((file) => file.type.startsWith('image/')).slice(0, 3);
    return Promise.all(files.map(compressImage));
  }

  function compressImage(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('照片讀取失敗'));
      reader.onload = () => {
        const image = new Image();
        image.onerror = () => reject(new Error('照片格式無法處理'));
        image.onload = () => {
          const maxEdge = 1280;
          const scale = Math.min(1, maxEdge / Math.max(image.naturalWidth, image.naturalHeight));
          const width = Math.max(1, Math.round(image.naturalWidth * scale));
          const height = Math.max(1, Math.round(image.naturalHeight * scale));
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const context = canvas.getContext('2d');
          context.fillStyle = '#ffffff';
          context.fillRect(0, 0, width, height);
          context.drawImage(image, 0, 0, width, height);
          resolve({
            id: Logic.uid('attachment'),
            name: file.name || '照片.jpg',
            type: 'image/jpeg',
            dataUrl: canvas.toDataURL('image/jpeg', 0.78),
            createdAt: new Date().toISOString()
          });
        };
        image.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function saveTextFile(fileName, mimeType, content) {
    if (window.AndroidBridge && typeof window.AndroidBridge.saveTextFile === 'function') {
      window.AndroidBridge.saveTextFile(fileName, mimeType, content);
      return;
    }
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function exportBackup() {
    state.meta.updatedAt = new Date().toISOString();
    const fileName = `人際小本本備份-${localDateValue(null, false)}.json`;
    saveTextFile(fileName, 'application/json', JSON.stringify(state, null, 2));
    toast('已準備備份檔');
  }

  function csvCell(value) {
    return `"${String(value == null ? '' : value).replace(/"/g, '""')}"`;
  }

  function exportStatement(loan) {
    const person = personById(loan.personId) || { name: '已刪除人物' };
    const isItem = loan.kind === 'item';
    const rows = [
      ['人際小本本－借貸對帳明細'],
      ['人物', person.name],
      ['方向', directionLabel(loan)],
      ['項目', loan.title],
      ['借貸日期', loan.startAt],
      ['約定歸還', loan.dueAt || '未設定'],
      [isItem ? '原始數量' : '原始金額', isItem ? loan.quantity : loan.amount],
      [isItem ? '剩餘數量' : '剩餘金額', Logic.loanRemaining(loan)],
      ['目前狀態', statusLabel(Logic.loanStatus(loan))],
      [],
      ['歷次紀錄'],
      ['日期時間', isItem ? '歸還數量' : '還款金額', '備註', isItem ? '歸還狀況' : '']
    ];
    (loan.transactions || []).slice().sort((a, b) => new Date(a.occurredAt) - new Date(b.occurredAt)).forEach((transaction) => {
      rows.push([transaction.occurredAt, isItem ? transaction.quantity : transaction.amount, transaction.note || '', transaction.returnCondition || '']);
    });
    const csv = '\ufeff' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
    const safeName = `${person.name}-${loan.title}`.replace(/[\\/:*?"<>|]/g, '_');
    saveTextFile(`對帳明細-${safeName}.csv`, 'text/csv', csv);
    toast('已準備對帳明細');
  }

  async function importBackupFile(file) {
    if (!file) return;
    try {
      const text = await readFileText(file);
      const parsed = JSON.parse(text);
      if (!parsed || !Array.isArray(parsed.people) || !Array.isArray(parsed.events) || !Array.isArray(parsed.loans)) {
        throw new Error('這不是有效的人際小本本備份');
      }
      const accepted = await confirmAction('匯入備份？', '目前資料會被備份檔完整取代。建議先匯出現有資料。', '匯入取代');
      if (!accepted) return;
      state = Logic.normalizeState(parsed);
      unlocked = true;
      currentView = 'people';
      await persist('備份已匯入', false);
    } catch (error) {
      console.error(error);
      toast(error.message || '備份檔無法讀取');
    } finally {
      const input = document.getElementById('backup-file');
      if (input) input.value = '';
    }
  }

  function readFileText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('備份檔讀取失敗'));
      reader.readAsText(file, 'utf-8');
    });
  }

  function renderLockScreen() {
    app.innerHTML = `<main class="lock-screen"><img src="icons/icon-192.png" alt="人際小本本"><h1>人際小本本</h1><p>輸入 PIN 查看人際紀錄</p><form id="unlock-form" class="form-stack"><input name="pin" type="password" inputmode="numeric" pattern="[0-9]{4,8}" maxlength="8" aria-label="PIN" autofocus><button class="button primary" type="submit">解鎖</button></form></main>`;
  }

  function handleBack() {
    if (confirmDialog.open) {
      confirmDialog.close('cancel');
      return true;
    }
    if (sheet.open) {
      closeSheet();
      return true;
    }
    if (currentView !== 'people' && unlocked) {
      currentView = 'people';
      render();
      return true;
    }
    return false;
  }

  async function init() {
    try {
      const saved = await Store.loadState();
      state = Logic.normalizeState(saved || Logic.createDefaultState());
    } catch (error) {
      console.error(error);
      state = Logic.createDefaultState();
    }
    unlocked = !state.settings.pinHash;
    render();
    Store.requestPersistence().catch(() => false);

    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      navigator.serviceWorker.register('./sw.js').catch((error) => console.warn('Service worker unavailable', error));
    }
  }

  document.addEventListener('click', handleClick);
  document.addEventListener('input', handleInput);
  document.addEventListener('change', handleChange);
  document.addEventListener('submit', (event) => handleSubmit(event));
  document.addEventListener('pointerdown', () => { lastInteractionAt = Date.now(); }, { passive: true });
  document.addEventListener('keydown', () => { lastInteractionAt = Date.now(); }, { passive: true });

  sheet.addEventListener('click', (event) => {
    if (event.target === sheet) closeSheet();
  });

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    if (currentView === 'settings') render();
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    toast('已安裝到桌面');
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      lastInteractionAt = Date.now();
      Store.saveState(state).catch(() => {});
      return;
    }
    const lockAfter = Math.max(1, Number(state.settings.autoLockMinutes) || 5) * 60000;
    if (state.settings.pinHash && Date.now() - lastInteractionAt >= lockAfter) {
      unlocked = false;
      closeSheet();
      render();
    }
  });

  setInterval(() => {
    const lockAfter = Math.max(1, Number(state.settings.autoLockMinutes) || 5) * 60000;
    if (unlocked && state.settings.pinHash && Date.now() - lastInteractionAt >= lockAfter) {
      unlocked = false;
      closeSheet();
      render();
    }
  }, 30000);

  window.RenjiApp = { handleBack };
  init();
})();

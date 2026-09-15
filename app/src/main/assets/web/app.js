(function () {
  'use strict';

  const Logic = window.RenjiLogic;
  const Store = window.RenjiStore;
  const app = document.getElementById('app');
  const sheet = document.getElementById('sheet');
  const sheetContent = document.getElementById('sheet-content');
  const confirmDialog = document.getElementById('confirm-dialog');
  const toastElement = document.getElementById('toast');
  const APP_VERSION = '1.1.0';

  let state = Logic.createDefaultState();
  let currentView = 'people';
  let unlocked = false;
  let toastTimer = null;
  let deferredInstallPrompt = null;
  let lastInteractionAt = Date.now();
  let confirmResolver = null;
  let brandPressTimer = null;
  let brandLongPressed = false;
  let brandPressStart = null;
  const introAudio = new Audio('audio/intro.m4a');
  introAudio.preload = 'auto';

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

  function deltaControlHtml(prefix, value, label, required) {
    const numeric = Math.round(Number(value) || 0);
    const sign = numeric < 0 ? -1 : 1;
    const amount = Math.abs(numeric);
    return `<div class="field full" data-score-control>
      <span>${escapeHtml(label)}</span>
      <input type="hidden" name="${attribute(prefix)}Sign" value="${sign}" data-score-sign-value>
      <div class="score-sign-grid">
        <button type="button" class="score-sign positive ${sign > 0 ? 'active' : ''}" data-action="set-score-sign" data-sign="1" aria-pressed="${sign > 0}">＋ 加分</button>
        <button type="button" class="score-sign negative ${sign < 0 ? 'active' : ''}" data-action="set-score-sign" data-sign="-1" aria-pressed="${sign < 0}">－ 扣分</button>
      </div>
      <label class="score-amount-label"><span>分數</span><input name="${attribute(prefix)}Amount" type="number" min="0" max="100" step="1" inputmode="numeric" value="${amount}" ${required ? 'required' : ''}></label>
      <small>先選加分或扣分，再輸入 0–100。</small>
    </div>`;
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

  function updatePersonLoanTag(personId) {
    const person = personById(personId);
    if (!person) return;
    const active = Logic.personDebtSummary(state, personId).activeCount > 0;
    person.tags = Array.isArray(person.tags) ? person.tags : [];
    if (active && !person.tags.includes('借貸中')) person.tags.push('借貸中');
    if (!active) person.tags = person.tags.filter((tag) => tag !== '借貸中');
  }

  function syncAllLoanReminders() {
    try {
      if (window.AndroidBridge && window.AndroidBridge.syncLoanReminders) window.AndroidBridge.syncLoanReminders();
    } catch (error) {
      console.warn('無法更新到期提醒', error);
    }
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

  function avatarHtml(person, extraClass) {
    const className = `avatar ${extraClass || ''}`.trim();
    if (person.avatar && person.avatar.dataUrl) {
      return `<button type="button" class="${className} avatar-button" data-action="view-avatar" data-person-id="${attribute(person.id)}" aria-label="查看 ${attribute(person.name || '人物')} 的大頭照原圖"><img src="${attribute(person.avatar.thumbnailDataUrl || person.avatar.dataUrl)}" alt="${attribute(person.name || '人物')}的大頭照"></button>`;
    }
    return `<div class="${className}" aria-hidden="true">${initials(person)}</div>`;
  }

  function avatarViewerHtml(person) {
    if (!person.avatar || !person.avatar.dataUrl) return '';
    return `${sheetHead(`${person.name || '人物'}｜大頭照`, '顯示原始照片；人物卡使用選定的圓形區域。')}<div class="avatar-viewer"><img src="${attribute(person.avatar.dataUrl)}" alt="${attribute(person.name || '人物')}的大頭照原圖"></div>`;
  }

  function tagStyleKey(tag) {
    const value = state.settings.tagStyles && state.settings.tagStyles[tag];
    return Logic.TAG_STYLE_KEYS.includes(value) ? value : 'normal';
  }

  function tagHtml(tag, variant) {
    const styleClass = variant ? '' : `tag-theme-${tagStyleKey(tag)}`;
    return `<span class="tag ${variant || ''} ${styleClass}">${escapeHtml(tag)}</span>`;
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

  function storageModeText() {
    try {
      if (window.AndroidBridge) {
        return String(window.AndroidBridge.getStorageMode()) === 'native-file-v1' ? 'Android 原生檔案' : 'Android 本機儲存';
      }
    } catch (error) {
      // Browser fallback is shown below.
    }
    return '瀏覽器本機儲存';
  }

  function storagePathText() {
    try {
      if (window.AndroidBridge) return String(window.AndroidBridge.getStoragePath() || 'App 內部儲存空間');
    } catch (error) {
      // Browser fallback is shown below.
    }
    return 'IndexedDB：renji-notebook-db／app-state／current';
  }

  function topBarHtml() {
    return `
      <header class="topbar">
        <button type="button" class="brand brand-button" data-role="brand-title" aria-label="點擊播放介紹，長按修改標題">
          <h1>${escapeHtml(state.settings.appTitle)}</h1>
          <p>${escapeHtml(state.settings.appSubtitle)}</p>
        </button>
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
    return `<section class="summary-grid" aria-label="人物品質摘要">
      <div class="summary-item"><span class="summary-label">人物</span><strong class="summary-value">${summary.people}</strong></div>
      <div class="summary-item"><span class="summary-label">${escapeHtml(state.settings.qualityLabel)}</span><strong class="summary-value positive">${summary.qualityCount}</strong><small class="summary-hint">${state.settings.qualityThreshold} 分以上</small></div>
      <div class="summary-item"><span class="summary-label">${escapeHtml(state.settings.poorLabel)}</span><strong class="summary-value negative">${summary.poorCount}</strong><small class="summary-hint">${state.settings.poorThreshold} 分以下</small></div>
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

  function quickTagFiltersHtml() {
    const tags = state.settings.tags.filter((tag) => (state.settings.quickTags || []).includes(tag));
    return `<div class="quick-tag-head"><span>常用標籤</span><button class="text-link" data-action="edit-quick-tags">設定</button></div>
      <div class="chip-row quick-tags">${tags.map((tag) => {
        const filter = `tag:${tag}`;
        return `<button class="chip tag-filter tag-theme-${tagStyleKey(tag)} ${filters.people.filter === filter ? 'active' : ''}" data-action="people-filter" data-filter="${attribute(filter)}">${escapeHtml(tag)}</button>`;
      }).join('') || '<span class="small-muted">尚未設定首頁常用標籤</span>'}</div>`;
  }

  function renderPeopleView() {
    return `${summaryHtml()}${searchHtml('people', '搜尋姓名、事件、標籤、借貸')}${quickTagFiltersHtml()}${peopleFiltersHtml()}<div id="people-list">${renderPeopleListHtml()}</div>`;
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
        ${avatarHtml(person)}
        <div>
          <h3 class="person-name">${escapeHtml(person.name || '未命名')}</h3>
          ${person.nickname ? `<div class="person-alias">暱稱：${escapeHtml(person.nickname)}</div>` : ''}
        </div>
        <div class="score-cluster">${scoreBadgeHtml(score, person.id, false)}</div>
      </div>
      ${tags.length ? `<div class="tag-list">${tags.map((tag) => tagHtml(tag)).join('')}</div>` : ''}
      <div class="key-lines">
        ${debtKeyLine(person)}
        <div class="key-line"><span class="key-icon">◇</span><button class="text-link" data-action="show-score" data-person-id="${attribute(person.id)}">${selectedCategory ? `所選分類：${escapeHtml(selectedCategory.name)} ${selectedCategory.score}｜總分 ${score}` : `主要風險：${low.map((item) => `${escapeHtml(item.name)} ${item.score}`).join('｜') || '尚無分類'}`}</button></div>
        ${recent ? `<div class="key-line ${recent.important ? 'important-event-line' : ''}"><span class="key-icon">${recent.important ? '★' : '▤'}</span><button class="event-link" data-action="show-event" data-event-id="${attribute(recent.id)}">最近事件：${escapeHtml(recent.title)} <span class="${recent.delta >= 0 ? 'delta-positive' : 'delta-negative'}">${signed(recent.delta)}</span></button></div>` : ''}
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
      const text = [person.name, person.nickname, loan.title, loan.note, loan.itemCondition, loan.serialNumber, loan.amount, loan.quantity, ...(loan.transactions || []).flatMap((entry) => [entry.note, entry.returnCondition])].join(' ').toLocaleLowerCase('zh-Hant');
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
    const canTransact = !['settled', 'waived'].includes(status);
    return `<article class="loan-card">
      <div class="loan-card-open" role="button" tabindex="0" data-action="show-loan" data-loan-id="${attribute(loan.id)}">
        <div class="loan-head">
          <div><h3>${escapeHtml(loan.title || (loan.kind === 'money' ? '金錢借貸' : '物品借貸'))}</h3><div class="loan-person">${escapeHtml(person.name)}｜${directionLabel(loan)}</div></div>
          <span class="loan-status ${status === 'overdue' ? 'overdue' : ''}">${statusLabel(status)}${overdueDays ? ` ${overdueDays}天` : ''}</span>
        </div>
        <div class="loan-amount ${loan.direction === 'owedToMe' ? 'amount-owed' : loan.direction === 'iOwe' ? 'amount-i-owe' : ''}">${loan.kind === 'money' ? `$${money(remaining)}` : `${money(remaining)} 件`}</div>
        <div class="small-muted">原始${loan.kind === 'money' ? '金額' : '數量'}：${loan.kind === 'money' ? `$${money(original)}` : `${money(original)} 件`}｜到期：${dateText(loan.dueAt, false)}</div>
        <div class="loan-progress"><span style="width:${completed}%"></span></div>
        ${loan.note ? `<div class="small-muted">${escapeHtml(loan.note)}</div>` : ''}
      </div>
      <div class="loan-card-actions">
        <button class="action-button" data-action="show-loan" data-loan-id="${attribute(loan.id)}">查看明細</button>
        ${canTransact ? `<button class="action-button repay-button" data-action="add-transaction" data-loan-id="${attribute(loan.id)}">${loan.kind === 'item' ? '歸還' : '還款'}</button>` : '<button class="action-button" disabled>已完成</button>'}
      </div>
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
    return `<article class="event-card ${event.important ? 'important-event' : ''}" role="button" data-action="show-event" data-event-id="${attribute(event.id)}">
      <div class="event-head">
        <div><h3>${escapeHtml(event.title || '未命名事件')}</h3><div class="event-person">${escapeHtml(person.name)}｜${dateText(event.occurredAt || event.createdAt, true)}</div></div>
        <div class="event-score ${delta >= 0 ? 'delta-positive' : 'delta-negative'}">${signed(delta)}</div>
      </div>
      ${event.detail ? `<p class="event-detail">${escapeHtml(event.detail.length > 120 ? `${event.detail.slice(0, 120)}…` : event.detail)}</p>` : ''}
      <div class="event-flags">
        ${(event.categoryIds || []).map((id) => tagHtml(categoryName(id), 'gold')).join('')}
        ${event.important ? tagHtml('★ 重要事件', 'important') : ''}
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
        <div class="settings-line settings-divider"><strong>首頁分級</strong><span class="settings-value">${escapeHtml(state.settings.qualityLabel)} ≥ ${state.settings.qualityThreshold}｜${escapeHtml(state.settings.poorLabel)} ≤ ${state.settings.poorThreshold}</span></div>
        <button class="button secondary full" data-action="edit-quality-settings">修改名稱與門檻</button>
      </section>

      <section class="settings-card">
        <div class="settings-line"><strong>評分類別</strong><button class="button secondary" data-action="add-category">新增分類</button></div>
        ${activeCategories.map((category) => `<div class="settings-line"><span>${escapeHtml(category.name)}</span><span><button class="text-link" data-action="edit-category" data-category-id="${attribute(category.id)}">修改</button>　<button class="text-link" data-action="toggle-category" data-category-id="${attribute(category.id)}">停用</button></span></div>`).join('')}
        ${inactiveCategories.length ? `<div class="small-muted" style="margin-top:12px">已停用</div>${inactiveCategories.map((category) => `<div class="settings-line"><span class="small-muted">${escapeHtml(category.name)}</span><button class="text-link" data-action="toggle-category" data-category-id="${attribute(category.id)}">重新啟用</button></div>`).join('')}` : ''}
      </section>

      <section class="settings-card">
        <div class="settings-line"><strong>人物標籤</strong><button class="button secondary" data-action="add-tag">新增標籤</button></div>
        <p>可調整順序與外觀；炫彩樣式採靜態漸層與光暈，不會持續閃爍。</p>
        <div class="tag-settings-list">${state.settings.tags.map((tag, index) => `<div class="tag-settings-row">
          <span class="tag tag-theme-${tagStyleKey(tag)}">${escapeHtml(tag)}</span>
          <span class="tag-row-actions">
            <button class="mini-button" data-action="move-tag" data-tag="${attribute(tag)}" data-direction="up" ${index === 0 ? 'disabled' : ''} aria-label="上移 ${attribute(tag)}">↑</button>
            <button class="mini-button" data-action="move-tag" data-tag="${attribute(tag)}" data-direction="down" ${index === state.settings.tags.length - 1 ? 'disabled' : ''} aria-label="下移 ${attribute(tag)}">↓</button>
            <button class="text-link" data-action="edit-tag-style" data-tag="${attribute(tag)}">外觀</button>
            <button class="text-link danger-text" data-action="remove-tag" data-tag="${attribute(tag)}">刪除</button>
          </span>
        </div>`).join('') || '<span class="small-muted">尚無人物標籤</span>'}</div>
        <button class="button primary full" style="margin-top:12px" data-action="edit-quick-tags">更換首頁常用標籤</button>
      </section>

      <section class="settings-card">
        <h3>首頁標題</h3>
        <p>短按首頁標題播放原聲介紹；長按可修改主標題與副標題。</p>
        <div class="settings-line"><strong>${escapeHtml(state.settings.appTitle)}</strong><span class="settings-value">${escapeHtml(state.settings.appSubtitle)}</span></div>
        <button class="button secondary full" data-action="edit-title-settings">修改首頁標題</button>
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

      <section class="settings-card">
        <h3>系統狀態</h3>
        <div class="settings-line"><strong>App 版本</strong><span class="settings-value">v${APP_VERSION}</span></div>
        <div class="settings-line"><strong>資料儲存</strong><span class="settings-value">${escapeHtml(storageModeText())}</span></div>
        <div class="storage-path-block"><strong>儲存路徑</strong><code>${escapeHtml(storagePathText())}</code></div>
        <p>這是 App 自動儲存的內部資料路徑；匯出備份時，檔案位置由 Android 儲存視窗中所選的資料夾決定。</p>
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

  function zodiacOptions(selected) {
    return `<option value="">未設定</option>${Logic.ZODIAC_SIGNS.map((sign) => `<option value="${attribute(sign)}" ${selected === sign ? 'selected' : ''}>${escapeHtml(sign)}</option>`).join('')}`;
  }

  function bloodTypeOptions(selected) {
    return ['A', 'B', 'O', 'AB'].map((type) => `<option value="${type}" ${selected === type ? 'selected' : ''}>${type} 型</option>`).join('');
  }

  function customFieldRowHtml(field) {
    const item = field || { id: Logic.uid('field'), label: '', value: '' };
    return `<div class="custom-field-row" data-custom-field-row>
      <input type="hidden" name="customFieldId" value="${attribute(item.id)}">
      <label class="field"><span>欄位名稱</span><input name="customFieldLabel" maxlength="40" value="${attribute(item.label || '')}" placeholder="例如：公司／職業／地址"></label>
      <label class="field"><span>內容</span><input name="customFieldValue" maxlength="500" value="${attribute(item.value || '')}" placeholder="輸入要記住的資料"></label>
      <button type="button" class="mini-button custom-field-remove" data-action="remove-custom-field" aria-label="移除自訂欄位">×</button>
    </div>`;
  }

  function personFormHtml(person) {
    const editing = Boolean(person);
    const item = person || {
      id: '', name: '', nickname: '', phone: '', otherContact: '', relation: '',
      birthday: '', zodiac: '', bloodType: '', avatar: null, tags: [], notes: '', customFields: [], startScore: state.settings.defaultStartScore
    };
    const selectedTags = new Set(item.tags || []);
    const customTags = (item.tags || []).filter((tag) => !state.settings.tags.includes(tag));
    return `${sheetHead(editing ? '修改人物' : '新增人物', '先記重要資料，其餘日後補充即可。')}
      <form id="person-form" class="form-stack">
        <input type="hidden" name="recordId" value="${attribute(item.id)}">
        <label class="field avatar-upload-field"><span>大頭照</span><input name="avatar" type="file" accept="image/*" data-role="avatar-input"><small>選擇一張照片，拖動圓圈選定人物卡顯示區域。</small><strong class="attachment-status" data-avatar-status aria-live="polite"></strong></label>
        ${item.avatar && item.avatar.dataUrl ? `<div class="avatar-form-preview"><img src="${attribute(item.avatar.dataUrl)}" alt="目前大頭照"><label class="remove-avatar"><input type="checkbox" name="removeAvatar"><span>移除目前大頭照</span></label></div>` : ''}
        <div data-avatar-editor></div>
        <div class="form-grid">
          <label class="field"><span>姓名 *</span><input name="name" required maxlength="60" value="${attribute(item.name)}" autofocus></label>
          <label class="field"><span>暱稱</span><input name="nickname" maxlength="60" value="${attribute(item.nickname)}"></label>
          <label class="field"><span>關係</span><input name="relation" maxlength="40" placeholder="同事、朋友、客戶…" value="${attribute(item.relation)}"></label>
          <label class="field"><span>生日</span><input name="birthday" type="date" data-role="birthday" value="${attribute(item.birthday || '')}"></label>
          <label class="field"><span>星座</span><select name="zodiac" data-role="zodiac">${zodiacOptions(item.zodiac || Logic.zodiacFromBirthday(item.birthday))}</select></label>
          <label class="field"><span>血型</span><select name="bloodType"><option value="">未設定</option>${bloodTypeOptions(item.bloodType || '')}</select></label>
          <label class="field"><span>電話</span><input name="phone" type="tel" maxlength="50" value="${attribute(item.phone)}"></label>
          <label class="field"><span>其他聯絡</span><input name="otherContact" maxlength="120" placeholder="LINE、Email、地址…" value="${attribute(item.otherContact)}"></label>
          <label class="field"><span>起始分數</span><input name="startScore" type="number" min="0" max="100" required value="${attribute(item.startScore)}"><small>建立後仍可修改，但不會改動事件紀錄。</small></label>
          <label class="field full"><span>備註</span><textarea name="notes" maxlength="2000" placeholder="身份、背景或需要記住的事">${escapeHtml(item.notes)}</textarea></label>
        </div>
        <div class="field"><span>自訂人物資料</span><small>新增或改名後，所有人物會共用這些欄位；內容各自填寫。</small></div>
        <div class="custom-fields" data-custom-fields>${Logic.customFieldsFor(state, item).map(customFieldRowHtml).join('')}</div>
        <button type="button" class="button secondary full" data-action="add-custom-field">＋ 新增自訂欄位</button>
        <div class="field"><span>常用標籤</span><div class="check-list">${state.settings.tags.map((tag) => `<label class="check-chip tag-theme-${tagStyleKey(tag)}"><input type="checkbox" name="tags" value="${attribute(tag)}" ${selectedTags.has(tag) ? 'checked' : ''}><span>${escapeHtml(tag)}</span></label>`).join('')}</div></div>
        <label class="field"><span>其他標籤</span><input name="customTags" value="${attribute(customTags.join('、'))}" placeholder="以逗號或頓號分隔"></label>
        <div class="form-actions"><button type="button" class="button secondary" data-action="close-sheet">取消</button><button class="button primary" type="button" data-action="save-form">${editing ? '儲存修改' : '建立人物'}</button></div>
      </form>`;
  }

  function personDetailHtml(person) {
    const score = Logic.personScore(state, person);
    const band = Logic.scoreBand(score);
    const debt = Logic.personDebtSummary(state, person.id);
    const events = Logic.personEvents(state, person.id).slice(0, 3);
    const allLoans = Logic.personLoans(state, person.id);
    const warnings = [];
    if (debt.overdueCount) warnings.push(`${debt.overdueCount} 筆借貸已逾期`);
    const low = Logic.lowestCategories(state, person, 2);
    low.filter((category) => category.score <= 60).forEach((category) => warnings.push(`${category.name}僅 ${category.score} 分`));
    return `${sheetHead(person.name || '人物資料', person.nickname ? `暱稱：${person.nickname}` : band.label)}
      <div class="profile-overview">${avatarHtml(person, 'avatar-detail')}<div class="score-overview">${scoreBadgeHtml(score, person.id, true)}<div><strong style="font-size:19px">${escapeHtml(band.label)}</strong><div class="small-muted">起始 ${person.startScore} 分｜事件 ${Logic.personEvents(state, person.id).length} 筆</div></div></div></div>
      ${warnings.length ? `<div class="notice danger">${warnings.map(escapeHtml).join('｜')}</div>` : '<div class="notice">目前沒有逾期或 60 分以下的重大警示。</div>'}
      <div class="section-head"><h3 class="section-title">重要資料</h3></div>
      <div class="detail-list">
        <div class="detail-row"><span>關係</span><span>${escapeHtml(person.relation || '未設定')}</span></div>
        <div class="detail-row"><span>電話</span><span>${person.phone ? `<a href="tel:${attribute(person.phone)}">${escapeHtml(person.phone)}</a>` : '未設定'}</span></div>
        <div class="detail-row"><span>其他聯絡</span><span>${escapeHtml(person.otherContact || '未設定')}</span></div>
        <div class="detail-row"><span>生日</span><span>${dateText(person.birthday, false)}</span></div>
        <div class="detail-row"><span>星座</span><span>${escapeHtml(person.zodiac || Logic.zodiacFromBirthday(person.birthday) || '未設定')}</span></div>
        <div class="detail-row"><span>血型</span><span>${person.bloodType ? `${escapeHtml(person.bloodType)} 型` : '未設定'}</span></div>
        <div class="detail-row"><span>借貸關係</span><button class="text-link" data-action="show-person-loans" data-person-id="${attribute(person.id)}">${allLoans.length} 筆歷史｜${debt.activeCount} 筆未完成</button></div>
        ${Logic.customFieldsFor(state, person).map((field) => `<div class="detail-row"><span>${escapeHtml(field.label || '自訂欄位')}</span><span>${escapeHtml(field.value || '未設定')}</span></div>`).join('')}
      </div>
      ${person.tags && person.tags.length ? `<div class="tag-list">${person.tags.map((tag) => tagHtml(tag)).join('')}</div>` : ''}
      <div class="detail-card"><div class="settings-line"><h3>備註</h3><button class="text-link" data-action="edit-person-notes" data-person-id="${attribute(person.id)}">查看／修改</button></div><p class="event-detail">${escapeHtml(person.notes || '尚未填寫備註')}</p></div>
      <div class="section-head"><h3 class="section-title">最近事件</h3><button class="text-link" data-action="add-event" data-person-id="${attribute(person.id)}">＋ 新增</button></div>
      ${events.length ? `<div class="timeline">${events.map((event) => `<button class="timeline-item ${event.delta >= 0 ? 'positive' : 'negative'} ${event.important ? 'important-event' : ''} text-link" data-action="show-event" data-event-id="${attribute(event.id)}"><h4>${event.important ? '<span class="important-star">★</span> ' : ''}${escapeHtml(event.title)} <span class="${event.delta >= 0 ? 'delta-positive' : 'delta-negative'}">${signed(event.delta)}</span></h4><span class="small-muted">${dateText(event.occurredAt || event.createdAt, true)}</span></button>`).join('')}</div>` : '<div class="small-muted">尚無事件紀錄</div>'}
      <div class="card-actions person-detail-actions" style="margin-top:18px"><button class="action-button" data-action="edit-person" data-person-id="${attribute(person.id)}">修改人物</button><button class="action-button" data-action="show-person-loans" data-person-id="${attribute(person.id)}">借貸關係</button><button class="action-button" data-action="edit-person-notes" data-person-id="${attribute(person.id)}">備註</button><button class="action-button" data-action="show-person-events" data-person-id="${attribute(person.id)}" data-event-polarity="positive">往來明細</button></div>
      <button class="button danger full" style="margin-top:10px" data-action="delete-person" data-person-id="${attribute(person.id)}">刪除此人物</button>`;
  }

  function scoreDetailHtml(person) {
    const score = Logic.personScore(state, person);
    const band = Logic.scoreBand(score);
    const categories = Logic.categoryScores(state, person);
    return `${sheetHead(`${person.name}｜分數明細`, '總分由所有事件的加減分累積；分類分數只計入被標記的事件。')}
      <div class="score-overview">${scoreBadgeHtml(score, person.id, true)}<div><strong style="font-size:19px">${escapeHtml(band.label)}</strong><div class="small-muted">人物總分｜起始 ${person.startScore}</div></div></div>
      <div>${categories.map((category) => `<div class="score-row"><strong>${escapeHtml(category.name)}</strong><div class="score-track"><span class="score-fill band-${category.band.key}" style="width:${category.score}%"></span></div><strong style="color:${category.band.color}">${category.score}</strong></div>`).join('')}</div>
      <div class="notice" style="margin-top:15px">借錢、借物與還款本身都不會加分或扣分；只有另外建立的事件會改變評分。</div>
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
        <input type="hidden" name="recordId" value="${attribute(item.id)}">
        <label class="field"><span>人物 *</span><select name="personId" required>${peopleOptions(item.personId)}</select></label>
        <div class="form-grid">
          <label class="field full"><span>事件標題 *</span><input name="title" required maxlength="100" autofocus value="${attribute(item.title)}" placeholder="例如：再次延後還款"></label>
          <label class="field"><span>日期時間 *</span><input name="occurredAt" type="datetime-local" required value="${attribute(localDateValue(item.occurredAt, true))}"></label>
          ${deltaControlHtml('delta', item.delta, '加分／扣分 *', true)}
          <label class="field full"><span>事件經過</span><textarea name="detail" maxlength="5000" placeholder="記錄具體行為、承諾及結果">${escapeHtml(item.detail)}</textarea></label>
        </div>
        <div class="field"><span>影響分類</span><div class="check-list">${categories.map((category) => `<label class="check-chip"><input type="checkbox" name="categoryIds" value="${attribute(category.id)}" ${chosen.has(category.id) ? 'checked' : ''}><span>${escapeHtml(category.name)}</span></label>`).join('')}</div><small>未勾選時只影響人物總分。</small></div>
        <div class="choice-grid">
          <label class="choice"><input type="checkbox" name="important" ${item.important ? 'checked' : ''}><span>重要事件</span></label>
          <label class="choice"><input type="checkbox" name="followUp" ${item.followUp ? 'checked' : ''}><span>需要後續觀察</span></label>
        </div>
        <label class="field"><span>新增照片證據</span><input name="attachments" type="file" accept="image/*" multiple data-role="attachment-input"><small>每次最多 3 張，會壓縮後保存在本機。</small><strong class="attachment-status" data-attachment-status aria-live="polite"></strong></label>
        ${attachmentHtml(item.attachments)}
        <div class="form-actions"><button type="button" class="button secondary" data-action="close-sheet">取消</button><button class="button primary" type="button" data-action="save-form">${editing ? '儲存修改' : '儲存事件'}</button></div>
      </form>`;
  }

  function eventDetailHtml(event) {
    const person = personById(event.personId) || { name: '已刪除人物' };
    return `${sheetHead(event.title || '事件內容', `${person.name}｜${dateText(event.occurredAt || event.createdAt, true)}`)}
      <div class="score-overview"><div class="score-badge ${event.delta >= 0 ? 'band-green' : 'band-red'}">${signed(event.delta)}</div><div><strong>${event.delta >= 0 ? '加分事件' : '扣分事件'}</strong><div class="small-muted">影響人物總分${event.categoryIds && event.categoryIds.length ? '及所選分類' : ''}</div></div></div>
      <div class="tag-list">${(event.categoryIds || []).map((id) => tagHtml(categoryName(id), 'gold')).join('')}${event.important ? tagHtml('★ 重要事件', 'important') : ''}${event.followUp ? tagHtml('待追蹤') : ''}</div>
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
      interestNote: '', serialNumber: '', itemCondition: '', note: '', attachments: [], transactions: [], reminderEnabled: false
    };
    const isItem = item.kind === 'item';
    return `${sheetHead(editing ? '修改借貸' : '新增借貸', '金錢與物品分開記錄，部分歸還不會覆蓋原始資料。')}
      <form id="loan-form" class="form-stack">
        <input type="hidden" name="recordId" value="${attribute(item.id)}">
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
          <label class="choice full"><input type="checkbox" name="reminderEnabled" ${item.reminderEnabled ? 'checked' : ''}><span>到期日上午 9:00 左右提醒</span></label>
          <label class="field full"><span>備註</span><textarea name="note" maxlength="3000" placeholder="原因、付款方式、歸還約定等">${escapeHtml(item.note)}</textarea></label>
        </div>
        <label class="field"><span>新增照片／截圖</span><input name="attachments" type="file" accept="image/*" multiple data-role="attachment-input"><small>每次最多 3 張，會壓縮後保存在本機。</small><strong class="attachment-status" data-attachment-status aria-live="polite"></strong></label>
        ${attachmentHtml(item.attachments)}
        ${editing && item.transactions && item.transactions.length ? '<div class="notice">修改原始金額或數量時，既有還款／歸還紀錄仍會保留。</div>' : ''}
        <div class="form-actions"><button type="button" class="button secondary" data-action="close-sheet">取消</button><button class="button primary" type="button" data-action="save-form">${editing ? '儲存修改' : '建立借貸'}</button></div>
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
        <div class="detail-row"><span>到期提醒</span><span>${loan.reminderEnabled && loan.dueAt && !['settled', 'waived'].includes(status) ? '已開啟｜當日上午 9:00 左右' : '未開啟'}</span></div>
        ${!isItem && loan.interestNote ? `<div class="detail-row"><span>利息／約定</span><span>${escapeHtml(loan.interestNote)}</span></div>` : ''}
        ${isItem && loan.estimatedValue ? `<div class="detail-row"><span>估計價值</span><span>$${money(loan.estimatedValue)}</span></div>` : ''}
        ${isItem && loan.serialNumber ? `<div class="detail-row"><span>型號／序號</span><span>${escapeHtml(loan.serialNumber)}</span></div>` : ''}
        ${isItem && loan.itemCondition ? `<div class="detail-row"><span>原始狀況</span><span>${escapeHtml(loan.itemCondition)}</span></div>` : ''}
      </div>
      ${loan.note ? `<div class="detail-card" style="margin-top:12px"><h3>備註</h3><p class="event-detail">${escapeHtml(loan.note)}</p></div>` : ''}
      ${attachmentHtml(loan.attachments)}
      <div class="section-head"><h3 class="section-title">${isItem ? '歸還紀錄' : '還款紀錄'}</h3></div>
      ${(loan.transactions || []).length ? `<div class="timeline">${loan.transactions.slice().sort((a, b) => new Date(b.occurredAt) - new Date(a.occurredAt)).map((transaction) => `<div class="timeline-item positive transaction-item"><div><h4>${isItem ? `歸還 ${money(transaction.quantity)} 件` : `還款 $${money(transaction.amount)}`}</h4><span class="small-muted">${dateText(transaction.occurredAt, true)}</span>${transaction.note ? `<p>${escapeHtml(transaction.note)}</p>` : ''}${transaction.returnCondition ? `<p class="small-muted">歸還狀況：${escapeHtml(transaction.returnCondition)}</p>` : ''}</div><div class="transaction-actions"><button class="text-link" data-action="edit-transaction" data-loan-id="${attribute(loan.id)}" data-transaction-id="${attribute(transaction.id)}">修改</button><button class="text-link danger-text" data-action="delete-transaction" data-loan-id="${attribute(loan.id)}" data-transaction-id="${attribute(transaction.id)}">刪除</button></div></div>`).join('')}</div>` : '<div class="small-muted">尚無歸還紀錄</div>'}
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
    return `${sheetHead(`${person.name}｜借貸關係`, '保留全部借貸、還款與歸還歷史，包含已結清及已免除。')}
      <section class="summary-grid">
        <div class="summary-item"><span class="summary-label">他欠我</span><strong class="summary-value positive">$${money(debt.owedToMe)}</strong></div>
        <div class="summary-item"><span class="summary-label">我欠他</span><strong class="summary-value negative">$${money(debt.iOwe)}</strong></div>
        <div class="summary-item"><span class="summary-label">逾期</span><strong class="summary-value ${debt.overdueCount ? 'warning' : ''}">${debt.overdueCount}</strong></div>
      </section>
      ${loans.length ? `<div class="list-stack">${loans.map(loanCardHtml).join('')}</div>` : '<div class="empty-state"><span class="empty-icon">◉</span><h2>沒有借貸紀錄</h2><p>目前與此人沒有已建立的金錢或物品往來。</p></div>'}
      <button class="button primary full" style="margin-top:14px" data-action="add-loan" data-person-id="${attribute(person.id)}">新增借貸</button>`;
  }

  function personEventsHtml(person, selectedPolarity) {
    const polarity = selectedPolarity === 'negative' ? 'negative' : 'positive';
    const allEvents = Logic.personEvents(state, person.id);
    const positiveEvents = allEvents.filter((event) => Number(event.delta) >= 0);
    const negativeEvents = allEvents.filter((event) => Number(event.delta) < 0);
    const events = polarity === 'negative' ? negativeEvents : positiveEvents;
    return `${sheetHead(`${person.name}｜往來明細`, '此人的全部事件依加分與扣分分頁顯示。')}
      <div class="subtabs two-tabs">
        <button class="subtab ${polarity === 'positive' ? 'active' : ''}" data-action="show-person-events" data-person-id="${attribute(person.id)}" data-event-polarity="positive">加分 ${positiveEvents.length}</button>
        <button class="subtab ${polarity === 'negative' ? 'active' : ''}" data-action="show-person-events" data-person-id="${attribute(person.id)}" data-event-polarity="negative">扣分 ${negativeEvents.length}</button>
      </div>
      ${events.length ? `<div class="list-stack person-event-list">${events.map(eventCardHtml).join('')}</div>` : `<div class="empty-state"><span class="empty-icon">▤</span><h2>尚無${polarity === 'positive' ? '加分' : '扣分'}事件</h2><p>新增事件後會依分數方向自動歸入此頁。</p></div>`}
      <button class="button primary full" style="margin-top:14px" data-action="add-event" data-person-id="${attribute(person.id)}">新增事件</button>`;
  }
  function transactionFormHtml(loan, transaction) {
    const person = personById(loan.personId) || { name: '已刪除人物' };
    const remaining = Logic.loanRemaining(loan);
    const isItem = loan.kind === 'item';
    const editing = Boolean(transaction);
    const currentValue = editing ? Number(isItem ? transaction.quantity : transaction.amount) || 0 : remaining;
    const original = Number(isItem ? loan.quantity : loan.amount) || 0;
    const maximum = original - Logic.transactionTotal(loan) + (editing ? currentValue : 0);
    return `${sheetHead(editing ? (isItem ? '修改歸還紀錄' : '修改還款紀錄') : (isItem ? '記錄物品歸還' : '記錄還款'), `${person.name}｜可記錄 ${isItem ? `${money(maximum)} 件` : `$${money(maximum)}`}`)}
      <form id="transaction-form" class="form-stack">
        <input type="hidden" name="loanId" value="${attribute(loan.id)}">
        <input type="hidden" name="transactionId" value="${attribute(transaction ? transaction.id : '')}">
        <div class="form-grid">
          <label class="field"><span>${isItem ? '歸還數量' : '還款金額'} *</span><input name="value" type="number" min="1" max="${maximum}" step="1" required value="${currentValue}" autofocus></label>
          <label class="field"><span>日期時間 *</span><input name="occurredAt" type="datetime-local" required value="${localDateValue(transaction && transaction.occurredAt, true)}"></label>
          <label class="field full"><span>備註</span><textarea name="note" maxlength="1000" placeholder="付款方式、物品狀況或其他說明">${escapeHtml(transaction && transaction.note || '')}</textarea></label>
          ${isItem ? `<label class="field full"><span>歸還時狀況</span><input name="returnCondition" maxlength="300" value="${attribute(transaction && transaction.returnCondition || '')}" placeholder="是否完整、損壞或缺件"></label>` : ''}
        </div>
        <div class="notice">此紀錄只調整借貸餘額並保留借貸歷史，不會加分或扣分。</div>
        <div class="form-actions"><button type="button" class="button secondary" data-action="close-sheet">取消</button><button class="button primary" type="button" data-action="save-form">${editing ? '儲存修改' : '儲存紀錄'}</button></div>
      </form>`;
  }

  function categoryFormHtml(category) {
    return `${sheetHead(category ? '修改分類' : '新增分類', '分類會用來拆解人物風險，名稱應描述單一面向。')}
      <form id="category-form" class="form-stack"><input type="hidden" name="recordId" value="${attribute(category ? category.id : '')}"><label class="field"><span>分類名稱 *</span><input name="name" required maxlength="30" value="${attribute(category ? category.name : '')}" placeholder="例如：情緒穩定" autofocus></label><div class="form-actions"><button type="button" class="button secondary" data-action="close-sheet">取消</button><button class="button primary" type="button" data-action="save-form">儲存分類</button></div></form>`;
  }

  function tagFormHtml() {
    return `${sheetHead('新增人物標籤', '新增後可套用到人物，也能設為首頁搜尋常用標籤。')}<form id="tag-form" class="form-stack"><label class="field"><span>標籤名稱 *</span><input name="name" required maxlength="30" placeholder="例如：高情緒成本" autofocus></label><div class="form-actions"><button type="button" class="button secondary" data-action="close-sheet">取消</button><button class="button primary" type="button" data-action="save-form">新增標籤</button></div></form>`;
  }

  function quickTagsFormHtml() {
    const selected = new Set(state.settings.quickTags || []);
    return `${sheetHead('更換首頁常用標籤', '選擇要放在人物搜尋列下方的標籤，最多 6 個。')}<form id="quick-tags-form" class="form-stack"><div class="field"><span>首頁常用標籤</span><div class="check-list">${state.settings.tags.map((tag) => `<label class="check-chip tag-theme-${tagStyleKey(tag)}"><input type="checkbox" name="quickTags" value="${attribute(tag)}" ${selected.has(tag) ? 'checked' : ''}><span>${escapeHtml(tag)}</span></label>`).join('') || '<span class="small-muted">請先新增人物標籤</span>'}</div><small>可隨時更換，不會刪除人物身上的既有標籤。</small></div><div class="form-actions"><button type="button" class="button secondary" data-action="close-sheet">取消</button><button class="button primary" type="button" data-action="save-form">儲存常用標籤</button></div></form>`;
  }

  function personNotesFormHtml(person) {
    return `${sheetHead(`${person.name}｜備註`, '可直接查看與修改，不必開啟整份人物表單。')}<form id="person-notes-form" class="form-stack"><input type="hidden" name="personId" value="${attribute(person.id)}"><label class="field"><span>人物備註</span><textarea name="notes" maxlength="2000" rows="10" autofocus placeholder="身份、背景或需要記住的事">${escapeHtml(person.notes || '')}</textarea></label><div class="form-actions"><button type="button" class="button secondary" data-action="close-sheet">取消</button><button class="button primary" type="button" data-action="save-form">儲存備註</button></div></form>`;
  }

  function qualitySettingsFormHtml() {
    return `${sheetHead('首頁分級設定', '自訂兩組名稱與分數門檻；低分門檻必須小於高分門檻。')}<form id="quality-settings-form" class="form-stack"><div class="form-grid"><label class="field"><span>高分名稱 *</span><input name="qualityLabel" required maxlength="12" value="${attribute(state.settings.qualityLabel)}"></label><label class="field"><span>高分門檻 *</span><input name="qualityThreshold" type="number" min="0" max="100" required value="${state.settings.qualityThreshold}"></label><label class="field"><span>低分名稱 *</span><input name="poorLabel" required maxlength="12" value="${attribute(state.settings.poorLabel)}"></label><label class="field"><span>低分門檻 *</span><input name="poorThreshold" type="number" min="0" max="100" required value="${state.settings.poorThreshold}"></label></div><div class="form-actions"><button type="button" class="button secondary" data-action="close-sheet">取消</button><button class="button primary" type="button" data-action="save-form">儲存分級</button></div></form>`;
  }

  function titleSettingsFormHtml() {
    return `${sheetHead('修改首頁標題', '只改 App 內首頁顯示，不會更改手機桌面上的 App 名稱。')}<form id="title-settings-form" class="form-stack"><label class="field"><span>主標題 *</span><input name="appTitle" required maxlength="30" value="${attribute(state.settings.appTitle)}" autofocus></label><label class="field"><span>副標題 *</span><input name="appSubtitle" required maxlength="60" value="${attribute(state.settings.appSubtitle)}"></label><div class="form-actions"><button type="button" class="button secondary" data-action="close-sheet">取消</button><button class="button primary" type="button" data-action="save-form">儲存標題</button></div></form>`;
  }

  function tagStyleFormHtml(tag) {
    const styles = [
      ['normal', '經典', '沉穩單色'], ['aurora', '極光', '藍綠漸層'], ['neon', '霓虹', '紫粉光暈'],
      ['electric', '電光', '深藍紫與青光'], ['lava', '熔岩', '紅橘漸層'], ['ice', '冰晶', '銀藍冷光'], ['obsidian', '曜金', '黑金質感']
    ];
    const selected = tagStyleKey(tag);
    return `${sheetHead(`${tag}｜標籤外觀`, '選擇靜態炫彩樣式，套用到人物卡與常用標籤。')}<form id="tag-style-form" class="form-stack"><input type="hidden" name="tag" value="${attribute(tag)}"><div class="tag-style-grid">${styles.map(([key, label, hint]) => `<label class="tag-style-choice"><input type="radio" name="style" value="${key}" ${selected === key ? 'checked' : ''}><span class="tag tag-theme-${key}">${escapeHtml(tag)}</span><strong>${label}</strong><small>${hint}</small></label>`).join('')}</div><div class="form-actions"><button type="button" class="button secondary" data-action="close-sheet">取消</button><button class="button primary" type="button" data-action="save-form">套用外觀</button></div></form>`;
  }

  function pinFormHtml() {
    return `${sheetHead(state.settings.pinHash ? '變更 PIN' : '設定 PIN', '請設定 4 至 8 位數字；忘記 PIN 無法從畫面內找回。')}<form id="pin-form" class="form-stack"><label class="field"><span>新 PIN *</span><input name="pin" type="password" inputmode="numeric" pattern="[0-9]{4,8}" minlength="4" maxlength="8" required autofocus></label><label class="field"><span>再次輸入 *</span><input name="confirmPin" type="password" inputmode="numeric" pattern="[0-9]{4,8}" minlength="4" maxlength="8" required></label><div class="form-actions"><button type="button" class="button secondary" data-action="close-sheet">取消</button><button class="button primary" type="button" data-action="save-form">儲存 PIN</button></div></form>`;
  }

  function toast(message) {
    clearTimeout(toastTimer);
    toastElement.textContent = message;
    toastElement.classList.add('show');
    toastTimer = setTimeout(() => toastElement.classList.remove('show'), 2300);
  }

  function playIntroAudio() {
    try {
      introAudio.pause();
      introAudio.currentTime = 0;
      const playback = introAudio.play();
      if (playback && typeof playback.catch === 'function') playback.catch(() => toast('原聲暫時無法播放'));
    } catch (error) {
      toast('原聲暫時無法播放');
    }
  }

  function handleBrandPointerDown(event) {
    if (!event.target.closest('[data-role="brand-title"]')) return;
    clearTimeout(brandPressTimer);
    brandLongPressed = false;
    brandPressStart = { x: event.clientX, y: event.clientY };
    brandPressTimer = setTimeout(() => {
      brandLongPressed = true;
      introAudio.pause();
      openSheet(titleSettingsFormHtml());
    }, 650);
  }

  function handleBrandPointerUp(event) {
    clearTimeout(brandPressTimer);
    brandPressTimer = null;
  }

  function cancelBrandPress() {
    clearTimeout(brandPressTimer);
    brandPressTimer = null;
  }

  async function persist(message, shouldCloseSheet) {
    state.meta.updatedAt = new Date().toISOString();
    await Store.saveState(state);
    syncAllLoanReminders();
    if (shouldCloseSheet !== false) closeSheet();
    render();
    if (message) toast(message);
  }

  function confirmAction(title, message, confirmLabel) {
    if (confirmResolver) finishConfirm(false);
    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-message').textContent = message;
    const accept = document.getElementById('confirm-accept');
    accept.textContent = confirmLabel || '確認';
    confirmDialog.showModal();
    return new Promise((resolve) => {
      confirmResolver = resolve;
    });
  }

  function finishConfirm(accepted) {
    const resolve = confirmResolver;
    confirmResolver = null;
    if (confirmDialog.open) confirmDialog.close();
    if (resolve) resolve(Boolean(accepted));
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
    const transactionId = element.dataset.transactionId || '';

    if (action === 'confirm-cancel') return finishConfirm(false);
    if (action === 'confirm-accept') return finishConfirm(true);
    if (action === 'save-form') {
      const form = element.closest('form');
      if (form) return saveManagedForm(form, element);
      return;
    }

    if (action === 'set-score-sign') {
      const control = element.closest('[data-score-control]');
      if (!control) return;
      const sign = Number(element.dataset.sign) < 0 ? -1 : 1;
      const value = control.querySelector('[data-score-sign-value]');
      if (value) value.value = String(sign);
      control.querySelectorAll('[data-action="set-score-sign"]').forEach((button) => {
        const active = Number(button.dataset.sign) === sign;
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', String(active));
      });
      return;
    }

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
    if (action === 'add-custom-field') {
      const container = document.querySelector('[data-custom-fields]');
      if (container) container.insertAdjacentHTML('beforeend', customFieldRowHtml(null));
      return;
    }
    if (action === 'remove-custom-field') {
      const row = element.closest('[data-custom-field-row]');
      if (row) row.remove();
      return;
    }
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
    if (action === 'edit-person-notes') {
      const person = personById(personId);
      if (person) openSheet(personNotesFormHtml(person));
      return;
    }
    if (action === 'view-avatar') {
      const person = personById(personId);
      if (person && person.avatar && person.avatar.dataUrl) openSheet(avatarViewerHtml(person));
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
    if (action === 'show-person-events') {
      const person = personById(personId);
      if (person) openSheet(personEventsHtml(person, element.dataset.eventPolarity));
      return;
    }
    if (action === 'add-transaction') {
      const item = loanById(loanId);
      if (item) openSheet(transactionFormHtml(item, null));
      return;
    }
    if (action === 'edit-transaction') {
      const item = loanById(loanId);
      const transaction = item && (item.transactions || []).find((entry) => entry.id === transactionId);
      if (item && transaction) openSheet(transactionFormHtml(item, transaction));
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
    if (action === 'edit-quick-tags') return openSheet(quickTagsFormHtml());
    if (action === 'edit-quality-settings') return openSheet(qualitySettingsFormHtml());
    if (action === 'edit-title-settings') return openSheet(titleSettingsFormHtml());
    if (action === 'edit-tag-style') return openSheet(tagStyleFormHtml(element.dataset.tag || ''));
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
      const removedTag = element.dataset.tag;
      const accepted = await confirmAction('刪除標籤？', `標籤「${removedTag}」會從設定移除，人物既有標籤會保留。`, '刪除標籤');
      if (!accepted) return;
      state.settings.tags = state.settings.tags.filter((tag) => tag !== removedTag);
      state.settings.quickTags = (state.settings.quickTags || []).filter((tag) => tag !== removedTag);
      if (state.settings.tagStyles) delete state.settings.tagStyles[removedTag];
      if (filters.people.filter === `tag:${removedTag}`) filters.people.filter = 'all';
      return persist('已從人物標籤移除', false);
    }
    if (action === 'move-tag') {
      const tag = element.dataset.tag;
      const index = state.settings.tags.indexOf(tag);
      const next = element.dataset.direction === 'up' ? index - 1 : index + 1;
      if (index >= 0 && next >= 0 && next < state.settings.tags.length) {
        const reordered = state.settings.tags.slice();
        [reordered[index], reordered[next]] = [reordered[next], reordered[index]];
        state.settings.tags = reordered;
        return persist('標籤順序已更新', false);
      }
      return;
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
      updatePersonLoanTag(item.personId);
      return persist('借貸已刪除');
    }
    if (action === 'delete-transaction') {
      const item = loanById(loanId);
      const transaction = item && (item.transactions || []).find((entry) => entry.id === transactionId);
      if (!item || !transaction) return;
      const accepted = await confirmAction('刪除這筆還款紀錄？', '借貸剩餘金額或數量會依保留的紀錄重新計算。', '刪除紀錄');
      if (!accepted) return;
      Logic.removeTransaction(item, transactionId);
      updatePersonLoanTag(item.personId);
      return persist(item.kind === 'item' ? '歸還紀錄已刪除' : '還款紀錄已刪除');
    }
    if (action === 'waive-loan') {
      const item = loanById(loanId);
      if (!item) return;
      const accepted = await confirmAction('免除這筆借貸？', '剩餘金額或物品會標示為已免除，不再列入未結清與逾期統計。', '確認免除');
      if (!accepted) return;
      item.waived = true;
      item.updatedAt = new Date().toISOString();
      updatePersonLoanTag(item.personId);
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
    if (event.target.closest('[data-role="brand-title"]')) {
      event.preventDefault();
      if (!brandLongPressed) playIntroAudio();
      brandLongPressed = false;
      cancelBrandPress();
      return;
    }
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
    if (target.matches('[data-role="avatar-input"]')) {
      const status = target.closest('.field') && target.closest('.field').querySelector('[data-avatar-status]');
      if (status) status.textContent = target.files && target.files.length ? `已選擇：${target.files[0].name || '大頭照'}` : '';
      const form = target.closest('form');
      if (form) {
        form._avatarDraft = null;
        const file = target.files && target.files[0];
        form._avatarLoading = file ? prepareAvatar(form, file) : null;
        if (form._avatarLoading) form._avatarLoading.catch((error) => showFormError(form, error));
      }
      return;
    }
    if (target.matches('[data-role="birthday"]')) {
      const form = target.closest('form');
      const zodiac = form && form.querySelector('[data-role="zodiac"]');
      if (zodiac) zodiac.value = Logic.zodiacFromBirthday(target.value);
      return;
    }
    if (target.matches('[data-role="attachment-input"]')) {
      const count = Math.min(3, target.files ? target.files.length : 0);
      const status = target.closest('.field') && target.closest('.field').querySelector('[data-attachment-status]');
      if (status) status.textContent = count ? `已選擇 ${count} 張照片，儲存時會加入紀錄` : '';
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

  function readSignedDelta(data, prefix) {
    return Logic.signedDelta(data.get(`${prefix}Sign`), data.get(`${prefix}Amount`));
  }

  function showFormError(form, error) {
    const message = error && error.message ? error.message : '儲存失敗，請重新嘗試';
    let panel = form.querySelector('[data-form-error]');
    if (!panel) {
      panel = document.createElement('div');
      panel.className = 'notice danger form-error';
      panel.setAttribute('data-form-error', '');
      form.insertBefore(panel, form.firstChild);
    }
    panel.textContent = message;
    panel.scrollIntoView({ block: 'center', behavior: 'auto' });
    toast(message);
  }

  async function saveManagedForm(form, triggerButton) {
    const formId = form && form.getAttribute ? form.getAttribute('id') : '';
    if (!form || !Logic.isManagedFormId(formId)) return;
    lastInteractionAt = Date.now();
    const existingError = form.querySelector('[data-form-error]');
    if (existingError) existingError.remove();
    if (typeof form.checkValidity === 'function' && !form.checkValidity()) {
      if (typeof form.reportValidity === 'function') form.reportValidity();
      showFormError(form, new Error('請先完成所有必填欄位'));
      return;
    }
    const snapshot = Logic.deepClone(state);
    const button = triggerButton || form.querySelector('[data-action="save-form"]');
    const originalLabel = button ? button.textContent : '';
    if (button) {
      button.disabled = true;
      button.textContent = '處理中…';
    }
    try {
      if (formId === 'person-form') await submitPerson(form);
      if (formId === 'event-form') await submitEvent(form);
      if (formId === 'loan-form') await submitLoan(form);
      if (formId === 'transaction-form') await submitTransaction(form);
      if (formId === 'category-form') await submitCategory(form);
      if (formId === 'tag-form') await submitTag(form);
      if (formId === 'quick-tags-form') await submitQuickTags(form);
      if (formId === 'person-notes-form') await submitPersonNotes(form);
      if (formId === 'quality-settings-form') await submitQualitySettings(form);
      if (formId === 'title-settings-form') await submitTitleSettings(form);
      if (formId === 'tag-style-form') await submitTagStyle(form);
      if (formId === 'pin-form') await submitPin(form);
      if (formId === 'unlock-form') await submitUnlock(form);
    } catch (error) {
      state = Logic.normalizeState(snapshot);
      console.error(error);
      showFormError(form, error);
    } finally {
      if (button && document.contains(button)) {
        button.disabled = false;
        button.textContent = originalLabel;
      }
    }
  }

  function handleSubmit(event) {
    const form = event.target;
    const formId = form && form.getAttribute ? form.getAttribute('id') : '';
    if (!form.matches('form') || !Logic.isManagedFormId(formId)) return;
    event.preventDefault();
    saveManagedForm(form, form.querySelector('[data-action="save-form"]'));
  }

  async function submitPerson(form) {
    const data = new FormData(form);
    const id = String(data.get('recordId') || '');
    const existing = personById(id);
    const chosenTags = data.getAll('tags').map(String);
    const customTags = splitTags(data.get('customTags'));
    const tags = Array.from(new Set([...chosenTags, ...customTags]));
    const fieldIds = data.getAll('customFieldId').map(String);
    const fieldLabels = data.getAll('customFieldLabel').map((value) => String(value || '').trim());
    const fieldValues = data.getAll('customFieldValue').map((value) => String(value || '').trim());
    const customFields = fieldLabels.map((label, index) => ({
      id: fieldIds[index] || Logic.uid('field'),
      label,
      value: fieldValues[index] || ''
    })).filter((field) => field.label || field.value);
    if (customFields.some((field) => !field.label)) throw new Error('請填寫自訂欄位名稱');
    if (new Set(customFields.map((field) => field.label)).size !== customFields.length) throw new Error('自訂欄位名稱不可重複');
    const removedFields = (state.settings.customFields || []).filter((field) => !customFields.some((entry) => entry.id === field.id));
    if (removedFields.length && !await confirmAction('刪除共用欄位？', `所有人物的「${removedFields.map((field) => field.label).join('、')}」欄位與內容都會移除。`, '刪除欄位')) return;
    const avatarInput = form.elements.avatar;
    if (form._avatarLoading) await form._avatarLoading;
    if (avatarInput && avatarInput.files && avatarInput.files.length && !form._avatarDraft) {
      await prepareAvatar(form, avatarInput.files[0]);
    }
    const newAvatar = form._avatarDraft ? finishAvatar(form) : null;
    const stamp = new Date().toISOString();
    const person = Object.assign({}, existing || {}, {
      id: existing ? existing.id : Logic.uid('person'),
      name: String(data.get('name') || '').trim(),
      nickname: String(data.get('nickname') || '').trim(),
      phone: String(data.get('phone') || '').trim(),
      otherContact: String(data.get('otherContact') || '').trim(),
      relation: String(data.get('relation') || '').trim(),
      birthday: String(data.get('birthday') || ''),
      zodiac: String(data.get('zodiac') || Logic.zodiacFromBirthday(data.get('birthday')) || ''),
      bloodType: String(data.get('bloodType') || ''),
      avatar: newAvatar || (data.has('removeAvatar') ? null : existing && existing.avatar ? existing.avatar : null),
      tags,
      notes: String(data.get('notes') || '').trim(),
      customFields,
      startScore: Logic.clampScore(data.get('startScore')),
      categoryStarts: existing ? existing.categoryStarts || {} : {},
      createdAt: existing ? existing.createdAt : stamp,
      updatedAt: stamp
    });
    if (!person.name) throw new Error('請輸入姓名');
    if (existing) Object.assign(existing, person);
    else state.people.push(person);
    Logic.updateCustomFields(state, person, customFields);
    state.settings.tags = Array.from(new Set([...state.settings.tags, ...customTags]));
    if (!state.settings.tagStyles) state.settings.tagStyles = {};
    customTags.forEach((tag) => { if (!state.settings.tagStyles[tag]) state.settings.tagStyles[tag] = 'normal'; });
    await persist(existing ? '人物資料已更新' : '人物已建立');
  }

  async function submitEvent(form) {
    const data = new FormData(form);
    const id = String(data.get('recordId') || '');
    const existing = eventById(id);
    const input = form.elements.attachments;
    const newAttachments = await imageAttachments(input && input.files);
    const stamp = new Date().toISOString();
    const occurredValue = String(data.get('occurredAt') || '');
    const item = Object.assign({}, existing || {}, {
      id: existing ? existing.id : Logic.uid('event'),
      personId: String(data.get('personId') || ''),
      title: String(data.get('title') || '').trim(),
      detail: String(data.get('detail') || '').trim(),
      delta: readSignedDelta(data, 'delta'),
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
    const id = String(data.get('recordId') || '');
    const existing = loanById(id);
    const previousPersonId = existing ? existing.personId : '';
    const kind = String(data.get('kind') || 'money');
    if (existing && existing.transactions && existing.transactions.length && kind !== existing.kind) {
      throw new Error('已有還款／歸還紀錄，不能再變更金錢或物品類型');
    }
    const input = form.elements.attachments;
    const newAttachments = await imageAttachments(input && input.files);
    const stamp = new Date().toISOString();
    const item = Object.assign({}, existing || {}, {
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
      reminderEnabled: data.has('reminderEnabled'),
      note: String(data.get('note') || '').trim(),
      attachments: [...(existing && existing.attachments ? existing.attachments : []), ...newAttachments],
      transactions: existing && existing.transactions ? existing.transactions : [],
      waived: existing ? Boolean(existing.waived) : false,
      createdAt: existing ? existing.createdAt : stamp,
      updatedAt: stamp
    });
    if (!personById(item.personId)) throw new Error('找不到指定人物');
    if (!item.title) throw new Error(`請輸入${kind === 'item' ? '物品' : '借貸'}名稱`);
    if (kind === 'money' && (!Number.isInteger(item.amount) || item.amount <= 0)) throw new Error('借貸金額必須是大於 0 的整數');
    if (Number(kind === 'item' ? item.quantity : item.amount) < Logic.transactionTotal(item)) throw new Error('原始金額或數量不能小於已歸還總額');
    if (item.reminderEnabled && !item.dueAt) throw new Error('開啟到期提醒前，請先設定約定歸還日期');
    if (existing) Object.assign(existing, item);
    else state.loans.push(item);
    const person = personById(item.personId);
    if (person) {
      person.updatedAt = stamp;
    }
    updatePersonLoanTag(item.personId);
    if (previousPersonId && previousPersonId !== item.personId) updatePersonLoanTag(previousPersonId);
    await persist(existing ? '借貸已更新' : '借貸已建立');
    if (item.reminderEnabled && window.AndroidBridge && window.AndroidBridge.requestNotificationPermission) window.AndroidBridge.requestNotificationPermission();
  }

  async function submitTransaction(form) {
    const data = new FormData(form);
    const loan = loanById(String(data.get('loanId') || ''));
    if (!loan) throw new Error('找不到這筆借貸');
    const transactionId = String(data.get('transactionId') || '');
    const isItem = loan.kind === 'item';
    const value = Number(data.get('value'));
    const occurredAt = String(data.get('occurredAt') || '');
    const input = {
      [isItem ? 'quantity' : 'amount']: value,
      occurredAt: occurredAt ? new Date(occurredAt).toISOString() : new Date().toISOString(),
      note: String(data.get('note') || '').trim(),
      returnCondition: String(data.get('returnCondition') || '').trim()
    };
    // Validate before showing confirmation; the live loan stays unchanged until accepted.
    Logic.saveTransaction(Logic.deepClone(loan), input, transactionId);
    const person = personById(loan.personId);
    const label = isItem ? '歸還紀錄' : '還款紀錄';
    const accepted = await confirmAction(transactionId ? `確認修改${label}？` : `確認${label}？`,
      `${person ? person.name : '人物'}｜${loan.title}\n${isItem ? `歸還 ${money(value)} 件` : `還款 $${money(value)}`}\n${dateText(input.occurredAt, true)}\n這筆紀錄不加分或扣分。`, '確認儲存');
    if (!accepted) return;
    Logic.saveTransaction(loan, input, transactionId);
    if (person) person.updatedAt = new Date().toISOString();
    updatePersonLoanTag(loan.personId);
    await persist(transactionId ? `${label}已修改` : `${label}已儲存`);
  }

  async function submitPersonNotes(form) {
    const data = new FormData(form);
    const person = personById(String(data.get('personId') || ''));
    if (!person) throw new Error('找不到指定人物');
    person.notes = String(data.get('notes') || '').trim();
    person.updatedAt = new Date().toISOString();
    await persist('人物備註已更新');
  }

  async function submitQualitySettings(form) {
    const data = new FormData(form);
    const qualityLabel = String(data.get('qualityLabel') || '').trim();
    const poorLabel = String(data.get('poorLabel') || '').trim();
    const qualityThreshold = Logic.clampScore(data.get('qualityThreshold'));
    const poorThreshold = Logic.clampScore(data.get('poorThreshold'));
    if (!qualityLabel || !poorLabel) throw new Error('請輸入高分與低分名稱');
    if (poorThreshold >= qualityThreshold) throw new Error('低分門檻必須小於高分門檻');
    Object.assign(state.settings, { qualityLabel, qualityThreshold, poorLabel, poorThreshold });
    await persist('首頁分級已更新');
  }

  async function submitTitleSettings(form) {
    const data = new FormData(form);
    const appTitle = String(data.get('appTitle') || '').trim();
    const appSubtitle = String(data.get('appSubtitle') || '').trim();
    if (!appTitle || !appSubtitle) throw new Error('主標題與副標題都不能留空');
    state.settings.appTitle = appTitle;
    state.settings.appSubtitle = appSubtitle;
    await persist('首頁標題已更新');
  }

  async function submitTagStyle(form) {
    const data = new FormData(form);
    const tag = String(data.get('tag') || '');
    const style = String(data.get('style') || 'normal');
    if (!state.settings.tags.includes(tag)) throw new Error('找不到這個標籤');
    if (!Logic.TAG_STYLE_KEYS.includes(style)) throw new Error('無效的標籤外觀');
    if (!state.settings.tagStyles) state.settings.tagStyles = {};
    state.settings.tagStyles[tag] = style;
    await persist('標籤外觀已套用');
  }

  async function submitCategory(form) {
    const data = new FormData(form);
    const id = String(data.get('recordId') || '');
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
    if (!state.settings.tagStyles) state.settings.tagStyles = {};
    if (!state.settings.tagStyles[name]) state.settings.tagStyles[name] = 'normal';
    await persist('人物標籤已新增');
  }

  async function submitQuickTags(form) {
    const data = new FormData(form);
    const selected = Array.from(new Set(data.getAll('quickTags').map(String)));
    if (selected.length > 6) throw new Error('首頁常用標籤最多選擇 6 個');
    state.settings.quickTags = selected.filter((tag) => state.settings.tags.includes(tag));
    if (String(filters.people.filter).startsWith('tag:') && !state.settings.quickTags.includes(String(filters.people.filter).slice(4))) {
      filters.people.filter = 'all';
    }
    await persist('首頁常用標籤已更新');
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

  function prepareAvatar(form, file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('照片讀取失敗'));
      reader.onload = () => {
        const image = new Image();
        image.onerror = () => reject(new Error('照片格式無法處理'));
        image.onload = () => {
          const editor = form.querySelector('[data-avatar-editor]');
          form._avatarDraft = { image, dataUrl: String(reader.result), name: file.name, type: file.type, crop: { x: .5, y: .5, size: .85 } };
          editor.innerHTML = `<div class="avatar-crop-stage" style="width:${Math.min(320, 320 * image.naturalWidth / image.naturalHeight)}px"><img src="${attribute(reader.result)}" alt="選擇頭像顯示範圍"><button type="button" class="avatar-crop-circle" aria-label="拖曳選擇頭像區域"></button></div><label class="field"><span>圓圈大小</span><input type="range" min="20" max="100" value="85" data-avatar-crop-size></label><small class="small-muted">拖動圓圈移動範圍，拖曳滑桿調整大小；原圖會保留。</small>`;
          const stage = editor.querySelector('.avatar-crop-stage');
          const circle = editor.querySelector('.avatar-crop-circle');
          let drag = null;
          function draw() {
            const bounds = stage.getBoundingClientRect();
            const crop = form._avatarDraft.crop;
            const size = Math.min(bounds.width, bounds.height) * crop.size;
            if (!size) return;
            crop.x = Math.max(size / 2 / bounds.width, Math.min(1 - size / 2 / bounds.width, crop.x));
            crop.y = Math.max(size / 2 / bounds.height, Math.min(1 - size / 2 / bounds.height, crop.y));
            Object.assign(circle.style, { width: `${size}px`, height: `${size}px`, left: `${crop.x * bounds.width - size / 2}px`, top: `${crop.y * bounds.height - size / 2}px` });
          }
          circle.addEventListener('pointerdown', (event) => {
            event.preventDefault();
            circle.setPointerCapture(event.pointerId);
            drag = { x: event.clientX, y: event.clientY, crop: Object.assign({}, form._avatarDraft.crop) };
          });
          circle.addEventListener('pointermove', (event) => {
            if (!drag) return;
            const bounds = stage.getBoundingClientRect();
            form._avatarDraft.crop.x = drag.crop.x + (event.clientX - drag.x) / bounds.width;
            form._avatarDraft.crop.y = drag.crop.y + (event.clientY - drag.y) / bounds.height;
            draw();
          });
          circle.addEventListener('pointerup', () => { drag = null; });
          circle.addEventListener('pointercancel', () => { drag = null; });
          circle.addEventListener('keydown', (event) => {
            const directions = { ArrowLeft: [-.02, 0], ArrowRight: [.02, 0], ArrowUp: [0, -.02], ArrowDown: [0, .02] };
            if (!directions[event.key]) return;
            event.preventDefault();
            form._avatarDraft.crop.x += directions[event.key][0];
            form._avatarDraft.crop.y += directions[event.key][1];
            draw();
          });
          editor.querySelector('[data-avatar-crop-size]').addEventListener('input', (event) => { form._avatarDraft.crop.size = Number(event.target.value) / 100; draw(); });
          editor.querySelector('img').onload = draw;
          requestAnimationFrame(draw);
          resolve();
        };
        image.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function finishAvatar(form) {
    const draft = form._avatarDraft;
    const crop = draft.crop;
    const image = draft.image;
    const side = Math.min(image.naturalWidth, image.naturalHeight) * crop.size;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 320;
    const context = canvas.getContext('2d');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, 320, 320);
    const x = Math.max(0, Math.min(image.naturalWidth - side, crop.x * image.naturalWidth - side / 2));
    const y = Math.max(0, Math.min(image.naturalHeight - side, crop.y * image.naturalHeight - side / 2));
    context.drawImage(image, x, y, side, side, 0, 0, 320, 320);
    return { id: Logic.uid('avatar'), name: draft.name, type: draft.type, dataUrl: draft.dataUrl, thumbnailDataUrl: canvas.toDataURL('image/jpeg', .85), crop, createdAt: new Date().toISOString() };
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
    try {
      if (window.AndroidBridge) {
        window.AndroidBridge.saveTextFile(fileName, mimeType, content);
        return;
      }
    } catch (error) {
      console.warn('Android 儲存視窗無法開啟，改用瀏覽器下載', error);
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
    app.innerHTML = `<main class="lock-screen"><img src="icons/icon-192.png" alt="人際小本本"><h1>${escapeHtml(state.settings.appTitle)}</h1><p>輸入 PIN 查看人際紀錄</p><form id="unlock-form" class="form-stack"><input name="pin" type="password" inputmode="numeric" pattern="[0-9]{4,8}" maxlength="8" aria-label="PIN" autofocus><button class="button primary" type="button" data-action="save-form">解鎖</button></form></main>`;
  }

  function handleBack() {
    if (confirmDialog.open) {
      finishConfirm(false);
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
    syncAllLoanReminders();
    Store.requestPersistence().catch(() => false);

    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      navigator.serviceWorker.register('./sw.js').catch((error) => console.warn('Service worker unavailable', error));
    }
  }

  document.addEventListener('click', handleClick);
  document.addEventListener('input', handleInput);
  document.addEventListener('change', handleChange);
  document.addEventListener('submit', handleSubmit, true);
  document.addEventListener('pointerdown', handleBrandPointerDown);
  document.addEventListener('pointerup', handleBrandPointerUp);
  document.addEventListener('pointercancel', () => { brandLongPressed = true; cancelBrandPress(); });
  document.addEventListener('pointermove', (event) => {
    if (brandPressTimer && brandPressStart && Math.hypot(event.clientX - brandPressStart.x, event.clientY - brandPressStart.y) > 12) {
      brandLongPressed = true; cancelBrandPress();
    }
  }, { passive: true });
  document.addEventListener('contextmenu', (event) => {
    if (event.target.closest('[data-role="brand-title"]')) event.preventDefault();
  });
  document.addEventListener('pointerdown', () => { lastInteractionAt = Date.now(); }, { passive: true });
  document.addEventListener('keydown', () => { lastInteractionAt = Date.now(); }, { passive: true });

  sheet.addEventListener('click', (event) => {
    if (event.target === sheet) closeSheet();
  });

  confirmDialog.addEventListener('click', (event) => {
    if (event.target === confirmDialog) finishConfirm(false);
  });

  confirmDialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    finishConfirm(false);
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
      introAudio.pause();
      cancelBrandPress();
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

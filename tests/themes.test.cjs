const { test } = require('node:test');
const assert = require('node:assert/strict');
const L = require('../app/src/main/assets/web/logic.js');

test('deadline colors use strict boundaries and completion priority', () => {
  const now = Date.parse('2026-09-18T12:00:00Z');
  for (const [hours, tone] of [[-1, 'overdue'], [0, 'urgent'], [23.999, 'urgent'], [24, 'soon'], [71.999, 'soon'], [72, 'month'], [719.999, 'month'], [720, 'later']]) {
    const item = {kind: 'todo', dueAt: new Date(now + hours * 3600000).toISOString()};
    assert.equal(L.journalTone(item, now), tone);
    assert.equal(L.journalTone({...item, completed: true}, now), 'done');
  }
  assert.equal(L.journalTone({kind: 'note'}, now), 'note');
  assert.equal(L.journalTone({kind: 'todo'}, now), 'pending');
});

test('sixteen themes and custom colors survive backup normalization', () => {
  assert.equal(L.THEMES.length, 16);
  assert.equal(new Set(L.THEMES.map(x => x[0])).size, 16);
  const state = L.createDefaultState();
  state.settings.theme = 'custom';
  state.settings.customThemeColors = ['#ABCDEF', 'invalid', '#123456'];
  const restored = L.normalizeState(JSON.parse(JSON.stringify(state)));
  assert.equal(restored.settings.theme, 'custom');
  assert.deepEqual(restored.settings.customThemeColors, ['#abcdef', '#92baff', '#123456']);
});

test('demo adds three fictional people with events and all journal colors', () => {
  const state = L.normalizeState(L.createDemoState());
  assert.equal(state.people.length, 5);
  for (const name of ['陳沛清', '劉星羽', '郭文德']) {
    const person = state.people.find(p => p.name === name);
    assert.match(person.notes, /虛構/);
    assert.equal(state.events.filter(e => e.personId === person.id).length, 2);
  }
  assert.equal(new Set(state.journal.map(j => L.journalTone(j))).size, 7);
});

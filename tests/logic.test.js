'use strict';
require('fake-indexeddb/auto');
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { IDBFactory } = require('fake-indexeddb');

const db = require('../app/js/db.js');
const L = require('../app/js/logic.js');

let saw, drill, battery, futurum, archistra, screws;

beforeEach(async () => {
  db._reset();
  globalThis.indexedDB = new IDBFactory();
  [futurum, archistra] = await L.addTeams(['Футурум', 'Архистра']);
  saw = await L.addToolType({ name: 'Циркулярная пила' });
  drill = await L.addToolType({ name: 'Шуруповёрт', limit: 3 });
  battery = await L.addToolType({ name: 'Аккумулятор 18V', kind: 'battery' });
  await L.addItems(saw.id, 4);
  await L.addItems(drill.id, 2);
  await L.addItems(battery.id, 6);
  screws = await L.addConsumable({ name: 'Саморезы 4×40', unit: 'уп', stock: 10 });
});

async function rejectsWith(promise, code) {
  await assert.rejects(promise, (e) => { assert.equal(e.code, code, e.message); return true; });
}

test('QR-коды: формат и разбор', () => {
  assert.deepEqual(L.parseCode('AB:T:T01'), { kind: 'team', id: 'T01' });
  assert.deepEqual(L.parseCode(' ab:i:tsirpil-02 '), { kind: 'item', id: 'TSIRPIL-02' });
  assert.equal(L.parseCode('https://example.com'), null);
  assert.equal(L.codeFor('consumable', 'C01'), 'AB:C:C01');
});

test('ID генерируются автоматически и последовательно', async () => {
  assert.equal(futurum.id, 'T01');
  assert.equal(saw.id, 'TSIRPIL');
  assert.equal(saw.limit, 2, 'лимит по умолчанию 2');
  assert.equal(battery.limit, 4, 'для аккумуляторов по умолчанию 4');
  const more = await L.addItems(saw.id, 2);
  assert.deepEqual(more.map((i) => i.id), ['TSIRPIL-05', 'TSIRPIL-06']);
  assert.equal(more[0].label, 'Циркулярная пила №5');
  const again = await L.addTeams(['Футурум', 'Новая']);
  assert.deepEqual(again.map((t) => t.id), ['T03'], 'дубликаты по имени пропускаются');
});

test('выдача и возврат', async () => {
  const r = await L.issue(futurum.id, ['TSIRPIL-01', 'AKKU18V-01'], [{ id: screws.id, qty: 3 }]);
  assert.equal(r.issued.length, 2);
  const item = await db.getOne('items', 'TSIRPIL-01');
  assert.equal(item.status, 'out');
  assert.equal(item.holderTeamId, futurum.id);
  assert.equal((await db.getOne('consumables', screws.id)).stock, 7);

  const back = await L.returnItem('AKKU18V-01');
  assert.equal(back.chargeReminder, true, 'напоминание о зарядке для аккумулятора');
  assert.equal(back.team.id, futurum.id);
  const saw1 = await L.returnItem('TSIRPIL-01');
  assert.equal(saw1.chargeReminder, false);
  assert.equal((await db.getOne('items', 'TSIRPIL-01')).status, 'in');
});

test('нельзя выдать уже выданное и вернуть невыданное', async () => {
  await L.issue(futurum.id, ['TSIRPIL-01']);
  await rejectsWith(L.checkCandidate(archistra.id, 'TSIRPIL-01', []), 'ALREADY_OUT');
  await rejectsWith(L.issue(archistra.id, ['TSIRPIL-01']), 'ALREADY_OUT');
  await rejectsWith(L.checkCandidate(futurum.id, 'TSIRPIL-01', []), 'ALREADY_YOURS');
  await rejectsWith(L.checkCandidate(futurum.id, 'TSIRPIL-02', ['TSIRPIL-02']), 'IN_CART');
  await rejectsWith(L.returnItem('TSIRPIL-02'), 'NOT_OUT');
  await L.returnItem('TSIRPIL-01');
  await rejectsWith(L.returnItem('TSIRPIL-01'), 'NOT_OUT');
  await rejectsWith(L.checkCandidate(futurum.id, 'NOPE-01', []), 'ITEM_NOT_FOUND');
});

test('взять чужой инструмент через выдачу нельзя, через возврат на склад — можно', async () => {
  await L.issue(futurum.id, ['TSIRPIL-01']);
  await rejectsWith(L.issue(archistra.id, ['TSIRPIL-01']), 'ALREADY_OUT');
  await L.returnItem('TSIRPIL-01');
  await L.issue(archistra.id, ['TSIRPIL-01']);
  assert.equal((await db.getOne('items', 'TSIRPIL-01')).holderTeamId, archistra.id);
});

test('передача другой команде без возврата на склад', async () => {
  await L.issue(futurum.id, ['TSIRPIL-01']);
  const before = (await db.getOne('items', 'TSIRPIL-01')).issuedAt;
  await new Promise((r) => setTimeout(r, 5));
  const r = await L.transferItem('TSIRPIL-01', archistra.id);
  assert.equal(r.from.id, futurum.id);
  assert.equal(r.to.id, archistra.id);
  const item = await db.getOne('items', 'TSIRPIL-01');
  assert.equal(item.status, 'out', 'на склад не возвращается');
  assert.equal(item.holderTeamId, archistra.id, 'ответственность у новой команды');
  assert.ok(item.issuedAt > before, 'время — с момента передачи');

  const s = await L.snapshot();
  const op = s.ops.find((o) => o.op === 'transfer');
  assert.equal(op.itemId, 'TSIRPIL-01');
  assert.equal(op.fromTeamId, futurum.id);
  assert.equal(op.fromTeamName, 'Футурум');
  assert.equal(op.teamId, archistra.id);
  assert.equal(s.ops.filter((o) => o.op === 'return').length, 0);

  // отчёты: числится за новой командой, счётчики передач
  assert.deepEqual(L.reportHoldings(s).map((h) => [h.teamName, h.itemId]), [['Архистра', 'TSIRPIL-01']]);
  const teams = Object.fromEntries(L.reportTeams(s).map((t) => [t.teamName, t]));
  assert.equal(teams['Футурум'].transferredOut, 1);
  assert.equal(teams['Архистра'].transferredIn, 1);
  assert.equal(teams['Футурум'].onHands.length, 0);
  assert.match(L.CSV.operations(s), /Передача;Футурум;Архистра;Циркулярная пила/);

  // обычный возврат после передачи снимает с новой команды
  const back = await L.returnItem('TSIRPIL-01');
  assert.equal(back.team.id, archistra.id);
  assert.equal((await db.getOne('items', 'TSIRPIL-01')).status, 'in');
});

test('передача: ошибки и откат', async () => {
  await rejectsWith(L.transferItem('TSIRPIL-01', archistra.id), 'NOT_OUT');
  await rejectsWith(L.transferItem('NOPE-01', archistra.id), 'ITEM_NOT_FOUND');
  await L.issue(futurum.id, ['TSIRPIL-01']);
  await rejectsWith(L.transferItem('TSIRPIL-01', futurum.id), 'SAME_TEAM');
  await rejectsWith(L.transferItem('TSIRPIL-01', 'T99'), 'TEAM_NOT_FOUND');
  await L.updateTeam(archistra.id, { active: false });
  await rejectsWith(L.transferItem('TSIRPIL-01', archistra.id), 'TEAM_INACTIVE');
  const s = await L.snapshot();
  assert.equal(s.items.find((i) => i.id === 'TSIRPIL-01').holderTeamId, futurum.id, 'ничего не поменялось');
  assert.equal(s.ops.filter((o) => o.op === 'transfer').length, 0, 'в журнале нет лишних записей');
});

test('передача: лимит проверяется у получателя', async () => {
  await L.issue(archistra.id, ['TSIRPIL-01', 'TSIRPIL-02']);
  await L.issue(futurum.id, ['TSIRPIL-03']);
  await assert.rejects(L.transferItem('TSIRPIL-03', archistra.id), (e) => {
    assert.equal(e.code, 'LIMIT');
    assert.equal(e.message, 'Лимит для вашей команды: 2 шт. Сначала верните один.');
    return true;
  });
  assert.equal((await db.getOne('items', 'TSIRPIL-03')).holderTeamId, futurum.id);
  // передача на другой тип — без ограничений по пилам
  await L.issue(futurum.id, ['SHURUP-01']);
  await L.transferItem('SHURUP-01', archistra.id);
  // освободили место — передача проходит
  await L.returnItem('TSIRPIL-01');
  await L.transferItem('TSIRPIL-03', archistra.id);
  assert.equal((await db.getOne('items', 'TSIRPIL-03')).holderTeamId, archistra.id);
});

test('лимит 2 на тип: учитывает и то, что на руках, и корзину', async () => {
  await L.issue(futurum.id, ['TSIRPIL-01']);
  // одна на руках + одна в корзине → третья запрещена
  await L.checkCandidate(futurum.id, 'TSIRPIL-02', []);
  await assert.rejects(L.checkCandidate(futurum.id, 'TSIRPIL-03', ['TSIRPIL-02']), (e) => {
    assert.equal(e.code, 'LIMIT');
    assert.equal(e.message, 'Лимит для вашей команды: 2 шт. Сначала верните один.');
    return true;
  });
  await L.issue(futurum.id, ['TSIRPIL-02']);
  await rejectsWith(L.issue(futurum.id, ['TSIRPIL-03']), 'LIMIT');
  // транзакция откатилась целиком — ничего лишнего не выдано
  assert.equal((await db.getOne('items', 'TSIRPIL-03')).status, 'in');
  // лимит по команде, а не глобальный
  await L.issue(archistra.id, ['TSIRPIL-03', 'TSIRPIL-04']);
  // вернули одну — можно взять снова
  await L.returnItem('TSIRPIL-01');
  await L.checkCandidate(futurum.id, 'TSIRPIL-01', []);
});

test('атомарная выдача: превышение лимита в одной корзине не выдаёт ничего', async () => {
  await rejectsWith(L.issue(futurum.id, ['TSIRPIL-01', 'TSIRPIL-02', 'TSIRPIL-03', 'AKKU18V-01']), 'LIMIT');
  const s = await L.snapshot();
  assert.equal(s.items.filter((i) => i.status === 'out').length, 0);
  assert.equal(s.ops.filter((o) => o.op === 'issue').length, 0);
});

test('лимит настраивается по типу; 0 = без лимита; на расходники не действует', async () => {
  await L.updateToolType(saw.id, { limit: 1 });
  await L.issue(futurum.id, ['TSIRPIL-01']);
  await assert.rejects(L.checkCandidate(futurum.id, 'TSIRPIL-02', []), /Лимит для вашей команды: 1 шт/);
  await L.updateToolType(saw.id, { limit: 0 });
  await L.issue(futurum.id, ['TSIRPIL-02', 'TSIRPIL-03', 'TSIRPIL-04']);
  // расходники: 10 уп, лимита нет — можно взять сколько есть
  await L.issue(futurum.id, [], [{ id: screws.id, qty: 10 }]);
  await rejectsWith(L.issue(futurum.id, [], [{ id: screws.id, qty: 1 }]), 'NOT_ENOUGH');
  await rejectsWith(L.checkConsumable(screws.id, 0), 'BAD_QTY');
});

test('отключённая команда не может брать', async () => {
  await L.updateTeam(futurum.id, { active: false });
  await rejectsWith(L.issue(futurum.id, ['TSIRPIL-01']), 'TEAM_INACTIVE');
});

test('нельзя списать или отправить в ремонт выданное', async () => {
  await L.issue(futurum.id, ['TSIRPIL-01']);
  await rejectsWith(L.updateItem('TSIRPIL-01', { status: 'retired' }), 'ITEM_OUT');
  await L.updateItem('TSIRPIL-02', { status: 'service' });
  await rejectsWith(L.checkCandidate(futurum.id, 'TSIRPIL-02', []), 'ITEM_SERVICE');
});

test('итоговые отчёты: кто что взял, сколько осталось', async () => {
  await L.issue(futurum.id, ['TSIRPIL-01', 'SHURUP-01'], [{ id: screws.id, qty: 2 }]);
  await L.issue(archistra.id, ['SHURUP-02', 'AKKU18V-01'], [{ id: screws.id, qty: 1 }]);
  await L.returnItem('SHURUP-01');
  await L.issue(futurum.id, [], [{ id: screws.id, qty: 4 }]);
  await L.changeStock(screws.id, 5, 'add');

  const s = await L.snapshot();
  const holdings = L.reportHoldings(s);
  assert.deepEqual(holdings.map((h) => [h.teamName, h.itemId]).sort(),
    [['Архистра', 'AKKU18V-01'], ['Архистра', 'SHURUP-02'], ['Футурум', 'TSIRPIL-01']]);

  const inv = Object.fromEntries(L.reportInventory(s).map((r) => [r.typeId, r]));
  assert.equal(inv.TSIRPIL.total, 4);
  assert.equal(inv.TSIRPIL.inRoom, 3);
  assert.deepEqual(inv.TSIRPIL.outByTeam, { 'Футурум': 1 });
  assert.equal(inv.SHURUP.inRoom, 1);

  const teams = Object.fromEntries(L.reportTeams(s).map((r) => [r.teamName, r]));
  assert.equal(teams['Футурум'].onHands.length, 1);
  assert.deepEqual(teams['Футурум'].issuedByType, { 'Циркулярная пила': 1, 'Шуруповёрт': 1 });
  assert.equal(teams['Футурум'].returnedTotal, 1);
  assert.deepEqual(teams['Футурум'].consumables, { 'Саморезы 4×40': 6 });

  const cons = L.reportConsumables(s)[0];
  assert.equal(cons.consumed, 7);
  assert.equal(cons.received, 15);
  assert.equal(cons.stock, 8);
  assert.deepEqual(cons.byTeam, { 'Футурум': 6, 'Архистра': 1 });

  const csv = L.CSV.teams(s);
  assert.ok(csv.startsWith('﻿Команда;'));
  assert.match(csv, /Футурум;1;Циркулярная пила №1 \[TSIRPIL-01\]/);
  assert.match(L.CSV.operations(s), /Выдача;;Архистра/);
});

test('резервная копия: экспорт и восстановление', async () => {
  await L.issue(futurum.id, ['TSIRPIL-01']);
  const backup = JSON.parse(JSON.stringify(await L.exportAll()));
  await L.wipeAll();
  assert.equal((await L.snapshot()).items.length, 0);
  await L.importAll(backup);
  assert.equal((await db.getOne('items', 'TSIRPIL-01')).holderTeamId, futurum.id);
  await rejectsWith(L.importAll({ foo: 1 }), 'BAD_BACKUP');
});

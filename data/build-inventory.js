#!/usr/bin/env node
/* Собирает файл инвентаря из таблицы «Иинструменты*)» (Google Sheets, Лист1 + Лист2).
 * Результат — data/archbukhta-inventory.json: загружается в админке через
 * «Настройки → Восстановить из файла». Заменяет инструменты, расходники и журнал,
 * команды и настройки (PIN, лимиты) не трогает.
 *
 *   node data/build-inventory.js
 */
'use strict';
require('fake-indexeddb/auto');
const fs = require('fs');
const path = require('path');
const L = require('../app/js/logic.js');

// kind: battery — напоминание «поставьте на зарядку» при возврате.
// limit не указан — по умолчанию из настроек (2 для инструментов, 4 для аккумуляторов).
// Каждая строка units — одна физическая единица со своим QR.
const n = (count, label) => Array.from({ length: count }, (_, i) => ({ label: label + ' №' + (i + 1) }));

const INVENTORY = [
  // ---- Лист1: инструмент ----
  { code: 'SHUR', name: 'Шуруповёрт', units: [
    { label: 'Шуруповёрт К-400' }, { label: 'Шуруповёрт К-300' }, { label: 'Шуруповёрт К-302' },
    { label: 'Шуруповёрт (в кейсе)' }] },
  { code: 'DRSH', name: 'Дрель-шуруповёрт', units: [
    { label: 'Дрель-шуруповёрт К-222' }, { label: 'Дрель-шуруповёрт К-220' },
    { label: 'Дрель-шуруповёрт К-223' },
    { label: 'Дрель-шуруповёрт К-220 (2)', note: 'В таблице второй раз К-220, «не в своей коробке» — проверить номер' }] },
  { code: 'GAIK', name: 'Гайковёрт (импакт)', units: [{ label: 'Гайковёрт импакт К-305' }] },
  { code: 'LOBZ', name: 'Лобзик', units: [{ label: 'Лобзик К-304' }, { label: 'Лобзик К-211' }, { label: 'Лобзик К-203' }] },
  { code: 'SHLKV', name: 'Шлифмашинка квадратная', units: [{ label: 'Шлифмашинка квадрат К-306' }, { label: 'Шлифмашинка квадрат К-307' }] },
  { code: 'SHLKR', name: 'Шлифмашинка круглая', units: [
    { label: 'Шлифмашинка круглая К-218' }, { label: 'Шлифмашинка круглая К-216' },
    { label: 'Шлифмашинка круглая К-317' }, { label: 'Шлифмашинка круглая (без номера)' }] },
  { code: 'TSIRK', name: 'Циркулярка', units: [
    { label: 'Циркулярка большая (с коробкой)' }, { label: 'Циркулярка большая (без коробки)' },
    { label: 'Циркулярка с ручкой (с коробкой)' }] },
  { code: 'TORTS', name: 'Торцовка', units: [
    { label: 'Торцовка аккумуляторная бордовая', note: 'в комплекте 2 аккумулятора' },
    { label: 'Торцовка проводная красная', note: 'в таблице: «Удшеуср (красная)»' }] },
  { code: 'STEPL', name: 'Степлер', units: n(3, 'Степлер') },

  // ---- Лист1: зарядки и аккумуляторы ----
  { code: 'ZARNEW', name: 'Зарядка новая', units: n(6, 'Зарядка новая') },
  { code: 'ZAROLD', name: 'Зарядка старая', units: n(2, 'Зарядка старая') },
  { code: 'AKKOLD', name: 'Аккумулятор старый', kind: 'battery', units: n(13, 'Аккумулятор старый') },
  { code: 'AKKNEW', name: 'Аккумулятор новый', kind: 'battery', units: n(2, 'Аккумулятор новый') },

  // ---- Лист2: прочее оборудование ----
  { code: 'NOZH', name: 'Ножницы', units: n(10, 'Ножницы') },
  { code: 'DOSKB', name: 'Доска для резки большая', units: n(6, 'Доска для резки большая') },
  { code: 'DOSKM', name: 'Доска для резки маленькая', units: n(6, 'Доска для резки маленькая') },
  { code: 'OTV', name: 'Отвёртка', units: n(3, 'Отвёртка') },
  { code: 'PRINT', name: 'Принтер', units: [{ label: 'Принтер', note: 'количество в таблице не указано — взят 1' }] },
  { code: 'FLAG', name: 'Флаг', units: n(2, 'Флаг') },
  { code: 'FLAGSH', name: 'Флагшток', units: n(2, 'Флагшток') },
  { code: 'PAUK', name: 'Паук', units: n(2, 'Паук') },
  { code: 'KOLON', name: 'Колонка', units: [{ label: 'Колонка' }] },
  { code: 'TERMO', name: 'Термопод', units: [{ label: 'Термопод' }] },
  { code: 'NOUT', name: 'Ноутбук с зарядкой', units: [{ label: 'Ноутбук с зарядкой' }] },
  { code: 'RACIA', name: 'Рация', units: n(6, 'Рация') },
  { code: 'METLA', name: 'Метла', units: [{ label: 'Метла' }] },
  { code: 'STREM', name: 'Стремянка красная', units: n(2, 'Стремянка красная') }
  // Планшетки: в таблице количество «?» — не добавлены, добавьте в админке, когда посчитаете.
];

(async () => {
  for (const t of INVENTORY) {
    const type = await L.addToolType({ name: t.name, code: t.code, kind: t.kind || 'tool', limit: t.limit });
    if (type.id !== t.code) throw new Error('Код типа занят: ' + t.code);
    const items = await L.addItems(type.id, t.units.length);
    for (let i = 0; i < items.length; i++) {
      await L.updateItem(items[i].id, { label: t.units[i].label, note: t.units[i].note || '' });
    }
  }
  const backup = await L.exportAll();
  // только инвентарь: команды и настройки на ноутбуке остаются
  const data = {
    toolTypes: backup.data.toolTypes,
    items: backup.data.items,
    consumables: [],
    operations: backup.data.operations
  };
  const out = path.join(__dirname, 'archbukhta-inventory.json');
  fs.writeFileSync(out, JSON.stringify({ app: 'archbukhta-tools', format: 1, kind: 'inventory', exportedAt: Date.now(), data }, null, 1));
  console.log('Готово: ' + out);
  console.log('Типов: ' + data.toolTypes.length + ', единиц: ' + data.items.length);
})().catch((e) => { console.error(e); process.exit(1); });

#!/usr/bin/env node
/* Собирает файл инвентаря из таблицы «Иинструменты*)» (Google Sheets, Лист1).
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
  // Все инструменты штучные. Без номера в таблице — присвоен номер серии К-5xx (наклеить на инструмент).
  { code: 'SHUR', name: 'Шуруповёрт', units: [
    { label: 'Шуруповёрт К-400' }, { label: 'Шуруповёрт К-300' }, { label: 'Шуруповёрт К-302' },
    { label: 'Шуруповёрт К-501 (в кейсе)', note: 'номер присвоен, в таблице: «в кейсе»' }] },
  { code: 'DRSH', name: 'Шуруповёрт-дрель', units: [
    { label: 'Шуруповёрт-дрель К-220' }, { label: 'Шуруповёрт-дрель К-223' },
    { label: 'Шуруповёрт-дрель К-220 (2, не в своей коробке)', note: 'в таблице номер К-220 повторяется — проверить' }] },
  { code: 'DREL', name: 'Дрель', units: [{ label: 'Дрель К-222' }] },
  { code: 'GAIK', name: 'Гайковёрт (импакт)', units: [{ label: 'Гайковёрт импакт К-305' }] },
  { code: 'LOBZ', name: 'Лобзик', units: [{ label: 'Лобзик К-304' }, { label: 'Лобзик К-211' }, { label: 'Лобзик К-203' }] },
  { code: 'SHLKV', name: 'Шлифмашинка квадратная', units: [{ label: 'Шлифмашинка квадрат К-306' }, { label: 'Шлифмашинка квадрат К-307' }] },
  { code: 'SHLKR', name: 'Шлифмашинка круглая', units: [
    { label: 'Шлифмашинка круглая К-218' }, { label: 'Шлифмашинка круглая К-216' },
    { label: 'Шлифмашинка круглая К-317' },
    { label: 'Шлифмашинка круглая К-502', note: 'номер присвоен, в таблице без номера' }] },
  { code: 'TSIRK', name: 'Циркулярка', units: [
    { label: 'Циркулярка большая К-503 (с коробкой)', note: 'номер присвоен' },
    { label: 'Циркулярка большая К-504 (без коробки)', note: 'номер присвоен' },
    { label: 'Циркулярка с ручкой К-505 (с коробкой)', note: 'номер присвоен' }] },
  { code: 'TORTS', name: 'Торцовка', units: [
    { label: 'Торцовка аккумуляторная К-506 (бордовая)', note: 'номер присвоен; в комплекте 2 аккумулятора' },
    { label: 'Торцовка проводная К-507 (красная)', note: 'номер присвоен; в таблице: «Удшеуср (красная)»' }] },

  // Количественные позиции: каждая штука получает свой QR и номер по порядку.
  { code: 'ZARNEW', name: 'Зарядка новая', units: n(6, 'Зарядка новая') },
  { code: 'ZAROLD', name: 'Зарядка старая', units: n(2, 'Зарядка старая') },
  { code: 'AKKOLD', name: 'Аккумулятор старый', kind: 'battery', units: n(13, 'Аккумулятор старый') },
  { code: 'AKKNEW', name: 'Аккумулятор новый', kind: 'battery', units: n(2, 'Аккумулятор новый') },
  { code: 'STEPL', name: 'Степлер', units: n(3, 'Степлер') }
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

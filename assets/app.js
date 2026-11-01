/* Общие настройки и помощники для всех страниц сайта. */

/* ===== НАСТРОЙКИ МОНЕТИЗАЦИИ ===== */
const CONFIG = {
  // Рекламная сеть Яндекса (РСЯ). После одобрения сайта в partner.yandex.ru
  // впишите сюда ID блоков вида "R-A-1234567-1" и поставьте enabled: true.
  yandexAds: {
    enabled: false,
    blocks: {
      top: "",     // блок над калькулятором
      result: "",  // блок под результатом расчёта (самый доходный)
      bottom: "",  // блок внизу страницы
    },
  },
  // Партнёрские (CPA) ссылки: Admitad, Advcake, партнёрки банков и магазинов.
  // Пустой url — показывается заглушка.
  partners: {
    tile:      { text: "Купить плитку с доставкой", url: "", note: "Партнёрская ссылка на магазин стройматериалов" },
    wallpaper: { text: "Подобрать обои и клей", url: "", note: "Партнёрская ссылка на магазин стройматериалов" },
    laminate:  { text: "Ламинат и подложка со скидкой", url: "", note: "Партнёрская ссылка на магазин стройматериалов" },
    npd:       { text: "Банк для самозанятых: бесплатная карта и чеки", url: "", note: "Партнёрская программа банка" },
    usn:       { text: "Открыть счёт для ИП бесплатно", url: "", note: "Партнёрская программа банка или онлайн-бухгалтерии" },
    paint:     { text: "Краска и грунтовка с доставкой", url: "", note: "Партнёрская ссылка на магазин стройматериалов" },
    concrete:  { text: "Заказать бетон с завода", url: "", note: "Партнёрская ссылка на поставщика бетона" },
    plaster:   { text: "Штукатурка и маяки по выгодной цене", url: "", note: "Партнёрская ссылка на магазин стройматериалов" },
    ndfl:      { text: "Брокерский счёт / ИИС с налоговыми льготами", url: "", note: "Партнёрская программа брокера" },
    vacation:  { text: "Туры и отели со скидкой", url: "", note: "Партнёрская ссылка на сервис путешествий" },
    sick:      { text: "Онлайн-консультация врача", url: "", note: "Партнёрская ссылка на сервис телемедицины" },
    brick:     { text: "Кирпич с доставкой на объект", url: "", note: "Партнёрская ссылка на поставщика стройматериалов" },
    gasblock:  { text: "Газобетон от производителя", url: "", note: "Партнёрская ссылка на поставщика стройматериалов" },
    insulation:{ text: "Утеплитель по выгодной цене", url: "", note: "Партнёрская ссылка на магазин стройматериалов" },
    mortgage:  { text: "Подобрать ипотеку с низкой ставкой", url: "", note: "Партнёрская ссылка на сервис подбора ипотеки" },
    credit:    { text: "Сравнить кредиты в разных банках", url: "", note: "Партнёрская ссылка на финансовый маркетплейс" },
    deposit:   { text: "Вклады с самой высокой ставкой", url: "", note: "Партнёрская ссылка на финансовый маркетплейс" },
    alimony:   { text: "Консультация семейного юриста онлайн", url: "", note: "Партнёрская ссылка на юридический сервис" },
    property:  { text: "Ипотека: сравнить ставки банков", url: "", note: "Партнёрская ссылка на сервис подбора ипотеки" },
  },
};

/* ===== Реклама ===== */
function renderAds() {
  const slots = document.querySelectorAll("[data-ad]");
  const cfg = CONFIG.yandexAds;
  if (cfg.enabled) {
    window.yaContextCb = window.yaContextCb || [];
    const s = document.createElement("script");
    s.src = "https://yandex.ru/ads/system/context.js";
    s.async = true;
    document.head.appendChild(s);
  }
  slots.forEach((slot) => {
    const blockId = cfg.blocks[slot.dataset.ad];
    if (!cfg.enabled || !blockId) {
      slot.innerHTML = '<div class="ad-placeholder">Место для рекламного блока РСЯ (' + slot.dataset.ad + ")</div>";
      return;
    }
    const id = "yandex_rtb_" + blockId + "_" + slot.dataset.ad;
    slot.innerHTML = '<div id="' + id + '"></div>';
    window.yaContextCb.push(() => {
      Ya.Context.AdvManager.render({ blockId: blockId, renderTo: id });
    });
  });
}

/* ===== Партнёрские блоки ===== */
function renderPartners() {
  document.querySelectorAll("[data-partner]").forEach((el) => {
    const p = CONFIG.partners[el.dataset.partner];
    if (!p) return;
    const link = p.url
      ? '<a href="' + p.url + '" target="_blank" rel="sponsored noopener">' + p.text + " →</a>"
      : "<b>" + p.text + "</b> (здесь будет партнёрская ссылка)";
    el.innerHTML = '<div class="partner">' + link + "<small>" + p.note + "</small></div>";
  });
}

/* ===== Помощники для калькуляторов ===== */
function num(id) {
  const el = document.getElementById(id);
  if (!el) return 0;
  const v = parseFloat(String(el.value).replace(",", ".").replace(/\s/g, ""));
  return isFinite(v) ? v : 0;
}

function fmt(n, digits = 0) {
  return Number(n).toLocaleString("ru-RU", { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

function rub(n) {
  return fmt(Math.round(n)) + " ₽";
}

/* Пересчитывать при любом изменении полей формы. */
function autoCalc(formId, fn) {
  const form = document.getElementById(formId);
  if (!form) return;
  form.addEventListener("input", fn);
  form.addEventListener("change", fn);
  form.addEventListener("submit", (e) => { e.preventDefault(); fn(); });
  fn();
}

document.addEventListener("DOMContentLoaded", () => {
  renderAds();
  renderPartners();
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
});

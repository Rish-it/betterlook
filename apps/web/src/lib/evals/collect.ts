import {CHECKER_DIR} from '../sandbox/runtime-check';
import type {Expectation} from './checks';

export const HOOK_PATH = `${CHECKER_DIR}/eval-hook.mjs`;
export const HOOK_OUT = `${CHECKER_DIR}/eval-out.json`;
export const HOOK_SHOT = `${CHECKER_DIR}/eval-shot.png`;
export const PRESS_SELECTOR = 'button, [role="button"], input[type="button"], input[type="submit"]';

export interface HookJob {
  target: string | null;
  expect: Expectation[];
  screenshot: boolean;
}

// Runs inside the page. Plain JS so no bundler can inject helpers into code that is serialized into Chromium.
const COLLECT = String.raw`function collect(args) {
  var VISIBLE = function (el) { return el.checkVisibility ? el.checkVisibility({opacityProperty: true, visibilityProperty: true}) : true; };
  var FOLLOWING = Node.DOCUMENT_POSITION_FOLLOWING;
  var canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
  var ctx = canvas.getContext('2d', {willReadFrequently: true});
  function rgba(str) {
    ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = 'rgba(0, 0, 0, 0)'; ctx.fillStyle = str; ctx.fillRect(0, 0, 1, 1);
    var d = ctx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255];
  }
  var TOKEN = /(rgba?|oklch|oklab|lab|lch|hsla?|hwb|color)\([^()]*\)|#[0-9a-f]{3,8}\b/gi;
  function tokens(value) { return value && value !== 'none' ? (value.match(TOKEN) || []) : []; }
  function path(el) {
    var parts = [];
    for (var e = el; e && e.nodeType === 1 && parts.length < 4; e = e.parentElement) {
      var s = e.tagName.toLowerCase();
      if (e.dataset && e.dataset.section) s += '[data-section="' + e.dataset.section + '"]';
      else if (e.classList && e.classList.length) s += '.' + Array.prototype.slice.call(e.classList, 0, 2).join('.');
      parts.unshift(s);
      if (e.dataset && e.dataset.section) break;
    }
    return parts.join(' > ');
  }
  function ownText(el) {
    var t = '';
    for (var n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 3) t += n.data;
    return t.trim();
  }
  function box(el) { var r = el.getBoundingClientRect(); return {x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height}; }
  var SIDES = ['top', 'right', 'bottom', 'left'];
  function borders(cs, prefix) {
    return SIDES.map(function (side) {
      return {side: prefix + side, width: parseFloat(cs.getPropertyValue('border-' + side + '-width')) || 0, style: cs.getPropertyValue('border-' + side + '-style'), alpha: rgba(cs.getPropertyValue('border-' + side + '-color'))[3]};
    });
  }
  function visibleBorder(b) { return b.width > 0 && b.style !== 'none' && b.style !== 'hidden' && b.alpha > 0; }
  function colorsOf(el, cs, own, prefix) {
    var out = [];
    function add(prop, raw) { if (raw && raw !== 'none') out.push({prop: prefix + prop, raw: raw, rgba: rgba(raw)}); }
    if (own) {
      add('color', cs.color);
      if (cs.textDecorationLine && cs.textDecorationLine !== 'none') add('text-decoration-color', cs.textDecorationColor);
      tokens(cs.textShadow).forEach(function (t) { add('text-shadow', t); });
    }
    add('background-color', cs.backgroundColor);
    tokens(cs.backgroundImage).forEach(function (t) { add('background-image', t); });
    borders(cs, '').forEach(function (b) { if (visibleBorder(b)) add('border-' + b.side + '-color', cs.getPropertyValue('border-' + b.side + '-color')); });
    if (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) add('outline-color', cs.outlineColor);
    tokens(cs.boxShadow).forEach(function (t) { add('box-shadow', t); });
    if (el instanceof SVGElement) { if (cs.fill && cs.fill !== 'none' && cs.fill.indexOf('url(') < 0) add('fill', cs.fill); if (cs.stroke && cs.stroke !== 'none' && cs.stroke.indexOf('url(') < 0) add('stroke', cs.stroke); }
    return out;
  }
  function radius(value, w, h) {
    var first = (value || '0').split(' ')[0];
    var r = first.slice(-1) === '%' ? parseFloat(first) / 100 * Math.min(w, h) : parseFloat(first) || 0;
    return Math.min(r, w / 2, h / 2);
  }

  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  var all = Array.prototype.filter.call(document.querySelectorAll('*'), function (el) {
    return !/^(HEAD|SCRIPT|STYLE|NOSCRIPT|TEMPLATE|TITLE|META|LINK)$/.test(el.tagName) && !el.closest('head') && VISIBLE(el) && (el === document.documentElement || el === document.body || el.getClientRects().length > 0);
  });
  var INTERACTIVE = 'a[href], button, input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="link"], [tabindex]:not([tabindex="-1"])';
  var families = {};
  var elements = all.map(function (el) {
    var cs = getComputedStyle(el);
    var own = ownText(el);
    families[cs.fontFamily] = true;
    var item = {
      path: path(el), tag: el.tagName.toLowerCase(), text: own.slice(0, 80), box: box(el),
      colors: colorsOf(el, cs, !!own, ''), borders: borders(cs, ''),
      outline: {width: parseFloat(cs.outlineWidth) || 0, style: cs.outlineStyle, alpha: rgba(cs.outlineColor)[3]},
      boxShadow: cs.boxShadow, opacity: parseFloat(cs.opacity),
      heading: /^H[1-6]$/.test(el.tagName), body: /^(P|LI|BLOCKQUOTE|FIGCAPTION|DD|TD|TH)$/.test(el.tagName),
      wrapStyle: cs.textWrapStyle || cs.getPropertyValue('text-wrap-style') || cs.getPropertyValue('text-wrap') || '',
      fontSize: parseFloat(cs.fontSize), letterSpacing: cs.letterSpacing === 'normal' ? 0 : parseFloat(cs.letterSpacing),
      hasOwnText: !!own, interactive: el.matches(INTERACTIVE), iconOnly: el.matches(INTERACTIVE) && !(el.innerText || '').trim(),
    };
    ['::before', '::after'].forEach(function (pseudo) {
      var ps = getComputedStyle(el, pseudo);
      if (!ps.content || ps.content === 'none' || ps.content === 'normal') return;
      var text = ps.content !== '""' && ps.content !== "''";
      item.colors = item.colors.concat(colorsOf(el, ps, text, pseudo + ' '));
      item.borders = item.borders.concat(borders(ps, pseudo + ' '));
      if (ps.boxShadow !== 'none') item.boxShadow = item.boxShadow === 'none' ? ps.boxShadow : item.boxShadow + ', ' + ps.boxShadow;
    });
    return item;
  });

  var hero = document.querySelector('[data-section="hero"]');
  var heroInfo = {exists: !!hero, h1Count: 0, introTag: null, introLines: null, buttonTag: null, ordered: false};
  var heroH1 = null;
  if (hero) {
    var h1s = hero.querySelectorAll('h1');
    heroInfo.h1Count = h1s.length;
    heroH1 = h1s[0] || null;
    var intro = heroH1 && Array.prototype.find.call(hero.querySelectorAll('p'), function (p) { return (heroH1.compareDocumentPosition(p) & FOLLOWING) && !heroH1.contains(p); });
    var button = intro && Array.prototype.find.call(hero.querySelectorAll('button, [role="button"], a[href]'), function (b) { return (intro.compareDocumentPosition(b) & FOLLOWING) && !intro.contains(b); });
    if (intro) {
      heroInfo.introTag = 'p';
      var range = document.createRange(); range.selectNodeContents(intro);
      var lines = [];
      Array.prototype.forEach.call(range.getClientRects(), function (r) {
        if (!r.width || !r.height) return;
        var mid = r.top + r.height / 2;
        if (!lines.some(function (l) { return mid >= l.top && mid <= l.bottom; })) lines.push({top: r.top, bottom: r.bottom});
      });
      heroInfo.introLines = lines.length;
    }
    if (button) heroInfo.buttonTag = button.tagName.toLowerCase();
    heroInfo.ordered = !!(heroH1 && intro && button);
  }

  var texts = [];
  var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (var node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.data.trim()) continue;
    var parent = node.parentElement;
    if (!parent || /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|TITLE)$/.test(parent.tagName) || !VISIBLE(parent)) continue;
    var r = document.createRange(); r.selectNodeContents(node);
    if (!r.getClientRects().length) continue;
    var pcs = getComputedStyle(parent);
    texts.push({
      text: node.data, path: path(parent), family: pcs.fontFamily, parentDisplay: pcs.display, parentText: parent.textContent || '',
      inHeroH1: !!heroH1 && heroH1.contains(parent), hasDigits: /\d/.test(node.data), numeric: pcs.fontVariantNumeric, features: pcs.fontFeatureSettings,
    });
  }

  var surfaces = all.filter(function (el) {
    var cs = getComputedStyle(el);
    var rounded = ['borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomRightRadius', 'borderBottomLeftRadius'].some(function (k) { return parseFloat(cs[k]) > 0; });
    return rounded && (rgba(cs.backgroundColor)[3] > 0 || cs.boxShadow !== 'none' || cs.backgroundImage !== 'none');
  });
  var surfaceSet = new Set(surfaces);
  var nested = [];
  surfaces.forEach(function (inner) {
    var outer = inner.parentElement;
    while (outer && !surfaceSet.has(outer)) outer = outer.parentElement;
    if (!outer) return;
    var o = outer.getBoundingClientRect(), i = inner.getBoundingClientRect(), ocs = getComputedStyle(outer), ics = getComputedStyle(inner);
    var spec = [
      ['top-left', 'borderTopLeftRadius', i.left - o.left, i.top - o.top],
      ['top-right', 'borderTopRightRadius', o.right - i.right, i.top - o.top],
      ['bottom-right', 'borderBottomRightRadius', o.right - i.right, o.bottom - i.bottom],
      ['bottom-left', 'borderBottomLeftRadius', i.left - o.left, o.bottom - i.bottom],
    ];
    nested.push({outer: path(outer), inner: path(inner), corners: spec.map(function (c) {
      return {corner: c[0], outerRadius: radius(ocs[c[1]], o.width, o.height), innerRadius: radius(ics[c[1]], i.width, i.height), insetX: c[2], insetY: c[3]};
    })});
  });

  var NAMES = {'geist sans': 'Geist Sans', 'geist mono': 'Geist Mono', 'geist pixel square': 'Geist Pixel Square'};
  var fontChecks = {};
  Object.keys(NAMES).forEach(function (k) { fontChecks[k] = document.fonts.check('16px "' + NAMES[k] + '"', 'Betterlook API 0123'); });
  var faces = []; document.fonts.forEach(function (f) { faces.push({family: f.family, status: f.status}); families[f.family] = true; });
  var htmlCs = getComputedStyle(document.documentElement);
  var target = args.target ? document.querySelector(args.target) : null;
  var presses = Array.prototype.map.call(document.querySelectorAll(args.press), function (el, i) { return VISIBLE(el) && el.getClientRects().length ? {index: i, path: path(el)} : null; }).filter(Boolean);
  return {
    rendered: !!document.body && document.body.children.length > 0,
    hero: heroInfo, texts: texts, faces: faces, fontChecks: fontChecks, declaredFamilies: Object.keys(families), elements: elements,
    hrCount: Array.prototype.filter.call(document.querySelectorAll('hr'), function (hr) { return VISIBLE(hr) && hr.getClientRects().length; }).length,
    html: {background: rgba(htmlCs.backgroundColor), backgroundImage: htmlCs.backgroundImage, fontSmoothing: htmlCs.webkitFontSmoothing || htmlCs.getPropertyValue('-webkit-font-smoothing')},
    nested: nested, targetBox: target ? box(target) : null, pressIndexes: presses,
    pageText: (document.body ? document.body.innerText : '') + '\n' + document.documentElement.outerHTML + '\n' + all.map(function (el) { return getComputedStyle(el, '::before').content + getComputedStyle(el, '::after').content; }).join('\n'),
  };
}`;

// Runs inside the page after collection; clicks may change the page, so expectations go last.
const EXPECT = String.raw`async function expectAll(list) {
  function text(el) { return (el.textContent || '').replace(/\s+/g, ' ').trim(); }
  async function one(e) {
    var el;
    try { el = e.selector ? document.querySelector(e.selector) : null; } catch (err) { return {expect: e, ok: null, actual: 'invalid selector'}; }
    switch (e.type) {
      case 'text': {
        if (!el) return {expect: e, ok: false, actual: 'no element'};
        var t = text(el);
        var ok = e.equals !== undefined ? t === e.equals : e.contains !== undefined ? t.indexOf(e.contains) >= 0 : new RegExp(e.matches).test(t);
        return {expect: e, ok: ok, actual: JSON.stringify(t.slice(0, 120))};
      }
      case 'count': {
        var n = document.querySelectorAll(e.selector).length;
        return {expect: e, ok: e.equals !== undefined ? n === e.equals : n >= e.min, actual: String(n)};
      }
      case 'visible': {
        if (!el) return {expect: e, ok: false, actual: 'no element'};
        var r = el.getBoundingClientRect();
        var v = (!el.checkVisibility || el.checkVisibility({opacityProperty: true, visibilityProperty: true})) && r.width > 0 && r.height > 0;
        return {expect: e, ok: v, actual: v ? 'visible' : 'hidden'};
      }
      case 'order': {
        var els = [];
        try { els = e.selectors.map(function (s) { return document.querySelector(s); }); } catch (err) { return {expect: e, ok: null, actual: 'invalid selector'}; }
        var missing = e.selectors.filter(function (s, i) { return !els[i]; });
        if (missing.length) return {expect: e, ok: false, actual: 'missing ' + missing.join(', ')};
        var ordered = els.every(function (x, i) { return i === 0 || (els[i - 1].compareDocumentPosition(x) & Node.DOCUMENT_POSITION_FOLLOWING); });
        return {expect: e, ok: !!ordered, actual: ordered ? 'in order' : 'out of order'};
      }
      case 'style': {
        if (!el) return {expect: e, ok: false, actual: 'no element'};
        var value = getComputedStyle(el).getPropertyValue(e.property).trim();
        var num = parseFloat(value);
        var good = (e.equals === undefined || value === e.equals) && (e.min === undefined || num >= e.min) && (e.max === undefined || num <= e.max);
        if ((e.min !== undefined || e.max !== undefined) && isNaN(num)) return {expect: e, ok: null, actual: value};
        return {expect: e, ok: good, actual: value};
      }
      case 'click': {
        if (!el) return {expect: e, ok: false, actual: 'no element'};
        el.click();
        await new Promise(function (r) { setTimeout(r, 300); });
        var results = [];
        for (var i = 0; i < e.then.length; i++) results.push(await one(e.then[i]));
        var bad = results.find(function (x) { return x.ok === false; });
        var unknown = results.find(function (x) { return x.ok !== true; });
        return {expect: e, ok: bad ? false : unknown ? null : true, actual: results.map(function (x) { return x.actual; }).join('; ')};
      }
    }
    return {expect: e, ok: null, actual: 'unsupported'};
  }
  var out = [];
  for (var i = 0; i < list.length; i++) out.push(await one(list[i]));
  return out;
}`;

// The sandbox checker imports this module and passes it the page it already loaded (verify's browser session).
export function hookModule(job: HookJob) {
  return `import {writeFileSync} from 'node:fs';
const JOB = ${JSON.stringify(job)};
const COLLECT = ${JSON.stringify(COLLECT)};
const EXPECT = ${JSON.stringify(EXPECT)};
const PRESS = ${JSON.stringify(PRESS_SELECTOR)};
const OUT = ${JSON.stringify(HOOK_OUT)};
const SHOT = ${JSON.stringify(HOOK_SHOT)};

const style = el => {
  const cs = getComputedStyle(el);
  const color = cs.outlineColor.match(/[\\d.]+/g) || [];
  return {transform: cs.transform, transitionProperty: cs.transitionProperty, transitionDuration: cs.transitionDuration,
    outline: {width: parseFloat(cs.outlineWidth) || 0, style: cs.outlineStyle, alpha: color.length > 3 ? Number(color[3]) : 1}};
};
const scaleOf = t => {
  if (!t || t === 'none') return 1;
  const m = t.match(/matrix\\(([^)]+)\\)/);
  if (!m) return null;
  const [a, b] = m[1].split(',').map(Number);
  return Math.hypot(a, b);
};

export default async function (page) {
  const started = Date.now();
  try {
    await page.emulateMedia({colorScheme: 'light', reducedMotion: 'no-preference'});
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    await page.mouse.move(0, 0);
    const snapshot = await page.evaluate('(' + COLLECT + ')(' + JSON.stringify({target: JOB.target, press: PRESS}) + ')');
    if (JOB.screenshot && !/blk_[a-f0-9]{32}/i.test(snapshot.pageText)) await page.screenshot({path: SHOT, fullPage: true, animations: 'disabled', caret: 'hide', scale: 'css'});
    const presses = [];
    for (const {index, path} of snapshot.pressIndexes) {
      const el = page.locator(PRESS).nth(index);
      await el.scrollIntoViewIfNeeded().catch(() => {});
      const box = await el.boundingBox();
      const rest = await el.evaluate(style);
      let pressed = null;
      if (box) {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.waitForTimeout(250);
        pressed = await el.evaluate(style);
        await page.mouse.move(0, 0);
        await page.mouse.up();
      }
      presses.push({index, path, rest, pressed});
    }
    await page.emulateMedia({reducedMotion: 'reduce'});
    for (const p of presses) p.reduced = await page.locator(PRESS).nth(p.index).evaluate(style);
    await page.emulateMedia({reducedMotion: 'no-preference'});
    await page.evaluate(() => window.scrollTo(0, 0));
    snapshot.presses = presses.map(p => ({
      path: p.path,
      scale: p.pressed ? scaleOf(p.pressed.transform) : null,
      transitionProperty: p.rest.transitionProperty, transitionDuration: p.rest.transitionDuration,
      reducedProperty: p.reduced.transitionProperty, reducedDuration: p.reduced.transitionDuration,
      pressedOutline: p.pressed ? p.pressed.outline : {width: 0, style: 'none', alpha: 0},
    }));
    snapshot.expectations = JOB.expect.length ? await page.evaluate('(' + EXPECT + ')(' + JSON.stringify(JOB.expect) + ')') : [];
    delete snapshot.pressIndexes;
    snapshot.collectMs = Date.now() - started;
    writeFileSync(OUT, JSON.stringify(snapshot));
  } catch (error) {
    writeFileSync(OUT, JSON.stringify({error: String(error && error.message || error).slice(0, 500), collectMs: Date.now() - started}));
  }
}
`;
}

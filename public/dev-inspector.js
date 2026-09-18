/*
 * dev-inspector — UI 피드백용 요소 좌표 집게 (dev 전용)
 *
 * 왜: "사이드바 카드 리스트"처럼 위치로 서술하거나 class 를 뒤지는 건 유일하지 않아
 * 클로드가 어느 요소인지 못 집는다. 이 도구는 클릭한 요소의 "소스 좌표(파일:줄)"를
 * 복사해준다 → 그대로 붙여넣으면 클로드가 grep 없이 그 소스로 단번에 착지.
 *
 * 동작:
 *   - 기본 OFF. 앱에 아무 영향 없음.
 *   - ⌥⇧D (Alt+Shift+D) 로 픽 모드 토글. ESC 로 종료.
 *   - 픽 모드: 마우스 올린 요소에 아웃라인 + 좌하단 HUD.
 *   - HUD 는 사람용 → 📍 파일:줄 + 태그·클래스 계층(nav › ul.list › li:3 › div.card).
 *   - 클릭 = 파일:줄 을 클립보드에 복사(앱 동작은 가로채 막음). 픽 모드 유지 → 연달아 집기.
 *
 * 좌표 출처: 빌드타임 Babel 플러그인(vite.config.ts jsxLocBabel)이 각 요소에 박은
 * data-loc="파일:줄". 클릭 요소에 없으면 가장 가까운 [data-loc] 조상 것으로 폴백,
 * 그것도 없으면(회사빌드 등) DOM 경로를 복사.
 *
 * 격리: 오버레이는 Shadow DOM 안에 그려 앱 CSS·z-index·툴팁과 안 부딪힌다.
 */
(function () {
  'use strict'
  if (window.__devInspector) return
  window.__devInspector = true

  // ── 오버레이 레이어 (Shadow DOM 격리) ─────────────────────────
  var host = document.createElement('div')
  host.id = '__dev-inspector-host'
  host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none'
  var shadow = host.attachShadow({ mode: 'open' })
  shadow.innerHTML =
    '<style>' +
    '  .box{position:fixed;pointer-events:none;border:1.5px solid #aa3bff;' +
    '       background:rgba(170,59,255,.08);border-radius:3px;display:none;' +
    '       transition:all .04s ease-out}' +
    '  .hud{position:fixed;left:12px;bottom:12px;max-width:min(74vw,680px);' +
    '       font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;' +
    '       color:#fff;background:rgba(20,20,24,.94);padding:9px 12px;' +
    '       border-radius:9px;box-shadow:0 6px 24px rgba(0,0,0,.4);' +
    '       pointer-events:none;display:none;white-space:pre-wrap;word-break:break-all}' +
    '  .hud .loc{font-weight:600;font-size:12.5px}' +
    '  .hud .loc.miss{color:#ffb454}' +
    '  .hud .tree{color:#d9a6ff;margin-top:3px}' +
    '  .hud .hint{color:#8a8a92;font-size:11px;margin-top:4px}' +
    '  .toast{position:fixed;left:50%;top:16px;transform:translateX(-50%);' +
    '       font:12px/1 ui-sans-serif,system-ui;color:#fff;background:#1f9d55;' +
    '       padding:8px 14px;border-radius:999px;box-shadow:0 6px 24px rgba(0,0,0,.35);' +
    '       pointer-events:none;opacity:0;transition:opacity .15s;max-width:80vw;' +
    '       overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '</style>' +
    '<div class="box"></div><div class="hud"></div><div class="toast"></div>'
  ;(document.body || document.documentElement).appendChild(host)
  var box = shadow.querySelector('.box')
  var hud = shadow.querySelector('.hud')
  var toast = shadow.querySelector('.toast')

  var active = false
  var current = null
  var toastTimer = null

  // ── 좌표 / 태그계층 계산 ──────────────────────────────────
  function segOf(el) {
    var s = el.tagName.toLowerCase()
    if (el.id) return s + '#' + el.id
    var cls = (el.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean)[0]
    if (cls) s += '.' + cls
    var i = 1, sib = el
    while ((sib = sib.previousElementSibling)) if (sib.tagName === el.tagName) i++
    var same = el.parentElement
      ? Array.prototype.filter.call(el.parentElement.children, function (c) { return c.tagName === el.tagName }).length
      : 1
    if (same > 1) s += ':' + i
    return s
  }
  function treeOf(el, depth) {
    var parts = [], cur = el, n = depth || 4
    while (cur && cur !== document.body && cur.nodeType === 1 && parts.length < n) {
      parts.unshift(segOf(cur)); cur = cur.parentElement
    }
    return parts.join(' › ')
  }
  function locOf(el) {
    var a = el && el.closest ? el.closest('[data-loc]') : null
    return a ? a.getAttribute('data-loc') : null
  }
  // 클릭 시 복사할 문자열: 소스 좌표 우선, 없으면 DOM 경로
  function copyTargetOf(el) {
    return locOf(el) || treeOf(el, 6)
  }

  // ── 픽 모드 ───────────────────────────────────────────────
  function onMove(e) {
    var el = document.elementFromPoint(e.clientX, e.clientY)
    if (!el || el === host) return
    current = el
    var r = el.getBoundingClientRect()
    box.style.display = 'block'
    box.style.left = r.left + 'px'; box.style.top = r.top + 'px'
    box.style.width = r.width + 'px'; box.style.height = r.height + 'px'
    var loc = locOf(el)
    hud.style.display = 'block'
    hud.innerHTML =
      '<div class="loc' + (loc ? '' : ' miss') + '">' +
      (loc ? '📍 ' + escapeHtml(loc) : '⚠ 소스 좌표 없음 — DOM 경로 복사됨') + '</div>' +
      '<div class="tree">' + escapeHtml(treeOf(el, 4)) + '</div>' +
      '<div class="hint">클릭=복사 · ESC=종료</div>'
  }
  function onClick(e) {
    if (!active) return
    e.preventDefault(); e.stopPropagation()
    copy(copyTargetOf(current || e.target))
    return false
  }
  function onKey(e) {
    if (e.altKey && e.shiftKey && (e.code === 'KeyD' || e.key === 'D' || e.key === 'd' || e.key === 'Δ')) {
      e.preventDefault(); active ? stop() : start(); return
    }
    if (active && e.key === 'Escape') { e.preventDefault(); stop() }
  }
  function start() {
    active = true
    document.addEventListener('mousemove', onMove, true)
    document.addEventListener('click', onClick, true)
    document.body.style.cursor = 'crosshair'
    showToast('픽 모드 ON — 요소 클릭해 좌표 복사', '#0071e3')
  }
  function stop() {
    active = false
    document.removeEventListener('mousemove', onMove, true)
    document.removeEventListener('click', onClick, true)
    document.body.style.cursor = ''
    box.style.display = 'none'; hud.style.display = 'none'
  }

  // ── 유틸 ──────────────────────────────────────────────────
  function copy(text) {
    var done = function () { showToast('복사됨: ' + text) }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text); done() })
    } else { fallbackCopy(text); done() }
  }
  function fallbackCopy(text) {
    var ta = document.createElement('textarea')
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'
    document.body.appendChild(ta); ta.select()
    try { document.execCommand('copy') } catch (e) {}
    document.body.removeChild(ta)
  }
  function showToast(msg, color) {
    toast.textContent = msg
    toast.style.background = color || '#1f9d55'
    toast.style.opacity = '1'
    clearTimeout(toastTimer)
    toastTimer = setTimeout(function () { toast.style.opacity = '0' }, 1800)
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] })
  }

  document.addEventListener('keydown', onKey, true)
  console.info('%c[dev-inspector]%c ⌥⇧D 로 픽 모드 — 요소 클릭하면 파일:줄 복사',
    'color:#aa3bff;font-weight:bold', 'color:inherit')
})()

// 自动朗读 · 网页半边
// 1) 轮询宿主 /api/latest，有新语音就排队播放
// 2) 设置页：音色 / 语速 / 音调 / 自动开关 / 试听
window.__ModuleLoader__.load({
  id: 'dsh-speak-her',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    const React = require('react')
    const inject = ['slots']
    const B = '/dsh-speak-her'
    const h = React.createElement

    const get = (p) => fetch(B + p, { cache: 'no-store' }).then((r) => r.json())
    const post = (p, body) =>
      fetch(B + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) })
        .then((r) => r.json())

    const CSS =
      '.sh-row{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:10px 0;border-bottom:.5px solid var(--dsw-alias-border-l2)}' +
      '.sh-row:last-child{border-bottom:none}' +
      '.sh-label{font-size:13px;line-height:19px}' +
      '.sh-hint{color:var(--dsw-alias-label-tertiary);font-size:11.5px;margin-top:3px}' +
      '.sh-input,.sh-select{background:transparent;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;color:var(--dsw-alias-label-primary);font-size:12.5px;height:30px;padding:0 8px;min-width:140px;outline:none}' +
      '.sh-btn{background:var(--dsw-alias-brand-primary);color:#fff;border:none;border-radius:6px;font-size:12.5px;height:30px;padding:0 12px;cursor:pointer;margin-left:8px}' +
      '.sh-btn2{background:transparent;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary)}' +
      '.sh-msg{font-size:12px;color:var(--dsw-alias-label-tertiary);margin-top:8px}'

    function useStyleOnce() {
      React.useEffect(() => {
        if (typeof document === 'undefined') return
        if (document.getElementById('sh-style')) return
        const el = document.createElement('style')
        el.id = 'sh-style'
        el.textContent = CSS
        document.head.appendChild(el)
      }, [])
    }

    // ── 自动播放：轮询宿主，有新条目就排队 ──────────────────────────────
    const player = {
      lastSeq: 0,
      queue: [],
      busy: false,
      unlocked: false,
      audio: null,
    }
    function stopAll() {
      try {
        if (player.audio) { player.audio.pause(); player.audio.currentTime = 0 }
      } catch { /* ignore */ }
      player.audio = null
      player.queue = []
      player.busy = false
    }
    function unlock() {
      if (player.unlocked) return
      try {
        const a = new Audio('data:audio/mp3;base64,//uQxAAAAAAAA')
        a.volume = 0
        a.play().then(() => { player.unlocked = true }).catch(() => {})
      } catch { /* ignore */ }
    }
    function playNext() {
      if (player.busy) return
      const item = player.queue.shift()
      if (!item) return
      player.busy = true
      const a = new Audio(item.url)
      player.audio = a
      a.onended = () => { player.busy = false; player.audio = null; playNext() }
      a.onerror = () => { player.busy = false; player.audio = null; playNext() }
      a.play().catch(() => { player.busy = false; player.audio = null })
    }
    async function poll() {
      try {
        const r = await get('/api/latest?since=' + player.lastSeq)
        if (r && r.ok && Array.isArray(r.items) && r.items.length) {
          for (const it of r.items) {
            player.lastSeq = Math.max(player.lastSeq, Number(it.seq) || 0)
            player.queue.push(it)
          }
          playNext()
        }
      } catch { /* 宿主没起来就下一轮再试 */ }
    }

    function SettingsPage() {
      useStyleOnce()
      const [s, setS] = React.useState(null)
      const [voices, setVoices] = React.useState([])
      const [sessions, setSessions] = React.useState([])
      const [msg, setMsg] = React.useState('')
      React.useEffect(() => {
        get('/api/settings').then((r) => { if (r && r.ok) setS(r.settings) }).catch(() => {})
        get('/api/voices').then((r) => { if (r && r.ok) setVoices(r.voices || []) }).catch(() => {})
        get('/api/sessions').then((r) => { if (r && r.ok) setSessions(r.sessions || []) }).catch(() => {})
      }, [])
      const save = async (patch) => {
        const next = { ...(s || {}), ...patch }
        setS(next)
        const r = await post('/api/settings', patch)
        setMsg(r && r.ok ? '已保存，下一句生效' : '保存失败：' + (r && r.error))
      }
      const test = async () => {
        setMsg('合成中…')
        const r = await post('/api/test', {})
        if (r && r.ok) { new Audio(r.url).play(); setMsg('已播放试听') }
        else setMsg('失败：' + (r && r.error))
      }
      const watchOf = (cfg) => (Array.isArray(cfg.watch) ? cfg.watch.map(String) : [])
      const toggleWatch = (id, on) => {
        const cur = new Set(watchOf(s))
        if (on) cur.add(String(id)); else cur.delete(String(id))
        save({ watch: [...cur] })
      }
      if (!s) return h('div', { style: { padding: 20, fontSize: 13 } }, '读取设置中…')
      const row = (label, hint, control) =>
        h('div', { className: 'sh-row' },
          h('div', null,
            h('div', { className: 'sh-label' }, label),
            hint ? h('div', { className: 'sh-hint' }, hint) : null),
          control)
      return h('div', { style: { padding: '4px 0 20px' } },
        h('div', { style: { fontSize: 15, fontWeight: 600, marginBottom: 6 } }, '自动朗读'),
        h('div', { className: 'sh-hint', style: { marginBottom: 12 } }, '她说完一整轮，就用下面这个音色念出来。'),
        row('自动朗读', '关掉 = 只保留试听按钮', h('input', {
          type: 'checkbox', checked: s.auto !== false,
          onChange: (e) => save({ auto: e.target.checked }),
        })),
        row('暂停朗读', '临时闭嘴：不合成、不排队，恢复后从下一轮继续',
          h('input', {
            type: 'checkbox', checked: s.paused === true,
            onChange: async (e) => {
              const paused = e.target.checked
              setS({ ...s, paused })
              if (paused) stopAll()
              await post('/api/pause', { paused })
              setMsg(paused ? '已暂停' : '已恢复')
            },
          })),
        row('停止当前', '立刻停掉正在念的这段，并清空排队',
          h('button', {
            className: 'sh-btn sh-btn2',
            onClick: () => { stopAll(); setMsg('已停止') },
          }, '停止')),
        row('音色', 'edge-tts 的中文神经语音；默认 Xiaoyi（少女音）',
          h('select', {
            className: 'sh-select', value: s.voice,
            onChange: (e) => save({ voice: e.target.value }),
            style: { maxWidth: 320 },
          },
          voices.length
            ? voices.map((v) => h('option', { key: v.name, value: v.name }, v.name + (v.desc ? ' · ' + v.desc : '')))
            : h('option', { value: s.voice }, s.voice))),
        row('语速', '例：-8%（慢） / +0%（正常） / +10%（快）', h('input', {
          className: 'sh-input', value: s.rate, onChange: (e) => setS({ ...s, rate: e.target.value }),
          onBlur: (e) => save({ rate: e.target.value }),
        })),
        row('音调', '例：+10Hz（略高） / +0Hz（原始）', h('input', {
          className: 'sh-input', value: s.pitch, onChange: (e) => setS({ ...s, pitch: e.target.value }),
          onBlur: (e) => save({ pitch: e.target.value }),
        })),
        row('单句上限（字）', '太长的回复会被截断，避免一次念太久', h('input', {
          className: 'sh-input', value: String(s.maxChars ?? 500),
          onChange: (e) => setS({ ...s, maxChars: Number(e.target.value) || 500 }),
          onBlur: (e) => save({ maxChars: Number(e.target.value) || 500 }),
        })),
        row('朗读哪些会话', '一个都不勾 = 全部会话；勾了就只念选中的',
          h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 180, overflowY: 'auto', minWidth: 220 } },
            sessions.length
              ? sessions.map((x) => h('label', { key: x.id, style: { fontSize: 12.5, display: 'flex', gap: 6, alignItems: 'center' } },
                h('input', {
                  type: 'checkbox',
                  checked: watchOf(s).includes(String(x.id)),
                  onChange: (e) => toggleWatch(x.id, e.target.checked),
                }),
                (x.title || x.id.slice(0, 8))))
              : h('span', { className: 'sh-hint' }, '没有可选的会话'))),
        row('Python 路径', '跑 edge-tts 用的解释器；留空 = PATH 里的 python', h('input', {
          className: 'sh-input', value: s.python || '', placeholder: 'python',
          onChange: (e) => setS({ ...s, python: e.target.value }),
          onBlur: (e) => save({ python: e.target.value }),
        })),
        h('div', { style: { marginTop: 14, display: 'flex', alignItems: 'center' } },
          h('button', { className: 'sh-btn', onClick: test }, '试听'),
          h('button', { className: 'sh-btn sh-btn2', onClick: () => { unlock(); setMsg('已尝试解锁浏览器自动播放') } }, '解锁自动播放'),
          h('span', { className: 'sh-msg' }, msg)),
        h('div', { className: 'sh-hint', style: { marginTop: 12 } },
          '提示：浏览器通常要求先有一次点击才允许自动出声。点一下「解锁自动播放」，或在页面里随便点一次即可。'),
      )
    }

    // ── 右下角小窗：不用进设置页也能停 / 选会话 ──────────────────────────
    function mountMiniPanel() {
      if (typeof document === 'undefined') return
      if (document.getElementById('sh-fab')) return

      const wrap = document.createElement('div')
      wrap.id = 'sh-fab'
      wrap.style.cssText = [
        'position:fixed', 'right:22px', 'bottom:92px', 'z-index:2147483000',
        'font-family:system-ui,-apple-system,"Segoe UI",sans-serif',
      ].join(';')

      const btn = document.createElement('button')
      btn.type = 'button'
      btn.title = '朗读小窗'
      btn.textContent = '🔊'
      btn.style.cssText = [
        'width:42px', 'height:42px', 'border-radius:999px', 'border:none', 'cursor:pointer',
        'background:#111827', 'color:#fff', 'font-size:18px', 'line-height:42px', 'text-align:center',
        'box-shadow:0 6px 18px rgba(0,0,0,.28)', 'opacity:.92',
      ].join(';')

      const panel = document.createElement('div')
      panel.style.cssText = [
        'display:none', 'position:absolute', 'right:0', 'bottom:54px', 'width:270px',
        'max-height:60vh', 'overflow:auto', 'background:#111827', 'color:#e5e7eb',
        'border:1px solid rgba(255,255,255,.12)', 'border-radius:12px', 'padding:12px',
        'box-shadow:0 12px 32px rgba(0,0,0,.4)', 'font-size:12.5px',
      ].join(';')

      const title = document.createElement('div')
      title.textContent = '朗读'
      title.style.cssText = 'font-weight:600;font-size:13px;margin-bottom:8px'
      panel.appendChild(title)

      const mkRow = (label) => {
        const row = document.createElement('label')
        row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:5px 0;cursor:pointer'
        const span = document.createElement('span')
        span.textContent = label
        return { row, span }
      }

      // 暂停开关
      const pauseBox = document.createElement('input')
      pauseBox.type = 'checkbox'
      const pauseRow = mkRow('暂停朗读')
      pauseRow.row.prepend(pauseBox)
      pauseRow.row.appendChild(pauseRow.span)
      panel.appendChild(pauseRow.row)

      // 停止按钮
      const stopBtn = document.createElement('button')
      stopBtn.type = 'button'
      stopBtn.textContent = '停止当前'
      stopBtn.style.cssText = 'width:100%;margin:6px 0 10px;height:30px;border-radius:8px;border:1px solid rgba(255,255,255,.18);background:transparent;color:#e5e7eb;cursor:pointer;font-size:12.5px'
      stopBtn.onclick = () => { stopAll(); stopBtn.textContent = '已停止' ; setTimeout(() => { stopBtn.textContent = '停止当前' }, 1200) }
      panel.appendChild(stopBtn)

      // 会话列表
      const sessTitle = document.createElement('div')
      sessTitle.textContent = '朗读哪些会话（不勾 = 全部）'
      sessTitle.style.cssText = 'color:#9ca3af;font-size:11.5px;margin:2px 0 6px'
      panel.appendChild(sessTitle)
      const sessBox = document.createElement('div')
      sessBox.style.cssText = 'display:flex;flex-direction:column;gap:4px;max-height:180px;overflow:auto'
      panel.appendChild(sessBox)

      const hint = document.createElement('div')
      hint.textContent = '更多设置：设置 → 自动朗读'
      hint.style.cssText = 'color:#6b7280;font-size:11px;margin-top:10px'
      panel.appendChild(hint)

      wrap.appendChild(btn)
      wrap.appendChild(panel)
      document.body.appendChild(wrap)

      let cfg = { paused: false, watch: [] }
      const refresh = async () => {
        try {
          const r = await get('/api/settings')
          if (r && r.ok) { cfg = r.settings; pauseBox.checked = cfg.paused === true }
        } catch { /* ignore */ }
        try {
          const r = await get('/api/sessions')
          const list = (r && r.ok && r.sessions) || []
          const watch = Array.isArray(cfg.watch) ? cfg.watch.map(String) : []
          sessBox.textContent = ''
          if (!list.length) {
            const empty = document.createElement('div')
            empty.textContent = '没有会话'
            empty.style.color = '#6b7280'
            sessBox.appendChild(empty)
          }
          for (const x of list) {
            const { row } = mkRow(x.title || String(x.id).slice(0, 8))
            const cb = document.createElement('input')
            cb.type = 'checkbox'
            cb.checked = watch.includes(String(x.id))
            cb.onchange = async () => {
              const cur = new Set(Array.isArray(cfg.watch) ? cfg.watch.map(String) : [])
              if (cb.checked) cur.add(String(x.id)); else cur.delete(String(x.id))
              cfg.watch = [...cur]
              await post('/api/settings', { watch: cfg.watch })
            }
            row.prepend(cb)
            sessBox.appendChild(row)
          }
        } catch { /* ignore */ }
      }

      pauseBox.onchange = async () => {
        cfg.paused = pauseBox.checked
        if (cfg.paused) stopAll()
        try { await post('/api/pause', { paused: cfg.paused }) } catch { /* ignore */ }
        btn.textContent = cfg.paused ? '🔇' : '🔊'
      }

      btn.onclick = () => {
        const open = panel.style.display === 'block'
        panel.style.display = open ? 'none' : 'block'
        if (!open) refresh()
      }
    }

    function apply(ctx) {
      const slots = ctx.get('slots')
      if (slots === undefined) return
      slots.inject('settings.section', () =>
        slots.register({ name: 'settings.section', id: 'speak-her', order: 62, label: '自动朗读' }, SettingsPage),
      )
      // 右下角小窗（停止 / 暂停 / 选会话），不依赖设置页
      try { mountMiniPanel() } catch { /* ignore */ }
      // 页面加载就开始轮询；用户点过任意位置后解锁自动播放
      try {
        document.addEventListener('click', unlock, { once: true })
      } catch { /* ignore */ }
      setInterval(() => { poll() }, 1500)
      setTimeout(() => { poll() }, 800)
    }

    exports.inject = inject
    exports.apply = apply
    return module.exports
  },
})

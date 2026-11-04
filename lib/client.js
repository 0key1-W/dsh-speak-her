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
      inFlight: false,     // ① 轮询在途防抖
      seen: new Set(),     // 已入队过的 seq（同一 seq 不会进两次）
    }

    // ② 刷新后接着念，而不是从 0 重放
    const LS_SEQ = 'dsh-speak-her:lastSeq'
    const readSeq = () => {
      try { const v = Number(localStorage.getItem(LS_SEQ)); return Number.isFinite(v) && v > 0 ? v : 0 } catch { return 0 }
    }
    const saveSeq = (n) => { try { localStorage.setItem(LS_SEQ, String(n)) } catch { /* ignore */ } }

    // ④ 跨标签单播锁：多开标签时只让一个念，否则就是双重回声
    const TAB_ID = Math.random().toString(36).slice(2)
    const LOCK_KEY = 'dsh-speak-her:leader'
    const readLock = () => { try { return JSON.parse(localStorage.getItem(LOCK_KEY) || 'null') } catch { return null } }
    const writeLock = () => { try { localStorage.setItem(LOCK_KEY, JSON.stringify({ id: TAB_ID, ts: Date.now() })) } catch { /* ignore */ } }
    function isLeader() {
      const l = readLock()
      if (!l || l.id === TAB_ID || Date.now() - Number(l.ts || 0) > 6000) {
        writeLock()
        return true
      }
      return false
    }

    player.lastSeq = readSeq()
    const STALE_MS = 30000   // ③ 超过 30 秒的条目视为陈旧，不播

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
      if (player.inFlight) return
      player.inFlight = true
      try {
        const r = await get('/api/latest?since=' + player.lastSeq)
        if (!r || !r.ok) return
        // 宿主重启过：服务器 seq 比本地小 → 以服务器为准，别卡住
        if (Number(r.seq) < player.lastSeq) {
          player.lastSeq = Number(r.seq) || 0
          saveSeq(player.lastSeq)
        }
        if (!Array.isArray(r.items) || !r.items.length) return
        for (const it of r.items) {
          const seq = Number(it.seq) || 0
          player.lastSeq = Math.max(player.lastSeq, seq)
          saveSeq(player.lastSeq)
          if (player.seen.has(seq)) continue          // 同一 seq 只入队一次
          player.seen.add(seq)
          if (player.seen.size > 200) {
            const keep = [...player.seen].slice(-100)
            player.seen = new Set(keep)
          }
          if (Date.now() - Number(it.at || 0) > STALE_MS) continue   // 陈旧条目跳过
          player.queue.push(it)
        }
        playNext()
      } catch { /* 宿主没起来就下一轮再试 */ } finally {
        player.inFlight = false
      }
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
        row('TTS 提供方', 'edge = 本地免费；breezeblue = 云端音色（要 API Key）',
          h('select', {
            className: 'sh-select', value: s.provider || 'edge',
            onChange: (e) => {
              save({ provider: e.target.value })
              setTimeout(() => location.reload(), 300)
            },
          },
          h('option', { value: 'edge' }, 'edge-tts（本地）'),
          h('option', { value: 'breezeblue' }, 'BreezeBlue（云端）'))),
        (s.provider === 'breezeblue') ? row('BreezeBlue API Key', '在 breezeblue.ai → 开发者 → API 密钥 里创建，形如 brz_...',
          h('input', {
            className: 'sh-input', type: 'password', style: { minWidth: 280 },
            value: (s.breeze && s.breeze.apiKey) || '',
            placeholder: 'brz_...',
            onChange: (e) => setS({ ...s, breeze: { ...(s.breeze || {}), apiKey: e.target.value } }),
            onBlur: (e) => save({ breeze: { ...(s.breeze || {}), apiKey: e.target.value } }),
          })) : null,
        (s.provider === 'breezeblue') ? row('BreezeBlue voice_id', '大肥鱼（机灵版）= voc_u3nxkd5578wc',
          h('input', {
            className: 'sh-input', style: { minWidth: 280 },
            value: (s.breeze && s.breeze.voiceId) || '',
            placeholder: 'voc_...',
            onChange: (e) => setS({ ...s, breeze: { ...(s.breeze || {}), voiceId: e.target.value } }),
            onBlur: (e) => save({ breeze: { ...(s.breeze || {}), voiceId: e.target.value } }),
          })) : null,
        (s.provider === 'breezeblue')
          ? row('云端音色', '选中的 BreezeBlue voice_id；语速/音调由云端音色自己决定',
            h('select', {
              className: 'sh-select',
              value: (s.breeze && s.breeze.voiceId) || '',
              onChange: (e) => save({ breeze: { ...(s.breeze || {}), voiceId: e.target.value } }),
              style: { maxWidth: 320 },
            },
            voices.length
              ? voices.map((v) => h('option', { key: v.name, value: v.name }, (v.desc ? v.desc + ' · ' : '') + v.name))
              : h('option', { value: (s.breeze && s.breeze.voiceId) || '' }, (s.breeze && s.breeze.voiceId) || '（未配置）')))
          : row('音色', 'edge-tts 的中文神经语音；默认 Xiaoyi（少女音）',
            h('select', {
              className: 'sh-select', value: s.voice,
              onChange: (e) => save({ voice: e.target.value }),
              style: { maxWidth: 320 },
            },
            voices.length
              ? voices.map((v) => h('option', { key: v.name, value: v.name }, v.name + (v.desc ? ' · ' + v.desc : '')))
              : h('option', { value: s.voice }, s.voice))),
        (s.provider === 'breezeblue') ? null : row('语速', '例：-8%（慢） / +0%（正常） / +10%（快）', h('input', {
          className: 'sh-input', value: s.rate, onChange: (e) => setS({ ...s, rate: e.target.value }),
          onBlur: (e) => save({ rate: e.target.value }),
        })),
        (s.provider === 'breezeblue') ? null : row('音调', '例：+10Hz（略高） / +0Hz（原始）', h('input', {
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

    // ── 右下角小窗：不用进设置页也能停 / 选会话 ──────────────────────────
    function mountMiniPanel() {
      if (typeof document === 'undefined') return
      if (document.getElementById('sh-fab')) return

      const LIGHT = '#f8fafc'
      const DIM = '#cbd5e1'
      const BG = '#0f172a'
      const LINE = 'rgba(255,255,255,.14)'

      const wrap = document.createElement('div')
      wrap.id = 'sh-fab'
      wrap.style.cssText = [
        'position:fixed', 'right:22px', 'bottom:92px', 'z-index:2147483000',
        'font-family:system-ui,-apple-system,"Segoe UI",sans-serif', 'color:' + LIGHT,
      ].join(';')

      const btn = document.createElement('button')
      btn.type = 'button'
      btn.title = '朗读小窗'
      btn.textContent = '🔊'
      btn.style.cssText = [
        'width:42px', 'height:42px', 'border-radius:999px', 'border:none', 'cursor:pointer',
        'background:#1e293b', 'color:#fff', 'font-size:18px', 'line-height:42px', 'text-align:center',
        'box-shadow:0 6px 18px rgba(0,0,0,.32)', 'opacity:.94',
      ].join(';')

      const panel = document.createElement('div')
      panel.style.cssText = [
        'display:none', 'position:absolute', 'right:0', 'bottom:54px', 'width:250px',
        'background:' + BG, 'color:' + LIGHT,
        'border:1px solid ' + LINE, 'border-radius:12px', 'padding:12px',
        'box-shadow:0 12px 32px rgba(0,0,0,.5)', 'font-size:12.5px',
      ].join(';')

      const title = document.createElement('div')
      title.textContent = '朗读'
      title.style.cssText = 'font-weight:600;font-size:13px;margin-bottom:8px;color:' + LIGHT
      panel.appendChild(title)

      const makeCheck = (labelText) => {
        const row = document.createElement('label')
        row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 0;cursor:pointer;color:' + LIGHT
        const cb = document.createElement('input')
        cb.type = 'checkbox'
        cb.style.cssText = 'accent-color:#60a5fa;width:14px;height:14px;cursor:pointer'
        const span = document.createElement('span')
        span.textContent = labelText
        span.style.cssText = 'color:' + LIGHT + ';font-size:12.5px'
        row.append(cb, span)
        return { row, cb, span }
      }

      const pause = makeCheck('暂停朗读')
      panel.appendChild(pause.row)

      const stopBtn = document.createElement('button')
      stopBtn.type = 'button'
      stopBtn.textContent = '停止当前'
      stopBtn.style.cssText = [
        'width:100%', 'margin:4px 0 10px', 'height:30px', 'border-radius:8px',
        'border:1px solid ' + LINE, 'background:transparent', 'color:' + LIGHT,
        'cursor:pointer', 'font-size:12.5px',
      ].join(';')
      panel.appendChild(stopBtn)

      // 会话选择：按钮 + 弹窗
      const sessBtn = document.createElement('button')
      sessBtn.type = 'button'
      sessBtn.textContent = '选择会话…'
      sessBtn.style.cssText = [
        'width:100%', 'height:30px', 'border-radius:8px', 'border:1px solid ' + LINE,
        'background:transparent', 'color:' + LIGHT, 'cursor:pointer', 'font-size:12.5px',
      ].join(';')
      panel.appendChild(sessBtn)

      const hint = document.createElement('div')
      hint.textContent = '更多设置：设置 → 自动朗读'
      hint.style.cssText = 'color:' + DIM + ';font-size:11px;margin-top:10px'
      panel.appendChild(hint)

      // 弹窗（挂在 body 上，避免被 panel 的滚动/层级裁掉）
      const modal = document.createElement('div')
      modal.style.cssText = [
        'display:none', 'position:fixed', 'inset:0', 'z-index:2147483001',
        'background:rgba(0,0,0,.55)', 'align-items:center', 'justify-content:center',
        'font-family:system-ui,-apple-system,"Segoe UI",sans-serif',
      ].join(';')
      const card = document.createElement('div')
      card.style.cssText = [
        'width:360px', 'max-width:88vw', 'max-height:76vh', 'overflow:hidden',
        'background:' + BG, 'color:' + LIGHT, 'border:1px solid ' + LINE,
        'border-radius:14px', 'box-shadow:0 18px 48px rgba(0,0,0,.55)',
        'display:flex', 'flex-direction:column',
      ].join(';')
      const cardHead = document.createElement('div')
      cardHead.textContent = '朗读哪些会话'
      cardHead.style.cssText = 'padding:14px 16px 6px;font-size:13px;font-weight:600;color:' + LIGHT
      const cardTip = document.createElement('div')
      cardTip.textContent = '一个都不勾 = 全部会话'
      cardTip.style.cssText = 'padding:0 16px 8px;font-size:11.5px;color:' + DIM
      const listBox = document.createElement('div')
      listBox.style.cssText = 'padding:0 10px 6px;overflow:auto;flex:1;display:flex;flex-direction:column;gap:2px'
      const cardFoot = document.createElement('div')
      cardFoot.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;padding:10px 16px 14px;border-top:1px solid ' + LINE
      const mkFootBtn = (txt, primary) => {
        const b = document.createElement('button')
        b.type = 'button'
        b.textContent = txt
        b.style.cssText = [
          'height:30px', 'padding:0 12px', 'border-radius:8px', 'cursor:pointer', 'font-size:12.5px',
          primary ? 'background:#2563eb;border:none;color:#fff' : 'background:transparent;border:1px solid ' + LINE + ';color:' + LIGHT,
        ].join(';')
        return b
      }
      const btnAll = mkFootBtn('全选', false)
      const btnNone = mkFootBtn('清空', false)
      const btnDone = mkFootBtn('完成', true)
      cardFoot.append(btnAll, btnNone, btnDone)
      card.append(cardHead, cardTip, listBox, cardFoot)
      modal.appendChild(card)

      wrap.appendChild(btn)
      wrap.appendChild(panel)
      document.body.appendChild(wrap)
      document.body.appendChild(modal)

      let cfg = { paused: false, watch: [] }
      let sessions = []

      const watchList = () => (Array.isArray(cfg.watch) ? cfg.watch.map(String) : [])
      const updateSessLabel = () => {
        const w = watchList()
        sessBtn.textContent = w.length ? `选择会话（已选 ${w.length} 个）` : '选择会话（全部）'
      }

      const saveWatch = async (list) => {
        cfg.watch = list
        updateSessLabel()
        try { await post('/api/settings', { watch: cfg.watch }) } catch { /* ignore */ }
      }

      const renderList = () => {
        listBox.textContent = ''
        const allOn = watchList().length === 0
        // 置顶：全部会话（推荐，免得勾错会话还以为坏了）
        const allRow = document.createElement('label')
        allRow.style.cssText = 'display:flex;align-items:center;gap:9px;padding:8px 6px;border-radius:7px;cursor:pointer;background:' + (allOn ? 'rgba(96,165,250,.12)' : 'transparent')
        const allCb = document.createElement('input')
        allCb.type = 'checkbox'
        allCb.checked = allOn
        allCb.style.cssText = 'accent-color:#60a5fa;width:14px;height:14px;cursor:pointer'
        allCb.onchange = async () => {
          if (allCb.checked) { await saveWatch([]); renderList() }
          else { allCb.checked = true; renderList() }   // 不允许“一个都不选又不选全部”
        }
        const allSpan = document.createElement('span')
        allSpan.textContent = '全部会话（推荐）'
        allSpan.style.cssText = 'color:' + LIGHT + ';font-size:12.5px;font-weight:600'
        allRow.append(allCb, allSpan)
        listBox.appendChild(allRow)

        const divider = document.createElement('div')
        divider.style.cssText = 'height:1px;background:' + LINE + ';margin:6px 2px'
        listBox.appendChild(divider)

        if (!sessions.length) {
          const e = document.createElement('div')
          e.textContent = '没有可选的会话'
          e.style.cssText = 'color:' + DIM + ';font-size:12px;padding:6px 6px 10px'
          listBox.appendChild(e)
          return
        }
        const w = new Set(watchList())
        for (const x of sessions) {
          const row = document.createElement('label')
          row.style.cssText = 'display:flex;align-items:center;gap:9px;padding:7px 6px;border-radius:7px;cursor:pointer;color:' + LIGHT + ';opacity:' + (allOn ? '.55' : '1')
          const cb = document.createElement('input')
          cb.type = 'checkbox'
          cb.checked = w.has(String(x.id))
          cb.disabled = allOn
          cb.style.cssText = 'accent-color:#60a5fa;width:14px;height:14px;cursor:pointer'
          cb.onchange = async () => {
            const cur = new Set(watchList())
            if (cb.checked) cur.add(String(x.id)); else cur.delete(String(x.id))
            await saveWatch([...cur])
          }
          const span = document.createElement('span')
          span.textContent = x.title || String(x.id).slice(0, 10)
          span.style.cssText = 'color:' + LIGHT + ';font-size:12.5px;line-height:18px;word-break:break-all'
          row.append(cb, span)
          row.onmouseenter = () => { row.style.background = 'rgba(255,255,255,.06)' }
          row.onmouseleave = () => { row.style.background = 'transparent' }
          listBox.appendChild(row)
        }
      }

      const openModal = async () => {
        try {
          const r = await get('/api/sessions')
          sessions = (r && r.ok && r.sessions) || []
        } catch { sessions = [] }
        renderList()
        modal.style.display = 'flex'
      }
      const closeModal = () => { modal.style.display = 'none' }

      sessBtn.onclick = () => { openModal() }
      modal.onclick = (e) => { if (e.target === modal) closeModal() }
      btnDone.onclick = () => closeModal()
      btnAll.onclick = async () => {
        await saveWatch(sessions.map((x) => String(x.id)))
        renderList()
      }
      btnNone.onclick = async () => {
        await saveWatch([])
        renderList()
      }
      stopBtn.onclick = () => {
        stopAll()
        stopBtn.textContent = '已停止'
        setTimeout(() => { stopBtn.textContent = '停止当前' }, 1200)
      }

      const refresh = async () => {
        try {
          const r = await get('/api/settings')
          if (r && r.ok) {
            cfg = r.settings
            pause.cb.checked = cfg.paused === true
            btn.textContent = cfg.paused ? '🔇' : '🔊'
            updateSessLabel()
          }
        } catch { /* ignore */ }
      }

      pause.cb.onchange = async () => {
        cfg.paused = pause.cb.checked
        if (cfg.paused) stopAll()
        btn.textContent = cfg.paused ? '🔇' : '🔊'
        try { await post('/api/pause', { paused: cfg.paused }) } catch { /* ignore */ }
      }

      btn.onclick = () => {
        const open = panel.style.display === 'block'
        panel.style.display = open ? 'none' : 'block'
        if (!open) refresh()
      }

      updateSessLabel()
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
      // 只有拿到跨标签锁的那个标签才轮询/播放
      setInterval(() => { if (isLeader()) poll() }, 1200)
      setTimeout(() => { if (isLeader()) poll() }, 800)
    }

    exports.inject = inject
    exports.apply = apply
    return module.exports
  },
})

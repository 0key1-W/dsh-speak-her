// 自动朗读 · 宿主半边
// 盯住会话里「说完一整轮」的助手文字 → 用 edge-tts 合成 mp3 → 网页半边播放。
// 音色 / 语速 / 音调存在 ~/.dsh/speak-her.json，设置页可改，改完下一次生效。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFile } from 'node:child_process'

export const name = 'speak-her'
export const inject = ['webServer', 'sessions', 'sessionTitle', 'timer']

const P = '/dsh-speak-her'
const HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
const CFG_PATH = path.join(HOME, 'speak-her.json')
const AUDIO_DIR = path.join(HOME, 'speak-her', 'audio')

const DEFAULTS = {
  auto: true,
  voice: 'zh-CN-XiaoyiNeural',
  rate: '-8%',
  pitch: '+10Hz',
  maxChars: 500,
  python: '',
  volume: 1,
  cleanMarkdown: true,
  provider: 'edge',
  breeze: { apiKey: '', voiceId: 'voc_u3nxkd5578wc', baseUrl: 'https://api.breeze.blue', outputFormat: 'mp3' },
  watch: [],
  paused: false,
}

const HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'cache-control': 'no-store',
}

function loadCfg() {
  try {
    return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(CFG_PATH, 'utf8')) }
  } catch {
    return { ...DEFAULTS }
  }
}
function saveCfg(c) {
  fs.mkdirSync(path.dirname(CFG_PATH), { recursive: true })
  fs.writeFileSync(CFG_PATH, JSON.stringify(c, null, 2) + '\n', 'utf8')
}

const readJson = (req) =>
  new Promise((resolve) => {
    let raw = ''
    req.on('data', (c) => { raw += c })
    req.on('end', () => { try { resolve(JSON.parse(raw || '{}')) } catch { resolve({}) } })
  })

const reply = (res, code, obj) => {
  res.writeHead(code, HEADERS)
  res.end(JSON.stringify(obj))
}

export function apply(ctx) {
  fs.mkdirSync(AUDIO_DIR, { recursive: true })
  let cfg = loadCfg()
  const state = {
    seq: 0,
    items: [],           // 最近合成好的：{ seq, url(dataURI), text, at }
    seen: new Map(),     // 文本去重：hash -> at
    lastError: '',
    scanning: false,
  }
  const say = (m) => console.log('[speak-her] ' + m)

  // ── Python / edge-tts ────────────────────────────────────────────────
  function pythonExe() {
    return String(cfg.python || process.env.WHALE_PYTHON || 'python')
  }
  const execAsync = (file, args, timeout = 120000) =>
    new Promise((resolve, reject) => {
      execFile(file, args, { timeout, windowsHide: true, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
        if (err) reject(Object.assign(err, { stderr: String(stderr || '') }))
        else resolve(String(stdout || ''))
      })
    })

  // 朗读前的文本清洗：把 Markdown / 代码 / 链接标记都去掉，只留能念的字。
  // 否则 edge-tts 会把「**」「#」「```」原样念出来。
  function cleanForSpeech(raw) {
    let s = String(raw || '')
    s = s.replace(/```[\s\S]*?```/g, ' ')          // 代码块整段不念
    s = s.replace(/~~~[\s\S]*?~~~/g, ' ')
    s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')    // 图片
    s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')  // 链接只留文字
    s = s.replace(/<[^>]+>/g, ' ')                 // HTML 标签
    s = s.replace(/`([^`]*)`/g, '$1')              // 行内代码去反引号
    s = s.replace(/^\s{0,3}#{1,6}\s+/gm, '')       // 标题
    s = s.replace(/^\s{0,3}>\s?/gm, '')            // 引用
    s = s.replace(/^\s*[-*+]\s+/gm, '')            // 无序列表
    s = s.replace(/^\s*\d+\.\s+/gm, '')            // 有序列表
    s = s.replace(/^\s*\|.*\|\s*$/gm, ' ')         // 表格行
    s = s.replace(/^\s*[-*_]{3,}\s*$/gm, ' ')      // 分隔线
    s = s.replace(/[*_~]{1,3}/g, '')               // 粗体/斜体/删除线标记
    s = s.replace(/[#>*|]+/g, ' ')                 // 残留符号
    s = s.replace(/&[a-z]+;/gi, ' ')               // HTML 实体
    s = s.replace(/\u00a0/g, ' ')
    s = s.replace(/\s+/g, ' ').trim()
    return s
  }

  // ── BreezeBlue 云端 TTS ─────────────────────────────────────────────
  async function synthesizeBreeze(body, override = {}) {
    const b = cfg.breeze || {}
    const key = String(override.apiKey || b.apiKey || '').trim()
    if (!key) throw new Error('没有配置 BreezeBlue API Key（设置页填 brz_... 或环境变量 BREEZE_API_KEY）')
    const voiceId = String(override.voiceId || b.voiceId || '').trim()
    if (!voiceId) throw new Error('没有配置 BreezeBlue voice_id')
    const base = String(b.baseUrl || 'https://api.breeze.blue').replace(/\/$/, '')
    const fmt = String(override.outputFormat || b.outputFormat || 'mp3')
    const url = `${base}/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=${encodeURIComponent(fmt)}`
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'xi-api-key': key, 'content-type': 'application/json' },
      body: JSON.stringify({ text: body }),
    })
    if (!r.ok) {
      let detail = ''
      try {
        const j = await r.json()
        detail = j.detail || j.error || j.message || JSON.stringify(j)
      } catch { detail = await r.text().catch(() => '') }
      throw new Error(`BreezeBlue ${r.status}: ${String(detail).slice(0, 200)}`)
    }
    const buf = Buffer.from(await r.arrayBuffer())
    if (buf.length < 500) throw new Error('BreezeBlue 返回的音频为空')
    const mime = fmt === 'wav' ? 'audio/wav' : 'audio/mpeg'
    return { url: `data:${mime};base64,${buf.toString('base64')}`, voice: voiceId, rate: '', pitch: '', text: body }
  }

  async function synthesize(text, override = {}) {
    const clean = cfg.cleanMarkdown === false ? String(text || '').trim() : cleanForSpeech(text)
    if (!clean) throw new Error('空文本')
    const body = clean.slice(0, Math.max(50, Number(cfg.maxChars) || 500))
    const provider = String(override.provider || cfg.provider || 'edge')
    if (provider === 'breezeblue') return synthesizeBreeze(body, override)
    const voice = String(override.voice || cfg.voice)
    const rate = String(override.rate || cfg.rate)
    const pitch = String(override.pitch || cfg.pitch)
    const id = crypto.randomBytes(8).toString('hex')
    const txt = path.join(AUDIO_DIR, id + '.txt')
    const mp3 = path.join(AUDIO_DIR, id + '.mp3')
    fs.writeFileSync(txt, body, 'utf8')
    try {
      await execAsync(pythonExe(), ['-m', 'edge_tts', '-f', txt, '-v', voice,
        `--rate=${rate}`, `--pitch=${pitch}`, '--write-media', mp3])
      if (!fs.existsSync(mp3) || fs.statSync(mp3).size < 500) throw new Error('edge-tts 没有产出音频')
      const b64 = fs.readFileSync(mp3).toString('base64')
      return { url: `data:audio/mpeg;base64,${b64}`, voice, rate, pitch, text: body }
    } finally {
      fs.rmSync(txt, { force: true })
      // 保留 mp3 一会儿方便排查，10 分钟后再删
      const timer = setTimeout(() => { try { fs.rmSync(mp3, { force: true }) } catch {} }, 10 * 60 * 1000)
      if (timer.unref) timer.unref()
    }
  }

  async function push(text) {
    const key = crypto.createHash('sha1').update(String(text)).digest('hex')
    const now = Date.now()
    const last = state.seen.get(key)
    if (last && now - last < 60_000) return null
    state.seen.set(key, now)
    if (state.seen.size > 200) {
      for (const [k, t] of state.seen) if (now - t > 120_000) state.seen.delete(k)
    }
    const audio = await synthesize(text)
    state.seq += 1
    const item = { seq: state.seq, url: audio.url, text: audio.text, at: now }
    state.items.push(item)
    if (state.items.length > 5) state.items.shift()
    return item
  }

  // ── 会话扫描：只认「说完一整轮」的文字 ────────────────────────────────
  const tracked = new Map() // sessionId -> { seq, turns: Map }
  const watched = (id) => {
    const list = Array.isArray(cfg.watch) ? cfg.watch : []
    return list.length === 0 || list.includes(String(id))   // 空 = 所有会话
  }
  async function scan() {
    if (state.scanning || cfg.paused) return
    state.scanning = true
    try {
      let list = []
      try { list = ctx.sessions.list() || [] } catch { list = [] }
      const arr = list instanceof Map ? [...list.values()] : (Array.isArray(list) ? list : Object.values(list || {}))
      for (const raw of arr) {
        const s = typeof raw === 'string' ? ctx.sessions.get(raw) : raw
        if (!s || s.id === undefined) continue
        const id = String(s.id)
        if (!watched(id)) { tracked.delete(id); continue }
        const seq = Number(s.seq || 0)
        const t = tracked.get(id)
        if (!t) { tracked.set(id, { seq, turns: new Map() }); continue }
        if (seq <= t.seq) continue
        let events = []
        try { events = s.snapshotEvents(t.seq) || [] } catch { events = [] }
        t.seq = seq
        for (const ev of events) {
          if (!ev || !ev.data) continue
          const d = ev.data
          if (d.turn === undefined || d.turn === null) continue
          if (ev.type === 'assistant/message') {
            const buf = t.turns.get(d.turn) || []
            const blocks = (d.message && d.message.content) || []
            if (Array.isArray(blocks)) {
              for (const b of blocks) {
                if (b && b.type === 'text' && typeof b.text === 'string' && b.text.trim()) buf.push(b.text.trim())
              }
            }
            t.turns.set(d.turn, buf)
          } else if (ev.type === 'turn/end') {
            const buf = t.turns.get(d.turn)
            t.turns.delete(d.turn)
            const ok = d.reason && d.reason.kind === 'completed'
            if (ok && buf && buf.length && cfg.auto) {
              push(buf.join('\n\n')).catch((e) => { state.lastError = String(e.message || e) })
            }
          }
        }
      }
    } catch (e) {
      state.lastError = String(e && e.message || e)
    } finally {
      state.scanning = false
    }
  }
  ctx.effect(() => ctx.interval(() => { scan().catch(() => {}) }, 1500))

  // ── HTTP ────────────────────────────────────────────────────────────
  const route = (p, handler) =>
    ctx.effect(() => ctx.webServer.register({
      kind: 'exact',
      path: p,
      handler: async (req, res) => {
        if (req.method === 'OPTIONS') { res.writeHead(204, HEADERS); res.end(); return }
        try { await handler(req, res) } catch (e) {
          reply(res, 500, { ok: false, error: String(e && e.message || e) })
        }
      },
    }))

  route(P + '/api/health', async (req, res) => {
    reply(res, 200, { ok: true, name, seq: state.seq, auto: cfg.auto, error: state.lastError })
  })

  route(P + '/api/sessions', async (req, res) => {
    const out = []
    try {
      const list = ctx.sessions.list() || []
      const arr = list instanceof Map ? [...list.values()] : (Array.isArray(list) ? list : Object.values(list || {}))
      for (const raw of arr) {
        const s = typeof raw === 'string' ? ctx.sessions.get(raw) : raw
        if (!s || s.id === undefined) continue
        let title = ''
        try {
          const snap = ctx.sessionTitle && ctx.sessionTitle.get(s)
          title = snap && snap.title ? String(snap.title) : ''
        } catch { /* ignore */ }
        out.push({ id: String(s.id), title })
      }
    } catch { /* ignore */ }
    reply(res, 200, { ok: true, sessions: out })
  })

  route(P + '/api/pause', async (req, res) => {
    const body = await readJson(req)
    cfg = { ...cfg, paused: !!body.paused }
    saveCfg(cfg)
    say(cfg.paused ? '已暂停朗读' : '已恢复朗读')
    reply(res, 200, { ok: true, paused: cfg.paused })
  })

  route(P + '/api/settings', async (req, res) => {
    if (req.method === 'GET') { reply(res, 200, { ok: true, settings: cfg }); return }
    const body = await readJson(req)
    cfg = { ...cfg, ...body }
    saveCfg(cfg)
    reply(res, 200, { ok: true, settings: cfg })
  })

  route(P + '/api/voices', async (req, res) => {
    try {
      if (String(cfg.provider || 'edge') === 'breezeblue') {
        const b = cfg.breeze || {}
        const key = String(b.apiKey || '').trim()
        if (!key) { reply(res, 200, { ok: true, voices: [], error: '还没填 BreezeBlue API Key' }); return }
        const base = String(b.baseUrl || 'https://api.breeze.blue').replace(/\/$/, '')
        const r = await fetch(`${base}/v1/voices`, { headers: { 'xi-api-key': key } })
        if (!r.ok) throw new Error(`BreezeBlue ${r.status}`)
        const j = await r.json()
        const arr = Array.isArray(j) ? j : (j.voices || j.data || j.items || [])
        const voices = arr.map((v) => ({
          name: String(v.voice_id || v.id || v.voiceId || ''),
          desc: String(v.name || v.display_name || v.description || ''),
        })).filter((v) => v.name)
        reply(res, 200, { ok: true, voices })
        return
      }
      const out = await execAsync(pythonExe(), ['-m', 'edge_tts', '--list-voices'], 120000)
      const voices = out.split(/\r?\n/)
        .filter((l) => /^zh-CN-|^zh-TW-|^zh-HK-/.test(l.trim()))
        .map((l) => {
          const parts = l.trim().split(/\s{2,}/)
          return { name: parts[0], desc: parts.slice(1).join(' ') }
        })
      reply(res, 200, { ok: true, voices })
    } catch (e) {
      reply(res, 500, { ok: false, error: String(e.message || e) })
    }
  })

  route(P + '/api/latest', async (req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1')
    const since = Number(u.searchParams.get('since') || 0)
    reply(res, 200, { ok: true, seq: state.seq, auto: cfg.auto, items: state.items.filter((x) => x.seq > since) })
  })

  route(P + '/api/test', async (req, res) => {
    const body = await readJson(req)
    const text = String(body.text || '这是一段测试朗读，音色、语速和音调都可以在设置里调整。')
    try {
      const audio = await synthesize(text, body)
      reply(res, 200, { ok: true, url: audio.url })
    } catch (e) {
      reply(res, 500, { ok: false, error: String(e.message || e) })
    }
  })

  say(`已启动 · 音色 ${cfg.voice} · ${cfg.rate} / ${cfg.pitch} · 自动=${cfg.auto}`)
}

// 离线冒烟测试：用假 ctx 加载宿主插件，验证路由注册 + 实际合成一段音频
import { EventEmitter } from 'node:events'
import { apply } from 'file:///C:/Users/王/.dsh/plugins/dsh-speak-her/lib/host.js'

const routes = new Map()
const ctx = {
  effect: (fn) => { try { return fn() } catch { return null } },
  interval: () => 0,
  webServer: { register: ({ path, handler }) => { routes.set(path, handler); return () => {} } },
  sessions: { list: () => [], get: () => undefined },
}

apply(ctx)
console.log('注册路由:', [...routes.keys()].join(', '))

function mkReq(method, body) {
  const req = new EventEmitter()
  req.method = method
  req.url = '/'
  setTimeout(() => {
    if (body !== undefined) req.emit('data', Buffer.from(JSON.stringify(body)))
    req.emit('end')
  }, 0)
  return req
}
function mkRes() {
  return {
    code: 0, payload: '',
    writeHead(c) { this.code = c },
    end(s) { this.payload = s },
  }
}

const health = routes.get('/dsh-speak-her/api/health')
let res = mkRes()
await health(mkReq('GET'), res)
console.log('health:', res.code, res.payload.slice(0, 120))

const settings = routes.get('/dsh-speak-her/api/settings')
res = mkRes()
await settings(mkReq('GET'), res)
console.log('settings:', res.code, res.payload.slice(0, 160))

const test = routes.get('/dsh-speak-her/api/test')
res = mkRes()
await test(mkReq('POST', { text: '测试一下自动朗读' }), res)
const out = JSON.parse(res.payload)
console.log('test:', out.ok ? `ok, audio ${Math.round((out.url.length * 3) / 4 / 1024)} KB` : 'FAIL ' + out.error)

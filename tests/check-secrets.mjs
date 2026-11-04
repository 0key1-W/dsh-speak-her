// 提交前自检：仓库里不许出现真实的 API Key / token。
// 用法: node tests/check-secrets.mjs
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

let files = []
try {
  files = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split(/\r?\n/).filter(Boolean)
} catch {
  // 不是 git 仓库时扫全目录（跳过 node_modules / .git）
  const walk = (dir) => {
    for (const it of fs.readdirSync(dir, { withFileTypes: true })) {
      if (it.name === 'node_modules' || it.name === '.git') continue
      const p = path.join(dir, it.name)
      if (it.isDirectory()) walk(p)
      else files.push(path.relative(root, p))
    }
  }
  walk(root)
}

const PATTERNS = [
  { name: 'BreezeBlue key', re: /brz_[A-Za-z0-9]{16,}/ },
  { name: '通用长 token 赋值', re: /(api[_-]?key|token|secret)\s*[:=]\s*["'][A-Za-z0-9_\-]{16,}["']/i },
]

let bad = 0
for (const rel of files) {
  const abs = path.join(root, rel)
  if (!fs.existsSync(abs)) continue
  if (/\.(mp3|wav|png|jpg|jpeg|webp|zip)$/i.test(rel)) continue
  let text = ''
  try { text = fs.readFileSync(abs, 'utf8') } catch { continue }
  for (const p of PATTERNS) {
    const m = text.match(p.re)
    if (m) {
      console.error(`✗ ${rel} 里疑似密钥（${p.name}）：${String(m[0]).slice(0, 24)}…`)
      bad += 1
    }
  }
}

if (bad) {
  console.error(`\n发现 ${bad} 处疑似密钥，拒绝提交。`)
  process.exit(1)
}
console.log(`✓ 检查了 ${files.length} 个文件，没有发现密钥`)

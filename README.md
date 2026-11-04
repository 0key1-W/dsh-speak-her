# dsh-speak-her

给 DSH 的「自动朗读」插件：她说完一整轮，就用 **edge-tts** 的中文神经语音念出来。
音色、语速、音调都能在 **设置 → 自动朗读** 里改，改完下一句生效。

> 和视频里用的是同一个音色（默认 `zh-CN-XiaoyiNeural`，语速 -8%、音调 +10Hz）。
> 不需要 API key，不经过任何第三方服务，本机合成。

## 功能

- **自动朗读**：订阅会话事件，只认「说完一整轮」的助手文字；工具调用、思考过程不念
- **音色可选**：设置页从 `edge-tts --list-voices` 里列出现有中文音色
- **参数可调**：语速（`-8%`）、音调（`+10Hz`）、单句字数上限
- **试听 / 解锁自动播放**：浏览器通常要一次点击才允许出声，设置页有按钮
- **去重**：同一段文字 60 秒内不会重复念
- **本地缓存**：合成的 mp3 存在 `~/.dsh/speak-her/audio/`，10 分钟后自动清理

## 安装

```bash
# 1) 需要本机有 Python 和 edge-tts
pip install edge-tts

# 2) 装插件（本地目录）
dsh plugin --profile desktop add "link:C:\path\to\dsh-speak-her"

# 3) 重启一次 DSH（bundle 层要重启才组装）

# 4) 打开 设置 → 自动朗读
```

## 配置

存在 `~/.dsh/speak-her.json`：

```json
{
  "auto": true,
  "voice": "zh-CN-XiaoyiNeural",
  "rate": "-8%",
  "pitch": "+10Hz",
  "maxChars": 500,
  "python": "",
  "cleanMarkdown": true
}
```

| 字段 | 说明 |
|---|---|
| `auto` | 关掉 = 只保留试听 |
| `voice` | edge-tts 的音色名，例如 `zh-CN-XiaoxiaoNeural`（温柔）、`zh-CN-XiaoyiNeural`（少女） |
| `rate` | 语速，如 `-8%`、`+0%`、`+10%` |
| `pitch` | 音调，如 `+10Hz`、`+0Hz` |
| `maxChars` | 单次朗读最多多少字，防止一条回复念太久 |
| `python` | 跑 edge-tts 的解释器，留空用 PATH 里的 `python` |
| `watch` | 要朗读的会话 id 列表；空数组 = 全部会话 |
| `paused` | 暂停朗读（不合成、不排队） |
| `cleanMarkdown` | 朗读前过滤 Markdown/代码/链接符号（默认开；关掉会连 `**`、`#` 一起念出来） |

## 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/dsh-speak-her/api/settings` | 读配置 |
| POST | `/dsh-speak-her/api/settings` | 改配置（局部合并） |
| GET | `/dsh-speak-her/api/voices` | 列出中文音色 |
| GET | `/dsh-speak-her/api/latest?since=N` | 取 N 之后新合成的语音（base64 data URI） |
| POST | `/dsh-speak-her/api/test` | 试听一句话 |
| GET | `/dsh-speak-her/api/sessions` | 列出会话（设置页勾选用） |
| POST | `/dsh-speak-her/api/pause` | 暂停 / 恢复朗读 |
| GET | `/dsh-speak-her/api/health` | 健康检查 |

## 已知限制

- 浏览器自动播放需要一次用户交互（已提供「解锁自动播放」按钮）
- 只朗读**助手**的最终回复，不读工具调用和中间过程
- 朗读所有活跃会话；若你开了多个会话同时说话，会依次念
- 依赖 edge-tts 的在线接口（微软），断网时静默失败，`/api/health` 里能看到错误

## License

MIT

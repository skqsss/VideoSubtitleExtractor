# 视频分辨率解析下载器

粘贴 B 站 / 抖音 / YouTube 等平台的视频链接，列出全部可用分辨率与编码档位，自选一档下载到本地。
本期只做"取素材"：**高质量原片下载**；转写 / 翻译 / 字幕留到下一期。

> 下载内容仅限已获授权或个人研究使用，转载需取得授权并遵守目标平台规则。

## 技术结构

| 层 | 选型 | 说明 |
| --- | --- | --- |
| 本地服务 | Node 24 + TypeScript（原生类型擦除直接运行） | `src/server`，调用 yt-dlp、管任务队列 |
| 接口 | Fastify + zod | 只监听 `127.0.0.1`，SSE 推送进度 |
| 界面 | Vue 3 + `<script setup>` + Pinia + Vite | `src/components` 等 |
| 共享逻辑 | `src/shared` | 格式归一化、`-f` 选择器生成、错误映射 |
| 外部程序 | `bin/yt-dlp.exe`、`bin/ffmpeg/` | ffmpeg 为 shared 构建，必须整目录携带 dll |

传输层单独收在 `src/api/client.ts`：将来打包成桌面端时，把这个文件换成 Electron IPC 实现即可，组件不动。

## 目录

```
├─ bin/                  # yt-dlp.exe 与 ffmpeg 目录（含 dll，随应用分发）
├─ config.json           # 运行时配置（下载目录、Cookie 来源、代理等）
├─ src/
│  ├─ server/            # 本地服务：配置、二进制自检、yt-dlp 调用、任务队列、HTTP
│  ├─ shared/            # 服务端与前端共享的类型与纯逻辑
│  ├─ api/client.ts      # 传输层适配（网页版 fetch/SSE）
│  ├─ stores/            # Pinia：配置、解析结果、任务列表
│  ├─ composables/       # 解析、进度订阅、格式筛选
│  ├─ components/        # UrlBar / MediaSummary / FormatTable / TaskList / SettingsPanel
│  └─ styles/            # 设计令牌与全局样式
└─ tests/                # 选择器生成与错误映射单元测试
```

## 运行

首次运行前确认 `bin/yt-dlp.exe` 与 `bin/ffmpeg/ffmpeg.exe` 存在（ffmpeg 的 dll 必须同目录）。

```powershell
npm install
npm run dev:server   # 终端 A：本地服务（http://127.0.0.1:8787）
npm run dev          # 终端 B：Vite 页面（http://127.0.0.1:5173，已代理 /api）
```

只想跑单进程（构建后由本地服务直接托管页面）：

```powershell
npm start            # 等价于 npm run build && node src/server/index.ts
```

其他命令：

```powershell
npm test             # 单元测试（选择器规则、错误映射）
npm run type-check   # vue-tsc 全量类型检查（含服务端）
```

## 配置

首次启动会在项目根生成 `config.json`：

```json
{
  "port": 8787,
  "ytdlpPath": "bin/yt-dlp.exe",
  "ffmpegDir": "bin/ffmpeg",
  "downloadDir": "D:\\video-workspace\\downloads",
  "cookieBrowser": "edge",
  "proxy": "",
  "concurrency": 1
}
```

也可以在界面右上角"设置"里改，保存后立即生效。

## Cookie 与清晰度

清晰度上限由平台按登录态发放，本项目提供两条取 Cookie 的路径：

1. `cookieBrowser`：`--cookies-from-browser`，直接从浏览器读。
   - Chrome / Edge 127 以后启用了 App-Bound Encryption，yt-dlp 常见报错 `Failed to decrypt with DPAPI`，
     此时需要**完全退出浏览器**后重试，或改用别的浏览器；Firefox 若从未使用过，也不会有 Cookie 数据库。
2. `cookiesFile`：浏览器扩展导出的 `cookies.txt`，填写路径后与浏览器 Cookie 合并使用。
   - 抖音对 "Fresh cookies" 校验严格，实测**必须**走这条路径才能解析（未登录也要一份新 Cookie）。

读取浏览器 Cookie 失败时，解析与下载都会自动降级为"不读取 Cookie"再试一次，并在界面给出黄色提示，
不会让整个操作直接失败——只是清晰度可能被限制在未登录档位。

## 已知实现细节

- **清晰度解锁**：B 站 1080P+ 与抖音解析基本依赖登录态。设置里选浏览器后走 `--cookies-from-browser`；Chrome / Edge 新版可能要求先完全退出浏览器。
- **分轨合并**：B 站 DASH 常态是纯视频档，选择这类档位时会自动拼接最佳音轨（`<format_id>+ba`），并由 ffmpeg 合并成 mp4。
- **文件名**：视频档位输出为 `标题 [宽x高].mp4`。若只按标题命名，同一个视频换档重下时 yt-dlp 会判定旧文件"已下载"而复用，
  出现"选了 1080P 却拿到先前 360P 文件"的情况；纯音频预设仍用 `标题.mp3`。
- **中文与编码**：Windows 中文环境下 yt-dlp 默认按 GBK 输出，本项目固定传入 `--encoding utf-8` 并设置 `PYTHONUTF8`，避免中文标题与路径变乱码。
- **进度解析**：使用 `--progress-template` 输出带 `VFPROGRESS:` 前缀的 JSON 行（`download:` 在 yt-dlp 里只是类型选择器、不会出现在输出中），同时保留 `[download] 12.3% of ...` 的回退正则。
- **取消**：终止整个进程树（`taskkill /T /F`），并按本次任务写出的目标路径精确删除 `.part`、`.ytdl` 残留。
- **进度推送**：SSE 响应必须带 `Content-Type: text/event-stream`，否则浏览器会直接拒绝连接（界面会一直显示"正在重连进度通道"）。
- **代理**：外网（YouTube）需要代理，B 站 / 抖音建议直连；输入条上的"本次走代理"用于单次覆盖。

## 下一步（不在本期）

转写与翻译：任务对象已保留 `outputPath`，下一期接 `faster-whisper` / `FunASR` 与大模型翻译，输出 srt / ass 软字幕与硬字幕版本。

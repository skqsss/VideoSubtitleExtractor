# 视频分辨率解析下载器

粘贴 B 站 / 抖音 / YouTube 等平台的视频链接，列出全部可用分辨率与编码档位，自选一档下载到本地。
本期只做"取素材"：**高质量原片下载**；转写 / 翻译 / 字幕留到下一期。

> 下载内容仅限已获授权或个人研究使用，转载需取得授权并遵守目标平台规则。

## 技术结构

| 层 | 选型 | 说明 |
| --- | --- | --- |
| 主进程 | Electron + Node | `electron/`，窗口与生命周期；业务实现在 `src/server`，调用 yt-dlp、管任务队列 |
| 通信 | Electron IPC + zod | 页面走自定义 `app://` 协议加载，接口走 `ipcMain.handle`，不监听任何端口 |
| 界面 | Vue 3 + `<script setup>` + Pinia + Vite | `src/components` 等 |
| 共享逻辑 | `src/shared` | 格式归一化、`-f` 选择器生成、错误映射 |
| 外部程序 | `bin/yt-dlp.exe`、`bin/ffmpeg/` | ffmpeg 为 shared 构建，必须整目录携带 dll |

通信链路：界面 → `src/api/client.ts`（唯一传输层出口）→ `electron/preload.ts` 注入的桥 → `electron/ipc.ts` → `src/server/operations.ts`。
通道名与统一响应信封定义在 `src/shared/ipc.ts`，加接口只需要动这条链路上的几处，组件不用改。

## 目录

```
├─ bin/                  # yt-dlp.exe 与 ffmpeg 目录（含 dll，随应用分发）
├─ electron/             # 主进程入口、窗口与协议、IPC 注册、preload 桥、冒烟自检
├─ src/
│  ├─ server/            # 业务实现：配置、二进制自检、yt-dlp 调用、任务队列、操作层
│  ├─ shared/            # 主进程与界面共享的类型、IPC 通道定义与纯逻辑
│  ├─ api/client.ts      # 传输层适配（IPC 通道调用）
│  ├─ stores/            # Pinia：配置、解析结果、任务列表
│  ├─ composables/       # 解析、进度订阅、格式筛选
│  ├─ components/        # UrlBar / MediaSummary / FormatTable / TaskList / SettingsPanel
│  └─ styles/            # 设计令牌与全局样式
└─ tests/                # 业务逻辑与错误码单元测试，不依赖 Electron
```

## 运行

首次运行前确认 `bin/yt-dlp.exe` 与 `bin/ffmpeg/ffmpeg.exe` 存在（ffmpeg 的 dll 必须同目录）。

```powershell
npm install
npm run electron:start   # 构建主进程后直接跑未封装版，加载的就是打包后那套页面
```

改界面时想要热更新：先 `npm run dev` 起 Vite，再 `npm run electron:dev` 打开窗口。
页面与主进程之间走 IPC，没有本地服务进程，**不要**单独用浏览器打开 Vite 地址（浏览器里拿不到 IPC 桥）。

想一键确认"界面能渲染 + IPC 通不通"：

```powershell
npm run test:electron    # 构建后用真实窗口跑冒烟自检，逐项输出 OK / FAIL
```

## 用法要点

- **整段分享文案可以直接粘**：抖音/B 站的分享内容通常长这样 `【标题】 https://... 复制此链接，打开 APP 观看`，
  直接粘进输入框（或点输入框右侧的「粘贴」按钮读取剪贴板）即可，工具只保留其中的链接，界面会提示"已从粘贴的分享文案中提取链接"。
- B 站建议把「Cookie 来源」设为 `不读取` 以省掉一次失败重试，或按上面「Cookie 与清晰度」配置 `cookies.txt` 解锁 1080P+。

其他命令：

```powershell
npm test             # 单元测试（选择器规则、错误映射）
npm run type-check   # vue-tsc 全量类型检查（含服务端）
```

## 配置

首次启动会在 `%APPDATA%\videosubtitleextractor\config.json` 生成配置：

```json
{
  "ytdlpPath": "%APPDATA%\\videosubtitleextractor\\bin\\yt-dlp.exe",
  "ffmpegDir": "%APPDATA%\\videosubtitleextractor\\bin\\ffmpeg",
  "downloadDir": "%USERPROFILE%\\Videos\\VideoSubtitleExtractor",
  "cookieBrowser": "edge",
  "proxy": "",
  "concurrency": 1
}
```

也可以在界面右上角"设置"里改，保存后立即生效。

## Cookie 与清晰度（B 站 1080P+ / 抖音）

清晰度上限与能否解析由平台按 Cookie 发放，本工具提供两条路，按推荐度排序。

### 方式 A：导出 cookies.txt（推荐，不受浏览器加密影响）

1. 浏览器装一个 Cookie 导出扩展（都只在本地读取，不上传）：
   - **Cookie-Editor**：Edge 加载项商店里搜得到（特色扩展），点 Export → JSON 即可；
   - **Get cookies.txt LOCALLY**：Chrome 应用商店里的开源扩展，导出的是 Netscape 格式 `.txt`。
   两种格式本工具都认，导出时选哪个都行。
2. 分别打开并登录 **bilibili.com** 与 **douyin.com**（抖音不登录也行，但要是刚访问过的会话）。
3. 在两个页面各点一次扩展图标 → Export，得到两份导出文件（`.txt` 或 `.json`）。
4. 把两份文件放进同一个文件夹，例如 `D:\video-workspace\cookies\`。
5. 本工具「设置 → cookies.txt 路径」填这个**文件夹**（填单个文件、或用 `;` 分隔多个文件也可以）→ 保存。
6. 点「检查 Cookie」确认结果：会显示合并了几个文件、多少条 Cookie、每个域名下有哪些 Cookie 名。
   B 站至少要看到 `SESSDATA`，抖音至少要看到 `ttwid`。

工具每次请求前会把配置里的文件合并成一份临时文件（`cache/yt-dlp-cookies.txt`）再交给 yt-dlp，
**不会改动你导出的原始文件**——yt-dlp 默认会把 Cookie 回写进传入的文件，所以这一步很有必要。
导出的 JSON 会被自动转成 yt-dlp 需要的 Netscape 格式（含 `#HttpOnly_` 前缀、过期时间秒级换算）。

### 方式 B：让工具直接读浏览器（能不能用取决于浏览器）

- Firefox 的 Cookie 不加密，通常可直接读：设置里把 Cookie 来源选 Firefox（前提是该 Firefox 登录过 B 站）。
- Chrome / Edge 127 之后启用了 App-Bound Encryption，yt-dlp 常见 `Failed to decrypt with DPAPI`；
  浏览器正在运行时还可能报 `Could not copy Chrome cookie database`。
  可以试**完全退出浏览器**或**以管理员身份运行**，不行就走方式 A。

### 方式 C：什么都不配

B 站多数视频能拿到 720P / 1080P（个别视频未登录也能到 1080P），抖音基本解析不了。

> ⚠️ **抖音现在会拦掉 yt-dlp（2026-10 实测）**：抖音的网页详情接口要求请求带 `a_bogus` 签名，
> 缺签名时直接返回 `403 Blocked by ArgusSecurityPlugin`，yt-dlp 会把它兜底成
> `Fresh cookies (not necessarily logged in) are needed`。**这不是 Cookie 过期**：实测用刚导出的
> `sessionid` / `UIFID`（有效期到 11 月）同样报这句，重新导出、换浏览器、清缓存都没用，
> 本工具已把这种情况单独识别为「平台风控拦截」并给出对应提示。目前只能等 yt-dlp 上游适配，
> 或者改用其他方式下载该视频；B 站不受影响。

> ⚠️ **过期或与账号不匹配的 Cookie 比不读取更差**：实测本机用一份伪造 SESSDATA 时，
> 同一个 B 站视频只列出 480P；清空后反而恢复到 1080P。导出要趁刚登录时做，过期就重新导出。

无论哪条路，读浏览器 Cookie 失败时工具都会自动降级为"不读取 Cookie"重试一次，并在界面给出黄色提示，
不会让整步操作直接失败，只是清晰度可能被限制在未登录档位。

## 已知实现细节

- **清晰度解锁**：B 站 1080P+ 与抖音解析基本依赖登录态。设置里选浏览器后走 `--cookies-from-browser`；Chrome / Edge 新版可能要求先完全退出浏览器。
- **分轨合并**：B 站 DASH 常态是纯视频档，选择这类档位时会自动拼接最佳音轨（`<format_id>+ba`），并由 ffmpeg 合并成 mp4。
- **文件名**：视频档位输出为 `标题 [宽x高].mp4`。若只按标题命名，同一个视频换档重下时 yt-dlp 会判定旧文件"已下载"而复用，
  出现"选了 1080P 却拿到先前 360P 文件"的情况；纯音频预设仍用 `标题.mp3`。
- **同名文件**：下载目录里已经有同名文件时，新文件按 `标题 [宽x高] (1).mp4`、`(2)`、`(3)` 依次编号，
  不会再被 yt-dlp 判成"已下载"而整步跳过；指定档位时按实际分辨率精确判重，换清晰度不会白加序号。
- **中文与编码**：Windows 中文环境下 yt-dlp 默认按 GBK 输出，本项目固定传入 `--encoding utf-8` 并设置 `PYTHONUTF8`，避免中文标题与路径变乱码。
- **进度解析**：使用 `--progress-template` 输出带 `VFPROGRESS:` 前缀的 JSON 行（`download:` 在 yt-dlp 里只是类型选择器、不会出现在输出中），同时保留 `[download] 12.3% of ...` 的回退正则。
- **取消**：终止整个进程树（`taskkill /T /F`），并按本次任务写出的目标路径精确删除 `.part`、`.ytdl` 残留。
- **进度推送**：任务快照由主进程通过 `task:update` 通道直接推给窗口，没有 SSE、也没有断线重连；窗口重开后靠一次任务列表拉取补齐。
- **代理**：外网（YouTube）需要代理，B 站 / 抖音建议直连；输入条上的"本次走代理"用于单次覆盖。
- **Cookie 来源的选择规则**：配置了 cookies.txt 时默认不再读浏览器 Cookie（那条路在 Chrome / Edge 上大概率失败，白白多花时间）；
  想在输入条上显式选某个浏览器时，两者会一起送给 yt-dlp。
- **Cookie 文件格式**：目录里的 `.txt`（Netscape）与 `.json`（Cookie-Editor / Chrome 风格）都会被解析合并，
  内容不是 Cookie 的文件会被跳过并在日志里记一笔，不会让整条链路失败。

## 下一步（不在本期）

转写与翻译：任务对象已保留 `outputPath`，下一期接 `faster-whisper` / `FunASR` 与大模型翻译，输出 srt / ass 软字幕与硬字幕版本。

## 打包桌面端（Electron）

```powershell
npm run build:win     # 构建前端 + 主进程，再产出 release/ 下的两个 exe
```

按需选择产物（命令行里的 `--win <target>` 会覆盖配置里的目标列表，不用改编配置文件）：

```powershell
npm run build:win:installer   # 只出 NSIS 安装包
npm run build:win:portable    # 只出免安装单文件
```

想永久去掉便携版：把 `electron-builder.yml` 里 `win.target` 下的 `portable` 那两行删掉，
之后 `npm run build:win` 就只产安装包，也省掉一次 150MB 的压缩。

### 改功能时要不要重新打包

不用每次都打包。按目的选：

| 目的 | 怎么做 | 是否要打包 |
| --- | --- | --- |
| 自动化冒烟自检（界面渲染 + IPC 通道） | `npm run test:electron` | 否 |
| 在桌面窗口里验证（含热更新） | 先 `npm run dev`，再 `npm run electron:dev`，窗口加载 Vite 页面 | 否 |
| 验证接近正式版的构建产物 | `npm run electron:start`（构建后跑未封装版） | 否 |
| 给安装版/发给别人用 | `npm run build:win`，用新的 exe 覆盖安装 | **是** |
| 只改 Cookie、下载目录、代理等配置 | 在设置里改即可 | 否 |
| 只更新 yt-dlp | 应用内「更新 yt-dlp」按钮 | 否 |

> 更新 yt-dlp 走的是应用自己的网络请求（用 Electron 网络栈，会自动跟随**系统代理**）。
> 每次尝试都有超时与断流重试，失败会给出中文原因，不会一直卡在"更新中"。

### 自己手动打包的完整步骤

```powershell
# 0. 进项目目录（路径带空格，记得加引号）
cd "D:\Leaning Project\VideoSubtitleExtractor"

# 1. 改 package.json 里的 version，例如 0.1.1 → 0.1.2
#    不改版本号的话，安装包同名、程序列表里的版本也不变，用户分不清新旧

# 2. 一条命令跑测试 + 打包（国内网络建议先设 nsis 工具镜像）
$env:ELECTRON_BUILDER_BINARIES_MIRROR = 'https://npmmirror.com/mirrors/electron-builder-binaries/'
npm run release

# 3. 产物在 release\ 下
#    release\视频分辨率解析下载器 Setup 0.1.2.exe
```

只想构建不打包：`npm run build:electron`；只想出便携单文件：`npm run build:win:portable`。

**重装依赖后必须补的一步**：本机 npm 的策略会拦掉安装脚本，`npm install` 后 Electron 只有壳、没有二进制。
如果不小心删了 `node_modules`，装完依赖要手动补下载：

```powershell
$env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
node node_modules/electron/install.js
```

打包如果报 `EPERM: rename win-unpacked.tmp`（杀软或索引占用解压目录），先删掉 `release\` 再重试；
配置里已用 `electronDist` 复用本地 Electron，跳过下载解包那一步。

产物：

- `release\视频解析下载器-便携版-0.1.0.exe`：免安装，双击即用
- `release\视频分辨率解析下载器 Setup 0.1.0.exe`：NSIS 安装包，可改安装目录、建桌面快捷方式
- `release\win-unpacked\`：未封装的目录版，调试用，可直接运行里面的 exe

打包后的数据位置（首次启动自动创建）：

| 内容 | 位置 |
| --- | --- |
| 配置 | `%APPDATA%\videosubtitleextractor\config.json` |
| 外部二进制 | `%APPDATA%\videosubtitleextractor\bin\`（首次运行从 `resources\bin` 复制，**不需要再下载 yt-dlp / ffmpeg**） |
| Cookie 合并缓存 | `%APPDATA%\videosubtitleextractor\cache\yt-dlp-cookies.txt` |

实现要点：

- 业务逻辑跑在 Electron 主进程里，窗口通过自定义 `app://` 协议加载前端产物，前后端只走 IPC：不监听端口、不受端口占用影响，本机其它程序也访问不到这些接口。
- 单实例锁：重复双击只聚焦已有窗口；退出时会终止所有 yt-dlp / ffmpeg 子进程，实测无残留。
- 未做代码签名，首次运行会出现 SmartScreen 提示，点"仍要运行"即可（个人自用可接受）。
- 打包若遇到 `EPERM: rename win-unpacked.tmp`（杀软或索引占用解压目录），本配置已通过 `electronDist` 复用本地 Electron 分发版绕开下载解包那一步。

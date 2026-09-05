# DuoDuo 订阅管理系统

这是一个前后端一体化的现代 Web 全栈应用，主要用于帮助用户追踪、管理及统计他们各项在线订阅服务（如 Netflix、Spotify 等）的续费计划和开销情况。

## 💡 技术栈概览 
* **前端框架:** React 19 + TypeScript + Vite
* **样式框架:** Tailwind CSS v4
* **UI 与图表:** Framer Motion (动画) + Recharts (数据可视化表) + Lucide React (图标)
* **后端服务:** Node.js + Express.js 
* **数据库:** MySQL (原生 SQL 参数化语句与 `mysql2` 驱动连接)

---

## 📂 项目文件全指北 (File-by-File Breakdown)

以下是本项目中**每一个**代码、配置文件及其具体作用的清单：

### 根目录配置文件 (Root Configurations)
| 文件名 | 作用描述 |
| :--- | :--- |
| `package.json` | 整个项目的“户口本”。定义了项目的名称、用到了哪些第三方依赖包（如 React、Express、mysql2等），以及所有可执行的运行命令（如 `npm run dev`并联拉起前后端）。 |
| `package-lock.json` | 锁定依赖的绝对具体版本树，保证任何人下载此项目后跑起来的版本不会因为库的自动更新而发生错乱。 |
| `vite.config.ts` | 前端打包工具 [Vite](https://vitejs.dev/) 的配置文件。它指定了 React 插件的运行模式，并将前端强制在本地局域网（0.0.0.0）与特定的 3000 端口启动。 |
| `tsconfig.json` | [TypeScript](https://www.typescriptlang.org/) 的编译标准配置文件，告诉编译器代码的语法检查严格程度以及最终解析到哪一版 JavaScript 标准。 |
| `index.html` | 前端网页运行的**根骨架**物理文件，所有 React 组件最终都会在用户浏览器中动态渲染进这个文件里的 `<div id="root">` 节点里面。 |
| `.env.example` | 环境变量模板示例。展示了本项目跑起来需要填充哪些密钥，特别是连本地 MySQL 数据库的配置（Host、账号、密码等）。 |
| `.env` | **(重要)** 你实际用来填入账号密码配置的变量文件。因为包含了敏感信息，它一般不应该被上传到公共网络。 |
| `.gitignore` | 告诉代码版本管理工具（Git）在备份代码时**忽略**哪些垃圾数据或敏感内容，比如 `node_modules` 会被过滤掉。 |
| `README.md` | 项目的说明书文档（即你正在看的这份文件）。 |

### 数据库层级代码 (Database Scripts)
| 文件名 | 作用描述 |
| :--- | :--- |
| `mysql_schema.sql` | 专门在您的 **MySQL 服务器**上运行以初始化数据的 SQL 语句集。它在本地直接把 `subscriptions` 表给建立出来，附带数据校验功能。 |
| `supabase_schema.sql` | 早期版本代码的遗留产物。这是以前系统连接第三方 Supabase (PostgreSQL) 时用的建表代码，如果你彻底换成上了 MySQL，这个文件仅作备用或历史参考即可。 |

### 后层服务器相关 (Backend Server: `server/`)
| 文件名 | 作用描述 |
| :--- | :--- |
| `server/index.ts` | **后端项目的唯一入口与引擎。** 它是一个纯后端的 Node/Express 应用，监听在默认的 3001 端口上。这个文件里包含了通过 `mysql2` 构建服务器到数据库的所有通信逻辑。它负责处理来自前端页面的四个 API：（获取所有的订阅列表、新增一个订阅、修改订阅的数据如价格、删除一个不再订阅的项）。它是全栈架构中的桥梁核心。 |

### 前端源代码层级 (Frontend: `src/`)

#### 核心与骨架级 (Core Definitions)
| 文件名 | 作用描述 |
| :--- | :--- |
| `src/main.tsx` | 前端的启动文件（Entry Point）。引入了 React 特有节点，将包含多语言上下文（`i18n`）、主题（`theme`）的最外层环境连同 `App.tsx` 挂接到页面上。 |
| `src/App.tsx` | UI 界面的最顶层组件。包含应用最外层的主导航骨骼、路由或是顶层大状态的管控模块均在此汇集。 |
| `src/index.css` | 全局的基座样式文件。这里声明了最粗粒度的样式重置、以及植入了 TailwindCSS v4 的核心功能预指令。 |
| `src/constants.ts` | 全局静态变量仓库与 **数据格式规范（TypeScript Interfaces）**。其中定义了核心格式 `Subscription` 究竟应该长什么样，以及项目中所有用来造模拟数据的假数据数组等。 |

#### 前端工具及引擎驱动层 (`src/lib/`)
| 文件名 | 作用描述 |
| :--- | :--- |
| `src/lib/api.ts` | **前后端交互中心**。前端用来发网络请求的专用“接头人”。任何一个 React 组件如果想读写数据库，都必须执行 API 文件里的暴露出去的函数模块（例如 `createSubscription`），它会将数据发包到 `/api/subscriptions` 端点。 |
| `src/lib/i18n.tsx` | （Internationalization 的简写）。专门处理**语言切换**的上下文引擎。有了它系统可以在不同国家的语言配置里丝滑替换文案环境。 |
| `src/lib/theme.tsx` | 处理前端 UI 主题变色逻辑的引擎。主要是承载**亮色（Light Mode）/ 暗色（Dark Mode）**的主题切换调度配置。 |
| `src/lib/utils.ts` | 杂物箱。通常放置那些最普遍也最小号的辅助处理函数（例如：格式化时间串的函数、拼装样式的函数 `clsx / classnames` 语法糖）。 |

#### React 可视化前端页面与组件群 (`src/components/`)
*这是用户每天用眼睛去看的图形界面组成的核心库，每一个文件对应着界面上的一个区块或是整一页面板：*

| 文件名 | 作用描述 |
| :--- | :--- |
| `Dashboard.tsx` | 第一眼的**主控台看板（首页）**。渲染总花销与金额比例走势数据。这里重度使用了 `Recharts` 画波形图或饼图来总结花费记录。 |
| `Subscriptions.tsx` | **核心业务列表页**。这里用卡片式的长列表样式循环列出你所登记在 MySQL 数据库里的每一条“订阅服务”数据（如：网飞 50元/月），并控制每条数据的更新与删除调度。 |
| `AddSubscription.tsx` | **录入表单抽屉**。通常用来展示那张添加信息用的表单。由于表单里需要包含名称、费用、币种、下次扣费时间等大量校验，此处汇集了最重的前端校验逻辑。数据填完后派发给 api 层的函数执行网络入库。 |
| `AccountView.tsx` | 可能会从“账号”这一个独立维度或者标签维度去拆分的视图列表（例如：这到底是用我的哪个苹果 ID 或支付宝在付费？针对账号层面做的列表数据渲染）。 |
| `CategoryView.tsx` | 从“种类”（如：影视类、生产力软件类、游戏类）这个标签细分流切入做的汇总视图组件。 |
| `Settings.tsx` | **设置页中心**。供用户设定前端显示偏好，如默认选什么币种，换浅色深色主题、修改地区设定等的总开关面板。 |
| `Statistics.tsx` | **深度报表分析页**。包含大量由历史数据推演的进阶花销汇总和数据计算视图，把记账的核心价值以复杂视图反馈出来。 |
| `Premium.tsx` | 高级服务/购买升级宣发页面。可能会列出“开通系统的VIP享受怎样的服务功能”。 |
| `NotificationCenter.tsx` | **消息中心面板**。可能位于页面右上角的小铃铛，专门罗列应用推送给用户的提醒（例如：“您的迅雷会员再过 2 天即将扣费，请确保有余额！”）。 |
| `WalletModal.tsx` | **钱包与财务配置框（模态弹窗）**。以弹出的弹出框形式来集中设置财务属性（充值、绑定账户或账单确认功能）。 |
| `IconSelection.tsx` | **小组件：应用图标选择器**。这主要是为了 `AddSubscription.tsx` 页面服务。由于用户添加应用时通常需要给这应用搭配一个直观形象的 LOGO （诸如 Spotify 选绿色音符），这个组件专门用于渲染并挑选小图标。 |

---

## 🚀 启动项目
你只需要运行命令：`npm run dev`，前端将开启网页并在本地展示，后端会在控制台提示数据库连通成功并默默支持前后数据的交互！

## 🌐 服务器部署时的 API 地址配置

前端会读取环境变量 `VITE_API_BASE_URL` 作为 API 根地址：

* 本地开发：建议保持 `VITE_API_BASE_URL="/api"`（使用 Vite 代理转发到本地后端）。
* 服务器网页：设置为 `VITE_API_BASE_URL="/api"`，由 Nginx 转发到 Node.js 的 `3001` 端口。
* 移动端打包：设置为公网 API 地址，例如 `VITE_API_BASE_URL="http://47.99.119.180/api"`。

这样打包后的 iPhone App 也能直接访问你的服务器后端，不依赖本机 `localhost`。

### 生产部署注意事项

前端环境变量是在 `npm run build` 时写入静态文件的，不能只在 Node 进程启动时设置。生产构建前必须设置以下变量：

```bash
export VITE_GOOGLE_CLIENT_ID="你的 Google Web client ID"
export VITE_API_BASE_URL="/api"
npm run build
```

后端进程还必须设置相同的 `GOOGLE_CLIENT_ID`、数据库变量、`JWT_SECRET` 和 `NODE_ENV=production`。如果缺少 Google client ID，构建或启动会直接报错，不会再生成表面可打开但无法登录的页面。

生产构建时不要设置 `CAPACITOR_SERVER_URL`，否则原生 App 会继续加载开发电脑上的 Vite 服务。只有本地调试原生 App 时才设置它，例如：

```bash
CAPACITOR_SERVER_URL="http://你的局域网IP:3000" npm run cap:sync
```

你的服务器公网 IP 是 `47.99.119.180`。部署到 ECS 后，网页前端使用 `VITE_API_BASE_URL="/api"`，由 Nginx 转发 `/api` 到 Node 服务；原生 App 构建时则使用完整公网地址：

```bash
VITE_API_BASE_URL="http://47.99.119.180/api" npm run cap:sync
```

后端生产环境必须设置 `JWT_SECRET`，不要使用示例值。可以在服务器生成：

```bash
openssl rand -hex 32
```

`.env`、数据库密码、JWT 密钥和上传文件不应提交到 Gitee；仓库只提交 `.env.example` 和源代码。

### Gitee 服务器发布流程

服务器不需要连接 GitHub，使用 Gitee 作为代码源。首次部署：

```bash
git clone https://gitee.com/RosyCandy/duoduo.git /var/www/duoduo
cd /var/www/duoduo
npm ci
cp .env.example .env
# 编辑 .env，填写真实数据库密码、GOOGLE_CLIENT_ID 和 JWT_SECRET
npm run lint
VITE_API_BASE_URL=/api npm run build
```

以后服务器更新代码：

```bash
cd /var/www/duoduo
git pull --ff-only origin main
npm ci
npm run lint
VITE_API_BASE_URL=/api npm run build
sudo systemctl restart duoduo-api
sudo rsync -a --delete dist/ /var/www/duoduo-web/
```

Node 服务建议使用 `systemd` 常驻运行，服务文件中的 `WorkingDirectory` 指向项目目录，`EnvironmentFile` 指向服务器上的 `.env`。Nginx 网站根目录建议使用 `/var/www/duoduo-web`，并把 `/api/` 反向代理到 `127.0.0.1:3001`。ECS 安全组只开放 `80`、`443` 和 `22`，不要开放 MySQL 的 `3306` 或 Node 的 `3001`。

每次发布后验收：

```bash
curl http://47.99.119.180/api/health
curl -I http://47.99.119.180
```

浏览器打开 `http://47.99.119.180`，在开发者工具 Network 中确认 API 请求指向 `47.99.119.180/api`，而不是 `localhost`。

### 服务器调试流程

修改服务器代码后先执行 `npm run lint`；后端调试可临时执行 `npm run server` 查看日志，确认无误后重启 `duoduo-api`。前端代码修改必须重新执行 `VITE_API_BASE_URL=/api npm run build` 并同步 `dist`，已经安装的 App 则必须重新执行 `npm run cap:sync` 后重新生成 APK/AAB 或 iOS 安装包。

### Git 版本管理

今天这版按 `1.0.0` 管理。建议发布前提交并打标签：

```bash
git add .
git commit -m "release: 1.0.0"
git tag -a v1.0.0 -m "DuoDuo 1.0.0"
git push origin main --tags
```

服务器只部署稳定版本时，可以使用 `git fetch --tags` 后执行 `git checkout v1.0.0`；日常开发继续使用 `main` 分支。

### 不绑定域名时使用 HTTPS

不绑定域名可以先通过 `http://47.99.119.180` 使用网站。正式环境建议使用 HTTPS。免费证书通常要求域名；Let's Encrypt 已开始支持 IP 地址证书时，证书有效期会比域名证书短，且申请工具需要确认支持 IP SAN。申请失败时，最稳定的免费方案是注册一个域名后使用 Let's Encrypt 自动续期。

如果网页使用 HTTPS，App 和网页 API 都必须使用 `https://47.99.119.180/api`，不能混用 HTTP，否则浏览器会拦截混合内容，iOS 也可能因 ATS 拒绝连接。没有 HTTPS 时，移动端暂时使用 `http://47.99.119.180/api`，仅建议用于测试。

# 数学小勇士 · 后端部署与接入说明

> 适用版本：`index.html`（已叠加后端同步层）+ `backend/server.js`（本目录）
> 目标：让**管理后台能看到所有设备上的玩家**（跨设备可查看进度、可封禁），而不是只看到“打开后台的那台浏览器”里的账号。

---

## 一、为什么之前后台“显示没人注册”？

旧版是**纯前端**：账号和进度存在每个玩家**自己浏览器**的 `localStorage` 里，且 `localStorage` 是
**按“浏览器 + 设备”隔离**的。你在电脑上打开 `?admin=4423` 看后台，读到的是**你这台电脑浏览器**的数据；
而小朋友们（或你本人）是在**手机 / 另一台设备**上注册的，数据在他们自己设备里——所以后台自然是空的。
这不是 bug，是纯前端架构的硬限制。**接后端就是为了打破这个限制**：所有账号集中存到服务器，后台就能看到所有人。

---

## 二、这次交付的文件

```
prototype/
├── index.html              ← 游戏 + 管理后台（已叠加“后端同步层”，API_BASE 留空时行为与原版一致）
└── backend/                ← 纯后端（零依赖，仅用 Node 自带模块）
    ├── server.js           ← 后端主程序：托管游戏 + /api/* 接口
    ├── package.json        ← npm start 即可启动
    ├── data/.gitkeep       ← 运行后会生成 data/accounts.json（玩家数据）
    └── README.md           ← 本文件
```

后端做了什么：
- 账号/进度集中存储到服务器文件 `data/accounts.json`（有可写文件系统的 Node 主机即可，无需数据库）。
- 密码用 **SHA-256 + 随机盐**哈希存储，服务器不存明文。
- 提供接口：`/api/register` `/api/login` `/api/progress` `/api/admin/login` `/api/admin/users` `/api/admin/toggle` `/api/admin/export`。
- 管理员密码 `4423`（与 `index.html` 中的 `ADMIN_PWD` 保持一致；可在环境变量 `ADMIN_PWD` 覆盖）。
- 已开启 CORS（`Access-Control-Allow-Origin: *`），方便前端（Netlify）跨域调用。

---

## 三、部署步骤（推荐：前端留在 Netlify，后端放 Render）

这样你之前分享的 Netlify 游戏链接**不用变**，只多一个后端地址。

### 第 1 步：把后端部署到 Render（免费 Node 主机）
1. 打开 https://render.com ，用 GitHub / Google 账号登录（没有 GitHub 就先注册一个，免费）。
2. 在 GitHub 新建一个仓库（如 `mathwarrior-backend`），把本目录 `backend/` 里的 **4 个文件**
   （`server.js`、`package.json`、`data/.gitkeep`、`README.md`）上传进去。
3. 在 Render 控制台点 **New → Web Service**，关联刚才的 GitHub 仓库。
4. 配置：
   - **Build Command**：留空（或 `npm install`，无依赖也可空）
   - **Start Command**：`npm start`
   - **Instance Type**：选 **Free**（免费）
   - **Health Check Path**：`/`（可选）
5. 点 **Create Web Service**，等一两分钟部署完成。
6. 部署成功后，Render 会给你一个地址，形如 `https://mathwarrior-xxxx.onrender.com`
   → **这就是你的后端地址，复制下来**。

> 想改管理员密码：在 Render 的 **Environment** 里加环境变量 `ADMIN_PWD=你的新密码`，
> 同时把 `index.html` 里的 `ADMIN_PWD` 也改成一样的值。

### 第 2 步：把后端地址填进游戏
1. 用编辑器打开 `prototype/index.html`，搜索 `const API_BASE = "";`
2. 改成你的后端地址（**注意只改引号里的空字符串，不要删掉那对引号**）：
   ```js
   const API_BASE = "https://mathwarrior-xxxx.onrender.com";
   ```
3. 保存。

### 第 3 步：重新部署前端到 Netlify（覆盖旧文件）
1. 打开 https://app.netlify.com/drop ，登录你的谷歌账号。
2. 进入站点 `sprightly-torrone-d5221c` → **Deploys** → 把改好的 `index.html` 拖进 “Deploy manually”。
3. 部署完成。游戏链接不变：`https://sprightly-torrone-d5221c.netlify.app/`

### 第 4 步：进入后台（现在能看到所有人了）
`https://sprightly-torrone-d5221c.netlify.app/?admin=4423`
进入后标题显示「用户管理（**云端**）」，列出**所有设备**注册过的玩家，可跨设备查看进度、封禁。

---

## 四、两个既有本地账号会自动上云

你之前在两个设备上注册的账号，数据在他们各自浏览器里。部署新版本后：
- 当玩家（或你）**再次打开一次游戏**，前端会把这些本机账号**自动镜像到云端**（无需手动操作）。
- 之后进后台就能看到他们了。
- 若想立刻看到：用那两个账号在任意设备**登录一次**即可触发同步。

> 注意：如果一直不开游戏、不登录，云端就不会有这些账号——这是“先有玩家行为才同步”的设计，不会偷偷上传无关数据。

---

## 五、验证清单（部署后请逐项确认）
- [ ] 后端健康检查：浏览器访问 `https://你的后端地址/` 能看到游戏页面。
- [ ] 某设备注册/登录新账号后，后台「云端」列表里**立刻**出现该账号。
- [ ] 后台禁用某账号 → 该账号再登录被拒。
- [ ] 玩家手机上打开游戏链接能正常玩、进度能续上（前端仍保留 localStorage 兜底）。
- [ ] 若后端地址暂时没填 / 后端挂了：游戏**仍能正常玩**（自动降级为纯本地模式，不报错）。

---

## 六、备选：单主机方案（前后端都在 Render，只用一个链接）
如果你不介意把游戏链接换成 Render 的地址，可以把**整个 `prototype/` 文件夹**（含 `index.html` 与 `backend/`）一起部署到 Render：
1. 把 `index.html` 复制到 `backend/` 同目录（或保持现在的结构，server.js 会自动向上一级找 index.html）。
2. 在 Render 部署时 **Publish directory / 根目录**指向项目根，`Start Command` 为 `node backend/server.js`（或把 server.js 放到根目录用 `npm start`）。
3. 游戏的 `API_BASE` 填**同一个 Render 地址**（前后端同源，连 CORS 都不用管）。
4. 分享 Render 给的链接即可，无需 Netlify。

---

## 七、安全与注意
- 密码在传输时用 HTTPS（Render/Netlify 默认提供），服务器只存哈希，不存明文。
- 管理员密码 `4423` 同时写在前端 `index.html` 和后端。它用于“登录后端拿管理 token”，
  普通玩家拿不到管理权限（封禁等写操作需该 token）。若担心泄露，请按上文改成强密码 + 环境变量。
- `data/accounts.json` 是玩家数据的**唯一真相来源（在后端启用后）**。请勿手动删除该文件。
  后端还提供「导出备份」（在后台点 ⬇️ 导出备份），建议定期导出留存。
- 免费 Render 实例**长时间无人访问会休眠**，首次访问可能慢 1~2 秒，属正常现象。

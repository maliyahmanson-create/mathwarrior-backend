/* =========================================================================
 * 数学小勇士 · 后端服务（纯 Node，零依赖）
 * -------------------------------------------------------------------------
 * 职责：
 *   1) 托管前端游戏（同目录下的 index.html）
 *   2) 提供 /api/* 接口，集中存储所有玩家的账号与进度（跨设备可查、可封禁）
 *
 * 启动：  node server.js        （或 npm start）
 * 端口：  环境变量 PORT，默认 3000
 * 管理员密码：环境变量 ADMIN_PWD，默认 4423（与前端 index.html 中的保持一致）
 *
 * 数据存储：data/accounts.json（首次运行自动创建）。适用于有可写文件系统的
 *           Node 主机（Render / Railway / Fly / 自己的服务器等）。
 *           注意：Netlify Drop 等“纯静态”托管无法运行本服务，需要 Node 主机。
 * ========================================================================= */

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const ADMIN_PWD = process.env.ADMIN_PWD || "4423";
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "accounts.json");
// 优先用同目录的 index.html；找不到再向上一级找（方便把 backend/ 与 index.html 一起部署）
const GAME_FILE = fs.existsSync(path.join(__dirname, "index.html"))
  ? path.join(__dirname, "index.html")
  : path.join(__dirname, "..", "index.html");

/* ---------- 数据读写（带损坏保护，绝不覆盖清空） ---------- */
function loadDB() {
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    const o = JSON.parse(raw);
    return (o && typeof o === "object") ? o : {};
  } catch (e) {
    return {};
  }
}
function saveDB(db) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
    return true;
  } catch (e) {
    console.error("saveDB failed:", e && e.message);
    return false;
  }
}

/* ---------- 密码哈希（SHA-256 + 随机盐） ---------- */
function newSalt() { return crypto.randomBytes(8).toString("hex"); }
function hashPwd(pwd, salt) {
  return crypto.createHash("sha256").update(salt + "|" + (pwd || "")).digest("hex");
}

/* ---------- 管理员 token（内存态，重启需重登；1 小时有效） ---------- */
const adminTokens = new Map();
function checkToken(token) {
  if (!token) return false;
  const exp = adminTokens.get(token);
  if (!exp) return false;
  if (Date.now() > exp) { adminTokens.delete(token); return false; }
  return true;
}

/* ---------- HTTP 辅助 ---------- */
function send(res, code, obj, extraHeaders) {
  const body = JSON.stringify(obj);
  res.writeHead(code, Object.assign({
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  }, extraHeaders || {}));
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve) => {
    let d = "";
    req.on("data", (c) => { d += c; if (d.length > 1e6) req.destroy(); });
    req.on("end", () => { try { resolve(JSON.parse(d || "{}")); } catch (e) { resolve({}); } });
  });
}
// 把账号记录转成可下发的进度对象（去掉盐与哈希）
function toState(a) {
  return {
    user: a.user, name: a.name,
    gi: a.gi | 0, level: a.level | 0, qi: a.qi | 0,
    points: a.points | 0, coins: a.coins | 0, combo: a.combo | 0,
    lc: a.lc | 0, levelPoints: a.levelPoints | 0, disabled: !!a.disabled
  };
}
const PROGRESS_FIELDS = ["gi", "level", "qi", "points", "coins", "combo", "lc", "levelPoints", "name", "disabled"];

/* ====================== API 实现 ====================== */
async function apiRegister(res, b) {
  const user = (b.user || "").trim();
  const pwd = b.pwd || "";
  const name = (b.name || "").trim();
  if (user.length < 2) return send(res, 400, { ok: false, error: "账号至少 2 位" });
  if (pwd.length < 4) return send(res, 400, { ok: false, error: "密码至少 4 位" });
  const db = loadDB();
  if (db[user]) return send(res, 409, { ok: false, error: "账号已存在" });
  const salt = newSalt();
  db[user] = Object.assign(toState({ user, name: name || user }), {
    salt: salt, pwd: hashPwd(pwd, salt), updated: Date.now()
  });
  saveDB(db);
  send(res, 200, { ok: true, user: user });
}

async function apiLogin(res, b) {
  const user = (b.user || "").trim();
  const pwd = b.pwd || "";
  const db = loadDB();
  const a = db[user];
  if (!a) return send(res, 404, { ok: false, error: "账号不存在" });
  if (a.disabled) return send(res, 403, { ok: false, error: "disabled" });
  if (hashPwd(pwd, a.salt || "") !== a.pwd) return send(res, 401, { ok: false, error: "密码错误" });
  send(res, 200, { ok: true, user: user, state: toState(a) });
}

async function apiProgress(res, b) {
  const user = (b.user || "").trim();
  const pwd = b.pwd || "";
  const db = loadDB();
  const a = db[user];
  if (!a) return send(res, 404, { ok: false, error: "账号不存在" });
  if (hashPwd(pwd, a.salt || "") !== a.pwd) return send(res, 401, { ok: false, error: "密码错误" });
  const s = b.state || {};
  PROGRESS_FIELDS.forEach((k) => { if (k in s) a[k] = s[k]; });
  a.updated = Date.now();
  saveDB(db);
  send(res, 200, { ok: true });
}

async function apiAdminLogin(res, b) {
  const pwd = b.pwd || "";
  if (pwd !== ADMIN_PWD) return send(res, 401, { ok: false, error: "密码错误" });
  const token = crypto.randomBytes(16).toString("hex");
  adminTokens.set(token, Date.now() + 3600 * 1000);
  send(res, 200, { ok: true, token: token });
}

async function apiAdminUsers(res, token) {
  if (!checkToken(token)) return send(res, 401, { ok: false, error: "未授权" });
  const db = loadDB();
  const users = Object.keys(db).map((user) => {
    const a = db[user];
    const s = toState(a);
    s.updated = a.updated || 0;
    return s;
  }).sort((x, y) => (y.updated || 0) - (x.updated || 0));
  send(res, 200, { ok: true, users: users });
}

async function apiAdminToggle(res, b) {
  if (!checkToken(b.token)) return send(res, 401, { ok: false, error: "未授权" });
  const user = (b.user || "").trim();
  const disabled = !!b.disabled;
  const db = loadDB();
  if (!db[user]) return send(res, 404, { ok: false, error: "账号不存在" });
  db[user].disabled = disabled;
  db[user].updated = Date.now();
  saveDB(db);
  send(res, 200, { ok: true });
}

async function apiAdminExport(res, token) {
  if (!checkToken(token)) return send(res, 401, { ok: false, error: "未授权" });
  send(res, 200, { ok: true, db: loadDB() });
}

/* ====================== 静态托管 ====================== */
function serveStatic(res) {
  fs.readFile(GAME_FILE, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("index.html not found (请把游戏 index.html 放在与 server.js 同目录)");
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Access-Control-Allow-Origin": "*" });
    res.end(data);
  });
}

/* ====================== 路由 ====================== */
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://localhost");
  const p = u.pathname;
  if (req.method === "OPTIONS") { send(res, 204, {}); return; }

  if (p.startsWith("/api/")) {
    const body = (req.method === "POST")
      ? await readBody(req)
      : Object.fromEntries(u.searchParams);
    try {
      if (p === "/api/register") return apiRegister(res, body);
      if (p === "/api/login") return apiLogin(res, body);
      if (p === "/api/progress") return apiProgress(res, body);
      if (p === "/api/admin/login") return apiAdminLogin(res, body);
      if (p === "/api/admin/users") return apiAdminUsers(res, body.token || u.searchParams.get("token"));
      if (p === "/api/admin/toggle") return apiAdminToggle(res, body);
      if (p === "/api/admin/export") return apiAdminExport(res, body.token || u.searchParams.get("token"));
      return send(res, 404, { ok: false, error: "not found" });
    } catch (e) {
      console.error("api error:", e && e.message);
      return send(res, 500, { ok: false, error: "server error" });
    }
  }
  // 非 API 一律返回游戏页面
  serveStatic(res);
});

server.listen(PORT, () => {
  console.log("数学小勇士后端已启动: http://localhost:" + PORT);
  console.log("管理密码: " + (ADMIN_PWD === "4423" ? "4423（默认，可在环境变量 ADMIN_PWD 修改）" : "(已通过环境变量设置)"));
});

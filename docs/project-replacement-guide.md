# 项目快速替换教程

> 只保留最常用的复制命令。  
> 核心原则只有一句：**只换代码来源，不动 `.env`、`data/init.json`、Redis**，这样原来的密钥、管理员登录、API Key、账号验证基本都能保持不变。

---

## 1. 全新安装

### 安装我的项目

```bash
curl -fsSL https://raw.githubusercontent.com/nanashiwang/claude-relay-service-nanashi/main/scripts/manage.sh -o manage.sh && chmod +x manage.sh && ./manage.sh install
```

### 安装上游项目

```bash
curl -fsSL https://pincc.ai/manage.sh -o manage.sh && chmod +x manage.sh && ./manage.sh install
```

---

## 2. 已有实例切换到我的项目（保留原密钥和验证）

我的项目仓库地址：

```text
https://github.com/nanashiwang/claude-relay-service-nanashi.git
```

直接复制执行：

```bash
APP_DIR="/root/claude-relay-service/app"
BACKUP_DIR="/root/crs-switch-backup-$(date +%Y%m%d-%H%M%S)"

mkdir -p "$BACKUP_DIR"
cp "$APP_DIR/.env" "$BACKUP_DIR/.env.bak"
[ -f "$APP_DIR/data/init.json" ] && cp "$APP_DIR/data/init.json" "$BACKUP_DIR/init.json.bak"

# 先把当前实例的 origin 直接切到我的仓库
git -C "$APP_DIR" remote set-url origin "https://github.com/nanashiwang/claude-relay-service-nanashi.git"

# 先确认远程地址已经切过去
echo '===== REMOTE BEFORE UPDATE ====='
git -C "$APP_DIR" remote get-url origin

# 再用当前实例自己的更新脚本做覆盖更新
bash "$APP_DIR/scripts/manage.sh" update

echo '===== CHECK ====='
git -C "$APP_DIR" remote get-url origin
grep '^DEFAULT_REPO_URL=' "$APP_DIR/scripts/manage.sh"
bash "$APP_DIR/scripts/manage.sh" status
```

---

## 3. 已有实例切回上游项目（保留原密钥和验证）

直接复制执行：

```bash
APP_DIR="/root/claude-relay-service/app"
BACKUP_DIR="/root/crs-switch-backup-$(date +%Y%m%d-%H%M%S)"

mkdir -p "$BACKUP_DIR"
cp "$APP_DIR/.env" "$BACKUP_DIR/.env.bak"
[ -f "$APP_DIR/data/init.json" ] && cp "$APP_DIR/data/init.json" "$BACKUP_DIR/init.json.bak"

# 先把当前实例的 origin 直接切回上游仓库
git -C "$APP_DIR" remote set-url origin "https://github.com/Wei-Shaw/claude-relay-service.git"

# 先确认远程地址已经切回去
echo '===== REMOTE BEFORE UPDATE ====='
git -C "$APP_DIR" remote get-url origin

# 再执行更新
bash "$APP_DIR/scripts/manage.sh" update

echo '===== CHECK ====='
git -C "$APP_DIR" remote get-url origin
bash "$APP_DIR/scripts/manage.sh" status
```

---

## 4. 快速检查密钥和验证是否还在

如果你切换后想快速确认配置没丢，直接执行：

```bash
APP_DIR="/root/claude-relay-service/app"

echo '===== ENV SAFE ====='
grep -E '^(PORT|REDIS_HOST|REDIS_PORT|REDIS_PASSWORD|REDIS_DB|LOG_LEVEL|ENCRYPTION_KEY|JWT_SECRET|API_KEY_PREFIX)=' "$APP_DIR/.env" | sed 's/\(ENCRYPTION_KEY=\).*/\1<redacted>/' | sed 's/\(JWT_SECRET=\).*/\1<redacted>/'

echo
echo '===== ADMIN SOURCE ====='
[ -f "$APP_DIR/data/init.json" ] && cat "$APP_DIR/data/init.json"

echo
echo '===== STATUS ====='
bash "$APP_DIR/scripts/manage.sh" status
```

---

## 5. 只记住这 3 条

- 不要删除 `.env`
- 不要删除 `data/init.json`
- 不要清空 Redis

只要这三样不动，通常就不会把原来的密钥、管理员登录和验证状态搞丢。

---

## 6. 如果切换没成功

如果你执行后看到下面这种结果：

- `git -C "$APP_DIR" remote get-url origin` 还是旧仓库
- 更新日志里还是 `From https://github.com/Wei-Shaw/claude-relay-service`
- `grep '^DEFAULT_REPO_URL=' "$APP_DIR/scripts/manage.sh"` 没输出

那通常说明：

- 你当前服务器里的 `manage.sh` 还是旧版上游脚本
- 这个旧脚本并不认 `CRS_REPO_URL`
- 所以它还是按当前 `origin` 去更新

最稳的做法不是只 `export CRS_REPO_URL`，而是像上面脚本那样，**先直接改 `origin`，再执行 `update`**

补充：

- `update` 本身通常会自动重启服务
- 所以一般不需要在后面再手动执行一次 `restart`

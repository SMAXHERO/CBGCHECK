# 信息安全说明

本仓库是**公开**的。这份文档说明：什么需要保护、已经做了哪些防护、以及你可以怎么验证。

---

## 一、这个项目里，什么算敏感信息

| 类别 | 具体内容 | 泄露后果 | 现状 |
|---|---|---|---|
| **登录态** | `tools/cbg/scraper-service/profile/` 里的 `Cookies`、`Login Data` | 等同于把藏宝阁账号会话交给别人 | ✅ 被 gitignore，且 `pre-push` 钩子二次拦截 |
| **访问凭据** | GitHub token、SSH 私钥、`.env` 文件 | 可被用来推送代码、冒充身份 | ✅ 同上 |
| **个人身份** | 提交者姓名与邮箱（写在每个 commit 里） | 邮箱被公开、可能被爬虫收集 | ⚠️ 见第四节 |
| **账号数据** | 抓取到的账号列表 | 本身就是公开信息 | ⬜ 不敏感（详见下） |

### 为什么「抓取到的账号数据」不算敏感

它来自藏宝阁**公开的商品列表页**（价格、区服、一速、签到天数这类账号属性），
任何人在藏宝阁网站上都能看到。而且：

- 本项目的查询是**实时**的，数据不进仓库
- 仓库里 `cbg-web/public/data/` 只有条件定义（`filters.json`）与区服清单（`servers.json`），
  以及一份 78 条的历史演示数据
- **不含**卖家信息、联系方式、订单号明文等任何个人数据

---

## 二、两层防护

### 第一层：`.gitignore`

```gitignore
tools/cbg/scraper-service/profile/     # 浏览器用户目录（含登录态）
**/profile/
*git-cred*  *credential*               # 凭据类文件名
*.token  *.pem  *.key  id_rsa*  id_ed25519*
.env  .env.*
```

### 第二层：`pre-push` 钩子

安装（**clone 后需要执行一次**）：

```bash
git config core.hooksPath .githooks
```

它会在每次 `git push` 前扫描**将要上传的文件**（包括已提交和暂存区），命中即阻止推送：

| 检查项 | 说明 |
|---|---|
| `ghp_`/`gho_`/`ghu_`/`ghs_`/`ghr_` 开头的串 | GitHub token |
| `BEGIN ... PRIVATE KEY` | 私钥内容 |
| `AKIA...` / `ASIA...` | AWS 访问密钥 |
| `password=` / `api_key=` / `app_secret=` 等赋值 | 硬编码凭据 |
| `Cookie: xxx=` | Cookie 头内容 |
| 文件名含 `profile/`、`Cookies`、`Login Data`、`credential`、`.env` | 凭据与登录态文件 |

同时会**提醒**提交者邮箱是否为真实邮箱（只警告，不阻止）。

确认某个命中是误报时，可以绕过：

```bash
git push --no-verify
```

### 第三层（GitHub 侧，自动生效）

- **Push protection**：GitHub 会在服务端扫描并拒绝含密钥的推送。
  本项目开发过程中它**实际拦下过一次**（一个误入提交的 token 文件），说明这道防线是有效的。
- **Secret scanning**：公开仓库自动开启，支持范围的密钥一旦进入历史会被标记。

---

## 三、你可以自己验证

```bash
# 1. 仓库里有没有被跟踪的凭据类文件（应无输出）
git ls-files | grep -Ei 'profile/|cookies|login data|credential|\.env|\.pem|\.key'

# 2. 当前文件里有没有密钥形态的串（应无输出）
git grep -nE 'gh[pousr]_[A-Za-z0-9]{20,}|BEGIN [A-Z ]*PRIVATE KEY|AKIA[0-9A-Z]{16}'

# 3. 整个 git 历史里有没有（应无输出）
git log -p --all | grep -E 'gh[pousr]_[A-Za-z0-9]{20,}'

# 4. 钩子是否已启用（应输出 .githooks）
git config core.hooksPath
```

第 3 条尤其重要：**历史里推上去的东西，即使后来删除也仍然存在**，所以要查历史而不只是查当前文件。

---

## 四、已知的暴露项：提交者邮箱

目前所有提交的作者与提交者都是：

```
maxsalt <smh0103@163.com>
```

这是**公开可见**的（GitHub 的提交列表、`git log` 都能看到）。

- 属于**隐私**问题，不是**安全**问题：邮箱本身不能用来登录任何东西
- 如果不想暴露，两个选择：

  **A. 只影响以后的提交**（简单，历史里仍能查到）

  ```bash
  git config --global user.email "<你的数字ID>+SMAXHERO@users.noreply.github.com"
  ```

  数字 ID 可在 https://github.com/settings/emails 页面看到。

  **B. 重写历史，把已有提交也改掉**（彻底，但会改变所有 commit 哈希）

  ```bash
  # 需要 git-filter-repo：pip install git-filter-repo
  git filter-repo --email-callback '
      return email.replace(b"smh0103@163.com", b"<数字ID>+SMAXHERO@users.noreply.github.com")
  '
  git push --force
  ```

  本仓库没有协作者、没有 fork，所以重写是安全的。

---

## 五、给贡献者的检查清单

提交前过一遍：

- [ ] 没有 `git add` 任何 `profile/`、`Cookies`、`.env`、凭据文件
- [ ] 代码里没有硬编码的 token / 密码（用环境变量或本地配置文件）
- [ ] `git config core.hooksPath .githooks` 已设置（钩子会替你兜底）
- [ ] 推送前看一眼 `git diff --cached`，确认没有意外内容
- [ ] 如果不小心推了密钥：**立即撤销那个密钥**，然后再清理历史——
      清理历史不能挽回已经泄露的凭据

---

## 六、报告安全问题

如果发现本仓库存在信息泄露（例如某个文件里意外含有凭据），请：

1. 不要在公开 issue 里贴出具体内容
2. 通过仓库的 **Security → Report a vulnerability** 私下提交
3. 或直接联系仓库所有者

---

## 七、这个项目不会做的事

以下是设计上的边界，也是安全性的来源：

- **不读取、不保存你的账号密码**：登录完全在服务拉起的浏览器里手动完成
- **不把登录态写到仓库或任何会被提交的位置**
- **不向任何第三方服务器上传数据**：查询链路是本机浏览器 → 藏宝阁，中间没有我们的服务器
- **不绕过登录或权限校验**：请求由页面自己发出，带着使用者自己的会话

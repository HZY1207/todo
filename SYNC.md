# 把改动同步回你的工作副本

你的工作副本：`E:\work\vs\todo`（git 仓库，`main` 指向上游 `1cb69794`）
本次改动都做在这个镜像目录里：`E:\work\dsh\HZY1207-todo`

我没有写你的工作副本（它在会话沙箱之外），所以需要你执行下面的复制命令。
复制前建议先 `git status` / `git stash`，复制后用 `git diff` 复核再提交。

## 一、改动的文件（8 个）

| 文件 | 大小 | 改动性质 |
| --- | ---: | --- |
| `index.html` | 6538 B | 主题首帧脚本、favicon、未排期筛选与按钮、撤销提示、从备份还原、无障碍属性 |
| `css/style.css` | 13382 B | 完成勾改状态类、编辑态、未排期、撤销提示、触屏微调、对比度 |
| `js/store.js` | 7826 B | id 生成、写入失败保护、导入校验/id 重编/去重、覆盖还原、`setDate`/`restore` |
| `js/app.js` | 18388 B | 去重复监听、空态文案、编辑（内容+日期）、长按、通用提示（撤销/刷新）、对话框焦点 |
| `js/calendar.js` | 9286 B | 严格日期解析、动态行数、未排期面板、严格 `select` |
| `js/theme.js` | 1862 B | 首帧主题一致、meta theme-color 同步 |
| `sw.js` | 3258 B | 逐个缓存、版本化缓存名、导航网络优先、作用域守卫 |
| `manifest.json` | 569 B | 去 `any maskable`、加 `id`、去掉方向锁定 |
| `README.md` | 2365 B | 功能与操作说明更新 |

## 二、新增的文件（3 个）

| 文件 | 说明 |
| --- | --- |
| `favicon.ico` | 由 `images/icon-192.png` 生成（PNG-in-ICO，2687 B），消除 `/favicon.ico` 的 404 |
| `_review/harness.js` | 回归测试：110 项探针（自带 DOM/localStorage 桩，`node _review/harness.js`） |
| `_review/serve-check.js` | HTTP 冒烟测试：起静态服务并逐个请求所有资源（`node _review/serve-check.js`） |

## 三、复制命令

```powershell
$src  = 'E:\work\dsh\HZY1207-todo'
$dst  = 'E:\work\vs\todo'

# 先备份（可选但建议）
Copy-Item $dst "$dst-backup-$(Get-Date -Format yyyyMMdd-HHmm)" -Recurse

# 同步业务文件
foreach ($f in 'index.html','manifest.json','sw.js','README.md','favicon.ico') {
  Copy-Item (Join-Path $src $f) (Join-Path $dst $f) -Force
}
foreach ($f in 'css\style.css','js\store.js','js\theme.js','js\calendar.js','js\app.js') {
  $d = Join-Path $dst (Split-Path $f)
  if (-not (Test-Path $d)) { New-Item -ItemType Directory -Path $d | Out-Null }
  Copy-Item (Join-Path $src $f) (Join-Path $dst $f) -Force
}

# 测试文件（不想放进仓库可以跳过）
New-Item -ItemType Directory -Force -Path (Join-Path $dst '_review') | Out-Null
Copy-Item "$src\_review\*" (Join-Path $dst '_review') -Force

# 复核
Set-Location $dst
git status --short
node _review\harness.js        # 期望：110/110 probes pass, 0 anomalies
node _review\serve-check.js    # 期望：all HTTP checks passed
```

`images/icon-192.png` 与 `images/icon-512.png` **不需要复制**：这两个文件本来就一致
（SHA-256 已比对，2665 B / 7326 B 完全相同），我是从你的副本里读进来补齐镜像的。

## 四、复制后自检清单

- [ ] `git diff` 里没有出现意外的换行符整体重写（原仓库除 `css/style.css` 外均无结尾换行，我保持了这一约定）
- [ ] 勾选一条待办，圆圈变实心并出现白色 ✓（这是修复的核心视觉 bug）
- [ ] 设置里切到「黑白」，刷新页面，首帧不再是绿白
- [ ] 添加一条不填日期的待办，月历顶部出现「未排期 1」，点进去能看到它；清单视图的「未排期」筛选也能看到
- [ ] 对已有待办点 ✎，改日期或清空日期后保存
- [ ] 手机上长按待办文字进入编辑，且不会顺带被标记完成
- [ ] 删除一条待办，底部出现「已删除 / 撤销」，点撤销能恢复
- [ ] 导出备份后点「导入并合并」选同一文件，提示里应显示"跳过 N 条重复"且总数不变
- [ ] 点「从备份还原」选同一文件，确认后数据被替换为备份内容
- [ ] 部署到 Pages 后，改动需要改 `sw.js` 的 `CACHE`（现为 `todo-v2`）才会推送给已安装的用户

## 五、上游仓库的状态

这个镜像的文件与 `https://github.com/HZY1207/todo` 的 `main`（`1cb69794`）原本逐字节相同，
本次改动是本地的，**上游没有这些提交**。要更新线上，需要在你的仓库里提交并推送：

```powershell
Set-Location E:\work\vs\todo
git add -A
git commit -m "fix: 完成勾不显示、导入 id 撞车、列表双渲染、存储写入失败；新增未排期与撤销"
git push
```

推送后等 1~2 分钟 GitHub Pages 生效。用户端要拿到新版，仍需 `sw.js` 的 `CACHE` 版本号变化
（本次已从 `todo-v1` 提到 `todo-v2`，所以这一次会自动更新）。

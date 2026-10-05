# 来源与版本记录

## 上游

- 仓库：https://github.com/HZY1207/todo
- 默认分支：`main`
- 基线提交：`1cb69794d13ce7e58154509f17c1d36f4d6a5bdc`
- 本目录：`E:\work\dsh\HZY1207-todo`（评审与修复都在这里进行）

## 这个目录是怎么来的

本机 shell 无法直连 GitHub（`git clone`、`curl`、`Invoke-WebRequest` 都超时），
所以文件是用 DSH 的 `web_fetch` 逐文件取回、再用 `write` 原样落盘的：

- 9 个文本文件走 `https://ghproxy.net/https://raw.githubusercontent.com/HZY1207/todo/main/<path>`
  （`raw.githubusercontent.com` 与 `github.com/.../raw/...` 在本环境均报 `TypeError: fetch failed`）
- 元数据与期望哈希走 `https://api.github.com/repos/HZY1207/todo/git/trees/<sha>?recursive=1`

每个文件都按字节数和 Git blob SHA-1（`sha1("blob <size>\0" + bytes)`）双向校验，全部与上游一致：

| 路径 | 基线字节 | 基线 blob SHA-1 |
| --- | ---: | --- |
| `README.md` | 1433 | `c4eab54dca30da5140f31c0dc384f8892d7a237a` |
| `index.html` | 4191 | `4159dac48c7658c483b84d3856c61fab6764177f` |
| `manifest.json` | 568 | `2630459095e99b7d553e229b02d4acbae06cb2ee` |
| `sw.js` | 1189 | `04596955e46d5cccd3bbc5436001c868b7877465` |
| `css/style.css` | 10320 | `40588707867f40586ca17d33151c56448fe2dd0e` |
| `js/app.js` | 7650 | `3e3713aa19cf67cbd768068ac6f8cef992f3e3f1` |
| `js/calendar.js` | 6422 | `4fc021bcb86aee7e1d10f4f7285d709811db8fb1` |
| `js/store.js` | 3075 | `2ef277c72ca65e905498b09ca550ad8d7d639abb` |
| `js/theme.js` | 1124 | `abe8bf87a09c21fcb1f1cead9c7aedd70e06ac48` |

换行约定：以上 9 个文件里 8 个结尾没有换行，只有 `css/style.css` 以单个 LF 结尾。
修复时保持了这个约定，以免 diff 里出现整文件重写。

两个 PNG 图标（`images/icon-192.png` 2665 B、`images/icon-512.png` 7326 B）无法用
`web_fetch` 传输，是从本机工作副本 `E:\work\vs\todo\images\` 读入的，SHA-256 已比对一致
（与上游 tree 里的字节数 2665 / 7326 相同）。

## 修复后的版本

本目录的内容**已经不是上游基线**：`REVIEW.md` 记录的 11 项问题已修复，
详见 `REVIEW.md` 的「修复结果」一节，以及 `SYNC.md` 的同步步骤。

当前工作文件（修复后）：

| 路径 | 字节 | SHA-256（前 16 位） |
| --- | ---: | --- |
| `index.html` | 6538 | `5D777FEE6A773721` |
| `manifest.json` | 569 | `CB273D9860D0E7A0` |
| `sw.js` | 3258 | `71440198AEFC38F1` |
| `css/style.css` | 13382 | `082037241A8914F9` |
| `js/store.js` | 7826 | `0B3F6A3785977F52` |
| `js/theme.js` | 1862 | `B6FBB03926DB6482` |
| `js/calendar.js` | 9286 | `65E697238BC80F14` |
| `js/app.js` | 18388 | `D5F6D4CFE036B955` |
| `favicon.ico` | 2687 | `B5E1FD408DDBBA29` |
| `README.md` | 2365 | `891045FD6EA894E8` |
| `REVIEW.md` | 18749 | 修复前的评审（保留作依据） |
| `FIXES.md` | 8050+ | 修复清单与验证 |
| `SYNC.md` | 4475+ | 同步回工作副本的步骤 |
| `_review/harness.js` | 49019 | `3476A72F9AD2A412` |
| `_review/serve-check.js` | 3948 | `A6B91115D734DA2A` |

## 测试

```powershell
node _review\harness.js       # 84 项探针，期望 84/84 pass
node _review\serve-check.js   # 起本地静态服务，期望 all HTTP checks passed
```

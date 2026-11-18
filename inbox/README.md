# recess-inbox（模板）

这个目录是**私有**收件箱仓库 `recess-inbox` 的模板，不在公开仓库里运行。

- 投稿由 Worker 通过 GitHub App 在 `recess-inbox` 开 Issue。未审核的原文只存在那里。
- 把 `.github/workflows/souvenir.yml` 复制到 `recess-inbox`，按文件头设好 variables / secrets。
- 审核通过的投稿由 Action 往公开仓库开 PR，PR 里只有生成的 YAML 和枚举汇总。
- `app-check.yml`：手动运行，检查 App 对内容仓库有没有需要的权限（铸 token、读 main、建一个临时分支再删掉），不公开任何内容。
- 设 repo variable `RECESS_DRY_RUN=true` 时，审核照常跑，但「通过」时只做本地提交和 `git push --dry-run`，不推送、不开 PR，Issue 转 needs-human。

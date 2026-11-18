# recess-inbox（模板）

这个目录是**私有**收件箱仓库 `recess-inbox` 的模板，不在公开仓库里运行。

- 投稿由 Worker 通过 GitHub App 在 `recess-inbox` 开 Issue。未审核的原文只存在那里。
- 把 `.github/workflows/souvenir.yml` 复制到 `recess-inbox`，按文件头设好 variables / secrets。
- 审核通过的投稿由 Action 往公开仓库开 PR，PR 里只有生成的 YAML 和枚举汇总。

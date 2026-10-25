# 第三方资源

本项目随附以下前端资源，以支持无需构建和联网的本地阅读。它们保留原作者版权和各自的许可证；根目录 MIT 许可证仅适用于本项目原创部分。

| 资源 | 锁定版本 | 许可证 | 随附许可文本 |
| --- | --- | --- | --- |
| markdown-it | 15.0.3 | MIT | [markdown-it-LICENSE.txt](阅读器/web/vendor/markdown-it-LICENSE.txt) |
| KaTeX（含字体） | 0.19.0 | MIT | [katex-LICENSE.txt](阅读器/web/vendor/katex-LICENSE.txt) |
| DOMPurify | 3.4.17 | Apache-2.0 OR MPL-2.0 | [dompurify-LICENSE.txt](阅读器/web/vendor/dompurify-LICENSE.txt) |

依赖树与完整性校验保存在 `阅读器/package-lock.json`。更新依赖时同时更新锁文件、随附浏览器资源与许可文本，并运行阅读器测试。

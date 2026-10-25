# Zhiye · 知页

**A local study workspace for course materials, AI-assisted explanations, and your own understanding.**

[中文](README.md) · [Example note](知识库/数学/投影与最小二乘.md) · [Contributing](CONTRIBUTING.md)

Zhiye combines a Markdown knowledge base, reusable AI tutoring instructions, study templates, and a local reader with math rendering, search, highlights, and annotations. The included interface and learning materials are primarily in Chinese, with English technical terms alongside explanations.

![Zhiye displaying the original least-squares example](docs/reader-preview.png)

## Start

Python 3.9+ and a modern browser are enough. No Python packages, API keys, or frontend build are needed for reading.

```bash
git clone https://github.com/moimksa/zhiye.git
cd zhiye
python3 阅读器/launch.py
```

On Windows, use `py -3` instead of `python3`. On macOS, you can also double-click `打开阅读器.command`. The launcher opens a loopback-only service, normally at `http://127.0.0.1:8765`. To run in the foreground and stop with `Ctrl+C`, use `python3 阅读器/server.py`.

## A complete learning example

The repository includes one original learning case: **projection and least squares**, with an explanatory note, self-test, and separate solutions. It demonstrates how to preserve assumptions, derivations, terminology, and verifiable calculations without claiming that reading a note proves mastery.

For your own course, run `python3 scripts/init_workspace.py`. This creates an ignored `个人资料/` directory with blank profile and learning-record templates. Existing files are never overwritten. Store personal materials there and ask your AI assistant to read [AGENTS.md](AGENTS.md) and the project [course-explainer skill](.agents/skills/course-explainer/SKILL.md). The reader itself does not call an AI service.

## Data and development

Notes remain regular Markdown files. Highlights and preferences stay in the ignored `阅读器/data/` directory. There is no built-in telemetry, account system, or cloud sync. External links and remote images in your own notes can still contact external websites. An external AI assistant has its own data handling practices.

For development, install Node.js 20+, then run `npm ci` and `npm test` inside `阅读器/`. From the repository root, `python3 scripts/check_public.py` checks tracked files for common private data patterns and broken local links. Ignore rules and this check do not replace review of what you publish.

Original code, documentation, templates, and example materials are under the [MIT License](LICENSE). Bundled libraries retain their own licenses; see [third-party notices](THIRD_PARTY_NOTICES.md). University slides, textbooks, real submissions, and personal learning histories are not distributed.

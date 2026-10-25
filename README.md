<p align="center">
  <img src="public/monocode.png" alt="MonoCode" width="88" />
</p>

<h1 align="center">MonoCode</h1>

<p align="center">
  <strong>A GUI for your coding agents.</strong>
</p>

<p align="center">
  <img width="1680" height="1050" alt="MonoCode with agent sessions open side by side" src="https://github.com/user-attachments/assets/2cd4a6ec-eb1e-4b45-8627-a76442ea3874" />
</p>

> [!NOTE]
> **This is [Keremcan Şeker](https://github.com/keremcanseker)'s fork of [hardbeat920/monocode](https://github.com/hardbeat920/monocode).** I use it every day to run coding agents across my products, and I keep it merged with upstream (currently v0.15.0). Everything below this note is upstream's README. What the fork adds:
>
> **Web mode: MonoCode in the browser.** A Tauri IPC shim boots the desktop UI in a browser, backed by a MonoCode host. A small Node server sits behind a proxy, and a container image ships Claude Code, OpenCode and Hermes Agent (with its Telegram gateway, MCP support and Playwright with Chromium). The layout adapts to phones. I run it on a server and drive agents from anywhere.
>
> **Working with running agents.**
> - Steer a running turn from the browser, the way the desktop does, with a host-side message queue as the fallback.
> - Stop the running turn and send the next message in one step (Cmd/Ctrl+Enter).
> - Fork a Claude conversation from any message into a new tab, locally or on a remote host (a Node port of the transcript fork-point lookup).
> - Claude's own subagents are listed, timed and stoppable, and finished ones stop reading as running.
> - The context meter updates right after a manual `/compact`.
>
> **Multi-repo projects.**
> - The Changes pane lists nested git repositories with branch, counts and ahead/behind.
> - Orchestration workers in a folder of repositories get one isolated worktree per repo, and their edits are recorded so review can integrate them.
>
> **Smaller things.** PDFs open in the file viewer (pdf.js under Tauri's CSP), OpenCode commands and host skills appear in the remote slash menu, and large non-git folders stay searchable.

Works with your subscriptions on Claude Code, Codex, Cursor, Grok Build, OpenCode, Antigravity, Pi, omp, fx, Hermes Agent, and Devin. If they’re installed and logged in, MonoCode can run them. Tabs are sessions. The composer is the input. MonoCode does not sell tokens.

## Install

Install and sign in to at least one supported agent first. See [provider setup](docs/providers.md) for instructions.

| Platform | Download |
| --- | --- |
| macOS, Apple Silicon | [MonoCode.dmg](https://dl.usemono.dev/MonoCode.dmg) |
| macOS, Intel | [MonoCode_x64.dmg](https://dl.usemono.dev/MonoCode_x64.dmg) |
| Linux, x86_64 | [.deb, .rpm, or AppImage](https://github.com/hardbeat920/monocode/releases/latest) |
| Windows, x86_64 | [Installer](https://github.com/hardbeat920/monocode/releases/latest) |

On macOS, open the DMG and drag MonoCode to Applications. On Windows, run the installer. See [Linux setup](docs/install.md) for dependencies and package instructions.

## Get started

Open a project folder, choose an agent, and send a message. Each tab is a session. Split panes to work with sessions side by side.

- Keep conversations organized by project.
- Use separate Git worktrees for parallel tasks.
- Edit files and review changes in the app.
- Start a message with `/operator` to let an agent open sessions and manage worktrees and notes.

Monos are experimental agents that work across your projects. They keep a memory and can run scheduled tasks you set up with them.

MonoCode is still early. If something breaks, [report a bug](https://github.com/hardbeat920/monocode/issues).

## Guides

- [Provider setup](docs/providers.md)
- [Linux installation](docs/install.md)
- [Agent access with /operator](docs/agent-access.md)
- [Remote sessions, experimental](docs/remote-access.md)

## Build from source

You’ll need Node.js 20+ and a stable Rust toolchain. See [build setup](docs/building.md) for platform dependencies and packaging.

```bash
npm install
npm run tauri dev
```

Small, focused contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.

## Contributors

Thanks to everyone who contributes to MonoCode!

[![MonoCode contributors](https://contrib.rocks/image?repo=hardbeat920/monocode)](https://github.com/hardbeat920/monocode/graphs/contributors)

Contributor image by [contrib.rocks](https://contrib.rocks).

## License

[MIT](LICENSE). Provider names and logos are trademarks of their owners. See [NOTICE](NOTICE).

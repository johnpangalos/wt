# Changelog

## [0.3.2](https://github.com/johnpangalos/wt/compare/wt-v0.3.1...wt-v0.3.2) (2026-06-24)


### Bug Fixes

* **switch:** resolve editor to an absolute path for Ghostty ([#30](https://github.com/johnpangalos/wt/issues/30)) ([e5ad37b](https://github.com/johnpangalos/wt/commit/e5ad37b38d6d00570332f6906ba57e86bf89b7cc))

## [0.3.1](https://github.com/johnpangalos/wt/compare/wt-v0.3.0...wt-v0.3.1) (2026-06-24)


### Bug Fixes

* **update:** use gh CLI for release check to avoid 403 rate limits ([#28](https://github.com/johnpangalos/wt/issues/28)) ([eaa5861](https://github.com/johnpangalos/wt/commit/eaa5861ae76c361af1159c3692064652b34b18d6))

## [0.3.0](https://github.com/johnpangalos/wt/compare/wt-v0.2.0...wt-v0.3.0) (2026-06-24)


### ⚠ BREAKING CHANGES

* drive Ghostty via AppleScript instead of tmux/zellij ([#26](https://github.com/johnpangalos/wt/issues/26))

### Features

* agent-aware wt list ([#20](https://github.com/johnpangalos/wt/issues/20)) ([895fc14](https://github.com/johnpangalos/wt/commit/895fc148b0df3172f9e6aea788e1ab1d4e21856f))
* drive Ghostty via AppleScript instead of tmux/zellij ([#26](https://github.com/johnpangalos/wt/issues/26)) ([7ceda34](https://github.com/johnpangalos/wt/commit/7ceda34b7fe3fd8ed486fdfc5878c20373d307b5))
* **switch:** default to current worktree and add placement flags ([#27](https://github.com/johnpangalos/wt/issues/27)) ([b73d98c](https://github.com/johnpangalos/wt/commit/b73d98c343591d1f97c4b3bf0bd40aa13125a815))

## [0.2.0](https://github.com/johnpangalos/wt/compare/wt-v0.1.0...wt-v0.2.0) (2026-06-05)


### Features

* add `wt update`, `wt --version`, and daily update nag ([#5](https://github.com/johnpangalos/wt/issues/5)) ([5dde0a0](https://github.com/johnpangalos/wt/commit/5dde0a0fba8d8a422162dac4e7805afa9564a3be))


### Bug Fixes

* **install:** normalize WT_VERSION to the real release tag ([#12](https://github.com/johnpangalos/wt/issues/12)) ([3e1a812](https://github.com/johnpangalos/wt/commit/3e1a812bec1b1b8178f2733923a217f1ce536bcb))
* remove release-as pin so release-please bumps versions ([#13](https://github.com/johnpangalos/wt/issues/13)) ([0245c6c](https://github.com/johnpangalos/wt/commit/0245c6c7e53392da2c474b41ac84b82bceb08c0c))

## [0.1.0](https://github.com/johnpangalos/wt/compare/wt-v0.1.0...wt-v0.1.0) (2026-04-19)


### Features

* add `wt update`, `wt --version`, and daily update nag ([#5](https://github.com/johnpangalos/wt/issues/5)) ([5dde0a0](https://github.com/johnpangalos/wt/commit/5dde0a0fba8d8a422162dac4e7805afa9564a3be))

## 0.1.0 (2026-04-18)


### Features

* automate releases and distribute prebuilt binaries ([#1](https://github.com/johnpangalos/wt/issues/1)) ([cdaad03](https://github.com/johnpangalos/wt/commit/cdaad0331404a1fe6fb8c4d72809b15eeeb4c3ec))

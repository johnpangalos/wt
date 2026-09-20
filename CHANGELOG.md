# Changelog

## [0.5.1](https://github.com/johnpangalos/wt/compare/wt-v0.5.0...wt-v0.5.1) (2026-09-20)


### Bug Fixes

* explain the sandbox Apple Event block instead of osascript noise ([#58](https://github.com/johnpangalos/wt/issues/58)) ([0ba46fe](https://github.com/johnpangalos/wt/commit/0ba46fecc4387a174c91344777b63225b5391b29))
* pass -- to git worktree add and reject option-like switch targets ([#54](https://github.com/johnpangalos/wt/issues/54)) ([b8279a3](https://github.com/johnpangalos/wt/commit/b8279a3d421e4a9af3fad402f0e70bce462b1fb3))
* strip control characters from wt list plain-text rows ([#55](https://github.com/johnpangalos/wt/issues/55)) ([2f63286](https://github.com/johnpangalos/wt/commit/2f6328607bd0ded780a54b767d6dc93d22cdb854))
* **update:** confirm prompt never appears — node:tty WriteStream throws under Bun ([#59](https://github.com/johnpangalos/wt/issues/59)) ([6bcfdd2](https://github.com/johnpangalos/wt/commit/6bcfdd24bdb5648de6c726419bc57f1478105d73))
* **update:** verify and install the release binary in-app instead of running a remote script ([#53](https://github.com/johnpangalos/wt/issues/53)) ([4c3e4ee](https://github.com/johnpangalos/wt/commit/4c3e4ee5ff46b715e6c744ae443cc898b22e80e2))
* validate the update-check cache before printing its tag ([#52](https://github.com/johnpangalos/wt/issues/52)) ([f6d688f](https://github.com/johnpangalos/wt/commit/f6d688f3032fccd76e6de8a634722060e2d98cb2))


### Performance Improvements

* **skill:** run wt during skill render instead of a model-driven Bash call ([#57](https://github.com/johnpangalos/wt/issues/57)) ([d67d81a](https://github.com/johnpangalos/wt/commit/d67d81ac2d2ba27e8fea069c4e301c714229e4a5))

## [0.5.0](https://github.com/johnpangalos/wt/compare/wt-v0.4.0...wt-v0.5.0) (2026-08-14)


### Features

* cut skill token cost with looser matching and a split reference ([#48](https://github.com/johnpangalos/wt/issues/48)) ([4a5492a](https://github.com/johnpangalos/wt/commit/4a5492a4beb2a30044788f8016988f73b2ca8d30))
* open a plain shell tab by default instead of $EDITOR ([#49](https://github.com/johnpangalos/wt/issues/49)) ([a8a5e96](https://github.com/johnpangalos/wt/commit/a8a5e964e4ea5b2f5a077a980e72746c0b29ee38))
* ship /wt as an agent skill installable via npx skills ([#42](https://github.com/johnpangalos/wt/issues/42)) ([07e7fd8](https://github.com/johnpangalos/wt/commit/07e7fd8c4c5a1f63bbd07eaf1e06c233ec584249))

## [0.4.0](https://github.com/johnpangalos/wt/compare/wt-v0.3.3...wt-v0.4.0) (2026-07-02)


### Features

* add hidden wt animate easter eggs (duck pond, crab, hatching egg) ([#37](https://github.com/johnpangalos/wt/issues/37)) ([dd6a369](https://github.com/johnpangalos/wt/commit/dd6a3695c935c14ecd98cbcd466abfef3aa9b5ea))

## [0.3.3](https://github.com/johnpangalos/wt/compare/wt-v0.3.2...wt-v0.3.3) (2026-06-29)


### Bug Fixes

* **switch:** ignore Ghostty's benign -1708 "Can't continue new tab" error ([#32](https://github.com/johnpangalos/wt/issues/32)) ([b87c549](https://github.com/johnpangalos/wt/commit/b87c54942869e6fdf7515710f9a80b7d915cb42b))
* **update:** recognize release-please "wt-v" tag prefix ([#34](https://github.com/johnpangalos/wt/issues/34)) ([1f0ae3e](https://github.com/johnpangalos/wt/commit/1f0ae3edaf2099e140d1bfe12fb97d58bd6023cd))

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

# pi-subagents upstream tracking

- Source: github:rasatpetabit/pi-subagents (fork of github:nicobailon/pi-subagents)
- Pinned commit: ff6f6c1 (v0.28.0)
- Fork model: soft-fork (track + selectively merge upstream changes)
- Upstream: github:nicobailon/pi-subagents (add as remote)

## Divergence log
| Date | Change | Reason |
|------|--------|--------|
| 2026-06-19 | Forked at v0.28.0 | Initial pin for owned-dependency unification |
| 2026-06-19 | worker.md: model=skynet/qwen36-27b-mtp-tp4, defaultContext=fresh | Default worker to local skynet qwen, prevent parent model inheritance |

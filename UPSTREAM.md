# pi-subagents upstream tracking

- Source: github:rasatpetabit/pi-subagents (fork of github:nicobailon/pi-subagents)
- Pinned commit: bdd1d0c (v0.30.0)
- Fork model: soft-fork (track + selectively merge upstream changes)
- Upstream: github:nicobailon/pi-subagents (remote: upstream)

## Divergence log
| Date | Change | Reason |
|------|--------|--------|
| 2026-06-19 | Forked at v0.28.0 | Initial pin for owned-dependency unification |
| 2026-06-19 | worker.md: model=skynet/qwen36-27b, defaultContext=fresh | Default worker to local skynet qwen, prevent parent model inheritance |
| 2026-06-20 | Merged upstream v0.30.0 (bdd1d0c) into rasatpetabit/v0.30.0-skynet | Track latest upstream while preserving fork defaults and acceptance/resource-limit behavior |

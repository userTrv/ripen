# @ripen/cli

The `ripen` command: create, promote and roll back features from CI or a terminal.

```bash
export RIPEN_URL=https://ripen.example.com RIPEN_ADMIN_TOKEN=...
ripen create new-editor --description "Rewritten editor"
ripen promote new-editor          # off → early
ripen health new-editor           # exit 1 while the gate does not pass
ripen promote-ready               # promote everything that is ready
ripen rollback new-editor --to off
```

Commands, exit codes and the GitHub Action: [CI and automation](https://github.com/userTrv/ripen/blob/main/docs/guide/ci.md).

## License

Apache-2.0. Part of [Ripen](https://github.com/userTrv/ripen): stability channels chosen by users, features promoted on real signals.

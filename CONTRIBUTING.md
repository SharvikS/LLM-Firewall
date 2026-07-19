# Contributing to TITAN

Thanks for helping improve TITAN. Contributions to the MIT-licensed Community
edition are welcome, from focused bug fixes and detectors to documentation,
SDKs, deployment tooling, and dashboard improvements.

## Before you start

- Search the [open issues](https://github.com/SharvikS/LLM-Firewall/issues) to
  avoid duplicating work.
- For a larger change, open an issue first and describe the problem, proposed
  approach, and affected components.
- Keep the open-core boundary in [`EDITIONS.md`](EDITIONS.md) intact. Code for
  commercially licensed features should not be moved into the MIT core.
- Do not report vulnerabilities in a public issue. Use GitHub Security
  Advisories or contact the maintainer privately at `sharviksutar@gmail.com`.

## Local setup

The fastest way to run the full stack is:

```bash
git clone https://github.com/SharvikS/LLM-Firewall.git
cd LLM-Firewall
./scripts/quickstart.sh
```

You can also work on one component at a time:

| Area | Location | Primary check |
|---|---|---|
| Go gateway | `gateway/` | `go test ./...` |
| ML engine | `ml_engine/` | `venv/bin/python -m pytest tests -q` |
| Dashboard | `dashboard/` | `npm run lint && npm run build` |
| Landing site | `landing/` | `npm run lint && npm run build` |
| Browser DLP | `browser-extension/` | `npm run lint && npm test && npm run build` |
| Helm chart | `helm/titan/` | `helm lint .` |

Use the commands relevant to your change. Integration tests that require
CockroachDB or the full Docker stack are documented in
[`docs/reference/testing.md`](docs/reference/testing.md).

## Pull requests

1. Create a focused branch from the current default branch.
2. Keep the change scoped; avoid unrelated formatting or generated artifacts.
3. Add or update tests for behavior changes.
4. Update documentation when configuration, APIs, deployment, or user-visible
   behavior changes.
5. Run the relevant checks above and include the results in the pull request.
6. Open a draft pull request early when feedback on the approach would help.

By contributing, you agree that your MIT-core contribution is licensed under
the repository's [MIT License](LICENSE).

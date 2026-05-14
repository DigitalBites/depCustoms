# PyPI OSS Package Demo

These scripts exercise the Customs PyPI proxy path with pip.

Run:

```bash
./test-basic.sh
```

On first run the helper asks for:

- proxy URL, for example `http://localhost:8080`
- raw project token from the dashboard

It writes a local `.pip.conf` ignored by git. The generated index URL uses
pip-compatible Basic auth with the project token as the username:

```text
http://<project-token>@<proxy-host>:8080/pypi/simple
```

Use `./test-advanced.sh` for individual pass/block reporting across several
direct and transitive packages.

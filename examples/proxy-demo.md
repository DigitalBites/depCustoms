# Customs Public Proxy Demo

Use these examples to route package installs through the public demo proxy:

```text
https://proxy-demo.depcustoms.com
```

You also need a Customs project token. Keep the token private and avoid committing it to source control.

For the examples below, put your token in an environment variable:

```bash
export CUSTOMS_PROJECT_TOKEN="<your-project-token>"
```

The demo proxy uses a publicly trusted TLS certificate, so you do not need to install a custom CA certificate.

## Python / pip

Create a temporary pip config for the current shell:

```bash
mkdir -p .customs-demo
cat > .customs-demo/pip.conf <<EOF
[global]
index-url = https://${CUSTOMS_PROJECT_TOKEN}@proxy-demo.depcustoms.com/pypi/simple
disable-pip-version-check = true
EOF

export PIP_CONFIG_FILE="$PWD/.customs-demo/pip.conf"
```

Install a package through the proxy:

```bash
python3 -m venv .venv
python -m pip install requests
```

Example output:

```bash
(.venv) ➜  depCustoms-demo python -m pip install requests
Looking in indexes: https://****@proxy-demo.depcustoms.com/pypi/simple
Collecting requests
  Downloading requests-2.34.2-py3-none-any.whl.metadata (4.8 kB)
Collecting charset_normalizer<4,>=2 (from requests)
  Downloading charset_normalizer-3.4.7-cp314-cp314-macosx_10_15_universal2.whl.metadata (40 kB)
Collecting idna<4,>=2.5 (from requests)
  Downloading idna-3.16-py3-none-any.whl.metadata (6.4 kB)
Collecting urllib3<3,>=1.26 (from requests)
  Downloading urllib3-2.7.0-py3-none-any.whl.metadata (6.9 kB)
Collecting certifi>=2023.5.7 (from requests)
  Downloading certifi-2026.5.20-py3-none-any.whl.metadata (2.5 kB)
Downloading requests-2.34.2-py3-none-any.whl (73 kB)
Downloading charset_normalizer-3.4.7-cp314-cp314-macosx_10_15_universal2.whl (309 kB)
Downloading idna-3.16-py3-none-any.whl (74 kB)
Downloading urllib3-2.7.0-py3-none-any.whl (131 kB)
Downloading certifi-2026.5.20-py3-none-any.whl (134 kB)
Installing collected packages: urllib3, idna, charset_normalizer, certifi, requests
Successfully installed certifi-2026.5.20 charset_normalizer-3.4.7 idna-3.16 requests-2.34.2 urllib3-2.7.0
```

To stop using the demo proxy in the current shell:

```bash
unset PIP_CONFIG_FILE
```

## NPM

Create a temporary npm config for the current shell:

```bash
mkdir -p .customs-demo
cat > .customs-demo/npmrc <<EOF
registry=https://proxy-demo.depcustoms.com
//proxy-demo.depcustoms.com/:_authToken=${CUSTOMS_PROJECT_TOKEN}
EOF

export NPM_CONFIG_USERCONFIG="$PWD/.customs-demo/npmrc"
```

Install a package through the proxy:

```bash
npm install lodash
```

Example output:

```bash
(.venv) ➜  depCustoms-demo npm install lodash

added 1 package in 2s
```

To stop using the demo proxy in the current shell:

```bash
unset NPM_CONFIG_USERCONFIG
```

## Docker

Log in to the proxy registry with any username and your project token as the password:

```bash
echo "${CUSTOMS_PROJECT_TOKEN}" | docker login proxy-demo.depcustoms.com --username customs --password-stdin
```

Pull an image through the proxy. For Docker Hub official images, either short Docker Hub names or full Docker Hub names are supported:

```bash
docker pull proxy-demo.depcustoms.com/alpine:3.20
docker pull proxy-demo.depcustoms.com/hub.docker.io/library/alpine:3.20
```

Example output:

```bash
Login Succeeded
(.venv) ➜  depCustoms-demo docker pull proxy-demo.depcustoms.com/alpine:3.20
3.20: Pulling from alpine
Digest: sha256:d9e853e87e55526f6b2917df91a2115c36dd7c696a35be12163d44e6e2a4b6bc
Status: Downloaded newer image for proxy-demo.depcustoms.com/alpine:3.20
proxy-demo.depcustoms.com/alpine:3.20
```

For other Docker Hub images, include the namespace:

```bash
docker pull proxy-demo.depcustoms.com/library/nginx:1.27
```

For another registry, include the upstream registry hostname after the proxy hostname:

```bash
docker pull proxy-demo.depcustoms.com/ghcr.io/<owner>/<image>:<tag>
```

To remove the stored Docker credentials:

```bash
docker logout proxy-demo.depcustoms.com
```

## Quick Checks

If an install is blocked, the proxy is working and the project policy denied that package or version. Try a different package/version or check the project policy in the Customs dashboard.

If you see `401 Unauthorized`, confirm `CUSTOMS_PROJECT_TOKEN` is set to a valid raw project token.

If Docker reports `pull access denied`, confirm that the image reference includes the proxy hostname first, for example:

```text
proxy-demo.depcustoms.com/hub.docker.io/library/alpine:3.20
```

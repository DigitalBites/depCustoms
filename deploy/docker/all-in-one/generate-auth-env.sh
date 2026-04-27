#!/bin/sh
#
# Initialize or patch oss/deploy/docker/all-in-one/.env for the split
# all-in-one deployment (db, auth, api, dashboard, caddy).
#
# Behavior:
#   - If .env is missing, copy .env.example to .env
#   - Only fill values when they are:
#       * absent
#       * empty
#       * still equal to the placeholder/example value
#   - Never overwrite an operator-provided non-default value
#
# Dependencies:
#   - POSIX shell
#   - openssl
#   - python3
#
# Notes:
#   - This script uses python3 for asymmetric JWK/JWT generation.
#   - It generates:
#       GOTRUE_JWT_SECRET
#       GOTRUE_JWT_KEYS
#       GOTRUE_ANON_KEY
#       GOTRUE_SERVICE_ROLE_KEY
#       GOTRUE_HOOK_SECRET
#       GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_SECRETS
#

set -e

if ! command -v openssl >/dev/null 2>&1; then
    echo "Error: openssl is required but not found."
    exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
    echo "Error: python3 is required but not found."
    echo "Install python3, then rerun ./generate-auth-env.sh."
    exit 1
fi

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
ENV_FILE="${SCRIPT_DIR}/.env"
EXAMPLE_FILE="${SCRIPT_DIR}/.env.example"

if [ ! -f "$EXAMPLE_FILE" ]; then
    echo "Error: .env.example not found."
    exit 1
fi

if [ ! -f "$ENV_FILE" ]; then
    cp "$EXAMPLE_FILE" "$ENV_FILE"
    echo "created .env from .env.example"
fi

gen_hex() {
    openssl rand -hex "$1"
}

gen_base64() {
    openssl rand -base64 "$1"
}

gen_base64url() {
    openssl rand -base64 "$1" | tr '+/' '-_' | tr -d '=\n'
}

base64_url_encode() {
    openssl enc -base64 -A | tr '+/' '-_' | tr -d '='
}

env_get() {
    key="$1"
    if grep -q "^${key}=" "$ENV_FILE"; then
        grep "^${key}=" "$ENV_FILE" | tail -n1 | cut -d= -f2-
    else
        printf ''
    fi
}

example_get() {
    key="$1"
    if grep -q "^${key}=" "$EXAMPLE_FILE"; then
        grep "^${key}=" "$EXAMPLE_FILE" | tail -n1 | cut -d= -f2-
    else
        printf ''
    fi
}

set_env() {
    key="$1"
    value="$2"
    if grep -q "^${key}=" "$ENV_FILE"; then
        tmpfile=$(mktemp)
        sed "s|^${key}=.*$|${key}=${value}|" "$ENV_FILE" > "$tmpfile"
        mv "$tmpfile" "$ENV_FILE"
    else
        last_char="$(tail -c 1 "$ENV_FILE" 2>/dev/null || true)"
        if [ -n "$last_char" ]; then
            printf '\n' >> "$ENV_FILE"
        fi
        printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
    fi
}

should_fill() {
    key="$1"
    desired="$2"
    current="$(env_get "$key")"
    example="$(example_get "$key")"

    if [ -z "$current" ]; then
        return 0
    fi

    if [ "$current" = "$example" ]; then
        if [ "$current" = "$desired" ]; then
            return 1
        fi
        return 0
    fi

    return 1
}

changed_keys=""

ensure_value() {
    key="$1"
    desired="$2"
    if should_fill "$key" "$desired"; then
        set_env "$key" "$desired"
        changed_keys="${changed_keys}
${key}"
    fi
}

build_public_origin() {
    explicit="$(env_get ALL_IN_ONE_PUBLIC_ORIGIN)"
    if [ -n "$explicit" ] && [ "$explicit" != "$(example_get ALL_IN_ONE_PUBLIC_ORIGIN)" ]; then
        printf '%s' "$explicit"
        return
    fi

    host="$(env_get ALL_IN_ONE_CADDY_HTTPS_HOST)"
    port="$(env_get ALL_IN_ONE_CADDY_HTTPS_PORT)"

    if [ -z "$host" ]; then
        printf ''
        return
    fi

    if [ -z "$port" ] || [ "$port" = "443" ]; then
        printf 'https://%s' "$host"
    else
        printf 'https://%s:%s' "$host" "$port"
    fi
}

build_proxy_public_origin() {
    explicit="$(env_get PROXY_PUBLIC_BASE_URL)"
    if [ -n "$explicit" ] && [ "$explicit" != "$(example_get PROXY_PUBLIC_BASE_URL)" ]; then
        printf '%s' "$explicit"
        return
    fi

    host="$(env_get ALL_IN_ONE_CADDY_HTTPS_HOST)"
    port="$(env_get ALL_IN_ONE_PROXY_HTTPS_PORT)"

    if [ -z "$host" ]; then
        printf ''
        return
    fi

    if [ -z "$port" ]; then
        port="8442"
    fi

    if [ "$port" = "443" ]; then
        printf 'https://%s' "$host"
    else
        printf 'https://%s:%s' "$host" "$port"
    fi
}

build_proxy_public_origins() {
    explicit_list="$(env_get PROXY_ALLOWED_PUBLIC_BASE_URLS)"
    if [ -n "$explicit_list" ] && [ "$explicit_list" != "$(example_get PROXY_ALLOWED_PUBLIC_BASE_URLS)" ]; then
        printf '%s' "$explicit_list"
        return
    fi

    explicit_single="$(env_get PROXY_PUBLIC_BASE_URL)"
    if [ -n "$explicit_single" ] && [ "$explicit_single" != "$(example_get PROXY_PUBLIC_BASE_URL)" ]; then
        printf '%s' "$explicit_single"
        return
    fi

    derived="$(build_proxy_public_origin)"
    printf '%s' "$derived"
}

gen_uuid() {
    python3 - <<'PY'
import uuid
print(uuid.uuid4())
PY
}

build_hook_secrets() {
    secret="$1"
    encoded=$(printf %s "$secret" | openssl enc -base64 -A)
    printf 'v1,whsec_%s' "$encoded"
}

generate_asymmetric_auth_material() {
    jwt_secret="$1"
    tmpdir="$(mktemp -d)"
    trap 'rm -rf "$tmpdir"' EXIT HUP INT TERM

    openssl ecparam -name prime256v1 -genkey -noout -out "$tmpdir/ec_private.pem" 2>/dev/null

    python3 "$SCRIPT_DIR/generate_auth_keys.py" "$tmpdir/ec_private.pem" "$jwt_secret"

    rm -rf "$tmpdir"
    trap - EXIT HUP INT TERM
}

generate_internal_service_jwk() {
    tmpdir="$(mktemp -d)"
    trap 'rm -rf "$tmpdir"' EXIT HUP INT TERM

    openssl ecparam -name prime256v1 -genkey -noout -out "$tmpdir/ec_private.pem" 2>/dev/null

    python3 "$SCRIPT_DIR/generate_internal_service_jwk.py" "$tmpdir/ec_private.pem"

    rm -rf "$tmpdir"
    trap - EXIT HUP INT TERM
}

PUBLIC_ORIGIN="$(build_public_origin)"
PROXY_PUBLIC_ORIGIN="$(build_proxy_public_origin)"
PROXY_PUBLIC_ORIGINS="$(build_proxy_public_origins)"

ensure_value "POSTGRES_PASSWORD" "$(gen_hex 16)"
ensure_value "BOOTSTRAP_FIRST_USER_SECRET" "$(gen_hex 32)"

if [ -n "$PUBLIC_ORIGIN" ]; then
    ensure_value "ALL_IN_ONE_PUBLIC_ORIGIN" "$PUBLIC_ORIGIN"
    ensure_value "AUTH_URL" "$PUBLIC_ORIGIN"
    ensure_value "GOTRUE_SITE_URL" "$PUBLIC_ORIGIN"
    ensure_value "GOTRUE_API_EXTERNAL_URL" "$PUBLIC_ORIGIN"
    ensure_value "GOTRUE_URI_ALLOW_LIST" "$PUBLIC_ORIGIN"
fi

if [ -n "$PROXY_PUBLIC_ORIGIN" ]; then
    ensure_value "PROXY_PUBLIC_BASE_URL" "$PROXY_PUBLIC_ORIGIN"
fi
if [ -n "$PROXY_PUBLIC_ORIGINS" ]; then
    ensure_value "PROXY_ALLOWED_PUBLIC_BASE_URLS" "$PROXY_PUBLIC_ORIGINS"
fi

ensure_value "ALL_IN_ONE_GOTRUE_DB_SCHEMA" "auth"
ensure_value "API_PORT" "3000"
ensure_value "API_LOG_LEVEL" "debug"
ensure_value "DASHBOARD_PORT" "3001"
ensure_value "AUTH_PROXY_ENABLED" "false"
ensure_value "DASHBOARD_API_PROXY_ENABLED" "false"
ensure_value "BOOTSTRAP_MODE" "bundled"
ensure_value "BOOTSTRAP_SETUP_GOTRUE" "true"
ensure_value "BOOTSTRAP_SETUP_FIRST_TENANT" "true"
ensure_value "BOOTSTRAP_SETUP_FIRST_PROXY" "true"
ensure_value "BOOTSTRAP_SETUP_DEFAULT_POLICIES" "true"
ensure_value "INTERNAL_SERVICE_JWT_KEY_ID" "internal-service-1"
ensure_value "BOOTSTRAP_PROXY_ID" "$(gen_uuid)"
ensure_value "BOOTSTRAP_PROXY_KEY" "cxp_$(gen_hex 16)"
ensure_value "PROXY_LOG_LEVEL" "info"
ensure_value "ALL_IN_ONE_PROXY_HTTPS_PORT" "8442"

BOOTSTRAP_PROXY_ID_VALUE="$(env_get BOOTSTRAP_PROXY_ID)"
if [ -n "$BOOTSTRAP_PROXY_ID_VALUE" ]; then
    ensure_value "PROXY_ID" "$BOOTSTRAP_PROXY_ID_VALUE"
fi

BOOTSTRAP_PROXY_KEY_VALUE="$(env_get BOOTSTRAP_PROXY_KEY)"
if [ -n "$BOOTSTRAP_PROXY_KEY_VALUE" ]; then
    ensure_value "PROXY_CONTROL_PLANE_SECRET" "$BOOTSTRAP_PROXY_KEY_VALUE"
fi

ensure_value "GOTRUE_DISABLE_SIGNUP" "false"
ensure_value "GOTRUE_JWT_EXP" "3600"
ensure_value "GOTRUE_SESSIONS_INACTIVITY_TIMEOUT" "2h"
ensure_value "GOTRUE_SESSIONS_TIMEBOX" "10h"
ensure_value "GOTRUE_OAUTH_SERVER_ENABLED" "true"
ensure_value "GOTRUE_OAUTH_SERVER_ALLOW_DYNAMIC_REGISTRATION" "true"
ensure_value "GOTRUE_OAUTH_SERVER_AUTHORIZATION_PATH" "/auth/oauth/authorize"
ensure_value "GOTRUE_EXTERNAL_EMAIL_ENABLED" "true"
ensure_value "GOTRUE_EXTERNAL_ANONYMOUS_USERS_ENABLED" "false"
ensure_value "GOTRUE_MAILER_AUTOCONFIRM" "true"
ensure_value "GOTRUE_MAILER_URLPATHS_INVITE" "/auth/v1/verify"
ensure_value "GOTRUE_MAILER_URLPATHS_CONFIRMATION" "/auth/v1/verify"
ensure_value "GOTRUE_MAILER_URLPATHS_RECOVERY" "/auth/v1/verify"
ensure_value "GOTRUE_MAILER_URLPATHS_EMAIL_CHANGE" "/auth/v1/verify"
ensure_value "GOTRUE_SMTP_ADMIN_EMAIL" "admin@example.com"
ensure_value "GOTRUE_SMTP_HOST" "supabase-mail"
ensure_value "GOTRUE_SMTP_PORT" "2500"
ensure_value "GOTRUE_SMTP_SENDER_NAME" "Customs"
ensure_value "GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_ENABLED" "true"
ensure_value "GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_URI" "http://host.docker.internal:3000/internal/auth/token-hook"

JWT_SECRET_VALUE="$(env_get GOTRUE_JWT_SECRET)"
if [ -z "$JWT_SECRET_VALUE" ] || [ "$JWT_SECRET_VALUE" = "$(example_get GOTRUE_JWT_SECRET)" ]; then
    JWT_SECRET_VALUE="$(gen_base64 30)"
    ensure_value "GOTRUE_JWT_SECRET" "$JWT_SECRET_VALUE"
else
    JWT_SECRET_VALUE="$(env_get GOTRUE_JWT_SECRET)"
fi

need_asymmetric_material=false
for key in GOTRUE_JWT_KEYS GOTRUE_ANON_KEY GOTRUE_SERVICE_ROLE_KEY; do
    current_value="$(env_get "$key")"
    example_value="$(example_get "$key")"
    if [ -z "$current_value" ] || [ "$current_value" = "$example_value" ]; then
        need_asymmetric_material=true
    fi
done

if [ "$need_asymmetric_material" = "true" ]; then
    generated_lines="$(generate_asymmetric_auth_material "$JWT_SECRET_VALUE")"
    GENERATED_GOTRUE_JWT_KEYS="$(printf '%s\n' "$generated_lines" | grep '^GOTRUE_JWT_KEYS=' | cut -d= -f2-)"
    GENERATED_GOTRUE_ANON_KEY="$(printf '%s\n' "$generated_lines" | grep '^GOTRUE_ANON_KEY=' | cut -d= -f2-)"
    GENERATED_GOTRUE_SERVICE_ROLE_KEY="$(printf '%s\n' "$generated_lines" | grep '^GOTRUE_SERVICE_ROLE_KEY=' | cut -d= -f2-)"

    ensure_value "GOTRUE_JWT_KEYS" "$GENERATED_GOTRUE_JWT_KEYS"
    ensure_value "GOTRUE_ANON_KEY" "$GENERATED_GOTRUE_ANON_KEY"
    ensure_value "GOTRUE_SERVICE_ROLE_KEY" "$GENERATED_GOTRUE_SERVICE_ROLE_KEY"
fi

HOOK_SECRET_VALUE="$(env_get GOTRUE_HOOK_SECRET)"
if [ -z "$HOOK_SECRET_VALUE" ] || [ "$HOOK_SECRET_VALUE" = "$(example_get GOTRUE_HOOK_SECRET)" ]; then
    HOOK_SECRET_VALUE="$(gen_base64url 32)"
    ensure_value "GOTRUE_HOOK_SECRET" "$HOOK_SECRET_VALUE"
else
    HOOK_SECRET_VALUE="$(env_get GOTRUE_HOOK_SECRET)"
fi

ensure_value "GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_SECRETS" "$(build_hook_secrets "$HOOK_SECRET_VALUE")"

INTERNAL_SERVICE_JWK_VALUE="$(env_get INTERNAL_SERVICE_JWT_PRIVATE_JWK)"
if [ -z "$INTERNAL_SERVICE_JWK_VALUE" ] || [ "$INTERNAL_SERVICE_JWK_VALUE" = "$(example_get INTERNAL_SERVICE_JWT_PRIVATE_JWK)" ]; then
    generated_internal_service_jwk="$(generate_internal_service_jwk)"
    GENERATED_INTERNAL_SERVICE_JWT_PRIVATE_JWK="$(printf '%s\n' "$generated_internal_service_jwk" | grep '^INTERNAL_SERVICE_JWT_PRIVATE_JWK=' | cut -d= -f2-)"
    ensure_value "INTERNAL_SERVICE_JWT_PRIVATE_JWK" "$GENERATED_INTERNAL_SERVICE_JWT_PRIVATE_JWK"
fi

if [ -z "$changed_keys" ]; then
    echo "no changes; .env already has non-default values for all managed keys"
    exit 0
fi

echo "updated .env with missing/defaulted values:"
printf '%s\n' "$changed_keys" | sed '/^$/d' | sed 's/^/  - /'

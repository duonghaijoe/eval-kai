"""Environment configuration stored in SQLite — includes per-profile credentials."""
import json
import os
import sqlite3
from contextlib import contextmanager

_data_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
os.makedirs(_data_dir, exist_ok=True)
DB_PATH = os.path.join(_data_dir, "kai_tests.db")

# Pre-defined defaults (seeded on first run)
_DEFAULTS = {
    "production": {
        "name": "Production",
        "base_url": "https://katalonhub.katalon.io",
        "login_url": "https://to3-devtools.vercel.app/api/login",
        "platform_url": "https://platform.katalon.com",
        "project_id": "1782829",
        "project_name": "TestOps - RA",
        "org_id": "1670719",
        "account_id": "9be50327-d44f-4def-8620-c04a1ffc93ac",
        "account_name": "Katalon Hub",
        "credentials": {"email": "", "password": "", "account": ""},
    },
    "staging": {
        "name": "Staging",
        "base_url": "https://staginggen3platform.staging.katalon.com",
        "login_url": "https://to3-devtools.vercel.app/api/login",
        "platform_url": "https://staginggen3platform.staging.katalon.com",
        "project_id": "460725",
        "project_name": "Quality Engineers",
        "org_id": "426801",
        "account_id": "8d7c8340-5bac-4cfe-9326-c0446adf8816",
        "account_name": "Katalon on Katalon",
        "credentials": {"email": "", "password": "cf054aab-de02-4059-ab49-50598983509f", "account": "1996096"},
    },
}


@contextmanager
def _get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_env_db():
    """Create env_profiles table and seed defaults if empty."""
    with _get_conn() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS env_profiles (
                key TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                base_url TEXT NOT NULL,
                login_url TEXT NOT NULL,
                platform_url TEXT NOT NULL,
                project_id TEXT,
                project_name TEXT,
                org_id TEXT,
                account_id TEXT,
                account_name TEXT,
                cred_email TEXT DEFAULT '',
                cred_password TEXT DEFAULT '',
                cred_account TEXT DEFAULT '',
                license_source_id TEXT DEFAULT '',
                license_feature TEXT DEFAULT '',
                is_active INTEGER DEFAULT 0
            )
        """)
        # Seed defaults if table is empty
        count = conn.execute("SELECT COUNT(*) FROM env_profiles").fetchone()[0]
        if count == 0:
            _seed_defaults(conn)
        else:
            # Migrate: ensure staging has correct credentials
            row = conn.execute(
                "SELECT cred_password, cred_account, account_id FROM env_profiles WHERE key = 'staging'",
            ).fetchone()
            if row:
                staging_defaults = _DEFAULTS.get("staging", {})
                staging_creds = staging_defaults.get("credentials", {})
                env_creds = _read_dotenv_creds()
                updates = []
                params = []
                if not row["cred_password"] and staging_creds.get("password"):
                    updates.append("cred_password=?")
                    params.append(staging_creds["password"])
                if not row["cred_account"] or row["cred_account"] != staging_creds.get("account", ""):
                    # Fix: staging account must be staging-specific, not inherited from production .env
                    if staging_creds.get("account"):
                        updates.append("cred_account=?")
                        params.append(staging_creds["account"])
                # Inherit email from .env if not set
                updates.append("cred_email=COALESCE(NULLIF(cred_email,''), ?)")
                params.append(env_creds.get("email", ""))
                # Fix account_id, platform_url, org_id, account_name
                updates.append("account_id=?")
                params.append(staging_defaults.get("account_id", ""))
                updates.append("platform_url=?")
                params.append(staging_defaults.get("platform_url", ""))
                updates.append("org_id=?")
                params.append(staging_defaults.get("org_id", ""))
                updates.append("account_name=COALESCE(NULLIF(account_name,''), ?)")
                params.append(staging_defaults.get("account_name", ""))
                if updates:
                    conn.execute(f"UPDATE env_profiles SET {', '.join(updates)} WHERE key='staging'", params)
        # Migrate: add license_source_id and license_feature columns
        try:
            conn.execute("SELECT license_source_id FROM env_profiles LIMIT 1")
        except sqlite3.OperationalError:
            conn.execute("ALTER TABLE env_profiles ADD COLUMN license_source_id TEXT DEFAULT ''")
            conn.execute("ALTER TABLE env_profiles ADD COLUMN license_feature TEXT DEFAULT ''")
            # Set staging defaults
            conn.execute(
                "UPDATE env_profiles SET license_source_id = '49', license_feature = 'TESTOPS_G3_FULL' WHERE key = 'staging'"
            )
        # Migrate: add MCP URL columns
        try:
            conn.execute("SELECT mcp_public_url FROM env_profiles LIMIT 1")
        except sqlite3.OperationalError:
            conn.execute("ALTER TABLE env_profiles ADD COLUMN mcp_public_url TEXT DEFAULT ''")
            conn.execute("ALTER TABLE env_profiles ADD COLUMN mcp_protected_url TEXT DEFAULT ''")
            conn.execute("UPDATE env_profiles SET mcp_public_url = 'https://mcp.katalon.com/mcp', mcp_protected_url = 'https://platform.katalon.io/mcp' WHERE key = 'production'")
            conn.execute("UPDATE env_profiles SET mcp_public_url = 'https://mcp.staging.katalon.com/mcp', mcp_protected_url = 'https://platform.staging.katalon.com/mcp' WHERE key = 'staging'")


def _seed_defaults(conn):
    """Insert default profiles, pulling creds from .env for production."""
    env_creds = _read_dotenv_creds()
    for key, profile in _DEFAULTS.items():
        creds = dict(profile.get("credentials", {}))
        if key == "production" and env_creds:
            # Production uses all .env creds
            creds = env_creds
        elif key == "staging" and env_creds:
            # Staging shares email/account from .env but has its own password
            creds["email"] = creds.get("email") or env_creds.get("email", "")
            creds["account"] = creds.get("account") or env_creds.get("account", "")
        conn.execute("""
            INSERT OR IGNORE INTO env_profiles
            (key, name, base_url, login_url, platform_url, project_id, project_name,
             org_id, account_id, account_name, cred_email, cred_password, cred_account, is_active)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            key, profile["name"], profile["base_url"], profile["login_url"],
            profile["platform_url"], profile.get("project_id", ""),
            profile.get("project_name", ""), profile.get("org_id", ""),
            profile.get("account_id", ""), profile.get("account_name", ""),
            creds.get("email", ""), creds.get("password", ""),
            creds.get("account", ""), 1 if key == "production" else 0,
        ))


def _read_dotenv_creds() -> dict:
    """Read credentials from .env file (used for initial seeding only)."""
    env_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env")
    env = {}
    if os.path.exists(env_path):
        with open(env_path) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    env[k.strip()] = v.strip().strip('"').strip("'")
    email = env.get("TESTOPS_EMAIL", "")
    password = env.get("TESTOPS_PASSWORD", "")
    account = env.get("TESTOPS_ACCOUNT", "")
    if email and password and account:
        return {"email": email, "password": password, "account": account}
    return {}


def _row_to_dict(row) -> dict:
    return {
        "name": row["name"],
        "base_url": row["base_url"],
        "login_url": row["login_url"],
        "platform_url": row["platform_url"],
        "project_id": row["project_id"] or "",
        "project_name": row["project_name"] or "",
        "org_id": row["org_id"] or "",
        "account_id": row["account_id"] or "",
        "account_name": row["account_name"] or "",
        "license_source_id": row["license_source_id"] if "license_source_id" in row.keys() else "",
        "license_feature": row["license_feature"] if "license_feature" in row.keys() else "",
        "mcp_public_url": row["mcp_public_url"] if "mcp_public_url" in row.keys() else "",
        "mcp_protected_url": row["mcp_protected_url"] if "mcp_protected_url" in row.keys() else "",
        "credentials": {
            "email": row["cred_email"] or "",
            "password": row["cred_password"] or "",
            "account": row["cred_account"] or "",
        },
    }


def load_env_config() -> dict:
    """Return full config: {active, environments}."""
    with _get_conn() as conn:
        rows = conn.execute("SELECT * FROM env_profiles ORDER BY key").fetchall()
        active_key = "production"
        envs = {}
        for r in rows:
            envs[r["key"]] = _row_to_dict(r)
            if r["is_active"]:
                active_key = r["key"]
        return {"active": active_key, "environments": envs}


def load_env_config_safe() -> dict:
    """Return config with passwords NEVER sent to frontend."""
    config = load_env_config()
    for env in config["environments"].values():
        creds = env.get("credentials", {})
        has_creds = bool(creds.get("email") and creds.get("password"))
        has_password = bool(creds.get("password"))
        # Strip sensitive fields — never send to frontend
        env["credentials"] = {
            "email": creds.get("email", ""),
            "account": creds.get("account", ""),
            "has_password": has_password,
            "has_credentials": has_creds,
        }
    return config


def save_env_config(config: dict) -> dict:
    """Save updates: switch active, update environment settings."""
    with _get_conn() as conn:
        # Switch active
        if "active" in config:
            conn.execute("UPDATE env_profiles SET is_active = 0")
            conn.execute("UPDATE env_profiles SET is_active = 1 WHERE key = ?", (config["active"],))

        # Update environments
        for key, env in config.get("environments", {}).items():
            existing = conn.execute("SELECT key FROM env_profiles WHERE key = ?", (key,)).fetchone()
            creds = env.get("credentials", {})
            if existing:
                # Preserve existing password if not explicitly provided
                if not creds.get("password"):
                    old = conn.execute("SELECT cred_password FROM env_profiles WHERE key = ?", (key,)).fetchone()
                    creds["password"] = old["cred_password"] if old else ""
                conn.execute("""
                    UPDATE env_profiles SET
                        name=?, base_url=?, login_url=?, platform_url=?,
                        project_id=?, project_name=?, org_id=?, account_id=?,
                        account_name=?, cred_email=?, cred_password=?, cred_account=?,
                        license_source_id=?, license_feature=?,
                        mcp_public_url=?, mcp_protected_url=?
                    WHERE key = ?
                """, (
                    env.get("name", key), env.get("base_url", ""),
                    env.get("login_url", ""), env.get("platform_url", ""),
                    env.get("project_id", ""), env.get("project_name", ""),
                    env.get("org_id", ""), env.get("account_id", ""),
                    env.get("account_name", ""),
                    creds.get("email", ""), creds.get("password", ""),
                    creds.get("account", ""),
                    env.get("license_source_id", ""), env.get("license_feature", ""),
                    env.get("mcp_public_url", ""), env.get("mcp_protected_url", ""),
                    key,
                ))
            else:
                # Insert new profile
                conn.execute("""
                    INSERT INTO env_profiles
                    (key, name, base_url, login_url, platform_url, project_id, project_name,
                     org_id, account_id, account_name, cred_email, cred_password, cred_account,
                     mcp_public_url, mcp_protected_url, is_active)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
                """, (
                    key, env.get("name", key), env.get("base_url", ""),
                    env.get("login_url", ""), env.get("platform_url", ""),
                    env.get("project_id", ""), env.get("project_name", ""),
                    env.get("org_id", ""), env.get("account_id", ""),
                    env.get("account_name", ""),
                    creds.get("email", ""), creds.get("password", ""),
                    creds.get("account", ""),
                    env.get("mcp_public_url", ""), env.get("mcp_protected_url", ""),
                ))

    return load_env_config()


def delete_env_profile(key: str):
    """Delete a non-active profile."""
    with _get_conn() as conn:
        row = conn.execute("SELECT is_active FROM env_profiles WHERE key = ?", (key,)).fetchone()
        if not row:
            return
        if row["is_active"]:
            raise ValueError("Cannot delete the active environment")
        conn.execute("DELETE FROM env_profiles WHERE key = ?", (key,))


def get_env_by_key(key: str) -> dict:
    """Return a specific environment's settings (with real credentials)."""
    with _get_conn() as conn:
        row = conn.execute("SELECT * FROM env_profiles WHERE key = ?", (key,)).fetchone()
        if not row:
            raise ValueError(f"Environment '{key}' not found")
        env = _row_to_dict(row)
        if not env.get("login_url"):
            env["login_url"] = "https://to3-devtools.vercel.app/api/login"
        if not env.get("base_url") and env.get("platform_url"):
            env["base_url"] = env["platform_url"]
        return env


def get_active_env() -> dict:
    """Return the active environment settings (with real credentials)."""
    with _get_conn() as conn:
        row = conn.execute("SELECT * FROM env_profiles WHERE is_active = 1").fetchone()
        if not row:
            row = conn.execute("SELECT * FROM env_profiles ORDER BY key LIMIT 1").fetchone()
        if not row:
            # Fallback to .env creds
            creds = _read_dotenv_creds()
            return {**_DEFAULTS["production"], "credentials": creds}
        env = _row_to_dict(row)
        # Ensure login_url always has a default
        if not env.get("login_url"):
            env["login_url"] = "https://to3-devtools.vercel.app/api/login"
        # Ensure base_url falls back to platform_url if not set
        if not env.get("base_url") and env.get("platform_url"):
            env["base_url"] = env["platform_url"]
        return env


def reset_env_config() -> dict:
    """Reset all profiles to defaults."""
    with _get_conn() as conn:
        conn.execute("DELETE FROM env_profiles")
        _seed_defaults(conn)
    return load_env_config()

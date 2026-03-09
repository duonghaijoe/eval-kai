"""Load Test User Provisioning — Create/teardown alias users for load testing Kai.

Simplified flow vs katalon-cec:
- No project creation (uses existing project from env profile)
- No API key creation (uses login token directly)
- Email pattern: {primary}+kai{N}@katalon.com

Provisioning steps:
1. Admin auth (reuse token cache)
2. Create user: POST /v1/users
3. Assign license + invite: POST /v2/admin/license-allocations
4. Invite to org: POST /v1/admin/account-invitations
5. Accept invitation (Keycloak OAuth flow)
6. Add to project: POST /v2/admin/project-users

Teardown steps:
1. Revoke license
2. Remove from account (deactivate)
3. Delete user profile (optional)
"""
import asyncio
import base64
import hashlib
import json
import logging
import os
import re
import secrets
import string
import time
from datetime import datetime, timedelta
from typing import Optional
from urllib.parse import urlencode, urlparse, quote

import httpx

import database as db
from env_config import get_active_env, get_env_by_key

logger = logging.getLogger(__name__)

# ── Password Generation ──────────────────────────────────────────

def _generate_password(length: int = 32) -> str:
    """Generate a strong password with uppercase, lowercase, digit, special."""
    alphabet = string.ascii_letters + string.digits + "!@#$%^&*"
    while True:
        pw = ''.join(secrets.choice(alphabet) for _ in range(length))
        if (any(c.isupper() for c in pw) and any(c.islower() for c in pw)
                and any(c.isdigit() for c in pw) and any(c in "!@#$%^&*" for c in pw)):
            return pw


def _decode_jwt_payload(token: str) -> dict:
    """Decode JWT payload (middle segment) without verification."""
    try:
        payload = token.split('.')[1]
        padding = 4 - len(payload) % 4
        if padding != 4:
            payload += '=' * padding
        return json.loads(base64.urlsafe_b64decode(payload))
    except Exception:
        return {}


# ── Admin Auth ────────────────────────────────────────────────────

class AdminAuth:
    """Manages admin authentication for provisioning operations."""

    def __init__(self, env: dict):
        self.env = env
        self.base_url = env.get("platform_url", "")
        self.login_url = env.get("login_url", "https://to3-devtools.vercel.app/api/login")
        self.admin_token: Optional[str] = None
        self.account_uuid: Optional[str] = None
        self.admin_account_id: Optional[int] = None
        creds = env.get("credentials", {})
        self.email = creds.get("email", "")
        self.password = creds.get("password", "")
        self.account = creds.get("account", "")
        # Parse account ID from account string (e.g., "1618265_true" → 1618265, or plain "1996096")
        if self.account:
            raw = self.account.split("_")[0]
            try:
                self.admin_account_id = int(raw)
            except (ValueError, TypeError):
                self.admin_account_id = None

    def _auth_headers(self) -> dict:
        return {
            "Authorization": f"Bearer {self.admin_token}",
            "x-account-id": self.account_uuid or "",
            "Content-Type": "application/json",
        }

    async def ensure_auth(self):
        """Authenticate as admin if not already."""
        if self.admin_token:
            return
        logger.info(f"Authenticating admin: {self.email} on {self.base_url}")
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(self.login_url, json={
                "url": self.base_url,
                "email": self.email,
                "password": self.password,
                "account": self.account,
            })
            resp.raise_for_status()
            data = resp.json()

        token_data = data.get("token", {})
        if isinstance(token_data, dict):
            self.admin_token = token_data.get("access_token") or token_data.get("token")
            id_token = token_data.get("id_token", "")
        else:
            self.admin_token = token_data
            id_token = data.get("id_token", "")

        if id_token:
            payload = _decode_jwt_payload(id_token)
            self.account_uuid = payload.get("account_uuid", "")

        if not self.admin_token:
            raise RuntimeError("Failed to get admin token")
        logger.info(f"Admin auth OK: account_uuid={self.account_uuid}")


# ── User Provisioning ────────────────────────────────────────────

class UserProvisioner:
    """Provisions and tears down alias users for load testing."""

    def __init__(self, env_key: str = None):
        self.env_key = env_key
        self.env = get_env_by_key(env_key) if env_key else get_active_env()
        self.auth = AdminAuth(self.env)
        self.client = httpx.AsyncClient(timeout=60, follow_redirects=False)

    async def close(self):
        await self.client.aclose()

    # ── Provision ─────────────────────────────────────────────────

    async def provision_user(self, email: str, password: str = None) -> dict:
        """Provision a single alias user. Returns user record dict."""
        await self.auth.ensure_auth()
        password = password or _generate_password()
        headers = self.auth._auth_headers()
        base = self.auth.base_url
        env = self.env
        result = {
            "email": email,
            "password": password,
            "env_key": self.env_key or "default",
            "status": "pending",
        }

        try:
            # Step 1: Create user
            logger.info(f"Creating user: {email}")
            resp = await self.client.post(f"{base}/v1/users", json={
                "email": email,
                "password": password,
                "fullName": "Kai Load Test User",
            }, headers=headers)

            if resp.status_code == 409 or (resp.status_code == 400 and "uq_users_email" in resp.text):
                logger.info(f"User {email} already exists, continuing")
                # Look up existing user
                user_id = await self._lookup_user_id(email, headers)
                result["user_id"] = user_id
            elif resp.status_code >= 400:
                raise RuntimeError(f"Create user failed ({resp.status_code}): {resp.text[:300]}")
            else:
                data = resp.json()
                user_data = data.get("data", data)
                result["user_id"] = user_data.get("id")
                logger.info(f"User created: id={result['user_id']}")

            # Step 2: Assign license + invite
            logger.info(f"Assigning license to {email}")
            lic_source_id = int(env.get("license_source_id", 49))
            feature = env.get("license_feature", "TESTOPS_G3_FULL")
            org_id = int(env.get("org_id", 0))
            expiry = (datetime.utcnow() + timedelta(days=30)).isoformat() + "Z"

            resp = await self.client.post(f"{base}/v2/admin/license-allocations", json={
                "accountId": self.auth.admin_account_id,
                "consumerType": "USER",
                "consumerId": email,
                "licenseSourceId": lic_source_id,
                "feature": feature,
                "usedQuota": 1,
                "expiryDate": expiry,
                "invite": False,  # Do NOT auto-invite — handled separately in step 3
            }, headers=headers)
            if resp.status_code >= 400 and resp.status_code != 409:
                logger.warning(f"License assign failed ({resp.status_code}): {resp.text[:300]}")
            else:
                lic_data = resp.json()
                lic_info = lic_data.get("data", lic_data)
                result["license_allocation_id"] = lic_info.get("id")
                logger.info(f"License assigned: id={result.get('license_allocation_id')}")

            # Step 3: Invite to org
            logger.info(f"Inviting {email} to org {org_id}")
            resp = await self.client.post(f"{base}/v1/admin/account-invitations", json={
                "invitedUserEmail": email,
                "accountId": self.auth.admin_account_id,
                "organizationId": org_id,
            }, headers=headers)

            invitation_token = None
            if resp.status_code < 400:
                inv_data = resp.json()
                inv_info = inv_data.get("data", inv_data)
                invitation_token = inv_info.get("invitationToken")
                # Capture testops_user_id from invitation response
                testops_uid = inv_info.get("invitedTestOpsUserId")
                if testops_uid:
                    result["testops_user_id"] = testops_uid
                    logger.info(f"TestOps userId from invitation: {testops_uid}")
                logger.info(f"Invitation sent: token={invitation_token[:20]}..." if invitation_token else "No token")
            else:
                logger.warning(f"Invite failed ({resp.status_code}): {resp.text[:300]}")

            # Step 4: Accept invitation (Keycloak OAuth)
            if invitation_token:
                await self._accept_invitation(email, password, invitation_token)

            # Step 5: Add to project
            project_id = int(env.get("project_id", 0))
            if project_id:
                logger.info(f"Adding {email} to project {project_id}")
                resp = await self.client.post(f"{base}/v2/admin/project-users", json={
                    "projectId": project_id,
                    "email": email,
                    "role": "MEMBER",
                }, headers=headers)
                if resp.status_code >= 400 and resp.status_code != 409:
                    logger.warning(f"Add to project failed ({resp.status_code}): {resp.text[:300]}")
                else:
                    pu_data = resp.json()
                    pu_info = pu_data.get("data", pu_data)
                    result["project_user_id"] = pu_info.get("id")
                    logger.info(f"Added to project {project_id} (project_user_id={result.get('project_user_id')})")

            # Look up account_user_id for teardown — use userId filter for direct lookup
            account_user_id, looked_up_uid = await self._lookup_account_user_id(
                email, headers, user_id=result.get("user_id"),
            )
            result["account_user_id"] = account_user_id
            if not result.get("user_id") and looked_up_uid:
                result["user_id"] = looked_up_uid
            if account_user_id:
                logger.info(f"Found account_user_id={account_user_id}")
            else:
                logger.warning(f"Could not find account_user_id for {email} — deactivation will be skipped during teardown")

            result["status"] = "active"
            logger.info(f"User provisioned: {email} (user_id={result.get('user_id')})")

        except Exception as e:
            result["status"] = "error"
            result["error"] = str(e)
            logger.exception(f"Provision failed for {email}: {e}")

        return result

    async def check_license_quota(self) -> dict:
        """Check available license quota before provisioning."""
        await self.auth.ensure_auth()
        headers = self.auth._auth_headers()
        base = self.auth.base_url
        lic_source_id = int(self.env.get("license_source_id", 49))
        feature = self.env.get("license_feature", "TESTOPS_G3_FULL")
        try:
            resp = await self.client.get(
                f"{base}/v2/admin/license-allocations",
                params={
                    "accountId": self.auth.admin_account_id,
                    "licenseSourceId": lic_source_id,
                    "feature": feature,
                },
                headers=headers,
            )
            if resp.status_code < 400:
                data = resp.json()
                allocs = data.get("data", []) if isinstance(data, dict) else data
                if isinstance(allocs, list):
                    # Count only kai alias allocations
                    kai_allocs = [a for a in allocs if "+kai_" in (a.get("consumerId", "") or "").lower()]
                    non_kai_allocs = [a for a in allocs if "+kai_" not in (a.get("consumerId", "") or "").lower()]
                    return {
                        "total_allocated": len(allocs),
                        "kai_allocated": len(kai_allocs),
                        "non_kai_allocated": len(non_kai_allocs),
                    }
        except Exception as e:
            logger.warning(f"License quota check failed: {e}")
        return {}

    async def provision_batch(self, primary_email: str, count: int) -> list:
        """Provision N alias users from primary email using timestamp-based aliases."""
        local, domain = primary_email.split("@")
        results = []
        ts = int(time.time())
        for i in range(count):
            alias = f"{local}+kai_{ts}_{i}@{domain}"
            result = await self.provision_user(alias)
            # Save to DB
            db.save_load_test_user(
                env_key=result.get("env_key", self.env_key or "default"),
                email=result["email"],
                password=result["password"],
                user_id=result.get("user_id"),
                testops_user_id=result.get("testops_user_id"),
                account_user_id=result.get("account_user_id"),
                project_user_id=result.get("project_user_id"),
                license_allocation_id=result.get("license_allocation_id"),
                status=result["status"],
                error=result.get("error"),
            )
            results.append(result)
            # Small delay between provisions
            await asyncio.sleep(1)

        return results

    # ── Sync from Platform ────────────────────────────────────────

    async def sync_from_platform(self) -> dict:
        """Fetch existing kai alias users from TestOps and sync into local DB.

        Paginates GET /v2/admin/account-users, filters for emails containing
        '+kai_', and upserts them into the load_test_users table.
        Returns: {synced: int, skipped: int, total_found: int}
        """
        await self.auth.ensure_auth()
        headers = self.auth._auth_headers()
        base = self.auth.base_url
        env_key = self.env_key or "default"

        # Get existing DB records for dedup
        existing = {u["email"].lower() for u in db.list_load_test_users(env_key)}

        synced = 0
        skipped = 0
        found = 0
        page_size = 100
        offset = 0

        while offset < 10000:  # safety limit
            query = json.dumps({
                "filters": [
                    {"field": "accountId", "operator": "EQ", "value": self.auth.admin_account_id},
                    {"field": "archived", "operator": "EQ", "value": False},
                ],
                "sorts": [{"field": "id", "desc": True}],
                "fetches": [],
                "offset": offset,
                "limit": page_size,
            })
            try:
                resp = await self.client.get(
                    f"{base}/v2/admin/account-users",
                    params={"query": query},
                    headers=headers,
                )
                if resp.status_code >= 400:
                    logger.warning(f"Sync: account-users fetch failed ({resp.status_code})")
                    break
                data = resp.json()
                users = data.get("data", [])
                if not isinstance(users, list) or not users:
                    break

                for u in users:
                    email = u.get("email", "")
                    if "+kai_" not in email.lower():
                        continue
                    found += 1
                    if email.lower() in existing:
                        skipped += 1
                        continue

                    # Upsert into DB — we don't have the password, mark as synced
                    db.save_load_test_user(
                        env_key=env_key,
                        email=email,
                        password="",  # unknown — user was provisioned externally or in previous cycle
                        user_id=u.get("userId"),
                        account_user_id=u.get("id"),
                        status="active",
                    )
                    synced += 1
                    existing.add(email.lower())
                    logger.info(f"Synced user: {email} (account_user_id={u.get('id')})")

                if len(users) < page_size:
                    break
                offset += page_size
            except Exception as e:
                logger.warning(f"Sync: page fetch error at offset={offset}: {e}")
                break

        logger.info(f"Sync complete: found={found}, synced={synced}, skipped={skipped}")
        return {"synced": synced, "skipped": skipped, "total_found": found}

    # ── Teardown ──────────────────────────────────────────────────

    async def teardown_user(self, email: str) -> dict:
        """Teardown a single user. Returns status dict.
        SAFETY: Only tears down alias users (email must contain '+kai_').
        """
        # Safety guard — never touch non-alias users
        if "+kai_" not in email.lower():
            logger.warning(f"Refusing to teardown non-alias user: {email}")
            return {"email": email, "status": "skipped", "error": "Not a kai alias user — refusing to teardown"}

        await self.auth.ensure_auth()
        headers = self.auth._auth_headers()
        base = self.auth.base_url
        user = db.get_load_test_user(email, self.env_key or "default")
        steps = []

        try:
            # Step 1: Revoke license — only for this specific user
            logger.info(f"Revoking license for {email}")
            try:
                # Use the license_allocation_id from DB if available
                alloc_id_from_db = user.get("license_allocation_id") if user else None
                if alloc_id_from_db:
                    resp = await self.client.delete(
                        f"{base}/v2/admin/license-allocations/{alloc_id_from_db}",
                        headers=headers,
                    )
                    if resp.status_code in (200, 204, 404):
                        logger.info(f"Revoked license allocation {alloc_id_from_db}")
                else:
                    # Fallback: search by consumerId (email) — filter results carefully
                    resp = await self.client.get(f"{base}/v2/admin/license-allocations", params={
                        "accountId": self.auth.admin_account_id,
                        "consumerId": email,
                    }, headers=headers)
                    if resp.status_code < 400:
                        allocs = resp.json()
                        alloc_list = allocs.get("data", allocs) if isinstance(allocs, dict) else allocs
                        if isinstance(alloc_list, list):
                            # Only revoke allocations that match THIS kai alias user's email
                            for alloc in alloc_list:
                                consumer = alloc.get("consumerId", "")
                                if consumer.lower() == email.lower() and "+kai_" in consumer.lower():
                                    aid = alloc.get("id")
                                    if aid:
                                        await self.client.delete(
                                            f"{base}/v2/admin/license-allocations/{aid}",
                                            headers=headers,
                                        )
                                        logger.info(f"Revoked license allocation {aid}")
                                elif consumer.lower() == email.lower():
                                    logger.warning(f"Skipping license revocation for non-alias user: {consumer}")
                steps.append({"step": "revoke_license", "status": "ok"})
            except Exception as e:
                steps.append({"step": "revoke_license", "status": "failed", "error": str(e)})
                logger.warning(f"Revoke license failed for {email}: {e}")

            # Step 2: Remove from project
            project_user_id = user.get("project_user_id") if user else None
            if project_user_id:
                logger.info(f"Removing from project: project_user_id={project_user_id}")
                try:
                    resp = await self.client.delete(
                        f"{base}/v2/admin/project-users/{project_user_id}",
                        headers=headers,
                    )
                    if resp.status_code in (200, 204, 404):
                        steps.append({"step": "remove_from_project", "status": "ok"})
                    else:
                        steps.append({"step": "remove_from_project", "status": "failed",
                                      "error": f"HTTP {resp.status_code}"})
                except Exception as e:
                    steps.append({"step": "remove_from_project", "status": "failed", "error": str(e)})

            # Step 3: Remove from account (deactivate)
            account_user_id = user.get("account_user_id") if user else None
            if account_user_id:
                logger.info(f"Deactivating account user {account_user_id}")
                try:
                    resp = await self.client.delete(
                        f"{base}/v2/admin/account-users/{account_user_id}",
                        headers=headers,
                    )
                    if resp.status_code in (200, 204, 404):
                        steps.append({"step": "deactivate_user", "status": "ok"})
                    else:
                        steps.append({"step": "deactivate_user", "status": "failed",
                                      "error": f"HTTP {resp.status_code}"})
                except Exception as e:
                    steps.append({"step": "deactivate_user", "status": "failed", "error": str(e)})
            else:
                # Try lookup by email (best effort — API returns max 50 of 140+ users)
                try:
                    uid = user.get("user_id") if user else None
                    auid, _ = await self._lookup_account_user_id(email, headers, user_id=uid)
                    if auid:
                        resp = await self.client.delete(
                            f"{base}/v2/admin/account-users/{auid}",
                            headers=headers,
                        )
                        if resp.status_code in (200, 204, 404):
                            steps.append({"step": "deactivate_user", "status": "ok"})
                        else:
                            steps.append({"step": "deactivate_user", "status": "failed",
                                          "error": f"HTTP {resp.status_code}"})
                    else:
                        steps.append({"step": "deactivate_user", "status": "skipped",
                                      "error": "account_user_id not found — API pagination broken (returns max 50 of 140+ users)"})
                except Exception as e:
                    steps.append({"step": "deactivate_user", "status": "failed", "error": str(e)})

            # Step 4: Delete user profile (optional, best-effort)
            user_id = user.get("user_id") if user else None
            if user_id and user and user.get("password"):
                logger.info(f"Deleting user profile {user_id}")
                try:
                    # Login as user to get their token
                    user_token, user_acct_uuid = await self._login_as_user(
                        email, user["password"]
                    )
                    if user_token:
                        user_headers = {
                            "Authorization": f"Bearer {user_token}",
                            "x-account-id": user_acct_uuid or "",
                            "Content-Type": "application/json",
                        }
                        resp = await self.client.request(
                            "DELETE",
                            f"{base}/v2/admin/users/{user_id}",
                            headers=user_headers,
                            json={
                                "deleteReason": f"{base}/v2/admin/scim/{user_acct_uuid}",
                                "password": user["password"],
                            },
                        )
                        if resp.status_code in (200, 204, 404):
                            steps.append({"step": "delete_profile", "status": "ok"})
                        else:
                            steps.append({"step": "delete_profile", "status": "failed",
                                          "error": f"HTTP {resp.status_code}"})
                    else:
                        steps.append({"step": "delete_profile", "status": "skipped",
                                      "error": "Could not login as user"})
                except Exception as e:
                    steps.append({"step": "delete_profile", "status": "failed", "error": str(e)})

            # Update DB
            db.update_load_test_user(email, self.env_key or "default", status="removed")
            return {"email": email, "status": "removed", "steps": steps}

        except Exception as e:
            db.update_load_test_user(email, self.env_key or "default",
                                     status="error", error=str(e))
            return {"email": email, "status": "error", "error": str(e), "steps": steps}

    async def teardown_all(self, env_key: str = None) -> list:
        """Teardown all active kai alias load test users for an environment.
        SAFETY: Only tears down users with '+kai_' in email.
        """
        ek = env_key or self.env_key or "default"
        users = db.list_load_test_users(ek)
        # Safety: only teardown kai alias users, never touch real users
        active = [u for u in users if u.get("status") == "active" and "+kai_" in u.get("email", "").lower()]
        results = []
        for u in active:
            result = await self.teardown_user(u["email"])
            results.append(result)
            await asyncio.sleep(0.5)
        return results

    # ── Internal Helpers ──────────────────────────────────────────

    async def _login_as_user(self, email: str, password: str) -> tuple:
        """Login as a user via puppeteer API. Returns (token, account_uuid)."""
        try:
            resp = await self.client.post(self.auth.login_url, json={
                "url": self.auth.base_url,
                "email": email,
                "password": password,
                "account": self.auth.account,
            })
            resp.raise_for_status()
            data = resp.json()
            token_data = data.get("token", {})
            if isinstance(token_data, dict):
                token = token_data.get("access_token") or token_data.get("token")
                id_token = token_data.get("id_token", "")
            else:
                token = token_data
                id_token = ""
            acct_uuid = _decode_jwt_payload(id_token).get("account_uuid", "") if id_token else ""
            return token, acct_uuid
        except Exception as e:
            logger.warning(f"Login as {email} failed: {e}")
            return None, None

    async def _accept_invitation(self, email: str, password: str, invitation_token: str):
        """Accept org invitation via Keycloak OAuth flow."""
        env = self.env
        # Derive keycloak URL from platform URL
        platform_url = env.get("platform_url", "")
        parsed = urlparse(platform_url)
        domain = parsed.hostname or ""

        # Keycloak URLs vary by environment
        if "staging" in domain:
            keycloak_base = "https://login.staging.katalon.com"
            keycloak_client = "katalon-testops-gen3"
        else:
            keycloak_base = "https://login.katalon.com"
            keycloak_client = "katalon-testops-gen3"

        redirect_uri = f"{platform_url}/accept-invitation?invitation_token={invitation_token}"
        auth_url = (
            f"{keycloak_base}/realms/katalon/protocol/openid-connect/auth?"
            f"response_type=code&client_id={keycloak_client}"
            f"&redirect_uri={quote(redirect_uri, safe='')}"
            f"&source=accept-invitation"
        )

        try:
            logger.info(f"Accepting invitation for {email} via Keycloak ({keycloak_base})")

            # Use a fresh client per user to avoid cookie leaks between users
            kc_client = httpx.AsyncClient(timeout=30, follow_redirects=False)

            # Step 1: Get login page (don't follow redirects)
            resp1 = await kc_client.get(auth_url, follow_redirects=False)
            cookies1 = dict(resp1.cookies)

            # If Keycloak redirects directly (user already has a session), follow to accept
            location = resp1.headers.get("location", "")
            if resp1.status_code in (301, 302, 303) and location:
                # Check if redirected back to platform (invitation accepted via existing session)
                if "accept-invitation" in location or "code=" in location:
                    logger.info(f"Invitation auto-accepted for {email} (existing Keycloak session)")
                    return
                # Follow redirect to actual login form
                if location.startswith("/"):
                    location = f"{keycloak_base}{location}"
                resp1 = await kc_client.get(location, cookies=cookies1, follow_redirects=False)
                cookies1.update(dict(resp1.cookies))

            # Extract login form action URL
            body = resp1.text
            match = re.search(r'action="([^"]+)"', body)
            if not match:
                logger.warning("Could not find login form action in Keycloak response")
                return
            form_url = match.group(1).replace("&amp;", "&")
            if form_url.startswith("/"):
                form_url = f"{keycloak_base}{form_url}"

            # Step 2: Submit credentials
            resp2 = await kc_client.post(form_url,
                data={"username": email, "password": password},
                headers={"Content-Type": "application/x-www-form-urlencoded"},
                cookies=cookies1,
                follow_redirects=False,
            )
            cookies2 = {**cookies1, **dict(resp2.cookies)}

            # Step 3: Handle choose-account page or follow redirects
            if resp2.status_code not in (301, 302):
                # Likely a Choose Account / Accept Invitation page
                body2 = resp2.text if isinstance(resp2.text, str) else ""
                match2 = re.search(r'action="([^"]+)"', body2)
                if match2:
                    choose_url = match2.group(1).replace("&amp;", "&")
                    if choose_url.startswith("/"):
                        choose_url = f"{keycloak_base}{choose_url}"
                    selected = f"{self.auth.admin_account_id}_true"
                    resp3 = await kc_client.post(choose_url,
                        data={"selected_account": selected, "invitation_action": "accept"},
                        headers={"Content-Type": "application/x-www-form-urlencoded"},
                        cookies=cookies2,
                        follow_redirects=False,
                    )
                    if resp3.status_code in (301, 302):
                        logger.info(f"Invitation accepted for {email}")
                    else:
                        logger.warning(f"Choose-account returned {resp3.status_code} for {email}")
                else:
                    logger.warning(f"No form found in Keycloak response for {email}")
            else:
                logger.info(f"Invitation accepted for {email} (redirect after login)")

        except Exception as e:
            logger.warning(f"Accept invitation failed for {email}: {e}")
        finally:
            await kc_client.aclose()

    async def _lookup_user_id(self, email: str, headers: dict) -> Optional[int]:
        """Look up user ID by email."""
        auid, uid = await self._lookup_account_user_id(email, headers)
        return uid

    async def _lookup_account_user_id(self, email: str, headers: dict,
                                      user_id: int = None) -> tuple:
        """Look up account-user ID for deactivation. Returns (account_user_id, user_id).

        Uses the structured query param (same as the admin UI) with a userId
        filter for direct lookup when user_id is known. Falls back to
        offset-based pagination if not.
        """
        base = self.auth.base_url
        target = email.lower()

        # Strategy 1: Direct lookup by userId (identity ID from POST /v1/users)
        if user_id:
            query = json.dumps({
                "filters": [
                    {"field": "accountId", "operator": "EQ", "value": self.auth.admin_account_id},
                    {"field": "userId", "operator": "EQ", "value": user_id},
                ],
                "sorts": [],
                "fetches": [],
            })
            try:
                resp = await self.client.get(
                    f"{base}/v2/admin/account-users",
                    params={"query": query},
                    headers=headers,
                )
                if resp.status_code < 400:
                    data = resp.json()
                    users = data.get("data", [])
                    if users and len(users) == 1:
                        auid = users[0].get("id")
                        uid = users[0].get("userId")
                        logger.info(f"Found account_user_id={auid} for {email} (userId filter)")
                        return auid, uid
            except Exception as e:
                logger.debug(f"userId filter lookup failed: {e}")

        # Strategy 2: Paginate and match email client-side (fallback)
        page_size = 50
        offset = 0
        while offset < 5000:  # safety limit
            query = json.dumps({
                "filters": [
                    {"field": "accountId", "operator": "EQ", "value": self.auth.admin_account_id},
                    {"field": "archived", "operator": "EQ", "value": False},
                ],
                "sorts": [{"field": "id", "desc": True}],
                "fetches": [],
                "offset": offset,
                "limit": page_size,
            })
            try:
                resp = await self.client.get(
                    f"{base}/v2/admin/account-users",
                    params={"query": query},
                    headers=headers,
                )
                if resp.status_code >= 400:
                    break
                data = resp.json()
                users = data.get("data", [])
                if not isinstance(users, list) or not users:
                    break
                for u in users:
                    if u.get("email", "").lower() == target:
                        auid = u.get("id")
                        uid = u.get("userId")
                        logger.info(f"Found account_user_id={auid} for {email} (offset={offset})")
                        return auid, uid
                if len(users) < page_size:
                    break
                offset += page_size
            except Exception as e:
                logger.warning(f"Account-user lookup failed at offset={offset}: {e}")
                break

        logger.warning(f"Could not find account_user_id for {email}")
        return None, None

"""Discover accounts and projects from the Katalon platform via Keycloak + REST API.

Flow:
1. discover_accounts: Keycloak OIDC login → parse choose-account HTML → return account list
2. discover_projects: Login with account → GET /v2/admin/projects → return project list
"""

import json
import logging
import re
from urllib.parse import urlparse, quote

import httpx

logger = logging.getLogger(__name__)


def _keycloak_base_url(platform_url: str) -> str:
    """Derive Keycloak base URL from platform URL."""
    parsed = urlparse(platform_url)
    domain = parsed.hostname or ""
    if "qa" in domain:
        return "https://login.qa.katalon.com"
    if "staging" in domain:
        return "https://login.staging.katalon.com"
    return "https://login.katalon.com"


async def discover_accounts(platform_url: str, email: str, password: str) -> list[dict]:
    """Login via Keycloak and return list of accounts the user belongs to.

    Returns: [{"id": "6484", "name": "Manual Test Account", "url": "https://..."}, ...]
    If user has only one account (auto-redirect), returns empty list.
    """
    keycloak_base = _keycloak_base_url(platform_url)
    keycloak_client = "katalon-testops-gen3"
    redirect_uri = f"{platform_url}/"

    auth_url = (
        f"{keycloak_base}/realms/katalon/protocol/openid-connect/auth?"
        f"response_type=code&client_id={keycloak_client}"
        f"&redirect_uri={quote(redirect_uri, safe='')}"
    )

    async with httpx.AsyncClient(timeout=30, follow_redirects=False) as client:
        # Step 1: Get login page
        resp1 = await client.get(auth_url, follow_redirects=False)
        cookies = dict(resp1.cookies)

        # Follow redirect if needed (Keycloak sometimes redirects to the actual login form)
        location = resp1.headers.get("location", "")
        if resp1.status_code in (301, 302, 303) and location:
            if location.startswith("/"):
                location = f"{keycloak_base}{location}"
            resp1 = await client.get(location, cookies=cookies, follow_redirects=False)
            cookies.update(dict(resp1.cookies))

        # Extract login form action URL (the email login form)
        body = resp1.text
        match = re.search(r'action="([^"]+)"', body)
        if not match:
            raise ValueError("Could not find Keycloak login form — check platform URL")
        form_url = match.group(1).replace("&amp;", "&")
        if form_url.startswith("/"):
            form_url = f"{keycloak_base}{form_url}"

        # Step 2: Submit credentials (login_method=email is required by some Keycloak instances)
        resp2 = await client.post(
            form_url,
            data={
                "login_method": "email",
                "username": email,
                "password": password,
                "login": "Log in",
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            cookies=cookies,
            follow_redirects=False,
        )
        cookies.update(dict(resp2.cookies))

        # Case A: 302 redirect → single account (no choose-account page)
        if resp2.status_code in (301, 302, 303):
            logger.info("Single account — no choose-account page")
            return []

        # Case B: 200 → choose-account page or error
        body2 = resp2.text
        if not body2:
            raise ValueError("Empty response after login — check credentials")

        # Check for error messages (wrong password etc)
        error_match = re.search(
            r'class="[^"]*(?:kc-feedback-text|alert-error|error-message)[^"]*"[^>]*>(.*?)<',
            body2, re.DOTALL
        )
        if error_match:
            error_text = re.sub(r'<[^>]+>', '', error_match.group(1)).strip()
            if error_text:
                raise ValueError(f"Login failed: {error_text}")

        # If still on login page (no choose page), credentials may be wrong
        if "selected_account" not in body2:
            # Check page title
            title_match = re.search(r'<title>(.*?)</title>', body2)
            title = title_match.group(1) if title_match else ""
            if "Sign in" in title or "Log in" in title:
                raise ValueError("Login failed — invalid email or password")
            raise ValueError(f"Unexpected page after login: {title}")

        # Parse accounts from the HTML
        accounts = _parse_accounts_from_html(body2)
        if not accounts:
            raise ValueError("Could not parse accounts from Keycloak response")

        return accounts


def _parse_accounts_from_html(html: str) -> list[dict]:
    """Parse account list from Keycloak choose-account HTML page.

    Keycloak structure:
    <input type="radio" name="selected_account" value="ID_true">
    <div class="account_name">Account Name</div>
    <div class="domain_name">https://domain.katalon.com</div>

    _true = G3 platform, _false = G2 platform.
    We prefer _true entries but include _false-only accounts too.
    """
    accounts = []
    seen_ids = set()

    # Find all selected_account radio inputs with their nearby account_name/account_domain divs
    # HTML structure:
    #   <input name="selected_account" value="ID_true">
    #   <div class="account_name">
    #       Account Name
    #       <div class="account_domain">https://domain.katalon.com</div>
    #   </div>
    for m in re.finditer(
        r'<input[^>]*name="selected_account"[^>]*value="(\d+)_(true|false)"[^>]*>',
        html
    ):
        aid = m.group(1)
        variant = m.group(2)
        # Only take _true (G3) entries, or _false if no _true exists for this ID
        if variant == "false" and aid in seen_ids:
            continue

        after = html[m.end():m.end() + 600]

        # Extract account name (text before the nested account_domain div)
        name_match = re.search(r'class="account_name"[^>]*>\s*(.*?)\s*<', after, re.DOTALL)
        name = name_match.group(1).strip() if name_match else f"Account {aid}"

        # Extract domain URL from nested <div class="account_domain"> or <div class="domain_name">
        url_match = re.search(r'class="account_domain"[^>]*>\s*(.*?)\s*<', after, re.DOTALL)
        if not url_match:
            url_match = re.search(r'class="domain_name"[^>]*>\s*(.*?)\s*<', after, re.DOTALL)
        url = url_match.group(1).strip() if url_match else ""

        # Extract just the domain subdomain from the URL for display
        domain = ""
        if url:
            from urllib.parse import urlparse as _urlparse
            parsed = _urlparse(url)
            host = parsed.hostname or ""
            # e.g. "staginggen3platform.staging.katalon.com" → "staginggen3platform"
            # e.g. "katalonhub.katalon.io" → "katalonhub"
            domain = host.split(".")[0] if host else ""

        if aid in seen_ids:
            # Update existing entry (upgrading _false to _true)
            for a in accounts:
                if a["id"] == aid:
                    a["variant"] = variant
                    if url:
                        a["url"] = url
                        a["domain"] = domain
                    break
        else:
            accounts.append({
                "id": aid,
                "name": name,
                "url": url,
                "domain": domain,
                "variant": variant,
            })
            seen_ids.add(aid)

    # Fallback: generic pattern for other Keycloak themes
    if not accounts:
        for m in re.finditer(r'value="(\d+)_true"', html):
            aid = m.group(1)
            if aid not in seen_ids:
                accounts.append({"id": aid, "name": f"Account {aid}", "url": "", "variant": "true"})
                seen_ids.add(aid)

    return accounts


async def discover_projects(
    platform_url: str, login_url: str, email: str, password: str, account: str
) -> list[dict]:
    """Login with account, then fetch projects from the platform API.

    Filters by the account's numeric ID (team.organization.accountId) so only
    projects belonging to the selected account are returned.  Paginates to
    fetch all results (up to 500 safety limit).

    Returns: [{"id": 55425, "name": "Quality Engineer", "org_id": 34810,
               "org_name": "Manual To Automation", "account_uuid": "fcb31c41-..."}, ...]
    """
    token, headers, account_id = await _get_token_and_headers(
        platform_url, login_url, email, password, account
    )

    # Build filter — scope to selected account if we have the numeric ID
    filters = []
    if account_id:
        filters.append({
            "field": "team.organization.accountId",
            "operator": "EQ",
            "value": account_id,
        })

    projects = []
    page_size = 100
    offset = 0

    async with httpx.AsyncClient(timeout=30) as client:
        while offset < 500:  # safety limit
            query = json.dumps({
                "filters": filters,
                "sorts": [{"field": "id", "desc": False}],
                "fetches": [],
                "offset": offset,
                "limit": page_size,
            })
            resp = await client.get(
                f"{platform_url}/v2/admin/projects",
                params={"query": query},
                headers=headers,
            )
            resp.raise_for_status()
            result = resp.json()
            page_data = result.get("data", [])
            if not page_data:
                break

            for p in page_data:
                team = p.get("team", {}) or {}
                org = team.get("organization", {}) or {}
                projects.append({
                    "id": p["id"],
                    "name": p.get("name", ""),
                    "status": p.get("status", ""),
                    "team_id": team.get("id"),
                    "team_name": team.get("name", ""),
                    "org_id": org.get("organizationId") or org.get("id"),
                    "org_name": org.get("name", ""),
                    "account_id": org.get("accountId"),
                    "account_uuid": org.get("accountUUID") or "",
                })

            if len(page_data) < page_size:
                break
            offset += page_size

    return projects


async def _get_token_and_headers(
    platform_url: str, login_url: str, email: str, password: str, account: str
) -> tuple:
    """Shared auth helper. Returns (token, headers, account_id)."""
    account_param = account
    if account_param and not account_param.endswith("_true") and not account_param.endswith("_false"):
        account_param = f"{account_param}_true"

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(login_url, json={
            "url": platform_url,
            "email": email,
            "password": password,
            "account": account_param,
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

    if not token:
        raise ValueError(f"Failed to get bearer token: {data}")

    account_uuid = ""
    if id_token:
        import base64
        try:
            payload_b64 = id_token.split('.')[1]
            padding = 4 - len(payload_b64) % 4
            if padding != 4:
                payload_b64 += '=' * padding
            payload = json.loads(base64.urlsafe_b64decode(payload_b64))
            account_uuid = payload.get("account_uuid", "")
        except Exception:
            pass

    account_id = None
    raw = account.split("_")[0]
    try:
        account_id = int(raw)
    except (ValueError, TypeError):
        pass

    headers = {
        "Authorization": f"Bearer {token}",
        "x-account-id": account_uuid,
        "Accept": "application/json",
    }
    return token, headers, account_id


async def discover_license_sources(
    platform_url: str, login_url: str, email: str, password: str, account: str
) -> list[dict]:
    """Discover license sources with Available vs Purchased for the account.

    Combines /v2/admin/license-sources (hierarchy & quota) with
    /v2/admin/license-allocations (assigned user count) to compute:
    - purchased (quota)
    - dedicated (sum of child org quotas)
    - pool (quota - dedicated)
    - assigned (allocation count from API `total` field)
    - available (pool - assigned)

    Returns account-level sources (parentId=None) grouped by feature,
    plus org-level sources relevant to the user's org.
    """
    token, headers, account_id = await _get_token_and_headers(
        platform_url, login_url, email, password, account
    )

    async with httpx.AsyncClient(timeout=30) as client:
        # Step 1: Fetch all license sources
        resp = await client.get(
            f"{platform_url}/v2/admin/license-sources",
            params={"accountId": account_id} if account_id else {},
            headers=headers,
        )
        if resp.status_code >= 400:
            raise ValueError(f"License sources API returned {resp.status_code}: {resp.text[:300]}")
        result = resp.json()
        all_sources = result.get("data", [])
        if not isinstance(all_sources, list):
            all_sources = []

        # Build parent→children map
        children_by_parent: dict[int, list] = {}
        for s in all_sources:
            pid = s.get("parentId")
            if pid is not None:
                children_by_parent.setdefault(pid, []).append(s)

        # Step 2: For each account-level source (parentId=None), get allocation count
        output = []
        for s in all_sources:
            if s.get("parentId") is not None:
                continue  # skip org-level (shown as children)
            if s.get("status") != "ACTIVE":
                continue

            sid = s["id"]
            feature = s.get("feature", "")
            purchased = s.get("quota", 0) or 0

            # Sum dedicated quota from child org sources
            children = children_by_parent.get(sid, [])
            dedicated = sum(c.get("quota", 0) or 0 for c in children)
            pool = purchased - dedicated

            # Get assigned count via allocations API (use `total` field for accurate count)
            assigned = 0
            try:
                query = json.dumps({
                    "filters": [
                        {"field": "accountId", "operator": "EQ", "value": account_id},
                        {"field": "licenseSourceId", "operator": "EQ", "value": sid},
                    ],
                    "sorts": [],
                    "fetches": [],
                    "offset": 0,
                    "limit": 1,  # we only need the total count
                })
                r2 = await client.get(
                    f"{platform_url}/v2/admin/license-allocations",
                    params={"query": query},
                    headers=headers,
                )
                if r2.status_code < 400:
                    alloc_data = r2.json()
                    assigned = alloc_data.get("total", 0)
            except Exception:
                pass

            available = pool - assigned

            # Build org breakdown
            org_details = []
            for c in children:
                if c.get("status") != "ACTIVE":
                    continue
                org_details.append({
                    "id": c["id"],
                    "org_id": c.get("organizationId"),
                    "dedicated": c.get("quota", 0),
                })

            expiry = s.get("expiryDate", "")
            if isinstance(expiry, (int, float)) and expiry > 0:
                from datetime import datetime, timezone
                try:
                    expiry = datetime.fromtimestamp(expiry / 1000, tz=timezone.utc).strftime("%Y-%m-%d")
                except Exception:
                    expiry = str(expiry)

            output.append({
                "id": sid,
                "feature": feature,
                "purchased": purchased,
                "dedicated": dedicated,
                "pool": pool,
                "assigned": assigned,
                "available": available,
                "expiry_date": expiry,
                "status": s.get("status", ""),
                "org_count": len([c for c in children if c.get("status") == "ACTIVE"]),
                "orgs": org_details,
            })

    return output

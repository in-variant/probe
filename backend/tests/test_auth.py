import pytest
from httpx import AsyncClient
from unittest.mock import patch

import local_cache
from routers.auth import ADMIN_EMAIL, AUTH_SESSION_STORE, ROLES_PATH


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


class TestRoles:
    def test_admin_role_is_seeded(self):
        from routers.auth import _read_roles

        roles = _read_roles()
        assert roles["members"][ADMIN_EMAIL]["role"] == "ADMIN"
        assert local_cache.read_json(ROLES_PATH)["members"][ADMIN_EMAIL]["allowed"] is True

    @pytest.mark.asyncio
    async def test_me_returns_role(self, client: AsyncClient):
        AUTH_SESSION_STORE["admin-token"] = {
            "email": ADMIN_EMAIL,
            "name": "Admin",
            "picture": "",
        }
        resp = await client.get("/api/auth/me", headers=_headers("admin-token"))
        assert resp.status_code == 200
        assert resp.json()["role"] == "ADMIN"

    def test_infer_invariant_when_not_in_registry(self):
        from routers import auth

        with patch.object(auth, "_member_for_email", return_value=None):
            assert auth._role_for_email("someone@invariant-ai.com") == "INVARIANT"
            assert auth._role_for_email("x@akashalabdhi.space") == "CLIENT"

    def test_infer_admin_email_without_registry_row(self):
        from routers import auth

        with patch.object(auth, "_member_for_email", return_value=None):
            assert auth._role_for_email(ADMIN_EMAIL) == "ADMIN"

    @pytest.mark.asyncio
    async def test_member_list_requires_admin(self, client: AsyncClient):
        AUTH_SESSION_STORE["client-token"] = {
            "email": "client@example.com",
            "name": "Client",
            "picture": "",
            "role": "CLIENT",
        }
        resp = await client.get("/api/auth/members", headers=_headers("client-token"))
        assert resp.status_code == 403

    @pytest.mark.asyncio
    async def test_admin_can_update_member_role(self, client: AsyncClient):
        AUTH_SESSION_STORE["admin-token-2"] = {
            "email": ADMIN_EMAIL,
            "name": "Admin",
            "picture": "",
            "role": "ADMIN",
        }
        resp = await client.patch(
            "/api/auth/members",
            headers=_headers("admin-token-2"),
            json={"email": "member@example.com", "role": "INVARIANT"},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["email"] == "member@example.com"
        assert body["role"] == "INVARIANT"

        listed = await client.get("/api/auth/members", headers=_headers("admin-token-2"))
        assert listed.status_code == 200
        members = {member["email"]: member for member in listed.json()["members"]}
        assert members["member@example.com"]["role"] == "INVARIANT"

    @pytest.mark.asyncio
    async def test_admin_seed_cannot_be_downgraded(self, client: AsyncClient):
        AUTH_SESSION_STORE["admin-token-3"] = {
            "email": ADMIN_EMAIL,
            "name": "Admin",
            "picture": "",
            "role": "ADMIN",
        }
        resp = await client.patch(
            "/api/auth/members",
            headers=_headers("admin-token-3"),
            json={"email": ADMIN_EMAIL, "role": "CLIENT"},
        )
        assert resp.status_code == 200
        assert resp.json()["role"] == "ADMIN"

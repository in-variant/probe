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

    @pytest.mark.asyncio
    async def test_assignable_members_endpoint_requires_auth(self, client: AsyncClient):
        resp = await client.get("/api/auth/members/assignable")
        assert resp.status_code == 401

    @pytest.mark.asyncio
    async def test_assignable_members_endpoint_returns_allowed_members(self, client: AsyncClient):
        AUTH_SESSION_STORE["viewer-token"] = {
            "email": "viewer@example.com",
            "name": "Viewer",
            "picture": "",
            "role": "CLIENT",
        }
        AUTH_SESSION_STORE["admin-token-4"] = {
            "email": ADMIN_EMAIL,
            "name": "Admin",
            "picture": "",
            "role": "ADMIN",
        }
        set_disabled = await client.patch(
            "/api/auth/members",
            headers=_headers("admin-token-4"),
            json={"email": "blocked@example.com", "role": "CLIENT"},
        )
        assert set_disabled.status_code == 200
        delete_resp = await client.request(
            "DELETE",
            "/api/auth/members",
            headers=_headers("admin-token-4"),
            json={"email": "blocked@example.com"},
        )
        assert delete_resp.status_code == 200
        resp = await client.get("/api/auth/members/assignable", headers=_headers("viewer-token"))
        assert resp.status_code == 200
        emails = {m["email"] for m in resp.json()["members"]}
        assert ADMIN_EMAIL in emails
        assert "blocked@example.com" not in emails

    @pytest.mark.asyncio
    async def test_admin_can_delete_member(self, client: AsyncClient):
        AUTH_SESSION_STORE["admin-token-5"] = {
            "email": ADMIN_EMAIL,
            "name": "Admin",
            "picture": "",
            "role": "ADMIN",
        }
        create = await client.patch(
            "/api/auth/members",
            headers=_headers("admin-token-5"),
            json={"email": "member2@example.com", "role": "INVARIANT"},
        )
        assert create.status_code == 200
        delete_resp = await client.request(
            "DELETE",
            "/api/auth/members",
            headers=_headers("admin-token-5"),
            json={"email": "member2@example.com"},
        )
        assert delete_resp.status_code == 200
        listed = await client.get("/api/auth/members", headers=_headers("admin-token-5"))
        members = {member["email"]: member for member in listed.json()["members"]}
        assert "member2@example.com" not in members

    @pytest.mark.asyncio
    async def test_primary_admin_cannot_be_deleted(self, client: AsyncClient):
        AUTH_SESSION_STORE["admin-token-6"] = {
            "email": ADMIN_EMAIL,
            "name": "Admin",
            "picture": "",
            "role": "ADMIN",
        }
        delete_resp = await client.request(
            "DELETE",
            "/api/auth/members",
            headers=_headers("admin-token-6"),
            json={"email": ADMIN_EMAIL},
        )
        assert delete_resp.status_code == 422

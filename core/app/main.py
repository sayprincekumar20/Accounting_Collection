import uuid

from fastapi import FastAPI, Request

from app.api import approvals, audit, groups, health, issues, switches


def create_app() -> FastAPI:
    app = FastAPI(title="RGF Core", version="0.1.0", docs_url="/docs", redoc_url=None)

    @app.middleware("http")
    async def request_id(request: Request, call_next):  # type: ignore[no-untyped-def]
        rid = request.headers.get("x-request-id") or uuid.uuid4().hex[:16]
        request.state.request_id = rid
        response = await call_next(request)
        response.headers["x-request-id"] = rid
        return response

    app.include_router(health.router)
    app.include_router(audit.router)
    app.include_router(switches.router)
    app.include_router(groups.router)
    app.include_router(approvals.router)
    app.include_router(issues.router)
    return app


app = create_app()

"""One shared Zoho client per process, with the access token cached in Redis."""

from functools import lru_cache

import redis

from app.config import get_settings
from app.zoho.auth import RedisTokenCache, ZohoTokenProvider, credentials_fingerprint
from app.zoho.client import ZohoClient


@lru_cache
def get_zoho_client() -> ZohoClient:
    s = get_settings()
    cache = RedisTokenCache(redis.Redis.from_url(s.redis_url), credentials_fingerprint(s))
    return ZohoClient(s, ZohoTokenProvider(s, cache))

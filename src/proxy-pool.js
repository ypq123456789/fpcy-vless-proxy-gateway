export function createProxyPool(initialPool) {
  let supported = [...(initialPool.supported || [])];
  let unsupported = [...(initialPool.unsupported || [])];
  let active = [];
  let inactive = [];
  let subscriptionFailures = [];
  let lastRefreshAt = '';
  let nextIndex = 0;

  function candidates() {
    return active.length ? active : supported;
  }

  return {
    pickProxy() {
      const list = candidates();
      if (!list.length) throw new Error('no active proxy nodes available');
      const proxy = list[nextIndex % list.length];
      nextIndex += 1;
      return proxy;
    },
    replaceSupported(pool, failures = []) {
      supported = [...(pool.supported || [])];
      unsupported = [...(pool.unsupported || [])];
      subscriptionFailures = failures;
      lastRefreshAt = new Date().toISOString();
      nextIndex = 0;
    },
    replaceActive(nextActive, nextInactive = []) {
      active = [...nextActive];
      inactive = [...nextInactive];
      lastRefreshAt = new Date().toISOString();
      nextIndex = 0;
    },
    supported() {
      return [...supported];
    },
    snapshot() {
      const list = candidates();
      return {
        ok: true,
        pool_count: list.length,
        active_count: active.length,
        supported_count: supported.length,
        inactive_count: inactive.length,
        unsupported_count: unsupported.length,
        subscription_failure_count: subscriptionFailures.length,
        last_refresh_at: lastRefreshAt,
        proxies: list.map(proxy => proxy.label),
        inactive,
        unsupported,
        subscription_failures: subscriptionFailures
      };
    }
  };
}

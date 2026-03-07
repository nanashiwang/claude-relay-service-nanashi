const {
  buildCacheMetrics,
  buildRequestCacheMetrics,
  resolveCacheStatus
} = require('../src/utils/cacheMetrics')

describe('cacheMetrics', () => {
  it('calculates token and request level cache rates', () => {
    const metrics = buildCacheMetrics({
      inputTokens: 300,
      cacheReadTokens: 700,
      cacheCreateTokens: 200,
      requests: 10,
      cacheReadRequests: 7,
      cacheCreateRequests: 2
    })

    expect(metrics.effectiveInputTokens).toBe(1000)
    expect(metrics.cacheHitRate).toBe(0.7)
    expect(metrics.cacheCreateRate).toBe(0.1667)
    expect(metrics.cacheReadRequestRate).toBe(0.7)
    expect(metrics.cacheCreateRequestRate).toBe(0.2)
  })

  it('classifies request cache state correctly', () => {
    expect(resolveCacheStatus({ cacheReadTokens: 0, cacheCreateTokens: 0 })).toBe('miss')
    expect(resolveCacheStatus({ cacheReadTokens: 120, cacheCreateTokens: 0 })).toBe('hit')
    expect(resolveCacheStatus({ cacheReadTokens: 0, cacheCreateTokens: 80 })).toBe('warmup')
    expect(resolveCacheStatus({ cacheReadTokens: 120, cacheCreateTokens: 80 })).toBe('mixed')
  })

  it('builds request metrics using prompt cache tokens as canonical inputs', () => {
    const metrics = buildRequestCacheMetrics({
      inputTokens: 200,
      cacheReadTokens: 800,
      cacheCreateTokens: 0
    })

    expect(metrics.cacheStatus).toBe('hit')
    expect(metrics.cacheHitRate).toBe(0.8)
    expect(metrics.cacheReadRequestRate).toBe(1)
    expect(metrics.cacheCreateRequestRate).toBe(0)
  })
})

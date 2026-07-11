jest.mock('../src/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  success: jest.fn()
}))

const modelService = require('../src/services/modelService')
const pricingService = require('../src/services/pricingService')
const CostCalculator = require('../src/utils/costCalculator')

describe('GPT-5.6 model and pricing compatibility', () => {
  it('exposes the sol, terra and luna variants', () => {
    const modelIds = modelService.getModelsByProvider('openai').map((model) => model.id)

    expect(modelIds).toEqual(
      expect.arrayContaining(['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'])
    )
  })

  it('uses dynamic GPT-5 pricing until GPT-5.6 has its own entry', () => {
    const gpt5Pricing = {
      input_cost_per_token: 0.00000125,
      output_cost_per_token: 0.00001,
      litellm_provider: 'openai'
    }
    pricingService.pricingData = { 'gpt-5': gpt5Pricing }
    pricingService.customModelPricing = {}

    expect(pricingService.getModelPricing('gpt-5.6-luna')).toEqual(gpt5Pricing)
  })

  it('uses the local GPT fallback instead of Claude unknown pricing', () => {
    expect(CostCalculator.getModelPricing('gpt-5.6-terra')).toEqual({
      input: 1.75,
      output: 14,
      cacheWrite: 1.75,
      cacheRead: 0.175
    })
  })
})

import { getBitcoinCyclePhase } from "@/lib/bitcoin-cycle"

describe("Bitcoin Cycle Badge", () => {
  describe("getBitcoinCyclePhase", () => {
    it("should identify pre-halving phase (within 6 months of next halving)", () => {
      // Oct 2028 is 6 months before April 2029 halving
      const date = new Date("2028-10-19")
      const phase = getBitcoinCyclePhase(date)
      expect(phase).toBe("pre-halving")
    })

    it("should identify post-halving year 1 (0-12 months after halving)", () => {
      // June 2024 is 2 months after April 2024 halving
      const date = new Date("2024-06-19")
      const phase = getBitcoinCyclePhase(date)
      expect(phase).toBe("post-halving-year-1")
    })

    it("should identify post-halving year 2 (12-24 months after halving)", () => {
      // May 2025 is 13 months after April 2024 halving
      const date = new Date("2025-05-19")
      const phase = getBitcoinCyclePhase(date)
      expect(phase).toBe("post-halving-year-2")
    })

    it("should identify bear phase (after 24 months post-halving)", () => {
      // May 2026 is 25 months after April 2024 halving
      const date = new Date("2026-05-19")
      const phase = getBitcoinCyclePhase(date)
      expect(phase).toBe("bear")
    })

    it("should use current date by default", () => {
      // Should not throw and return a valid phase
      const phase = getBitcoinCyclePhase()
      expect(["pre-halving", "post-halving-year-1", "post-halving-year-2", "bear"]).toContain(phase)
    })

    it("should handle boundary dates correctly", () => {
      // Exactly at halving date
      const atHalving = getBitcoinCyclePhase(new Date("2024-04-19"))
      expect(["post-halving-year-1", "pre-halving"]).toContain(atHalving)

      // Exactly 12 months after
      const at12mo = getBitcoinCyclePhase(new Date("2025-04-19"))
      expect(["post-halving-year-1", "post-halving-year-2"]).toContain(at12mo)

      // Exactly 24 months after
      const at24mo = getBitcoinCyclePhase(new Date("2026-04-19"))
      expect(["post-halving-year-2", "bear"]).toContain(at24mo)
    })
  })
})

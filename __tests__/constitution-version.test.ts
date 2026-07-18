import { describe, it, expect } from "vitest"
import { constitutionContentHash } from "@/lib/constitution-version"

describe("constitutionContentHash", () => {
  it("is deterministic for the same constitution", () => {
    expect(constitutionContentHash("atlas-core")).toBe(constitutionContentHash("atlas-core"))
    expect(constitutionContentHash("silicon-brick-road")).toBe(constitutionContentHash("silicon-brick-road"))
  })

  it("differs between the two constitutions", () => {
    expect(constitutionContentHash("atlas-core")).not.toBe(constitutionContentHash("silicon-brick-road"))
  })

  it("is a sha256 hex digest", () => {
    expect(constitutionContentHash("atlas-core")).toMatch(/^[0-9a-f]{64}$/)
  })
})

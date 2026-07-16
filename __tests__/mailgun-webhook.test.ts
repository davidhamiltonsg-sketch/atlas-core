import { describe, it, expect } from "vitest"
import crypto from "node:crypto"
import { verifyMailgunSignature } from "@/lib/mailgun-webhook"

const KEY = "test-signing-key"

function sign(timestamp: string, token: string, key = KEY) {
  return crypto.createHmac("sha256", key).update(timestamp + token).digest("hex")
}

describe("verifyMailgunSignature", () => {
  it("accepts a correctly signed, fresh request", () => {
    const now = 1_700_000_000_000
    const timestamp = String(Math.floor(now / 1000))
    const token = "abc123"
    const signature = sign(timestamp, token)
    expect(verifyMailgunSignature(timestamp, token, signature, KEY, now)).toBe(true)
  })

  it("rejects a wrong signature", () => {
    const now = 1_700_000_000_000
    const timestamp = String(Math.floor(now / 1000))
    expect(verifyMailgunSignature(timestamp, "abc123", "0".repeat(64), KEY, now)).toBe(false)
  })

  it("rejects the right signature computed with the wrong key", () => {
    const now = 1_700_000_000_000
    const timestamp = String(Math.floor(now / 1000))
    const token = "abc123"
    const signature = sign(timestamp, token, "a-different-key")
    expect(verifyMailgunSignature(timestamp, token, signature, KEY, now)).toBe(false)
  })

  it("rejects a stale timestamp (replay protection)", () => {
    const now = 1_700_000_000_000
    const staleTimestamp = String(Math.floor(now / 1000) - 600) // 10 minutes old
    const token = "abc123"
    const signature = sign(staleTimestamp, token)
    expect(verifyMailgunSignature(staleTimestamp, token, signature, KEY, now)).toBe(false)
  })

  it("accepts a timestamp just inside the 5-minute window", () => {
    const now = 1_700_000_000_000
    const timestamp = String(Math.floor(now / 1000) - 290)
    const token = "abc123"
    const signature = sign(timestamp, token)
    expect(verifyMailgunSignature(timestamp, token, signature, KEY, now)).toBe(true)
  })

  it("rejects missing fields", () => {
    expect(verifyMailgunSignature("", "t", "sig", KEY)).toBe(false)
    expect(verifyMailgunSignature("123", "", "sig", KEY)).toBe(false)
    expect(verifyMailgunSignature("123", "t", "", KEY)).toBe(false)
    expect(verifyMailgunSignature("123", "t", "sig", "")).toBe(false)
  })

  it("rejects a non-hex signature without throwing", () => {
    const now = 1_700_000_000_000
    const timestamp = String(Math.floor(now / 1000))
    expect(verifyMailgunSignature(timestamp, "abc123", "not-hex-!!", KEY, now)).toBe(false)
  })
})

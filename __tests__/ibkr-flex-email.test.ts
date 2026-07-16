import { describe, it, expect } from "vitest"
import {
  constitutionForFlexAccountId,
  extractFlexAccountId,
  flexEmailShape,
  looksLikeFlexAttachment,
} from "@/lib/ibkr-flex-email"

const ENV = { atlas: "U13800637", sbr: "U99999999" }

describe("constitutionForFlexAccountId", () => {
  it("maps the Atlas account id", () => {
    expect(constitutionForFlexAccountId("U13800637", ENV)).toBe("atlas-core")
  })
  it("maps the SBR account id", () => {
    expect(constitutionForFlexAccountId("U99999999", ENV)).toBe("silicon-brick-road")
  })
  it("never falls back between the two accounts — an unrecognised id resolves to null", () => {
    expect(constitutionForFlexAccountId("U00000000", ENV)).toBeNull()
  })
  it("resolves to null when neither env var is configured", () => {
    expect(constitutionForFlexAccountId("U13800637", {})).toBeNull()
  })
  it("is not fooled by whitespace", () => {
    expect(constitutionForFlexAccountId("  U13800637  ", ENV)).toBe("atlas-core")
  })
})

describe("extractFlexAccountId", () => {
  it("reads the accountId attribute", () => {
    const xml = `<FlexStatement accountId="U13800637" fromDate="20260715">`
    expect(extractFlexAccountId(xml)).toBe("U13800637")
  })
  it("returns empty string when absent", () => {
    expect(extractFlexAccountId("<FlexStatement>")).toBe("")
  })
})

describe("flexEmailShape", () => {
  it("detects a pure positions report", () => {
    const xml = `<FlexStatement><OpenPosition symbol="VWRA" /><Trades></Trades><CashTransactions></CashTransactions></FlexStatement>`
    expect(flexEmailShape(xml)).toEqual({ hasPositions: true, hasActivity: false })
  })
  it("still detects activity when a positions report carries one incidental cash row", () => {
    const xml = `<FlexStatement><OpenPosition symbol="VWRA" /><CashTransactions><CashTransaction accountId="U1" amount="5" /></CashTransactions></FlexStatement>`
    expect(flexEmailShape(xml)).toEqual({ hasPositions: true, hasActivity: true })
  })
  it("detects a pure activity report", () => {
    const xml = `<FlexStatement><Trades><Trade symbol="VWRA" buySell="BUY" /></Trades></FlexStatement>`
    expect(flexEmailShape(xml)).toEqual({ hasPositions: false, hasActivity: true })
  })
  it("reports neither for an unrelated document", () => {
    expect(flexEmailShape("<FlexStatement></FlexStatement>")).toEqual({ hasPositions: false, hasActivity: false })
  })
})

describe("looksLikeFlexAttachment", () => {
  it("accepts a .xml filename regardless of content-type", () => {
    expect(looksLikeFlexAttachment("Atlas-core.xml", "application/octet-stream")).toBe(true)
  })
  it("accepts an xml content-type regardless of filename", () => {
    expect(looksLikeFlexAttachment("report", "text/xml")).toBe(true)
  })
  it("rejects an unrelated attachment", () => {
    expect(looksLikeFlexAttachment("logo.png", "image/png")).toBe(false)
  })
})

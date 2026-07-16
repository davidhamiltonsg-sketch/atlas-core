/**
 * Unit tests for parseFlexXml (lib/ibkr-flex.ts) — Open Positions "Summary, Lot"
 * deduplication. Regression coverage for a real Atlas Flex export where every
 * OpenPosition row lacked a levelOfDetail attribute entirely: the summary/lot
 * distinction was carried only by percentOfNAV (populated on the summary row,
 * blank on the per-lot rows underneath it). Without a percentOfNAV fallback, every
 * row was treated as its own summary and imported separately — e.g. BTC would land
 * as three positions (S$4,422.88 + S$2,872 + S$1,550.88) instead of one.
 */
import { describe, it, expect } from "vitest"
import { parseFlexXml } from "@/lib/ibkr-flex"

describe("parseFlexXml", () => {
  it("collapses a summary+lots group signalled only by percentOfNAV (no levelOfDetail attribute)", () => {
    // Real shape from a live Atlas Flex query: summary row has percentOfNAV filled,
    // lot rows have percentOfNAV="" and no levelOfDetail attribute at all.
    const xml = `<FlexStatement>
      <OpenPosition accountId="U1" currency="USD" symbol="BTC" markPrice="28.72" positionValue="4422.88" costBasisMoney="6003.01" percentOfNAV="3.14" fifoPnlUnrealized="-1580.13" position="154" />
      <OpenPosition accountId="U1" currency="USD" symbol="BTC" markPrice="28.72" positionValue="2872" costBasisMoney="3898.09" percentOfNAV="" fifoPnlUnrealized="-1026.09" position="100" />
      <OpenPosition accountId="U1" currency="USD" symbol="BTC" markPrice="28.72" positionValue="1550.88" costBasisMoney="2104.92" percentOfNAV="" fifoPnlUnrealized="-554.04" position="54" />
    </FlexStatement>`
    const { positions } = parseFlexXml(xml)
    expect(positions).toHaveLength(1)
    expect(positions[0].positionValue).toBeCloseTo(4422.88, 2)
    expect(positions[0].units).toBe(154)
  })

  it("keeps the single lot when the summary and its only lot carry an identical value", () => {
    const xml = `<FlexStatement>
      <OpenPosition accountId="U1" currency="USD" symbol="IBIT" markPrice="36.81" positionValue="2466.27" percentOfNAV="1.75" position="67" />
      <OpenPosition accountId="U1" currency="USD" symbol="IBIT" markPrice="36.81" positionValue="2466.27" percentOfNAV="" position="67" />
    </FlexStatement>`
    const { positions } = parseFlexXml(xml)
    expect(positions).toHaveLength(1)
    expect(positions[0].positionValue).toBeCloseTo(2466.27, 2)
  })

  it("still prefers non-LOT rows when levelOfDetail IS present (existing SBR export shape)", () => {
    const xml = `<FlexStatement>
      <OpenPosition accountId="U2" currency="SGD" symbol="VWRA" markPrice="243.94" positionValue="8357.38" levelOfDetail="SUMMARY" position="34.259" />
      <OpenPosition accountId="U2" currency="SGD" symbol="VWRA" markPrice="243.94" positionValue="4000" levelOfDetail="LOT" position="16.4" />
      <OpenPosition accountId="U2" currency="SGD" symbol="VWRA" markPrice="243.94" positionValue="4357.38" levelOfDetail="LOT" position="17.859" />
    </FlexStatement>`
    const { positions } = parseFlexXml(xml)
    expect(positions).toHaveLength(1)
    expect(positions[0].positionValue).toBeCloseTo(8357.38, 2)
  })

  it("sums lot rows when no summary signal exists at all (lot-only report)", () => {
    const xml = `<FlexStatement>
      <OpenPosition accountId="U3" currency="USD" symbol="SMH" markPrice="140" positionValue="400" position="2" levelOfDetail="LOT" />
      <OpenPosition accountId="U3" currency="USD" symbol="SMH" markPrice="140" positionValue="238.14" position="1.701" levelOfDetail="LOT" />
    </FlexStatement>`
    const { positions } = parseFlexXml(xml)
    expect(positions).toHaveLength(1)
    expect(positions[0].positionValue).toBeCloseTo(638.14, 2)
    expect(positions[0].units).toBeCloseTo(3.701, 3)
  })

  it("leaves an unambiguous single-row symbol untouched", () => {
    const xml = `<FlexStatement>
      <OpenPosition accountId="U4" currency="USD" symbol="DBMFE" markPrice="159.07" positionValue="1123.55" percentOfNAV="9.3" position="7.063" />
    </FlexStatement>`
    const { positions } = parseFlexXml(xml)
    expect(positions).toHaveLength(1)
    expect(positions[0].positionValue).toBeCloseTo(1123.55, 2)
  })

  it("does not cross-contaminate two different symbols in the same report", () => {
    const xml = `<FlexStatement>
      <OpenPosition accountId="U1" currency="USD" symbol="BTC" markPrice="28.72" positionValue="4422.88" percentOfNAV="3.14" position="154" />
      <OpenPosition accountId="U1" currency="USD" symbol="BTC" markPrice="28.72" positionValue="2872" percentOfNAV="" position="100" />
      <OpenPosition accountId="U1" currency="USD" symbol="QQQM" markPrice="295.56" positionValue="21871.44" percentOfNAV="15.55" position="74" />
      <OpenPosition accountId="U1" currency="USD" symbol="QQQM" markPrice="295.56" positionValue="1477.8" percentOfNAV="" position="5" />
    </FlexStatement>`
    const { positions } = parseFlexXml(xml)
    expect(positions).toHaveLength(2)
    const btc = positions.find((p) => p.symbol === "BTC")
    const qqqm = positions.find((p) => p.symbol === "QQQM")
    expect(btc?.positionValue).toBeCloseTo(4422.88, 2)
    expect(qqqm?.positionValue).toBeCloseTo(21871.44, 2)
  })
})

"use server"

import { revalidatePath } from "next/cache"
import { db } from "@/lib/db"
import { getSession } from "@/lib/session"
import Anthropic from "@anthropic-ai/sdk"

// Manual update: create new snapshots for one or more holdings
export async function updateHoldingsManually(
  updates: Array<{ holdingId: string; units: number; price: number }>
) {
  const session = await getSession()
  if (!session) throw new Error("Unauthenticated")

  for (const u of updates) {
    // Verify holding belongs to this user
    const holding = await db.holding.findFirst({
      where: { id: u.holdingId, userId: session.userId },
    })
    if (!holding) continue

    await db.snapshot.create({
      data: {
        holdingId: u.holdingId,
        units: u.units,
        price: u.price,
        value: u.units * u.price,
        currency: "USD",
        date: new Date(),
      },
    })
  }

  revalidatePath("/portfolio")
  revalidatePath("/")
  revalidatePath("/reports")
  revalidatePath("/forecast")
}

// Screenshot OCR: extract holdings data from an IBKR screenshot using Claude vision
export async function extractFromScreenshot(
  imageBase64: string,
  mimeType: string
): Promise<Array<{ ticker: string; units: number; price: number; value: number }>> {
  const session = await getSession()
  if (!session) throw new Error("Unauthenticated")

  const client = new Anthropic()

  const message = await client.messages.create({
    model: "claude-opus-4-6",
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: mimeType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
              data: imageBase64,
            },
          },
          {
            type: "text",
            text: `This is a brokerage (IBKR) portfolio screenshot. Extract the holdings data.

For each holding visible, return a JSON array with objects containing:
- ticker: the stock/ETF ticker symbol (string)
- units: number of shares/units held (number)
- price: current price per unit in USD (number)
- value: total market value in USD (number)

Only include ETF/stock holdings, not cash. Return ONLY a valid JSON array, no explanation.
Example: [{"ticker":"VT","units":428,"price":155.52,"value":85209.84}]`,
          },
        ],
      },
    ],
  })

  const text = message.content[0].type === "text" ? message.content[0].text : ""
  const jsonMatch = text.match(/\[[\s\S]*\]/)
  if (!jsonMatch) throw new Error("Could not parse holdings from screenshot")

  return JSON.parse(jsonMatch[0])
}

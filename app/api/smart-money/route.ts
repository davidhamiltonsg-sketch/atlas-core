import { NextRequest, NextResponse } from 'next/server'
import { fetchSmartMoneyFeed } from '@/lib/smart-money'

export const revalidate = 14400 // 4 hours

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const sourcesParam = searchParams.get('sources')
  const sources = sourcesParam
    ? (sourcesParam.split(',') as Array<'congress' | 'insider' | 'influencer'>)
    : (['congress', 'insider', 'influencer'] as Array<'congress' | 'insider' | 'influencer'>)
  const daysBack  = parseInt(searchParams.get('daysBack') ?? '90', 10)
  const atlasOnly = searchParams.get('atlasOnly') === 'true'

  try {
    const data = await fetchSmartMoneyFeed({
      sources, daysBack, atlasOnly,
      apiKey: process.env.FINNHUB_API_KEY,
    })
    return NextResponse.json(data, {
      headers: { 'Cache-Control': 'public, s-maxage=14400, stale-while-revalidate=3600' },
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

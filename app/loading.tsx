import { BrandMark } from "@/components/brand/brand-mark"
import { getPortfolioHint } from "@/lib/session"

export default async function Loading() {
  const hint = await getPortfolioHint()
  const id = hint === "silicon-brick-road" ? "silicon-brick-road" : "atlas-core"
  const name = id === "silicon-brick-road" ? "Silicon Brick Road" : "Atlas Core"
  const sbr = id === "silicon-brick-road"
  return (
    <div data-theme={sbr ? "sbr" : "atlas-core"} className={`premium-loader ${sbr ? "is-sbr" : "is-atlas"}`} role="status" aria-live="polite" aria-label={`Preparing ${name}`}>
      <div className="loader-atmosphere" aria-hidden="true" />
      <div className="loader-instrument" aria-hidden="true">
        <i className="loader-orbit orbit-one" /><i className="loader-orbit orbit-two" /><i className="loader-orbit orbit-three" />
        <span className="loader-pulse" />
        <BrandMark constitutionId={id} className="loader-crest" />
      </div>
      <div className="loader-copy">
        <p>{sbr ? "THE ROAD AHEAD" : "PORTFOLIO COMMAND DECK"}</p>
        <h1>{name}</h1>
        <div className="loader-progress"><span /></div>
        <div className="loader-states" aria-hidden="true">
          <span>Reading broker snapshot</span><span>Checking constitution</span><span>Preparing your cockpit</span>
        </div>
      </div>
    </div>
  )
}

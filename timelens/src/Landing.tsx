/** The front page: one sentence, one search, real moving pictures, five targets, and how it works. */
import { useState } from 'preact/hooks';
import type { Featured } from '../../web/src/api';
import { Icon } from './icons';
import { SearchBox } from './Search';
import { LOOK_FOR } from './util';

function Preview({ slug, size, alt }: { slug: string; size: number; alt: string }) {
  const [state, setState] = useState<'loading' | 'ok' | 'none'>('loading');
  return (
    <span class={'preview ' + state} style={{ width: `${size}px`, height: `${size}px` }}>
      {state !== 'none' && <img src={`/api/preview?slug=${encodeURIComponent(slug)}`} width={size} height={size} alt={alt} loading="lazy"
        onLoad={() => setState('ok')} onError={() => setState('none')} />}
      {state === 'none' && <span class="preview-none">Preview not built yet. Open the target to load its images.</span>}
    </span>
  );
}

export function Landing({ featured, go, link }: { featured: Featured[]; go: (q: string) => void; link: (to: string) => (e: Event) => void }) {
  const hero = featured.find((f) => f.slug === 'barnard') ?? featured[0];
  return (
    <main class="landing" id="main">
      <section class="hero">
        <div class="hero-text">
          <p class="eyebrow">NASA Space Apps 2026 · Planet X &amp; SPHEREx</p>
          <h1>Find what moves in the infrared sky.</h1>
          <p class="lede">NASA's SPHEREx telescope photographs the whole sky about every six months, in 102 colours of infrared light. TimeLens finds every SPHEREx image of the spot you choose, lines them up, and blinks them, so nearby stars, cold brown dwarfs and changing stars give themselves away.</p>
          <SearchBox id="hero-q" value="" featured={featured} onSubmit={go} big button="Explore the sky" />
          <p class="hero-links"><a href="#how" class="link">How it works</a><span aria-hidden="true">·</span><a href="/timelens/about" class="link" onClick={link('/about')}>Methods and data</a></p>
        </div>
        {hero && (
          <figure class="hero-vis">
            <div class="instrument">
              <span class="inst-corner tl" /><span class="inst-corner tr" /><span class="inst-corner bl" /><span class="inst-corner br" />
              <Preview slug={hero.slug} size={312} alt={`${hero.name}: one frame per SPHEREx visit, looping. The star shifts between visits.`} />
            </div>
            <figcaption>
              <b>{hero.name}</b>, a 4′ patch of sky. Each frame is one SPHEREx visit, months apart; the amber ring marks where the star should be. <span class="real">Real SPHEREx data</span>
            </figcaption>
          </figure>
        )}
      </section>

      <section class="targets" aria-labelledby="targets-h">
        <div class="sec-head">
          <h2 id="targets-h">Five targets from the challenge</h2>
          <p>Three that move, two that change brightness. Each preview is built from that target's real SPHEREx visits.</p>
        </div>
        <ul class="target-grid">
          {featured.map((f) => {
            const lf = LOOK_FOR[f.slug];
            return (
              <li>
                <button class="target-card" onClick={() => go(f.name)}>
                  <Preview slug={f.slug} size={156} alt="" />
                  <span class="tc-body">
                    <b>{f.name}</b>
                    <span class="kind">{f.kind}</span>
                    <span class="tc-blurb">{f.blurb}</span>
                    {lf && <span class={'chip ' + (lf.what === 'Motion' ? 'amber' : 'violet')}>Look for: {lf.what}</span>}
                  </span>
                  <span class="tc-go" aria-hidden="true">Open <Icon name="arrow" size={15} /></span>
                </button>
              </li>
            );
          })}
          {!featured.length && <li class="note">Loading the challenge targets…</li>}
        </ul>
      </section>

      <section class="how" id="how" aria-labelledby="how-h">
        <div class="sec-head"><h2 id="how-h">How it works</h2></div>
        <ol class="steps">
          <li><span class="step-n mono">01</span><b>Choose a spot</b><p>Type a star's name or its coordinates. TimeLens asks NASA's archive which SPHEREx exposures cover it, often hundreds.</p></li>
          <li><span class="step-n mono">02</span><b>Watch it blink</b><p>The exposures from each visit are added up and lined up north-up, then the earliest and latest visits blink. Anything that jumps is moving.</p></li>
          <li><span class="step-n mono">03</span><b>Measure and check</b><p>Measure brightness across 102 colours, subtract visits, and let TimeLens search for movers, each checked against ESA's Gaia star catalogue.</p></li>
        </ol>
      </section>

      <section class="honest" aria-labelledby="honest-h">
        <div class="sec-head"><h2 id="honest-h">Honest by design</h2></div>
        <ul class="facts">
          <li><b>Every image is real.</b> Cut directly from NASA's public SPHEREx archive (NASA/IPAC IRSA, AWS Open Data) while you watch. No demo data, no simulations.</li>
          <li><b>Nothing is filled in.</b> Pixels too bright for SPHEREx to measure stay blank, and no frames are invented between visits.</li>
          <li><b>Finds are not discoveries.</b> Anything TimeLens flags is a candidate for a person to review, cross-checked with Gaia.</li>
          <li><b>Every number has a source.</b> Each measurement links back to the exact exposure and file it came from.</li>
        </ul>
        <p><a href="/timelens/about" class="btn" onClick={link('/about')}>Read the methods <Icon name="arrow" size={16} /></a></p>
      </section>

      <footer class="foot">
        <p>SPHEREx data: NASA/JPL-Caltech, served by NASA/IPAC IRSA and the AWS Open Data programme. Gaia DR3: ESA/Gaia/DPAC. CatWISE2020: Marocco et al. 2021. Name lookups: MAST (STScI). Sky map: Aladin Lite (CDS) with ESA HiPS.</p>
        <p>A NASA Space Apps 2026 project. Not an official NASA product.</p>
      </footer>
    </main>
  );
}

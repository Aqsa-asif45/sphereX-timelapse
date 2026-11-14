/** The front page: one sentence, one search, the whole SPHEREx sky, and the five challenge targets. */
import { useState } from 'preact/hooks';
import type { Featured } from '../../web/src/api';
import { Icon } from './icons';
import { EASE, inView, motion, MotionConfig, rise, stagger } from './motion';
import { SearchBox } from './Search';
import { SkySphere } from './SkySphere';
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
    <MotionConfig reducedMotion="user">
      <main class="landing" id="main">
        <motion.section class="hero" initial="hidden" animate="show" variants={stagger}>
          <motion.div class="hero-text" variants={stagger}>
            <motion.p class="eyebrow" variants={rise}>NASA Space Apps 2026 · Planet X &amp; SPHEREx</motion.p>
            <motion.h1 variants={rise}>Find what moves in the infrared sky.</motion.h1>
            <motion.p class="lede" variants={rise}>NASA's SPHEREx telescope photographs the whole sky about every six months, in 102 colours of infrared light. TimeLens finds every SPHEREx image of the spot you choose, lines them up, and blinks them, so nearby stars, cold brown dwarfs and changing stars give themselves away.</motion.p>
            <motion.div variants={rise}>
              <SearchBox id="hero-q" value="" featured={featured} onSubmit={go} big button="Explore the sky" />
            </motion.div>
            <motion.p class="hero-links" variants={rise}><a href="#sky-h" class="link">See the whole sky</a><span aria-hidden="true">·</span><a href="/timelens/about" class="link" onClick={link('/about')}>Methods and data</a></motion.p>
          </motion.div>
          {hero && (
            <motion.figure class="hero-vis" variants={{ hidden: { opacity: 0, scale: 0.96 }, show: { opacity: 1, scale: 1, transition: { duration: 0.7, ease: EASE, delay: 0.15 } } }}>
              <div class="instrument glass">
                <span class="inst-corner tl" /><span class="inst-corner tr" /><span class="inst-corner bl" /><span class="inst-corner br" />
                <Preview slug={hero.slug} size={312} alt={`${hero.name}: one frame per SPHEREx visit, looping. The star shifts between visits.`} />
              </div>
              <figcaption>
                <b>{hero.name}</b>, a 4′ patch of sky. Each frame is one SPHEREx visit, months apart; the amber ring marks where the star should be. <span class="real">Real SPHEREx data</span>
              </figcaption>
            </motion.figure>
          )}
        </motion.section>

        <SkySphere go={go} />

        <motion.section class="targets" aria-labelledby="targets-h" {...inView} variants={stagger}>
          <motion.div class="sec-head" variants={rise}>
            <h2 id="targets-h">Five targets from the challenge</h2>
            <p>Three that move, two that change brightness. Each preview is built from that target's real SPHEREx visits.</p>
          </motion.div>
          <motion.ul class="target-grid" variants={stagger}>
            {featured.map((f) => {
              const lf = LOOK_FOR[f.slug];
              return (
                <motion.li key={f.slug} variants={rise} whileHover={{ y: -4, transition: { duration: 0.2, ease: EASE } }}>
                  <button class="target-card glass" onClick={() => go(f.name)}>
                    <Preview slug={f.slug} size={156} alt="" />
                    <span class="tc-body">
                      <b>{f.name}</b>
                      <span class="kind">{f.kind}</span>
                      <span class="tc-blurb">{f.blurb}</span>
                      {lf && <span class={'chip ' + (lf.what === 'Motion' ? 'amber' : 'violet')}>Look for: {lf.what}</span>}
                    </span>
                    <span class="tc-go" aria-hidden="true">Open <Icon name="arrow" size={15} /></span>
                  </button>
                </motion.li>
              );
            })}
            {!featured.length && <li class="note">Loading the challenge targets…</li>}
          </motion.ul>
        </motion.section>

        <footer class="foot foot-slim">
          <p>Data: NASA/JPL-Caltech/IPAC (IRSA, AWS Open Data) · Gaia DR3 (ESA) · sky globe by Aladin Lite (CDS). <a href="/timelens/about" class="link" onClick={link('/about')}>Full credits and methods</a> · A NASA Space Apps 2026 project, not an official NASA product.</p>
        </footer>
      </main>
    </MotionConfig>
  );
}

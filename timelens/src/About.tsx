/** Data and methodology: what SPHEREx is, what TimeLens does to the data, and the limits. */
export function About({ link }: { link: (to: string) => (e: Event) => void }) {
  return (
    <main class="about" id="main">
      <header class="about-head">
        <p class="eyebrow">Methods and data</p>
        <h1>How TimeLens works</h1>
        <p class="lede">TimeLens shows real SPHEREx exposures and measures them in the open. This page explains each step, and what the results can and cannot tell you.</p>
        <p><a class="btn primary" href="/timelens/explore" onClick={link('/explore')}>Start exploring</a></p>
      </header>

      <section>
        <h2>SPHEREx in one paragraph</h2>
        <p>SPHEREx is a NASA space telescope that has been mapping the whole sky since 2025, covering every point about every six months. Its six detectors see near-infrared light from 0.75 to 5.0 µm, split into 102 colours (17 per detector). Instead of separate filters it uses <em>linear variable filters</em>: the colour changes gradually across each detector. So one exposure measures every star at a slightly different wavelength, and a star's full spectrum builds up as the telescope steps across the sky. Its pixels are large, 6.15″ across, because SPHEREx is built for spectra rather than sharp pictures.</p>
      </section>

      <section>
        <h2>The steps</h2>
        <ol class="method">
          <li><b>Find.</b> Your search becomes a sky position (names via MAST, which asks SIMBAD and NED). TimeLens asks NASA/IPAC IRSA which SPHEREx exposures contain it. If IRSA is unreachable, it uses its own index of all 101,080 observations in NASA's public AWS copy of the archive. Busy fields with more than 400 exposures are sampled evenly over time.</li>
          <li><b>Confirm.</b> Each exposure's own astrometric header (TAN-SIP) is read to check the target is really on the detector and where.</li>
          <li><b>Cut out.</b> Only the pixels needed are read from the 72 MB files, by HTTP range requests. They are resampled onto a common north-up grid at the native 6.15″ pixel size (Lanczos-3), so every date lines up. Blank original pixels stay blank.</li>
          <li><b>Stack.</b> Each image is put in noise units (background subtracted, divided by its robust noise), which removes the very different sky brightness at different wavelengths. A visit is the sigma-clipped mean of its exposures, which also rejects cosmic-ray hits.</li>
          <li><b>Compare.</b> Blink and side-by-side show two visits; Difference subtracts them. Fast-moving targets are drawn at the position their known proper motion predicts for each date.</li>
          <li><b>Measure.</b> Brightness is aperture photometry: the sum inside 1.6 pixels (≈10″) minus the median of a surrounding ring, converted from MJy/sr to µJy. The wavelength of each point comes from the file's own wavelength table at the target's pixel.</li>
          <li><b>Find movers.</b> Every star's position is measured in each visit and fitted with a straight line in time. A source is flagged when it shifts more than half a pixel and at least 4× its expected noise, and when the positions really follow a line. Bright spots seen in only one well-sampled visit are flagged too. Every find is compared with Gaia DR3.</li>
        </ol>
      </section>

      <section>
        <h2>Reading the views</h2>
        <dl class="read">
          <dt>Blink</dt><dd>Two visits flip back and forth. Your eye is very good at spotting what jumps.</dd>
          <dt>Difference</dt><dd>Visit A minus visit B, in noise units. Orange is brighter in A, blue brighter in B, black unchanged. A mover leaves an orange-and-blue pair.</dd>
          <dt>Every exposure</dt><dd>Single exposures in time order. Each is a different wavelength, so brightness flickers; positions are what to watch.</dd>
          <dt>Spectrum</dt><dd>One point per exposure, coloured by visit. Shaded regions are the six detector bands. Molecule markers show where water ice, methane, carbon dioxide ice and carbon monoxide <em>would</em> absorb; they are not detections.</dd>
        </dl>
      </section>

      <section>
        <h2>Limits worth knowing</h2>
        <ul class="limits">
          <li><b>Big pixels.</b> At 6.15″ per pixel, even Barnard's Star, the fastest-moving star in the sky, shifts only about 1.7 pixels a year. Small motions need the longest time baseline.</li>
          <li><b>Bright stars saturate.</b> Their centres are blank or flagged. TimeLens warns when that affects a measurement; turn on quality flags to check.</li>
          <li><b>Uncertainties are approximate.</b> Error bars come from the local sky noise. Resampling makes neighbouring pixels share noise, so true errors are somewhat larger.</li>
          <li><b>Gaia is not complete in the infrared.</b> Gaia sees visible light, so very cold objects such as brown dwarfs are often missing from it. "Not in Gaia" means "worth a closer look", not "new".</li>
          <li><b>Visits near the poles.</b> Near the ecliptic poles SPHEREx sees a spot almost continuously, so TimeLens cuts stretches longer than about three months into visits of about six weeks. They are still real exposures, only grouped differently.</li>
          <li><b>Coverage grows.</b> SPHEREx data are released in batches. A spot with one visit today will have more later.</li>
          <li><b>Candidates need people.</b> Glare, blended stars, cosmic rays and detector artefacts can all look like change. Nothing flagged here is a confirmed discovery.</li>
        </ul>
      </section>

      <section>
        <h2>Sources and credits</h2>
        <ul class="sources">
          <li>SPHEREx data: NASA/JPL-Caltech, from <a href="https://irsa.ipac.caltech.edu/Missions/spherex.html" target="_blank" rel="noopener">NASA/IPAC IRSA</a> and its public copy on AWS (s3://nasa-irsa-spherex).</li>
          <li>Star positions and motions: <a href="https://www.cosmos.esa.int/web/gaia/dr3" target="_blank" rel="noopener">ESA Gaia DR3</a> (ESA/Gaia/DPAC), queried through IRSA or ESA.</li>
          <li>Infrared sources: CatWISE2020 (Marocco et al. 2021), through IRSA.</li>
          <li>Name lookups: <a href="https://mast.stsci.edu" target="_blank" rel="noopener">MAST</a> (STScI), which asks SIMBAD and NED.</li>
          <li>Sky map: <a href="https://aladin.cds.unistra.fr/AladinLite/" target="_blank" rel="noopener">Aladin Lite</a> (CDS, Strasbourg) with ESA's HiPS sky images.</li>
        </ul>
        <p class="note">TimeLens is a NASA Space Apps 2026 project, not an official NASA product.</p>
      </section>
    </main>
  );
}

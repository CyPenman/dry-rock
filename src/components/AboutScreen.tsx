import { useEffect, useState, type ReactNode } from 'react';
import { BMC_RAD_URL } from '../data/crags';
import { FRICTION_REASON_LABEL, LIMITING_FACTOR_LABEL } from '../lib/format';
import { toLocalIsoDate } from '../model/dateRange';
import { FRICTION_BLOCK_LENGTH_HOURS, type FrictionReason } from '../model/friction';
import type { Observation } from '../model/observation';
import { SESSION_HOURS, verdictMessage, type Verdict } from '../model/score';
import { SCORE_BAND_COLOR_VAR, SCORE_BAND_LABEL, type ScoreBand } from '../model/scoreBand';
import type { LimitingFactor } from '../model/wetness';
import { listAllObservations } from '../storage/db';
import { FeedbackForm } from './FeedbackForm';

const LINK_STYLE = { color: 'var(--signal)' } as const;

/** Save every logged observation as a JSON file (§8.1) via a temporary download link. */
function downloadObservations(observations: Observation[]) {
  const blob = new Blob([JSON.stringify(observations, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `dry-rock-observations-${toLocalIsoDate(new Date())}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function ExternalLink({ href, children }: { href: string; children: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="underline" style={LINK_STYLE}>
      {children}
    </a>
  );
}

function SectionHeading({ children }: { children: ReactNode }) {
  return (
    <h2 className="pb-1 text-xs uppercase tracking-wide" style={{ color: 'var(--text-dim)' }}>
      {children}
    </h2>
  );
}

/** A reference section, closed by default so the page opens on the quick start rather than a wall of text. */
function GuideDetails({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details
      className="group rounded border [&_summary]:list-none [&_summary::-webkit-details-marker]:hidden"
      style={{ borderColor: 'var(--border)' }}
    >
      <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-2 px-3 text-sm font-medium">
        {title}
        <span aria-hidden="true" className="transition-transform group-open:rotate-180" style={{ color: 'var(--text-dim)' }}>
          &#9662;
        </span>
      </summary>
      <div className="space-y-2 px-3 pb-3">{children}</div>
    </details>
  );
}

/** Term and meaning, one per line - the reference lists below. */
function TermList({ items }: { items: [term: ReactNode, meaning: ReactNode][] }) {
  return (
    <dl className="space-y-1.5">
      {items.map(([term, meaning], i) => (
        <div key={i}>
          <dt className="font-medium">{term}</dt>
          <dd style={{ color: 'var(--text-dim)' }}>{meaning}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Keyed by the model's own types, so a new limiting factor or friction reason fails the build until it is explained here. */
const LIMITING_FACTOR_MEANING: Record<Exclude<LimitingFactor, 'none'>, string> = {
  rain: 'Rain reaching the face kept it wet.',
  seepage: 'Water draining out of the ground behind the rock after earlier rain. It can last days after the sky clears.',
  condensation: 'Dew forming on rock colder than the air - common on still, humid mornings.',
  snow: 'Snow lying on or above the crag.',
  frozen: 'Water on the rock is frozen.',
  drying: "No new water, but the rock hasn't finished drying from earlier.",
};

const FRICTION_REASON_MEANING: Record<FrictionReason, string> = {
  humid: 'Damp air - holds feel slick even when dry.',
  near_dew_point: 'The rock is barely warmer than the dew point, so it may start to sweat.',
  too_warm: 'Warm rock grips worse. Look for shade or an evening session.',
  too_cold: 'Grips well but hard on the fingers.',
  windy: 'Dries the rock, but hard work on exposed routes.',
  sun_baked: 'Sun on the face heats it above the air temperature.',
  salt: 'Onshore wind leaves a salty film on sea cliffs.',
};

const GATED_VERDICTS: Exclude<Verdict, 'scored'>[] = ['under_snow', 'frozen', 'rock_damage', 'soft_rock_wet'];

const BANDS: ScoreBand[] = ['good', 'fair', 'poor'];

/**
 * About (spec §6, §11): a short guide for new users - how to use the app and
 * read its results - then "where it's wrong" and the Open-Meteo attribution.
 * CC BY 4.0 makes that credit a licence condition, not a courtesy (§2).
 */
export function AboutScreen({ onBack }: { onBack: () => void }) {
  const [observations, setObservations] = useState<Observation[] | null>(null);
  const unsent = observations?.filter((o) => o.sentAtSec == null).length ?? 0;

  useEffect(() => {
    listAllObservations()
      .then(setObservations)
      .catch(() => setObservations([]));
  }, []);

  return (
    <div className="mx-auto max-w-screen-sm pb-8">
      <header className="sticky top-0 z-10 px-2 py-2" style={{ background: 'var(--ground)' }}>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onBack}
            className="flex h-11 items-center gap-1 rounded px-3 text-base font-medium"
            style={{ color: 'var(--signal)' }}
          >
            <span aria-hidden="true">&larr;</span> Back
          </button>
          <h1 className="text-xl font-medium">Guide &amp; about</h1>
        </div>
      </header>

      <div className="space-y-6 px-4 text-sm leading-relaxed" style={{ color: 'var(--text)' }}>
        <section>
          <p className="text-base">Where will the rock be dry, and when?</p>
          <p className="mt-2">
            Dry Rock simulates the water on and in the rock at each crag, hour by hour, from four weather models: rain
            reaching the face, seepage from the ground behind it, dew, and drying by sun and wind. Each crag-day is then
            scored on how long the rock is dry in daylight (60%) and how good the friction is in its best dry window
            (40%). How far the four models agree sets the confidence.
          </p>
        </section>

        <section>
          <SectionHeading>Quick start</SectionHeading>
          <ol className="list-decimal space-y-2 pl-5">
            <li>
              <span className="font-medium">Pick your dates.</span> The app opens on <em>This weekend</em>. Tap{' '}
              <em>Choose dates</em> for any other day or run of days, as far as the forecast reaches.
            </li>
            <li>
              <span className="font-medium">Set your home (optional).</span> Tap <em>Set address</em> and enter a
              postcode or town, or use your location. You'll see distances and rough drive times, and can sort by{' '}
              <em>Worth the drive</em> - the best score for the distance. It's saved on this device only.
            </li>
            <li>
              <span className="font-medium">Scan the Areas tab.</span> Each region shows its best crag's score for
              every day, with a bar counting how many of its crags are good, fair or poor. Tap a region to see its
              crags.
            </li>
            <li>
              <span className="font-medium">Open a crag.</span> Tap any crag, on any tab, for the day-by-day breakdown,
              the hour-by-hour charts, sun on the face, and access notes.
            </li>
            <li>
              <span className="font-medium">Check before you go.</span> Look at the access link on the crag's page, and
              the rock when you arrive.
            </li>
          </ol>
        </section>

        <section>
          <SectionHeading>The three tabs</SectionHeading>
          <p className="mb-2" style={{ color: 'var(--text-dim)' }}>
            Tap them at the bottom of the screen, or swipe left and right.
          </p>
          <TermList
            items={[
              ['Areas', 'Crags grouped into regions - the quickest way to see where to head.'],
              [
                'Crags',
                <>
                  Every crag, ranked by its best day in your dates. Tap the <span aria-label="star">&#9734;</span> to pin
                  up to five favourites to the top, whatever their score. Crags that are ruled out sit in a closed{' '}
                  <em>Ruled out</em> list at the bottom, with the reason.
                </>,
              ],
              ['Map', 'Every crag as a coloured dot. Tap one for its score on each day.'],
            ]}
          />
          <p className="mt-2" style={{ color: 'var(--text-dim)' }}>
            Your dates, home and sort carry across all three tabs. <em>Search</em>, at the top, finds a crag by name,
            area, style or rock type.
          </p>
        </section>

        <section>
          <SectionHeading>Reading a result</SectionHeading>
          <p>Scores run from 0 to 100, in three bands:</p>
          <ul className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
            {BANDS.map((band) => (
              <li key={band} className="flex items-center gap-1.5">
                <span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: SCORE_BAND_COLOR_VAR[band] }} />
                {SCORE_BAND_LABEL[band]}
              </li>
            ))}
          </ul>

          <p className="mt-3">A crag's row reads like this:</p>
          <div className="mt-1.5 rounded border px-3 py-2" style={{ borderColor: 'var(--border)', background: 'var(--ground-raised)' }}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="min-w-0 flex-1 truncate text-base font-medium">Raven Tor</span>
              <span style={{ color: 'var(--text-dim)' }}>Peak</span>
              <span className="shrink-0 pl-2 font-mono text-base font-medium">61</span>
            </div>
            <div style={{ color: 'var(--text-dim)' }}>
              <span style={{ color: 'var(--text)' }}>Sat</span> &middot; dry from 13:00 &middot; limited by seepage
              &middot; 3 of 4 models agree it's a fair day
            </div>
          </div>
          <TermList
            items={[
              ['61', "The best day's score."],
              ['Sat', 'The best day in your dates. The strip of numbers under each row scores every day, with the best one filled in.'],
              [
                'dry from 13:00',
                <>
                  When the rock is dry in daylight: <em>dry all day</em>, <em>dry from</em> an hour until dark, a window
                  such as <em>dry 09:00-14:00</em>, <em>nearly dry</em> (damp but close), or <em>no dry window</em>.
                </>,
              ],
              [
                'limited by seepage',
                "The main thing holding the score back - here, water still seeping out of the rock after earlier rain. On a dry day it's whatever is hurting the friction instead, such as humid or windy.",
              ],
              [
                '3 of 4 models agree',
                'How many of the four weather models put the day in the same band. 4 of 4 is a confident call; 2 of 4 could go either way.',
              ],
              [
                <>
                  <span style={{ color: 'var(--warning)' }}>&times;</span> in the day strip
                </>,
                'That day is ruled out - see below.',
              ],
            ]}
          />

          <div className="mt-3">
            <GuideDetails title="What the score means">
              <p>Each day is scored out of 100 from two parts:</p>
              <TermList
                items={[
                  [
                    'Dryness - up to 60',
                    `How much of a ${SESSION_HOURS}-hour session the rock is dry for in daylight. Half comes from the total dry hours, half from the longest unbroken dry stretch, so three scattered dry hours score less than three in a row. ${SESSION_HOURS} hours or more gets full marks - a long summer day doesn't outscore a shorter one that still gives a full session.`,
                  ],
                  [
                    'Friction - up to 40',
                    `How good the grip is in the day's best ${FRICTION_BLOCK_LENGTH_HOURS}-hour dry window. Full marks for rock in the crag's ideal temperature range, dry air and a light breeze. It loses marks for humid air, rock close to the dew point, rock too warm or too cold, strong wind, sun baking the face, and salt on sea cliffs.`,
                  ],
                  [
                    'Confidence',
                    'When the weather models disagree about a day, its score is trimmed a little - by up to 15% - so an uncertain day reads lower than a sure one.',
                  ],
                ]}
              />
              <p className="pt-1">
                A high score only happens one way. An 89 needs a long dry spell <em>and</em> good grip, with most models
                agreeing - just go.
              </p>
              <p>A middling score can be very different days. A 63 could be:</p>
              <ul className="list-disc space-y-1 pl-5" style={{ color: 'var(--text-dim)' }}>
                <li>
                  <span style={{ color: 'var(--text)' }}>Dry but greasy</span> - dry all day, but humid or close to the
                  dew point, so the holds feel slick. Fine for mileage, not for a project.
                </li>
                <li>
                  <span style={{ color: 'var(--text)' }}>A short window with great grip</span> - only two or three dry
                  hours, but crisp while they last. Good for a quick hit if you can be there at the right time.
                </li>
                <li>
                  <span style={{ color: 'var(--text)' }}>Middling on both</span> - five or so dry hours, a bit warm or
                  breezy. A usable day.
                </li>
                <li>
                  <span style={{ color: 'var(--text)' }}>A good day the models disagree about</span> - it might be a
                  74, or it might not.
                </li>
              </ul>
              <p>
                On a crag's page, tap the day to see which: the dryness and friction bars, the dry window and the reason
                tell them apart.
              </p>
            </GuideDetails>
          </div>
        </section>

        <section>
          <SectionHeading>Before you climb</SectionHeading>
          <p>
            Dry Rock is a forecast, not an inspection. It can be wrong (see below), and it knows nothing about loose
            rock, fixed gear, landings or who else is there. Look at the rock yourself when you arrive. Access
            arrangements and bird restrictions change at short notice, so check the{' '}
            <ExternalLink href={BMC_RAD_URL}>BMC Regional Access Database</ExternalLink> before you go. Climbing is
            dangerous, and the decision to climb is always yours.
          </p>
        </section>

        <section className="space-y-2">
          <SectionHeading>Reference</SectionHeading>

          <GuideDetails title="What the reasons mean">
            <p style={{ color: 'var(--text-dim)' }}>What kept the rock wet:</p>
            <TermList
              items={(Object.keys(LIMITING_FACTOR_MEANING) as (keyof typeof LIMITING_FACTOR_MEANING)[]).map((k) => [
                LIMITING_FACTOR_LABEL[k],
                LIMITING_FACTOR_MEANING[k],
              ])}
            />
            <p className="pt-1" style={{ color: 'var(--text-dim)' }}>
              What held the friction back on a dry day:
            </p>
            <TermList
              items={(Object.keys(FRICTION_REASON_MEANING) as FrictionReason[]).map((k) => [
                FRICTION_REASON_LABEL[k],
                FRICTION_REASON_MEANING[k],
              ])}
            />
          </GuideDetails>

          <GuideDetails title="Why a day is ruled out">
            <p>
              Some days aren't scored at all, because climbing would be unsafe or would damage the rock. They show as{' '}
              <span style={{ color: 'var(--warning)' }}>&times;</span> with the reason:
            </p>
            <ul className="list-disc space-y-1 pl-5" style={{ color: 'var(--text-dim)' }}>
              {GATED_VERDICTS.map((v) => (
                <li key={v}>{verdictMessage(v)}</li>
              ))}
            </ul>
            <p>
              The two sandstone rules apply to the soft rock of Southern Sandstone, where a broken hold is gone for
              good.
            </p>
          </GuideDetails>

          <GuideDetails title="On a crag's page">
            <TermList
              items={[
                ['Summary', 'One sentence on the best day in your dates: when it is dry, the main reason, and how far the models agree.'],
                [
                  'Day-by-day breakdown',
                  <>
                    Tap a day for its dryness, friction and confidence, plus the air, wind, cloud, rain chance and when
                    the sun is on the face. <em>Show the numbers</em> gives the detail behind each bar.
                  </>,
                ],
                [
                  'Run ensemble forecast',
                  'Runs the wetness model against about 40 slightly different versions of the weather, giving a real chance of a dry window for the next few days. It needs a connection and takes a few seconds.',
                ],
                ['Log conditions', "Tell the app what the rock was really like - see Your observations below."],
                [
                  'Charts',
                  <>
                    Rain, water on and in the rock, rock temperature against the dew point, each model's score, and
                    where the water comes from. Tap <em>What am I looking at?</em> beside any chart for a short
                    explanation.
                  </>,
                ],
                ['Notes and links', 'Seasonal restrictions and access notes, with links to UKClimbing and the BMC access database.'],
              ]}
            />
          </GuideDetails>

          <GuideDetails title="Tips">
            <ul className="list-disc space-y-1.5 pl-5">
              <li>
                In winter, look for crags with sun on the face; in summer, for shade and <em>too warm</em> warnings.
                Each day's breakdown gives the hours of sun on the face.
              </li>
              <li>
                After a wet spell, <em>limited by seepage</em> can hang on for days on limestone. A crag that sheds
                water quickly may be the better bet.
              </li>
              <li>
                A <em>showery</em> warning means no model can say where the showers will fall. Treat the score as a
                rough guide and have a plan B.
              </li>
              <li>
                Forecasts sharpen closer to the day. Check again the night before, and use <em>Refresh</em> if the data
                age at the top looks old.
              </li>
              <li>
                Add Dry Rock to your home screen from your browser's menu to use it like an app. With no signal it shows
                the last forecast it saved, and says how old that is.
              </li>
            </ul>
          </GuideDetails>
        </section>

        <section>
          <SectionHeading>Where it's wrong</SectionHeading>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              Resolution: the models see the weather in 2km squares for the next two days and 10km squares after that,
              so a sheltered gorge or a single buttress can differ from its square.
            </li>
            <li>Every crag setting (shade, shelter, seepage, how fast it dries) is an estimate, not a measurement.</li>
            <li>Soil moisture stands in for groundwater behind the rock; it describes soil, not limestone.</li>
            <li>Showers are badly placed by every model; a showery day is less certain than it looks.</li>
            <li>Shade from trees and neighbouring walls is only roughly allowed for.</li>
            <li>Sea state and tide are not modelled, so spray and tidal access at sea cliffs are invisible.</li>
            <li>Local effects such as sea breezes, rain shadows and valley inversions are mostly missed.</li>
            <li>
              Drive times are estimates from straight-line distance (slower for the first 50 km, faster beyond, as
              motorways take over), not a route - traffic, ferries and slow cross-country roads are not known.
            </li>
          </ul>
        </section>

        <section>
          <SectionHeading>Your observations</SectionHeading>
          <p>
            Conditions you log on a crag's page are saved on this device with what the model said about the same hour,
            and sent to Dry Rock's developer so its settings can be checked against what the rock was really like. Every
            log helps. Logged with no signal, they go the next time the app opens online.{' '}
            {observations == null
              ? ''
              : observations.length === 0
                ? 'None logged yet.'
                : `${observations.length} logged so far${unsent > 0 ? `, ${unsent} waiting to send` : ''}.`}
          </p>
          <button
            type="button"
            disabled={!observations || observations.length === 0}
            onClick={() => observations && downloadObservations(observations)}
            className="mt-2 rounded-full px-3 py-1.5 text-sm disabled:opacity-40"
            style={{ background: 'var(--ground-raised)', color: 'var(--text)' }}
          >
            Export observations (JSON)
          </button>
        </section>

        <section>
          <SectionHeading>Send feedback</SectionHeading>
          <p className="pb-2">
            Found a bug, got an idea, or know a crag the app gets wrong? It goes straight to the developer. Add an email
            address if you'd like a reply.
          </p>
          <FeedbackForm />
        </section>

        <section>
          <SectionHeading>Your data</SectionHeading>
          <p>
            There are no accounts. Your home address and pinned crags stay on this device. The app asks Open-Meteo for
            weather at the crags, OpenFreeMap for the map, and, when you set a home, postcodes.io to find it. Conditions
            you log and feedback you send are emailed to the developer through FormSubmit - a log carries the crag, the
            time, what you saw, the forecast and your browser type, never your home address.
          </p>
        </section>

        <section>
          <SectionHeading>Data and credits</SectionHeading>
          <ul className="space-y-1">
            <li>
              <ExternalLink href="https://open-meteo.com/">Weather data by Open-Meteo.com</ExternalLink>, licensed under{' '}
              <ExternalLink href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</ExternalLink>.
            </li>
            <li>
              Map: <ExternalLink href="https://openfreemap.org/">OpenFreeMap</ExternalLink> &copy;{' '}
              <ExternalLink href="https://www.openmaptiles.org/">OpenMapTiles</ExternalLink>, data &copy;{' '}
              <ExternalLink href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</ExternalLink>.
            </li>
            <li>
              Postcode and town search by <ExternalLink href="https://postcodes.io/">postcodes.io</ExternalLink>. Contains
              OS data &copy; Crown copyright and database right; Royal Mail data &copy; Royal Mail copyright and database
              right; National Statistics data &copy; Crown copyright and database right.
            </li>
            <li>
              Access links to the <ExternalLink href={BMC_RAD_URL}>BMC Regional Access Database</ExternalLink>.
            </li>
          </ul>
        </section>
      </div>
    </div>
  );
}

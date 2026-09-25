import { useEffect, useState } from 'react';
import { BMC_RAD_URL } from '../data/crags';
import { toLocalIsoDate } from '../model/dateRange';
import type { Observation } from '../model/observation';
import { listAllObservations } from '../storage/db';

const LINK_STYLE = { color: 'var(--signal)' } as const;

/** Save every logged observation as a JSON file (§8.1) via a temporary download link - nothing leaves the device otherwise. */
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

/**
 * About / "where it's wrong" (spec §6, §11), and the Open-Meteo attribution -
 * CC BY 4.0 makes the credit a licence condition, not a courtesy (§2).
 */
export function AboutScreen({ onBack }: { onBack: () => void }) {
  const [observations, setObservations] = useState<Observation[] | null>(null);

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
          <h1 className="text-xl font-medium">About</h1>
        </div>
      </header>

      <div className="space-y-5 px-4 text-sm leading-relaxed" style={{ color: 'var(--text)' }}>
        <section>
          <h2 className="pb-1 text-xs uppercase tracking-wide" style={{ color: 'var(--text-dim)' }}>
            What it does
          </h2>
          <p>
            Dry Rock simulates the water on and in the rock at each crag, hour by hour, from four weather models: rain
            reaching the face, seepage from the ground behind it, dew, and drying by sun and wind. Each crag-day is then
            scored on how long the rock is dry in daylight (60%) and how good the friction is in its best dry window
            (40%). How far the four models agree sets the confidence.
          </p>
        </section>

        <section>
          <h2 className="pb-1 text-xs uppercase tracking-wide" style={{ color: 'var(--text-dim)' }}>
            Before you climb
          </h2>
          <p>
            Dry Rock is a forecast, not an inspection. It can be wrong (see below), and it knows nothing about loose
            rock, fixed gear, landings or who else is there. Look at the rock yourself when you arrive. Access
            arrangements and bird restrictions change at short notice, so check the{' '}
            <ExternalLink href={BMC_RAD_URL}>BMC Regional Access Database</ExternalLink> before you go. Climbing is
            dangerous, and the decision to climb is always yours.
          </p>
        </section>

        <section>
          <h2 className="pb-1 text-xs uppercase tracking-wide" style={{ color: 'var(--text-dim)' }}>
            Where it's wrong
          </h2>
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
          <h2 className="pb-1 text-xs uppercase tracking-wide" style={{ color: 'var(--text-dim)' }}>
            Your observations
          </h2>
          <p>
            Conditions you log on a crag's page are saved on this device with what the model said about the same hour,
            so its settings can be checked against what the rock was really like.{' '}
            {observations == null
              ? ''
              : observations.length === 0
                ? 'None logged yet.'
                : `${observations.length} logged so far.`}
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
          <h2 className="pb-1 text-xs uppercase tracking-wide" style={{ color: 'var(--text-dim)' }}>
            Data and credits
          </h2>
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

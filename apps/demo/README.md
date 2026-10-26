# Ripen demo

The real Ripen service and API running in the browser on in-memory storage, with 160 simulated people. Pick your own channel on the phone, let days pass, and promote features through the gate in the release console. Nothing leaves the page.

```bash
pnpm demo                        # builds into apps/demo/site
python3 -m http.server -d apps/demo/site 8080   # or any static server
```

`site/index.html` works on any static host; `site/page.html` is the same page without the document wrapper, as published to claude.ai Artifacts.

The simulation is in [`src/simulation.ts`](src/simulation.ts): people open the app, early subscribers send pulses, "Voice notes" is deliberately buggy so its gate fails.

# Local video recording desk

The final integration includes Claude's completed onboarding (`ab858ec`), merged as `fc0a7da`. UI production build and root/UI typechecks passed after the merge.

- **Start here:** http://127.0.0.1:5195/ — video desk with direct links to the app and saved artifacts.
- **Tester:** http://127.0.0.1:5194/ — spec upload, actual Muse preparation, project review and explicitly offline selected-world campaigns. Opening the server does not start a model request or campaign.
- **Existing completed live HMI trial:** http://127.0.0.1:5190/ — separate prepared-conveyor proof, retained for Campaign/Results review.

In the tester, open Setup. Select **Slow-belt conveyor variant → v1** for the genuine saved Muse generation, assumptions, validation and 28-check plan. Its recorded project report is available from the version's Runs list. **Create project from specification** is the upload flow. Preparing a new project uses paid Muse calls; pressing Start in this tester executes the explicitly labelled offline fixture transport/provider, not a fresh PLC trial.

The video desk serves only an explicit artifact allowlist. It includes portable HTML/PDF reports for the adaptive PLC and HMI trials, exact received Start/Stop/overload/Reset images, agnostic diagrams, genuine generated source/validation and saved onboarding witness images. It has no campaign/model/PLC controls.

From this checkout's root, restart the artifact desk with:

```powershell
node scripts/serve-recording-artifacts.mjs --port 5195
```

Verify artifact availability without starting a server:

```powershell
node scripts/serve-recording-artifacts.mjs --check
```

The tester was started separately using `scripts/host-portal.js --port 5194 --campaign project --projects artifacts/projects --project-author muse --artifacts artifacts/project-host`, with the shared private `.env` loaded by Node's `--env-file` option. Do not put the model key into browser configuration or the recording.

Verification: 46 artifact URLs returned HTTP 200 with SHA-256 matching their source bytes; the tester API returned the expected project-offline factory and Muse preparation author; the video desk rendered without horizontal overflow. Evidence: `artifacts/submission-recording/video-desk-check.json` and `video-desk.png`. No model request, campaign or PLC write was initiated by these checks.

Use [the timed storyboard](demo-three-minute-cut.md). Keep preparation, offline tester footage and the separate recorded live trials labelled accurately.

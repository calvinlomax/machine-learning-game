# ML Racer (Browser-Only RL Game)

A static single-page machine learning game where a reinforcement learning agent learns to drive on a 2D top-down procedural racetrack.

The app is fully static, runs entirely in the browser, and requires no backend.

## Tech stack

- Vite + Vanilla JS (ES modules)
- HTML canvas rendering
- Custom in-browser DQN-style learner (small MLP + replay + target network)
- GitHub Pages deployment via GitHub Actions

## Local development

```bash
npm install
npm run dev
```

Build production bundle:

```bash
npm run build
```

Preview local production build:

```bash
npm run preview
```

## GitHub Pages deployment

Deployment workflow file:

- `.github/workflows/deploy.yml`

How it works:

1. On push to `main` (or manual dispatch), the workflow installs dependencies.
2. It builds the app with `VITE_BASE_PATH=/<repo-name>/`.
3. It uploads `dist/` as a Pages artifact.
4. It deploys using `actions/deploy-pages`.

Repository settings required:

1. Open GitHub repo settings.
2. Go to `Pages`.
3. Set source to `GitHub Actions`.

## Base path and project pages

The app uses one constant in runtime:

- `BASE_URL` in `src/main.js`, from `import.meta.env.BASE_URL`

Build-time base handling is in `vite.config.js`:

- Uses `VITE_BASE_PATH` when provided.
- Otherwise infers `/<repo-name>/` in production (from `GITHUB_REPOSITORY`) and `/` in dev.

To deploy under a different project path, set `VITE_BASE_PATH` in workflow/env.

## Game controls

- `Start/Pause`: run or stop simulation + training
- `Step`: advances one environment step and runs training for that step
- `Episode reset`: resets only episode state (model weights stay)
- `New track`: confirmation modal, generates new procedural track + resets episode
- `New racer`: confirmation modal, resets model weights + training history + episode
- `Track seed` + `Apply seed`: manual deterministic track generation
- Toggles: show/hide ray sensors and trajectory trail

## Environment and learning summary

### Procedural track generation

- A closed centerline is generated from seeded radial control points.
- The centerline is smoothed with a closed Catmull-Rom spline.
- Left/right boundaries are offset from centerline normals by half track width.
- Progress is computed by projecting the car position to nearest centerline segment.
- Off-track is detected by distance from centerline (`distance > trackWidth / 2`).

### Episode lifecycle

- Episode ends immediately on off-track.
- Episode also ends at max episode step cap.
- On termination:
  - episode return is recorded,
  - epsilon decays,
  - a new episode starts,
  - at least one training update is attempted before continuing.

### RL baseline

- DQN-style Q-learning:
  - online network + target network
  - replay buffer
  - epsilon-greedy exploration
- Network: lightweight MLP (hidden ReLU layer) implemented in plain JS.
- Observation includes:
  - normalized speed
  - heading alignment signals
  - lateral offset
  - steering state
  - forward raycast distances to track boundaries
- Reward includes:
  - progress reward
  - off-track terminal penalty
  - low-speed penalty
  - small steering penalty

## Hyperparameters and tuning

The Training panel contains live sliders for:

- Learning rate (log-scale feel, `1e-5` to `1e-2`)
- Discount factor gamma (`0.80` to `0.999`)
- Epsilon start (`0.1` to `1.0`)
- Epsilon min (`0.01` to `0.2`)
- Epsilon decay (`0.90` to `0.9999`, applied **per episode end**)
- Batch size (`16` to `256`)
- Replay buffer size (`1,000` to `50,000`)
- Target network update period (`50` to `5,000`)
- Training steps per environment step (`1` to `10`)
- Max episode steps (`200` to `5,000`)
- Action smoothing (`0.0` to `0.9`)
- Reward weights:
  - progress reward (`0` to `5`)
  - off-track penalty (`-10` to `0`)
  - speed penalty (`0` to `2`)

`Reset Defaults` restores all sliders to baseline values.

## Persistence

Stored in `localStorage`:

- best episode return
- last-used hyperparameters

## Project structure

```text
/
  index.html
  vite.config.js
  package.json
  /src
    main.js
    ui.js
    env.js
    trackgen.js
    physics.js
    rl.js
    replay.js
    rng.js
    render.js
    storage.js
  /styles
    app.css
  /.github/workflows
    deploy.yml
  README.md
```

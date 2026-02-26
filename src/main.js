import { RNG, normalizeSeed, randomSeed } from "./rng.js";
import { generateTrack, WORLD_HEIGHT, WORLD_WIDTH } from "./trackgen.js";
import { RacingEnv } from "./env.js";
import { DQNAgent } from "./rl.js";
import { ACTIONS } from "./physics.js";
import { createRenderer } from "./render.js";
import { DEFAULT_HYPERPARAMS, clampHyperparams, createUI } from "./ui.js";
import {
  clearBestReturn,
  loadBestReturn,
  loadHyperparams,
  saveBestReturn,
  saveHyperparams
} from "./storage.js";

const BASE_URL = import.meta.env?.BASE_URL ?? "/";
document.getElementById("base-url-readout").textContent = BASE_URL;

const canvas = document.getElementById("game-canvas");
const renderer = createRenderer(canvas, {
  worldWidth: WORLD_WIDTH,
  worldHeight: WORLD_HEIGHT
});

const persistedHyperparams = loadHyperparams();
let hyperparams = clampHyperparams({
  ...DEFAULT_HYPERPARAMS,
  ...(persistedHyperparams || {})
});

let bestEpisodeReturn = loadBestReturn();
if (!Number.isFinite(bestEpisodeReturn)) {
  bestEpisodeReturn = Number.NEGATIVE_INFINITY;
}

let currentSeed = randomSeed();
const envRng = new RNG(currentSeed ^ 0x9e3779b9);
const agentRng = new RNG(currentSeed ^ 0x85ebca6b);

let track = generateTrack(currentSeed, {
  worldWidth: WORLD_WIDTH,
  worldHeight: WORLD_HEIGHT
});

const env = new RacingEnv({
  track,
  rng: envRng,
  dt: 1 / 30,
  maxEpisodeSteps: hyperparams.maxEpisodeSteps,
  actionSmoothing: hyperparams.actionSmoothing,
  rewardWeights: {
    progressWeight: hyperparams.progressRewardWeight,
    offTrackPenalty: hyperparams.offTrackPenalty,
    speedPenaltyWeight: hyperparams.speedPenaltyWeight
  }
});

let observation = env.currentObservation;

const agent = new DQNAgent({
  observationSize: env.observationSize,
  actionSize: ACTIONS.length,
  rng: agentRng,
  hyperparams
});

const ui = createUI({
  initialHyperparams: hyperparams,
  initialSeed: currentSeed
});

let running = false;
let episodeNumber = 1;
let fps = 0;
let lastStepMs = 0;

const fixedStepMs = env.dt * 1000;
let accumulatorMs = 0;
let lastFrameTime = performance.now();

function applyHyperparams(nextHyperparams) {
  hyperparams = clampHyperparams(nextHyperparams);

  agent.setHyperparams(hyperparams);
  env.updateConfig({
    maxEpisodeSteps: hyperparams.maxEpisodeSteps,
    actionSmoothing: hyperparams.actionSmoothing,
    rewardWeights: {
      progressWeight: hyperparams.progressRewardWeight,
      offTrackPenalty: hyperparams.offTrackPenalty,
      speedPenaltyWeight: hyperparams.speedPenaltyWeight
    }
  });

  saveHyperparams(hyperparams);
}

function replaceTrack(seed) {
  const parsedSeed = normalizeSeed(seed);
  currentSeed = parsedSeed;
  ui.setSeedInput(parsedSeed);

  track = generateTrack(parsedSeed, {
    worldWidth: WORLD_WIDTH,
    worldHeight: WORLD_HEIGHT
  });

  observation = env.setTrack(track);
}

function resetEpisode({ countAsNewEpisode = true } = {}) {
  if (countAsNewEpisode) {
    episodeNumber += 1;
  }
  observation = env.resetEpisode(true);
}

function handleEpisodeTermination() {
  const finishedReturn = env.episodeReturn;
  if (!Number.isFinite(bestEpisodeReturn) || finishedReturn > bestEpisodeReturn) {
    bestEpisodeReturn = finishedReturn;
    saveBestReturn(bestEpisodeReturn);
  }

  agent.onEpisodeEnd();
  resetEpisode({ countAsNewEpisode: true });

  const forcedUpdate = agent.train(1);
  if (forcedUpdate.loss !== null) {
    agent.lastLoss = forcedUpdate.loss;
  }
}

function runOneStep() {
  const actionIndex = agent.act(observation);
  const transition = env.step(actionIndex);

  agent.remember({
    state: observation,
    action: actionIndex,
    reward: transition.reward,
    nextState: transition.observation,
    done: transition.done
  });

  const trainResult = agent.train(hyperparams.trainingStepsPerEnvStep);
  if (trainResult.loss !== null) {
    agent.lastLoss = trainResult.loss;
  }

  observation = transition.observation;

  if (transition.done) {
    handleEpisodeTermination();
  }
}

async function handleNewTrackRequest() {
  const confirmed = await ui.confirmNewTrack();
  if (!confirmed) {
    return;
  }

  replaceTrack(randomSeed());
}

async function handleNewRacerRequest() {
  const confirmed = await ui.confirmNewRacer();
  if (!confirmed) {
    return;
  }

  agent.resetModel();
  clearBestReturn();
  env.clearLapHistory();
  bestEpisodeReturn = Number.NEGATIVE_INFINITY;
  episodeNumber = 1;
  observation = env.resetEpisode(true);
}

ui.setHandlers({
  onStartPause: () => {
    running = !running;
    ui.setRunning(running);
  },
  onStep: () => {
    if (ui.isModalOpen()) {
      return;
    }

    const stepStart = performance.now();
    runOneStep();
    lastStepMs = performance.now() - stepStart;
  },
  onEpisodeReset: () => {
    if (ui.isModalOpen()) {
      return;
    }

    resetEpisode({ countAsNewEpisode: true });
  },
  onRequestNewTrack: () => {
    if (ui.isModalOpen()) {
      return;
    }

    handleNewTrackRequest();
  },
  onRequestNewRacer: () => {
    if (ui.isModalOpen()) {
      return;
    }

    handleNewRacerRequest();
  },
  onApplySeed: (seedText) => {
    if (ui.isModalOpen()) {
      return;
    }

    replaceTrack(seedText);
  },
  onHyperparamsChange: (nextHyperparams) => {
    applyHyperparams(nextHyperparams);
  }
});

ui.setHyperparams(hyperparams, false);
ui.setRunning(running);
saveHyperparams(hyperparams);

function renderFrame() {
  const renderState = env.getRenderState();
  const renderOptions = ui.getRenderOptions();

  renderer.render({
    track: renderState.track,
    car: renderState.car,
    trail: renderState.trail,
    sensorHits: renderState.sensorHits,
    showSensors: renderOptions.showSensors,
    showTrail: renderOptions.showTrail
  });

  ui.updateStats({
    episode: episodeNumber,
    step: env.stepCount,
    totalTrainingSteps: agent.trainingStepCount,
    progress: renderState.lapProgress,
    reward: env.lastReward,
    episodeReturn: env.episodeReturn,
    bestReturn: bestEpisodeReturn,
    thisLapTimeSec: renderState.thisLapTimeSec,
    bestLapTimeSec: renderState.bestLapTimeSec,
    epsilon: agent.epsilon,
    learningRate: hyperparams.learningRate,
    gamma: hyperparams.gamma,
    fps,
    stepMs: lastStepMs
  });
}

function loop(timestamp) {
  const frameDelta = Math.min(250, timestamp - lastFrameTime);
  lastFrameTime = timestamp;

  if (frameDelta > 0) {
    const currentFps = 1000 / frameDelta;
    fps = fps === 0 ? currentFps : fps * 0.9 + currentFps * 0.1;
  }

  if (running && !ui.isModalOpen()) {
    accumulatorMs += frameDelta;

    while (accumulatorMs >= fixedStepMs) {
      const stepStart = performance.now();
      runOneStep();
      lastStepMs = performance.now() - stepStart;
      accumulatorMs -= fixedStepMs;
    }
  } else {
    accumulatorMs = 0;
  }

  renderFrame();
  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);

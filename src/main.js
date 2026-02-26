import { RNG, normalizeSeed, randomSeed } from "./rng.js";
import { generateTrack, WORLD_HEIGHT, WORLD_WIDTH } from "./trackgen.js";
import { RacingEnv } from "./env.js";
import { DQNAgent } from "./rl.js";
import { ACTIONS } from "./physics.js";
import { createRenderer } from "./render.js";
import { CAR_PRESETS, DEFAULT_CAR_ID } from "./cars.js";
import { DEFAULT_HYPERPARAMS, clampHyperparams, createUI } from "./ui.js";
import { randomBizzaroName } from "./names.js";
import {
  clearBestReturn,
  loadBestReturn,
  loadHyperparams,
  loadSavedRacers,
  saveBestReturn,
  saveHyperparams,
  saveSavedRacers
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
let currentCarId = DEFAULT_CAR_ID;

const carById = new Map(CAR_PRESETS.map((car) => [car.id, car]));
const MAX_SAVED_RACERS = 4;

function normalizeBestReturn(value) {
  return Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY;
}

function createSavedRacerId() {
  return `racer-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

function sanitizeSavedRacer(entry, fallbackIndex) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const agentSnapshot = entry.agentSnapshot;
  if (!agentSnapshot || typeof agentSnapshot !== "object") {
    return null;
  }

  const rawName = typeof entry.name === "string" ? entry.name.trim() : "";
  const name = rawName || randomBizzaroName();
  const carId = carById.has(entry.carId) ? entry.carId : DEFAULT_CAR_ID;

  const hyperparamSource = entry.hyperparams || entry.agentSnapshot?.hyperparams || DEFAULT_HYPERPARAMS;
  const sanitizedHyperparams = clampHyperparams({
    ...DEFAULT_HYPERPARAMS,
    ...hyperparamSource
  });

  const metrics = entry.metrics && typeof entry.metrics === "object" ? entry.metrics : {};
  const episodes = Math.max(1, Math.floor(Number(metrics.episodes) || 1));
  const bestLapCount = Math.max(0, Math.floor(Number(metrics.bestLapCount) || 0));
  const trainingSteps = Math.max(
    0,
    Math.floor(
      Number(metrics.trainingSteps) ||
        Number(entry.agentSnapshot?.trainingStepCount) ||
        Number(entry.trainingStepCount) ||
        0
    )
  );

  const bestReturn = Number(metrics.bestReturn);
  const bestLapTimeSec = Number(metrics.bestLapTimeSec);
  const worstLapTimeSec = Number(metrics.worstLapTimeSec);
  const createdAt = Number(entry.createdAt);
  const updatedAt = Number(entry.updatedAt);

  return {
    id: typeof entry.id === "string" && entry.id ? entry.id : `racer-${fallbackIndex}-${Date.now()}`,
    name: name.slice(0, 48),
    carId,
    hyperparams: sanitizedHyperparams,
    agentSnapshot,
    metrics: {
      episodes,
      bestLapCount,
      bestReturn: Number.isFinite(bestReturn) ? bestReturn : Number.NEGATIVE_INFINITY,
      trainingSteps,
      bestLapTimeSec: Number.isFinite(bestLapTimeSec) && bestLapTimeSec > 0 ? bestLapTimeSec : null,
      worstLapTimeSec: Number.isFinite(worstLapTimeSec) && worstLapTimeSec > 0 ? worstLapTimeSec : null
    },
    createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : Date.now()
  };
}

function sanitizeSavedRacers(rawRacers) {
  if (!Array.isArray(rawRacers)) {
    return [];
  }

  const sanitized = [];
  for (let i = 0; i < rawRacers.length; i += 1) {
    const racer = sanitizeSavedRacer(rawRacers[i], i);
    if (racer) {
      sanitized.push(racer);
    }
  }

  sanitized.sort((a, b) => (a.updatedAt || 0) - (b.updatedAt || 0));
  return sanitized.slice(-MAX_SAVED_RACERS);
}

function persistSavedRacers(nextSavedRacers) {
  saveSavedRacers(nextSavedRacers);
  ui.setSavedRacers(nextSavedRacers, CAR_PRESETS);
}

let savedRacers = sanitizeSavedRacers(loadSavedRacers());

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
  env.clearLapHistory({ resetBestLapCount: true });
  bestEpisodeReturn = Number.NEGATIVE_INFINITY;
  episodeNumber = 1;
  observation = env.resetEpisode(true);
}

async function handleCarPickerRequest() {
  const selectedCarId = await ui.openCarPicker(CAR_PRESETS, currentCarId);
  if (!selectedCarId) {
    return;
  }

  if (carById.has(selectedCarId)) {
    currentCarId = selectedCarId;
  }
}

function getCurrentRacerMetrics() {
  const renderState = env.getRenderState();
  return {
    episodes: Math.max(1, Math.floor(episodeNumber)),
    bestLapCount: Math.max(0, Math.floor(renderState.bestLapCount ?? 0)),
    bestReturn: normalizeBestReturn(bestEpisodeReturn),
    trainingSteps: Math.max(0, Math.floor(agent.trainingStepCount)),
    bestLapTimeSec:
      Number.isFinite(renderState.bestLapTimeSec) && renderState.bestLapTimeSec > 0
        ? renderState.bestLapTimeSec
        : null,
    worstLapTimeSec:
      Number.isFinite(renderState.worstLapTimeSec) && renderState.worstLapTimeSec > 0
        ? renderState.worstLapTimeSec
        : null
  };
}

function buildSavedRacerPayload(name) {
  return {
    id: createSavedRacerId(),
    name: String(name).slice(0, 48),
    carId: currentCarId,
    hyperparams: { ...hyperparams },
    agentSnapshot: agent.exportSnapshot(),
    metrics: getCurrentRacerMetrics(),
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
}

function applySavedBestReturn(nextBestReturn) {
  bestEpisodeReturn = normalizeBestReturn(nextBestReturn);
  if (Number.isFinite(bestEpisodeReturn)) {
    saveBestReturn(bestEpisodeReturn);
  } else {
    clearBestReturn();
  }
}

async function handleSaveRacerRequest() {
  const result = await ui.promptSaveRacerName();
  if (!result) {
    return;
  }

  const chosenName = result.name || randomBizzaroName();
  const savedPayload = buildSavedRacerPayload(chosenName);

  savedRacers = [...savedRacers, savedPayload];
  if (savedRacers.length > MAX_SAVED_RACERS) {
    savedRacers = savedRacers.slice(savedRacers.length - MAX_SAVED_RACERS);
  }

  persistSavedRacers(savedRacers);
}

async function handleDeploySavedRacer(racerId) {
  const savedRacer = savedRacers.find((item) => item.id === racerId);
  if (!savedRacer) {
    return;
  }

  const nextHyperparams = clampHyperparams({
    ...DEFAULT_HYPERPARAMS,
    ...(savedRacer.hyperparams || {}),
    ...(savedRacer.agentSnapshot?.hyperparams || {})
  });

  ui.setHyperparams(nextHyperparams, false);
  applyHyperparams(nextHyperparams);

  const restored = agent.importSnapshot({
    ...savedRacer.agentSnapshot,
    hyperparams: nextHyperparams
  });

  if (!restored) {
    agent.resetModel();
  }

  currentCarId = carById.has(savedRacer.carId) ? savedRacer.carId : DEFAULT_CAR_ID;
  episodeNumber = Math.max(1, Math.floor(Number(savedRacer.metrics?.episodes) || 1));
  applySavedBestReturn(savedRacer.metrics?.bestReturn);

  env.clearLapHistory();
  env.setLapHistory({
    bestLapCount: savedRacer.metrics?.bestLapCount,
    bestLapTimeSec: savedRacer.metrics?.bestLapTimeSec,
    worstLapTimeSec: savedRacer.metrics?.worstLapTimeSec
  });

  observation = env.resetEpisode(true);
}

async function handleDeleteSavedRacer(racerId) {
  const racer = savedRacers.find((item) => item.id === racerId);
  if (!racer) {
    return;
  }

  const confirmed = await ui.confirmDeleteRacer(racer.name);
  if (!confirmed) {
    return;
  }

  savedRacers = savedRacers.filter((item) => item.id !== racerId);
  persistSavedRacers(savedRacers);
}

async function handleEditSavedRacer(racerId) {
  const racerIndex = savedRacers.findIndex((item) => item.id === racerId);
  if (racerIndex < 0) {
    return;
  }

  const racer = savedRacers[racerIndex];
  const result = await ui.promptEditRacer(racer, CAR_PRESETS);
  if (!result) {
    return;
  }

  const nextName = result.name ? result.name.slice(0, 48) : racer.name;
  const nextCarId = carById.has(result.carId) ? result.carId : racer.carId;

  savedRacers = savedRacers.map((item, index) =>
    index === racerIndex
      ? {
          ...item,
          name: nextName || racer.name,
          carId: nextCarId,
          updatedAt: Date.now()
        }
      : item
  );

  persistSavedRacers(savedRacers);
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
  onRequestCarPicker: () => {
    handleCarPickerRequest();
  },
  onRequestSaveRacer: () => {
    if (ui.isModalOpen()) {
      return;
    }

    handleSaveRacerRequest();
  },
  onDeploySavedRacer: (racerId) => {
    if (ui.isModalOpen()) {
      return;
    }

    handleDeploySavedRacer(racerId);
  },
  onDeleteSavedRacer: (racerId) => {
    if (ui.isModalOpen()) {
      return;
    }

    handleDeleteSavedRacer(racerId);
  },
  onEditSavedRacer: (racerId) => {
    if (ui.isModalOpen()) {
      return;
    }

    handleEditSavedRacer(racerId);
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
persistSavedRacers(savedRacers);

function renderFrame() {
  const renderState = env.getRenderState();
  const renderOptions = ui.getRenderOptions();

  renderer.render({
    track: renderState.track,
    car: renderState.car,
    trail: renderState.trail,
    sensorHits: renderState.sensorHits,
    showSensors: renderOptions.showSensors,
    showTrail: renderOptions.showTrail,
    carStyle: carById.get(currentCarId)
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
    worstLapTimeSec: renderState.worstLapTimeSec,
    currentLapCount: renderState.currentLapCount,
    bestLapCount: renderState.bestLapCount,
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

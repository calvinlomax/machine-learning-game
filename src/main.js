import { RNG, normalizeSeed, randomSeed } from "./rng.js";
import { generateTrack, generateTrackFromShape, WORLD_HEIGHT, WORLD_WIDTH } from "./trackgen.js";
import { RacingEnv } from "./env.js";
import { DQNAgent } from "./rl.js";
import { ACTIONS } from "./physics.js";
import { createRenderer } from "./render.js";
import { CAR_PRESETS, DEFAULT_CAR_ID } from "./cars.js";
import { DEFAULT_HYPERPARAMS, clampHyperparams, createUI } from "./ui.js?v=trackfix-speed-20260227";
import { randomBizzaroName } from "./names.js";
import {
  clearBestReturn,
  loadAppSettings,
  loadBestReturn,
  loadHyperparams,
  loadSavedRacers,
  loadTeamName,
  saveAppSettings,
  saveBestReturn,
  saveHyperparams,
  saveSavedRacers,
  saveTeamName
} from "./storage.js";

const BASE_URL = import.meta.env?.BASE_URL ?? "/";
const DEFAULT_TEAM_NAME = "ML1 Academy";
const MAX_SAVED_RACERS = 4;
const TRACK_PRESETS = Object.freeze([
  { id: "monte-carlo", name: "Monte Carlo", seed: "318041527" },
  { id: "monza", name: "Monza", seed: "704219883" },
  { id: "silverstone", name: "Silverstone", seed: "156890472" },
  { id: "suzuka", name: "Suzuka", seed: "902417635" }
]);

const DEFAULT_APP_SETTINGS = Object.freeze({
  worldWidth: WORLD_WIDTH,
  worldHeight: WORLD_HEIGHT,
  trackWidth: 112,
  trackColor: "#576f57",
  canvasBgColor: "#1b2b2f",
  canvasPattern: "diagonal",
  uiTheme: "light",
  trainingSpeed: 1
});

document.documentElement.dataset.baseUrl = BASE_URL;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function sanitizeColor(input, fallback) {
  const value = String(input ?? "").trim();
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;
}

function sanitizeAppSettings(input) {
  const source = {
    ...DEFAULT_APP_SETTINGS,
    ...(input && typeof input === "object" ? input : {})
  };

  const allowedPatterns = new Set(["diagonal", "grid", "dots", "solid"]);

  return {
    worldWidth: Math.round(clamp(Number(source.worldWidth) || WORLD_WIDTH, 480, 1600)),
    worldHeight: Math.round(clamp(Number(source.worldHeight) || WORLD_HEIGHT, 320, 1200)),
    trackWidth: Math.round(clamp(Number(source.trackWidth) || 112, 80, 150)),
    trackColor: sanitizeColor(source.trackColor, DEFAULT_APP_SETTINGS.trackColor),
    canvasBgColor: sanitizeColor(source.canvasBgColor, DEFAULT_APP_SETTINGS.canvasBgColor),
    canvasPattern: allowedPatterns.has(source.canvasPattern) ? source.canvasPattern : "diagonal",
    uiTheme: source.uiTheme === "dark" ? "dark" : "light",
    trainingSpeed: Math.round(clamp(Number(source.trainingSpeed) || 1, 1, 25))
  };
}

function normalizeBestReturn(value) {
  return Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY;
}

function clampSeedInput(seed) {
  const text = String(seed ?? "").trim();
  if (!text) {
    return "1";
  }
  return text.length > 9 ? text.slice(0, 9) : text;
}

function cloneSerializable(value, fallback) {
  try {
    if (typeof structuredClone === "function") {
      return structuredClone(value);
    }
  } catch {
    return fallback;
  }

  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return fallback;
  }
}

function createSavedRacerId(existingIds = new Set()) {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    let uuid = globalThis.crypto.randomUUID();
    while (existingIds.has(uuid)) {
      uuid = globalThis.crypto.randomUUID();
    }
    return uuid;
  }

  let fallbackId = `racer-${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
  while (existingIds.has(fallbackId)) {
    fallbackId = `racer-${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
  }
  return fallbackId;
}

function formatSeconds(secondsValue) {
  const value = Number(secondsValue);
  if (!Number.isFinite(value) || value <= 0) {
    return "--";
  }
  return `${value.toFixed(2)}s`;
}

const canvas = document.getElementById("game-canvas");
const persistedSettings = loadAppSettings();
let appSettings = sanitizeAppSettings({
  ...DEFAULT_APP_SETTINGS,
  ...(persistedSettings || {})
});

const renderer = createRenderer(canvas, {
  worldWidth: appSettings.worldWidth,
  worldHeight: appSettings.worldHeight
});
renderer.setWorldSize(appSettings.worldWidth, appSettings.worldHeight);

const persistedHyperparams = loadHyperparams();
let hyperparams = clampHyperparams({
  ...DEFAULT_HYPERPARAMS,
  ...(persistedHyperparams || {})
});

let bestEpisodeReturn = loadBestReturn();
if (!Number.isFinite(bestEpisodeReturn)) {
  bestEpisodeReturn = Number.NEGATIVE_INFINITY;
}

let teamName = loadTeamName() || DEFAULT_TEAM_NAME;
let currentSeed = randomSeed();

const envRng = new RNG(currentSeed ^ 0x9e3779b9);
const agentRng = new RNG(currentSeed ^ 0x85ebca6b);

let trackSource = {
  type: "seed",
  seed: currentSeed,
  name: null,
  shapePointsNorm: null
};

let track = generateTrack(currentSeed, {
  worldWidth: appSettings.worldWidth,
  worldHeight: appSettings.worldHeight,
  trackWidth: appSettings.trackWidth
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
  initialSeed: currentSeed,
  initialTeamName: teamName,
  initialSettings: appSettings
});

let running = false;
let episodeNumber = 1;
let fps = 0;
let lastStepMs = 0;
let currentCarId = DEFAULT_CAR_ID;
let currentDriverName = "Current Racer";
let deployedRacerId = null;
let trainingSpeedMultiplier = appSettings.trainingSpeed;

const drawState = {
  active: false,
  isPointerDown: false,
  points: []
};

const carById = new Map(CAR_PRESETS.map((car) => [car.id, car]));

function sanitizeSavedRacer(entry, fallbackIndex) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const agentSnapshot = cloneSerializable(entry.agentSnapshot, null);
  if (!agentSnapshot || typeof agentSnapshot !== "object") {
    return null;
  }

  const rawName = typeof entry.name === "string" ? entry.name.trim() : "";
  const name = rawName || randomBizzaroName();
  const carId = carById.has(entry.carId) ? entry.carId : DEFAULT_CAR_ID;

  const hyperparamSource = cloneSerializable(
    entry.hyperparams || entry.agentSnapshot?.hyperparams || DEFAULT_HYPERPARAMS,
    DEFAULT_HYPERPARAMS
  );
  const sanitizedHyperparams = clampHyperparams({
    ...DEFAULT_HYPERPARAMS,
    ...hyperparamSource
  });

  const metrics = cloneSerializable(
    entry.metrics && typeof entry.metrics === "object" ? entry.metrics : {},
    {}
  );

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
  const usedIds = new Set();
  for (let i = 0; i < rawRacers.length; i += 1) {
    const racer = sanitizeSavedRacer(rawRacers[i], i);
    if (!racer) {
      continue;
    }

    let nextId = racer.id;
    if (!nextId || usedIds.has(nextId)) {
      nextId = createSavedRacerId(usedIds);
    }

    usedIds.add(nextId);
    sanitized.push(
      nextId === racer.id
        ? racer
        : {
            ...racer,
            id: nextId,
            updatedAt: Date.now()
          }
    );
  }

  sanitized.sort((a, b) => (a.updatedAt || 0) - (b.updatedAt || 0));
  return cloneSerializable(sanitized.slice(-MAX_SAVED_RACERS), []);
}

let savedRacers = sanitizeSavedRacers(loadSavedRacers());

function persistSavedRacers(nextSavedRacers) {
  const canonical = sanitizeSavedRacers(nextSavedRacers);
  saveSavedRacers(canonical);
  ui.setSavedRacers(canonical, CAR_PRESETS);
  return canonical;
}

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

function toNormalizedShapePoints(worldPoints) {
  const safe = Array.isArray(worldPoints) ? worldPoints : [];
  return safe
    .filter((point) => Number.isFinite(point?.x) && Number.isFinite(point?.y))
    .map((point) => ({
      x: clamp(point.x / appSettings.worldWidth, 0, 1),
      y: clamp(point.y / appSettings.worldHeight, 0, 1)
    }));
}

function fromNormalizedShapePoints(normalizedPoints) {
  const safe = Array.isArray(normalizedPoints) ? normalizedPoints : [];
  return safe
    .filter((point) => Number.isFinite(point?.x) && Number.isFinite(point?.y))
    .map((point) => ({
      x: clamp(point.x, 0, 1) * appSettings.worldWidth,
      y: clamp(point.y, 0, 1) * appSettings.worldHeight
    }));
}

function regenerateTrackFromSource() {
  if (trackSource.type === "shape" && Array.isArray(trackSource.shapePointsNorm) && trackSource.shapePointsNorm.length >= 4) {
    const worldPoints = fromNormalizedShapePoints(trackSource.shapePointsNorm);
    track = generateTrackFromShape(worldPoints, {
      seed: currentSeed,
      worldWidth: appSettings.worldWidth,
      worldHeight: appSettings.worldHeight,
      trackWidth: appSettings.trackWidth
    });
  } else {
    track = generateTrack(trackSource.seed ?? currentSeed, {
      worldWidth: appSettings.worldWidth,
      worldHeight: appSettings.worldHeight,
      trackWidth: appSettings.trackWidth
    });
    currentSeed = track.seed;
    trackSource.seed = currentSeed;
  }

  ui.setSeedInput(currentSeed);
  observation = env.setTrack(track);
}

function applyAppSettings(nextSettings, { regenerateTrack = false } = {}) {
  appSettings = sanitizeAppSettings({
    ...appSettings,
    ...(nextSettings || {})
  });

  renderer.setWorldSize(appSettings.worldWidth, appSettings.worldHeight);
  ui.setSettings(appSettings);
  ui.applyTheme(appSettings.uiTheme);
  trainingSpeedMultiplier = appSettings.trainingSpeed;
  ui.setTrainingSpeed(trainingSpeedMultiplier, false);
  saveAppSettings(appSettings);

  if (regenerateTrack) {
    regenerateTrackFromSource();
  }
}

function setTrackFromSeed(seed, { name = null } = {}) {
  const normalizedSeed = normalizeSeed(clampSeedInput(seed));
  currentSeed = normalizedSeed;
  trackSource = {
    type: "seed",
    seed: normalizedSeed,
    name: name || null,
    shapePointsNorm: null
  };

  regenerateTrackFromSource();
}

function setTrackFromShape(shapePoints, { name = "Custom Shape" } = {}) {
  const normalized = toNormalizedShapePoints(shapePoints);
  if (normalized.length < 4) {
    return false;
  }

  trackSource = {
    type: "shape",
    seed: currentSeed,
    name,
    shapePointsNorm: normalized
  };

  regenerateTrackFromSource();
  return true;
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

function canvasEventToWorldPoint(event) {
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) {
    return null;
  }

  const x = ((event.clientX - rect.left) / rect.width) * appSettings.worldWidth;
  const y = ((event.clientY - rect.top) / rect.height) * appSettings.worldHeight;

  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }

  return {
    x: clamp(x, 0, appSettings.worldWidth),
    y: clamp(y, 0, appSettings.worldHeight)
  };
}

function appendDrawPoint(point) {
  if (!point) {
    return;
  }

  if (!drawState.points.length) {
    drawState.points.push(point);
    ui.setDrawMode(true, drawState.points.length);
    return;
  }

  const prev = drawState.points[drawState.points.length - 1];
  if (Math.hypot(point.x - prev.x, point.y - prev.y) >= 4) {
    drawState.points.push(point);
    ui.setDrawMode(true, drawState.points.length);
  }
}

function startDrawMode() {
  if (drawState.active) {
    return;
  }

  running = false;
  ui.setRunning(false);

  drawState.active = true;
  drawState.isPointerDown = false;
  drawState.points = [];
  ui.setDrawMode(true, 0);
}

function cancelDrawMode() {
  if (!drawState.active) {
    return;
  }

  drawState.active = false;
  drawState.isPointerDown = false;
  drawState.points = [];
  ui.setDrawMode(false, 0);
}

function finishDrawMode() {
  if (!drawState.active) {
    return;
  }

  if (drawState.points.length < 8) {
    window.alert("Draw at least 8 points to build a valid shape track.");
    return;
  }

  const created = setTrackFromShape(drawState.points, { name: "Custom Shape" });
  if (!created) {
    window.alert("Could not create track from the drawn shape. Try drawing a longer loop.");
    return;
  }

  cancelDrawMode();
}

canvas.style.touchAction = "none";
canvas.addEventListener("pointerdown", (event) => {
  if (!drawState.active || ui.isModalOpen()) {
    return;
  }

  event.preventDefault();
  drawState.isPointerDown = true;
  if (typeof canvas.setPointerCapture === "function") {
    canvas.setPointerCapture(event.pointerId);
  }

  appendDrawPoint(canvasEventToWorldPoint(event));
});

canvas.addEventListener("pointermove", (event) => {
  if (!drawState.active || !drawState.isPointerDown || ui.isModalOpen()) {
    return;
  }

  event.preventDefault();
  appendDrawPoint(canvasEventToWorldPoint(event));
});

canvas.addEventListener("pointerup", () => {
  if (!drawState.active) {
    return;
  }
  drawState.isPointerDown = false;
});

canvas.addEventListener("pointercancel", () => {
  if (!drawState.active) {
    return;
  }
  drawState.isPointerDown = false;
});

window.addEventListener("keydown", (event) => {
  if (!drawState.active || ui.isModalOpen()) {
    return;
  }

  if (event.key === "Escape") {
    event.preventDefault();
    cancelDrawMode();
    return;
  }

  if (event.key === "Enter") {
    event.preventDefault();
    finishDrawMode();
  }
});

async function handleNewTrackRequest() {
  const result = await ui.openTrackPicker(TRACK_PRESETS, currentSeed);
  if (!result) {
    return;
  }

  if (result.action === "drawShape") {
    startDrawMode();
    return;
  }

  if (result.action === "random") {
    setTrackFromSeed(randomSeed(), { name: null });
    return;
  }

  if (result.action === "applySeed") {
    setTrackFromSeed(result.seed, { name: result.presetName || null });
  }
}

async function handleSettingsRequest() {
  const result = await ui.openSettingsModal(appSettings);
  if (!result) {
    return;
  }

  const nextSettings = sanitizeAppSettings(result);
  const geometryChanged =
    nextSettings.worldWidth !== appSettings.worldWidth ||
    nextSettings.worldHeight !== appSettings.worldHeight ||
    nextSettings.trackWidth !== appSettings.trackWidth;

  applyAppSettings(nextSettings, { regenerateTrack: geometryChanged });
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
  currentDriverName = "Current Racer";
  deployedRacerId = null;
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

function buildSavedRacerPayload(name, carId) {
  const existingIds = new Set(savedRacers.map((item) => item.id));
  const savedCarId = carById.has(carId) ? carId : currentCarId;

  return {
    id: createSavedRacerId(existingIds),
    name: String(name).slice(0, 48),
    carId: savedCarId,
    hyperparams: cloneSerializable(hyperparams, { ...hyperparams }),
    agentSnapshot: cloneSerializable(agent.exportSnapshot(), null),
    metrics: cloneSerializable(getCurrentRacerMetrics(), getCurrentRacerMetrics()),
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
  const result = await ui.promptSaveRacerName(CAR_PRESETS, currentCarId);
  if (!result) {
    return;
  }

  const chosenName = result.name || randomBizzaroName();
  const selectedCarId = carById.has(result.carId) ? result.carId : currentCarId;
  const savedPayload = buildSavedRacerPayload(chosenName, selectedCarId);

  savedRacers = persistSavedRacers([...savedRacers, savedPayload]);
  currentDriverName = chosenName;
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

  const snapshotToDeploy = cloneSerializable(savedRacer.agentSnapshot, null);
  const restored = agent.importSnapshot({
    ...(snapshotToDeploy || {}),
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
  currentDriverName = savedRacer.name || "Current Racer";
  deployedRacerId = savedRacer.id;
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

  savedRacers = persistSavedRacers(savedRacers.filter((item) => item.id !== racerId));

  if (deployedRacerId === racerId) {
    deployedRacerId = null;
    currentDriverName = "Current Racer";
  }
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

  savedRacers = persistSavedRacers(
    savedRacers.map((item, index) =>
      index === racerIndex
        ? {
            ...item,
            name: nextName || racer.name,
            carId: nextCarId,
            updatedAt: Date.now()
          }
        : item
    )
  );

  if (deployedRacerId === racerId) {
    currentDriverName = nextName || currentDriverName;
  }
}

function getShareCandidateList() {
  const candidates = savedRacers.map((saved) => ({
    id: saved.id,
    name: saved.name || "Unnamed Racer",
    metrics: {
      episodes: Math.max(1, Math.floor(Number(saved.metrics?.episodes) || 1)),
      bestLapCount: Math.max(0, Math.floor(Number(saved.metrics?.bestLapCount) || 0)),
      bestLapTimeSec: Number(saved.metrics?.bestLapTimeSec),
      bestReturn: Number(saved.metrics?.bestReturn)
    }
  }));

  const currentMetrics = getCurrentRacerMetrics();
  const currentCandidate = {
    id: deployedRacerId || "current",
    name: currentDriverName || "Current Racer",
    metrics: {
      episodes: Math.max(1, Math.floor(Number(currentMetrics.episodes) || 1)),
      bestLapCount: Math.max(0, Math.floor(Number(currentMetrics.bestLapCount) || 0)),
      bestLapTimeSec: Number(currentMetrics.bestLapTimeSec),
      bestReturn: Number(currentMetrics.bestReturn)
    }
  };

  const index = candidates.findIndex((candidate) => candidate.id === currentCandidate.id);
  if (index >= 0) {
    candidates[index] = currentCandidate;
  } else {
    candidates.push(currentCandidate);
  }

  return candidates;
}

function pickBestShareCandidate(candidates) {
  let bestByTime = null;
  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = candidates[i];
    const time = Number(candidate.metrics?.bestLapTimeSec);
    if (!Number.isFinite(time) || time <= 0) {
      continue;
    }

    if (!bestByTime) {
      bestByTime = candidate;
      continue;
    }

    const bestTime = Number(bestByTime.metrics?.bestLapTimeSec);
    if (time < bestTime) {
      bestByTime = candidate;
    } else if (time === bestTime) {
      const laps = Number(candidate.metrics?.bestLapCount) || 0;
      const bestLaps = Number(bestByTime.metrics?.bestLapCount) || 0;
      if (laps > bestLaps) {
        bestByTime = candidate;
      }
    }
  }

  if (bestByTime) {
    return bestByTime;
  }

  let fallback = candidates[0] || {
    name: "Current Racer",
    metrics: { episodes: episodeNumber, bestLapCount: 0, bestLapTimeSec: null }
  };

  for (let i = 1; i < candidates.length; i += 1) {
    const candidate = candidates[i];
    const laps = Number(candidate.metrics?.bestLapCount) || 0;
    const fallbackLaps = Number(fallback.metrics?.bestLapCount) || 0;
    if (laps > fallbackLaps) {
      fallback = candidate;
      continue;
    }

    if (laps === fallbackLaps) {
      const value = Number(candidate.metrics?.bestReturn);
      const fallbackValue = Number(fallback.metrics?.bestReturn);
      if (value > fallbackValue) {
        fallback = candidate;
      }
    }
  }

  return fallback;
}

function buildShareText() {
  const candidates = getShareCandidateList();
  const best = pickBestShareCandidate(candidates);

  const bestName = best?.name || "Current Racer";
  const bestTimeSec = Number(best?.metrics?.bestLapTimeSec);
  const bestLaps = Math.max(0, Math.floor(Number(best?.metrics?.bestLapCount) || 0));
  const bestEpisodes = Math.max(1, Math.floor(Number(best?.metrics?.episodes) || 1));

  const trackLabel = trackSource.name
    ? trackSource.name
    : `Seed ${currentSeed}`;

  return [
    "ML1 Racer Share",
    `Best driver: ${bestName}`,
    `Best time: ${formatSeconds(bestTimeSec)}`,
    `Max laps: ${bestLaps}`,
    `Episodes: ${bestEpisodes}`,
    `Track: ${trackLabel}`
  ].join("\n");
}

async function handleShareRequest() {
  const shareText = buildShareText();

  if (navigator.share) {
    try {
      await navigator.share({
        title: "ML1 Racer Result",
        text: shareText
      });
      return;
    } catch {
      // fall through to clipboard/manual fallback
    }
  }

  if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
    try {
      await navigator.clipboard.writeText(shareText);
      window.alert("Share summary copied to clipboard.");
      return;
    } catch {
      // fall through to manual fallback
    }
  }

  window.prompt("Copy and share this summary:", shareText);
}

const fixedStepMs = env.dt * 1000;
let accumulatorMs = 0;
let lastFrameTime = performance.now();

ui.setHandlers({
  onStartPause: () => {
    if (drawState.active) {
      return;
    }
    running = !running;
    ui.setRunning(running);
  },
  onStep: () => {
    if (ui.isModalOpen() || drawState.active) {
      return;
    }

    const stepStart = performance.now();
    runOneStep();
    lastStepMs = performance.now() - stepStart;
  },
  onEpisodeReset: () => {
    if (ui.isModalOpen() || drawState.active) {
      return;
    }
    resetEpisode({ countAsNewEpisode: true });
  },
  onRequestNewTrack: () => {
    if (ui.isModalOpen()) {
      return;
    }
    if (drawState.active) {
      cancelDrawMode();
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
    if (ui.isModalOpen()) {
      return;
    }
    handleCarPickerRequest();
  },
  onRequestSaveRacer: () => {
    if (ui.isModalOpen()) {
      return;
    }
    handleSaveRacerRequest();
  },
  onRequestSettings: () => {
    if (ui.isModalOpen()) {
      return;
    }
    if (drawState.active) {
      cancelDrawMode();
    }
    handleSettingsRequest();
  },
  onRequestShare: () => {
    if (ui.isModalOpen()) {
      return;
    }
    handleShareRequest();
  },
  onTrainingSpeedChange: (nextSpeed) => {
    trainingSpeedMultiplier = Math.round(clamp(Number(nextSpeed) || 1, 1, 25));
    appSettings = sanitizeAppSettings({
      ...appSettings,
      trainingSpeed: trainingSpeedMultiplier
    });
    saveAppSettings(appSettings);
  },
  onFinishDrawTrack: () => {
    finishDrawMode();
  },
  onCancelDrawTrack: () => {
    cancelDrawMode();
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
  onTeamNameChange: (nextTeamName) => {
    teamName = String(nextTeamName || "").trim() || DEFAULT_TEAM_NAME;
    saveTeamName(teamName);
  },
  onHyperparamsChange: (nextHyperparams) => {
    applyHyperparams(nextHyperparams);
  }
});

ui.setHyperparams(hyperparams, false);
ui.setTeamName(teamName, false);
ui.setRunning(running);
ui.setSettings(appSettings);
ui.applyTheme(appSettings.uiTheme);
ui.setTrainingSpeed(trainingSpeedMultiplier, false);
ui.setDrawMode(false, 0);

saveHyperparams(hyperparams);
saveTeamName(teamName);
saveAppSettings(appSettings);
savedRacers = persistSavedRacers(savedRacers);

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
    carStyle: carById.get(currentCarId),
    visuals: {
      trackColor: appSettings.trackColor,
      canvasBgColor: appSettings.canvasBgColor,
      canvasPattern: appSettings.canvasPattern
    },
    drawShapePoints: drawState.active ? drawState.points : null
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

  if (running && !ui.isModalOpen() && !drawState.active) {
    accumulatorMs += frameDelta * trainingSpeedMultiplier;
    const maxStepsPerFrame = Math.max(120, trainingSpeedMultiplier * 120);
    let processedSteps = 0;

    while (accumulatorMs >= fixedStepMs && processedSteps < maxStepsPerFrame) {
      const stepStart = performance.now();
      runOneStep();
      lastStepMs = performance.now() - stepStart;
      accumulatorMs -= fixedStepMs;
      processedSteps += 1;
    }

    if (processedSteps >= maxStepsPerFrame) {
      accumulatorMs = 0;
    }
  } else {
    accumulatorMs = 0;
  }

  renderFrame();
  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);

import { RNG, normalizeSeed, randomSeed } from "./rng.js";
import { generateTrack, generateTrackFromShape, WORLD_HEIGHT, WORLD_WIDTH } from "./trackgen.js?v=track-metrics-20260227";
import { RacingEnv } from "./env.js?v=track-metrics-20260227";
import { DQNAgent } from "./rl.js";
import { ACTIONS } from "./physics.js";
import { createRenderer } from "./render.js";
import { CAR_PRESETS, DEFAULT_CAR_ID } from "./cars.js";
import { NpcController, NPC_PROFILES } from "./npc.js";
import { DEFAULT_HYPERPARAMS, clampHyperparams, createUI } from "./ui.js?v=panel-layout-sync-20260303";
import { randomBizzaroName } from "./names.js";
import {
  clearBestReturn,
  loadAppSettings,
  loadBestReturn,
  loadHyperparams,
  loadSavedRacers,
  loadSavedTracks,
  loadTeamName,
  saveAppSettings,
  saveBestReturn,
  saveHyperparams,
  saveSavedRacers,
  saveSavedTracks,
  saveTeamName
} from "./storage.js";

const BASE_URL = import.meta.env?.BASE_URL ?? "/";
const DEFAULT_TEAM_NAME = "ML1 Academy";
const MAX_SAVED_RACERS = 4;
const MAX_SAVED_TRACKS = 8;
const RACE_WORLD_WIDTH = 1200;
const RACE_WORLD_HEIGHT = 900;
const RACE_MODE_TRACK_WIDTH = 120;
const RACE_MAX_EPISODE_STEPS = 500000;
const AUTO_TRAIN_SPEED = 25;
const AUTO_TRAIN_SESSION_EPISODE_LIMIT = 3000;
const AUTO_TRAIN_EPISODE_LIMIT = 250;
const AUTO_TRAIN_TWO_LAP_TARGET = 2;
const AUTO_TRAIN_STREAK_LIMIT = 3;
const AUTO_TRAIN_PRESET_NAME = "AutoTrain Racer";
const AUTO_TRAIN_TUNE_INTERVAL_STEPS = 180;
const AUTO_TRAIN_TUNE_PARAMS = Object.freeze([
  { id: "actionSmoothing", min: 0, max: 0.9, step: 0.01 },
  { id: "progressRewardWeight", min: 0, max: 5, step: 0.01 },
  { id: "offTrackPenalty", min: -10, max: 0, step: 0.1 },
  { id: "speedPenaltyWeight", min: 0, max: 2, step: 0.01 }
]);
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
  trainingSpeed: 1,
  autoParamEnabled: false
});

document.documentElement.dataset.baseUrl = BASE_URL;

const learnLink = document.getElementById("learn-btn");
if (learnLink instanceof HTMLAnchorElement) {
  learnLink.href = `${BASE_URL}learn.html`;
}

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
    trainingSpeed: Math.round(clamp(Number(source.trainingSpeed) || 1, 1, 25)),
    autoParamEnabled: Boolean(source.autoParamEnabled)
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

function createSavedTrackId(existingIds = new Set()) {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    let uuid = globalThis.crypto.randomUUID();
    while (existingIds.has(uuid)) {
      uuid = globalThis.crypto.randomUUID();
    }
    return uuid;
  }

  let fallbackId = `track-${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
  while (existingIds.has(fallbackId)) {
    fallbackId = `track-${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
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

function formatLapClock(secondsValue) {
  const totalSeconds = Math.max(0, Number(secondsValue) || 0);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const centiseconds = Math.floor((totalSeconds - Math.floor(totalSeconds)) * 100);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}:${String(
    centiseconds
  ).padStart(2, "0")}`;
}

const canvas = document.getElementById("game-canvas");
const raceCanvas = document.getElementById("race-canvas") || document.createElement("canvas");

const raceModeElements = {
  root: document.getElementById("race-mode-root"),
  startBtn: document.getElementById("race-mode-start-btn"),
  trackBtn: document.getElementById("race-mode-track-btn"),
  chooseBtn: document.getElementById("race-mode-choose-btn"),
  withdrawBtn: document.getElementById("race-mode-withdraw-btn"),
  endBtn: document.getElementById("race-mode-end-btn"),
  exitBtn: document.getElementById("race-mode-exit-btn"),
  placeList: document.getElementById("race-place-list"),
  racerList: document.getElementById("race-racer-list"),
  statTime: document.getElementById("race-stat-time"),
  statLeader: document.getElementById("race-stat-leader"),
  statLeaderLaps: document.getElementById("race-stat-leader-laps"),
  statBestLap: document.getElementById("race-stat-best-lap"),
  statTrack: document.getElementById("race-stat-track")
};

const raceTrackModalElements = {
  root: document.getElementById("race-track-modal-root"),
  presetGrid: document.getElementById("race-track-preset-grid"),
  closeBtn: document.getElementById("race-track-close-btn"),
  backdrop: document.querySelector("#race-track-modal-root .modal-backdrop")
};

const raceChooseModalElements = {
  root: document.getElementById("race-choose-modal-root"),
  dialog: document.querySelector("#race-choose-modal-root .modal"),
  list: document.getElementById("race-choose-list"),
  count: document.getElementById("race-choose-count"),
  closeBtn: document.getElementById("race-choose-close-btn"),
  applyBtn: document.getElementById("race-choose-apply-btn"),
  backdrop: document.querySelector("#race-choose-modal-root .modal-backdrop")
};

const raceResultModalElements = {
  root: document.getElementById("race-result-modal-root"),
  dialog: document.querySelector("#race-result-modal-root .modal"),
  title: document.getElementById("race-result-modal-title"),
  message: document.getElementById("race-result-modal-message"),
  closeBtn: document.getElementById("race-result-close-btn"),
  backdrop: document.querySelector("#race-result-modal-root .modal-backdrop")
};

const persistedSettings = loadAppSettings();
let appSettings = sanitizeAppSettings({
  ...DEFAULT_APP_SETTINGS,
  ...(persistedSettings || {})
});

const renderer = createRenderer(canvas, {
  worldWidth: appSettings.worldWidth,
  worldHeight: appSettings.worldHeight
});
const raceRenderer = createRenderer(raceCanvas, {
  worldWidth: RACE_WORLD_WIDTH,
  worldHeight: RACE_WORLD_HEIGHT
});
renderer.setWorldSize(appSettings.worldWidth, appSettings.worldHeight);
raceRenderer.setWorldSize(RACE_WORLD_WIDTH, RACE_WORLD_HEIGHT);

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
const autoTrainState = {
  enabled: false,
  episodesSinceEnabled: 0,
  episodesOnTrack: 0,
  consecutiveTwoLapEpisodes: 0,
  trackKey: "",
  stepsSinceLastTweak: 0,
  tuneCursor: 0,
  pendingTweak: null,
  lastEpisodeReturn: null,
  tuneDirections: {
    actionSmoothing: 1,
    progressRewardWeight: 1,
    offTrackPenalty: 1,
    speedPenaltyWeight: 1
  }
};

const drawState = {
  active: false,
  isPointerDown: false,
  points: []
};

const carById = new Map(CAR_PRESETS.map((car) => [car.id, car]));
const presetById = new Map(TRACK_PRESETS.map((preset) => [preset.id, preset]));

let raceTrackPresetId = TRACK_PRESETS[0]?.id || null;
let raceTrackLabel = TRACK_PRESETS[0]?.name || `Seed ${currentSeed}`;
let raceTrack = generateTrack(TRACK_PRESETS[0]?.seed ?? currentSeed, {
  worldWidth: RACE_WORLD_WIDTH,
  worldHeight: RACE_WORLD_HEIGHT,
  trackWidth: RACE_MODE_TRACK_WIDTH
});

const raceModeState = {
  active: false,
  running: false,
  participants: [],
  elapsedSec: 0,
  accumulatorMs: 0,
  modalOpen: false,
  trackModalOpen: false,
  chooseModalOpen: false,
  resultModalOpen: false,
  targetLaps: 1,
  chooserSelection: new Set(),
  savedCardRefs: new Map(),
  placeCardRefs: new Map()
};

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

function sanitizeSavedTrack(entry, fallbackIndex) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const seed = normalizeSeed(clampSeedInput(entry.seed));
  const rawName = typeof entry.name === "string" ? entry.name.trim() : "";
  const name = rawName || `Track ${seed}`;
  const createdAt = Number(entry.createdAt);
  const updatedAt = Number(entry.updatedAt);
  const lengthMeters = Number(entry.lengthMeters);
  const bestLapTimeSec = Number(entry.bestLapTimeSec);
  const totalLapsCompleted = Number(entry.totalLapsCompleted);

  return {
    id: typeof entry.id === "string" && entry.id ? entry.id : `track-${fallbackIndex}-${Date.now()}`,
    name: name.slice(0, 64),
    seed,
    lengthMeters: Number.isFinite(lengthMeters) && lengthMeters >= 0 ? lengthMeters : 0,
    bestLapTimeSec: Number.isFinite(bestLapTimeSec) && bestLapTimeSec > 0 ? bestLapTimeSec : null,
    totalLapsCompleted: Number.isFinite(totalLapsCompleted) ? Math.max(0, Math.floor(totalLapsCompleted)) : 0,
    createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : Date.now()
  };
}

function sanitizeSavedTracks(rawTracks) {
  if (!Array.isArray(rawTracks)) {
    return [];
  }

  const sanitized = [];
  const usedIds = new Set();

  for (let i = 0; i < rawTracks.length; i += 1) {
    const trackEntry = sanitizeSavedTrack(rawTracks[i], i);
    if (!trackEntry) {
      continue;
    }

    let nextId = trackEntry.id;
    if (!nextId || usedIds.has(nextId)) {
      nextId = createSavedTrackId(usedIds);
    }
    usedIds.add(nextId);
    sanitized.push(
      nextId === trackEntry.id
        ? trackEntry
        : {
            ...trackEntry,
            id: nextId,
            updatedAt: Date.now()
          }
    );
  }

  sanitized.sort((a, b) => (a.updatedAt || 0) - (b.updatedAt || 0));
  return cloneSerializable(sanitized.slice(-MAX_SAVED_TRACKS), []);
}

let savedTracks = sanitizeSavedTracks(loadSavedTracks());

function persistSavedRacers(nextSavedRacers) {
  const canonical = sanitizeSavedRacers(nextSavedRacers);
  saveSavedRacers(canonical);
  ui.setSavedRacers(canonical, CAR_PRESETS);
  syncRaceModeSavedRacers(canonical);
  return canonical;
}

function persistSavedTracks(nextSavedTracks) {
  const canonical = sanitizeSavedTracks(nextSavedTracks);
  saveSavedTracks(canonical);
  ui.setSavedTracks(canonical);
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

function getAutoTrainTrackKey() {
  const sourceType = trackSource?.type === "shape" ? "shape" : "seed";
  const sourceSeed = normalizeSeed(clampSeedInput(trackSource?.seed ?? currentSeed));
  return `${sourceType}:${sourceSeed}`;
}

function resetAutoTrainTrackProgress() {
  autoTrainState.trackKey = getAutoTrainTrackKey();
  autoTrainState.episodesOnTrack = 0;
  autoTrainState.consecutiveTwoLapEpisodes = 0;
}

function resetAutoTrainTuningProgress() {
  autoTrainState.stepsSinceLastTweak = 0;
  autoTrainState.tuneCursor = 0;
  autoTrainState.pendingTweak = null;
  autoTrainState.lastEpisodeReturn = null;
  autoTrainState.tuneDirections.actionSmoothing = 1;
  autoTrainState.tuneDirections.progressRewardWeight = 1;
  autoTrainState.tuneDirections.offTrackPenalty = 1;
  autoTrainState.tuneDirections.speedPenaltyWeight = 1;
}

function getStepPrecision(step) {
  const text = String(step ?? "");
  if (!text.includes(".")) {
    return 0;
  }
  return Math.min(6, Math.max(0, text.split(".")[1]?.length || 0));
}

function stepAutoTrainParamValue(param, currentValue, direction) {
  const precision = getStepPrecision(param.step);
  const candidate = clamp(Number(currentValue) + direction * param.step, param.min, param.max);
  return Number(candidate.toFixed(precision));
}

function maybeApplyAutoTrainTweak() {
  if (!autoTrainState.enabled || !appSettings.autoParamEnabled || autoTrainState.pendingTweak) {
    return;
  }

  autoTrainState.stepsSinceLastTweak += 1;
  if (autoTrainState.stepsSinceLastTweak < AUTO_TRAIN_TUNE_INTERVAL_STEPS) {
    return;
  }
  autoTrainState.stepsSinceLastTweak = 0;

  const params = AUTO_TRAIN_TUNE_PARAMS;
  if (!params.length) {
    return;
  }

  const param = params[autoTrainState.tuneCursor % params.length];
  autoTrainState.tuneCursor = (autoTrainState.tuneCursor + 1) % params.length;

  const currentValue = Number(hyperparams[param.id]);
  let direction = autoTrainState.tuneDirections[param.id] || 1;
  let nextValue = stepAutoTrainParamValue(param, currentValue, direction);

  if (nextValue === currentValue) {
    direction *= -1;
    autoTrainState.tuneDirections[param.id] = direction;
    nextValue = stepAutoTrainParamValue(param, currentValue, direction);
    if (nextValue === currentValue) {
      return;
    }
  }

  const nextHyperparams = clampHyperparams({
    ...hyperparams,
    [param.id]: nextValue
  });
  ui.setHyperparams(nextHyperparams, false);
  applyHyperparams(nextHyperparams);

  autoTrainState.pendingTweak = {
    paramId: param.id,
    direction,
    baselineReturn: Number.isFinite(autoTrainState.lastEpisodeReturn) ? autoTrainState.lastEpisodeReturn : null
  };
}

function evaluateAutoTrainTweak(finishedReturn) {
  const pending = autoTrainState.pendingTweak;
  const numericReturn = Number(finishedReturn);
  const validReturn = Number.isFinite(numericReturn);
  if (pending && validReturn && Number.isFinite(pending.baselineReturn)) {
    if (numericReturn < pending.baselineReturn) {
      autoTrainState.tuneDirections[pending.paramId] = -(pending.direction || 1);
    } else {
      autoTrainState.tuneDirections[pending.paramId] = pending.direction || 1;
    }
  }

  autoTrainState.pendingTweak = null;
  if (validReturn) {
    autoTrainState.lastEpisodeReturn = numericReturn;
  }
}

function setAutoTrainEnabled(enabled) {
  autoTrainState.enabled = Boolean(enabled);
  autoTrainState.episodesSinceEnabled = 0;
  if (autoTrainState.enabled) {
    trainingSpeedMultiplier = AUTO_TRAIN_SPEED;
    ui.setTrainingSpeed(AUTO_TRAIN_SPEED, false);
  } else {
    trainingSpeedMultiplier = appSettings.trainingSpeed;
    ui.setTrainingSpeed(trainingSpeedMultiplier, false);
  }
  resetAutoTrainTrackProgress();
  resetAutoTrainTuningProgress();
}

function setAutoParamEnabled(enabled) {
  const next = Boolean(enabled);
  appSettings = sanitizeAppSettings({
    ...appSettings,
    autoParamEnabled: next
  });
  saveAppSettings(appSettings);
  resetAutoTrainTuningProgress();
  ui.setAutoParamEnabled(next, false);
}

function maybeRotateAutoTrainTrack(completedLapCount) {
  if (!autoTrainState.enabled) {
    return;
  }

  const currentTrackKey = getAutoTrainTrackKey();
  if (autoTrainState.trackKey !== currentTrackKey) {
    resetAutoTrainTrackProgress();
  }

  autoTrainState.episodesOnTrack += 1;
  if (completedLapCount >= AUTO_TRAIN_TWO_LAP_TARGET) {
    autoTrainState.consecutiveTwoLapEpisodes += 1;
  } else {
    autoTrainState.consecutiveTwoLapEpisodes = 0;
  }

  const reachedEpisodeLimit = autoTrainState.episodesOnTrack >= AUTO_TRAIN_EPISODE_LIMIT;
  const reachedLapStreak = autoTrainState.consecutiveTwoLapEpisodes >= AUTO_TRAIN_STREAK_LIMIT;

  if (!reachedEpisodeLimit && !reachedLapStreak) {
    return;
  }

  setTrackFromSeed(randomSeed(), { name: null });
}

function saveAutoTrainRacerPreset() {
  const presetName = AUTO_TRAIN_PRESET_NAME;
  const payload = buildSavedRacerPayload(presetName, currentCarId);
  const existingIndex = savedRacers.findIndex((item) => item.name === presetName);

  if (existingIndex >= 0) {
    const existing = savedRacers[existingIndex];
    const updated = {
      ...payload,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: Date.now()
    };
    savedRacers = persistSavedRacers(savedRacers.map((item, index) => (index === existingIndex ? updated : item)));
    return;
  }

  savedRacers = persistSavedRacers([...savedRacers, payload]);
}

function maybeFinalizeAutoTrainByEpisodeLimit() {
  if (!autoTrainState.enabled) {
    return false;
  }

  autoTrainState.episodesSinceEnabled += 1;
  if (autoTrainState.episodesSinceEnabled < AUTO_TRAIN_SESSION_EPISODE_LIMIT) {
    return false;
  }

  saveAutoTrainRacerPreset();
  setAutoTrainEnabled(false);
  resetCurrentRacerState({ pauseTraining: true, syncDeployed: false });
  return true;
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
  resetAutoTrainTrackProgress();
}

function applyAppSettings(nextSettings, { regenerateTrack = false } = {}) {
  appSettings = sanitizeAppSettings({
    ...appSettings,
    ...(nextSettings || {})
  });

  renderer.setWorldSize(appSettings.worldWidth, appSettings.worldHeight);
  ui.setSettings(appSettings);
  ui.applyTheme(appSettings.uiTheme);
  trainingSpeedMultiplier = autoTrainState.enabled ? AUTO_TRAIN_SPEED : appSettings.trainingSpeed;
  ui.setTrainingSpeed(trainingSpeedMultiplier, false);
  saveAppSettings(appSettings);

  if (regenerateTrack) {
    regenerateTrackFromSource();
    applyRaceTrackPreset(raceTrackPresetId, { resetParticipants: true });
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

  const shapeSeed = normalizeSeed(randomSeed());
  currentSeed = shapeSeed;

  trackSource = {
    type: "shape",
    seed: shapeSeed,
    name,
    shapePointsNorm: normalized
  };

  regenerateTrackFromSource();
  return true;
}

function resetCurrentRacerState({ pauseTraining = false, syncDeployed = true } = {}) {
  if (syncDeployed) {
    syncDeployedSavedRacerProgress();
  }

  agent.resetModel();
  clearBestReturn();
  env.clearLapHistory({ resetBestLapCount: true });
  bestEpisodeReturn = Number.NEGATIVE_INFINITY;
  episodeNumber = 1;
  observation = env.resetEpisode(true);
  currentCarId = DEFAULT_CAR_ID;
  currentDriverName = "Current Racer";
  deployedRacerId = null;

  if (pauseTraining) {
    running = false;
    ui.setRunning(false);
  }
}

function resetEpisode({ countAsNewEpisode = true } = {}) {
  if (countAsNewEpisode) {
    episodeNumber += 1;
  }
  observation = env.resetEpisode(true);
}

function handleEpisodeTermination() {
  const completedLapCount = Math.max(0, Math.floor(Number(env.currentLapCount) || 0));
  const finishedReturn = env.episodeReturn;
  if (!Number.isFinite(bestEpisodeReturn) || finishedReturn > bestEpisodeReturn) {
    bestEpisodeReturn = finishedReturn;
    saveBestReturn(bestEpisodeReturn);
  }
  evaluateAutoTrainTweak(finishedReturn);

  agent.onEpisodeEnd();
  syncDeployedSavedRacerProgress();
  if (maybeFinalizeAutoTrainByEpisodeLimit()) {
    return;
  }
  maybeRotateAutoTrainTrack(completedLapCount);
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

  maybeApplyAutoTrainTweak();
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
    cancelDrawMode();
    window.alert("Draw at least 8 points to build a valid shape track.");
    return;
  }

  const created = setTrackFromShape(drawState.points, { name: "Custom Shape" });
  cancelDrawMode();
  if (!created) {
    window.alert("Could not create track from the drawn shape. Try drawing a longer loop.");
    return;
  }
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
    return;
  }

  if (result.action === "saveTrack") {
    const safeSeed = normalizeSeed(clampSeedInput(result.seed));
    const trackMetrics = getTrackMetricsForSeed(safeSeed);
    const suggestedName = result.presetName || `Track ${safeSeed}`;
    const chosenName = await ui.promptTrackName(suggestedName, trackMetrics);
    if (chosenName === null) {
      return;
    }

    const existingIds = new Set(savedTracks.map((item) => item.id));
    const payload = {
      id: createSavedTrackId(existingIds),
      name: String(chosenName || suggestedName).slice(0, 64),
      seed: safeSeed,
      lengthMeters: trackMetrics.lengthMeters,
      bestLapTimeSec: trackMetrics.bestLapTimeSec,
      totalLapsCompleted: trackMetrics.totalLapsCompleted,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    savedTracks = persistSavedTracks([...savedTracks, payload]);
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

  resetCurrentRacerState({ pauseTraining: false, syncDeployed: true });
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

function getTrackMetricsForSeed(seed) {
  const normalizedSeed = normalizeSeed(clampSeedInput(seed));
  const isCurrentSeedTrack = trackSource.type === "seed" && Number(currentSeed) === normalizedSeed;

  if (isCurrentSeedTrack) {
    const renderState = env.getRenderState();
    return {
      lengthMeters: Math.max(0, Number(track?.totalLength) || 0),
      bestLapTimeSec:
        Number.isFinite(renderState.bestLapTimeSec) && renderState.bestLapTimeSec > 0
          ? renderState.bestLapTimeSec
          : null,
      totalLapsCompleted: Math.max(0, Math.floor(Number(renderState.totalLapsCompleted) || 0))
    };
  }

  const previewTrack = generateTrack(normalizedSeed, {
    worldWidth: appSettings.worldWidth,
    worldHeight: appSettings.worldHeight,
    trackWidth: appSettings.trackWidth
  });

  return {
    lengthMeters: Math.max(0, Number(previewTrack.totalLength) || 0),
    bestLapTimeSec: null,
    totalLapsCompleted: 0
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

function syncDeployedSavedRacerProgress() {
  if (!deployedRacerId) {
    return;
  }

  const index = savedRacers.findIndex((item) => item.id === deployedRacerId);
  if (index < 0) {
    return;
  }

  const current = savedRacers[index];
  const metrics = getCurrentRacerMetrics();

  const updated = {
    ...current,
    carId: carById.has(currentCarId) ? currentCarId : current.carId,
    hyperparams: cloneSerializable(hyperparams, { ...hyperparams }),
    agentSnapshot: cloneSerializable(agent.exportSnapshot(), current.agentSnapshot),
    metrics: cloneSerializable(
      {
        ...current.metrics,
        ...metrics,
        bestReturn: normalizeBestReturn(metrics.bestReturn)
      },
      metrics
    ),
    updatedAt: Date.now()
  };

  savedRacers = persistSavedRacers(savedRacers.map((item, itemIndex) => (itemIndex === index ? updated : item)));
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

function handleDeploySavedTrack(trackId) {
  const savedTrack = savedTracks.find((item) => item.id === trackId);
  if (!savedTrack) {
    return;
  }

  setTrackFromSeed(savedTrack.seed, { name: savedTrack.name || null });
}

async function handleDeleteSavedTrack(trackId) {
  const savedTrack = savedTracks.find((item) => item.id === trackId);
  if (!savedTrack) {
    return;
  }

  const confirmed = await ui.confirmDeleteTrack(savedTrack.name || `Track ${savedTrack.seed}`);
  if (!confirmed) {
    return;
  }

  savedTracks = persistSavedTracks(savedTracks.filter((item) => item.id !== trackId));
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

function getFocusableElements(root) {
  if (!root) {
    return [];
  }
  const selector = "button, input, [href], select, textarea, [tabindex]:not([tabindex='-1'])";
  return Array.from(root.querySelectorAll(selector)).filter((el) => !el.hasAttribute("disabled"));
}

function getRacePresetById(presetId) {
  if (presetById.has(presetId)) {
    return presetById.get(presetId);
  }
  return TRACK_PRESETS[0] || null;
}

function isSavedRaceParticipant(participant) {
  return participant?.kind === "saved";
}

function isNpcRaceParticipant(participant) {
  return participant?.kind === "npc";
}

function getNpcParticipantId(npcId) {
  return `npc:${npcId}`;
}

function getSavedSelectionId(savedId) {
  return `saved:${savedId}`;
}

function getNpcSelectionId(npcId) {
  return `npc:${npcId}`;
}

function refreshRaceModalState() {
  raceModeState.modalOpen = Boolean(
    raceModeState.trackModalOpen || raceModeState.chooseModalOpen || raceModeState.resultModalOpen
  );
}

function computeRaceTargetLaps(trackConfig) {
  const length = Math.max(1, Number(trackConfig?.totalLength) || 1);
  return Math.max(1, Math.ceil(14000 / length));
}

function applyRaceTrackPreset(presetId, options = {}) {
  const resetParticipants = options.resetParticipants !== false;
  const preset = getRacePresetById(presetId);

  const chosenSeed = preset ? preset.seed : currentSeed;
  raceTrackPresetId = preset?.id || raceTrackPresetId;
  raceTrackLabel = preset?.name || `Seed ${normalizeSeed(clampSeedInput(chosenSeed))}`;

  raceTrack = generateTrack(chosenSeed, {
    worldWidth: RACE_WORLD_WIDTH,
    worldHeight: RACE_WORLD_HEIGHT,
    trackWidth: RACE_MODE_TRACK_WIDTH
  });
  raceModeState.targetLaps = computeRaceTargetLaps(raceTrack);

  raceModeState.elapsedSec = 0;
  raceModeState.accumulatorMs = 0;

  if (resetParticipants) {
    for (let i = 0; i < raceModeState.participants.length; i += 1) {
      const participant = raceModeState.participants[i];
      participant.env.setTrack(raceTrack);
      participant.observation = participant.env.resetEpisode(true);
      participant.renderState = participant.env.getRenderState();
      participant.laps = 0;
      participant.lastEnvLapCount = 0;
      participant.progress = 0;
      participant.currentLapTimeSec = 0;
      participant.bestLapTimeSec = null;
      participant.episodeCount = 1;
      participant.finished = false;
      participant.finishTimeSec = null;
      participant.timeSinceLapSec = 0;
      participant.status = participant.kind === "npc" ? "Deployed" : "Ready";
    }
  }

  if (raceModeElements.statTrack) {
    raceModeElements.statTrack.textContent = raceTrackLabel;
  }

  if (raceModeState.active) {
    updateRaceRacerCards();
    renderRacePlaceList();
  }
}

function createRaceRacerCard(savedRacer) {
  const card = document.createElement("article");
  card.className = "race-racer-card";
  card.dataset.racerId = savedRacer.id;

  const head = document.createElement("div");
  head.className = "race-racer-head";

  const name = document.createElement("div");
  name.className = "race-racer-name";
  name.classList.add("race-name-saved");
  name.textContent = savedRacer.name || "Unnamed Racer";

  const status = document.createElement("div");
  status.className = "race-racer-status";
  status.textContent = "Ready to deploy";

  head.append(name, status);
  card.appendChild(head);

  const metrics = document.createElement("div");
  metrics.className = "race-racer-metrics";

  const lapsRow = document.createElement("div");
  lapsRow.className = "race-racer-metric";
  lapsRow.innerHTML = "<span>Laps</span><strong>0</strong>";

  const progressRow = document.createElement("div");
  progressRow.className = "race-racer-metric";
  progressRow.innerHTML = "<span>Progress</span><strong>0.0%</strong>";

  const bestLapRow = document.createElement("div");
  bestLapRow.className = "race-racer-metric";
  bestLapRow.innerHTML = "<span>Best lap</span><strong>00:00:00</strong>";

  const episodesRow = document.createElement("div");
  episodesRow.className = "race-racer-metric";
  episodesRow.innerHTML = "<span>Episodes</span><strong>1</strong>";

  metrics.append(lapsRow, progressRow, bestLapRow, episodesRow);
  card.appendChild(metrics);

  const actions = document.createElement("div");
  actions.className = "race-racer-actions";

  const deployBtn = document.createElement("button");
  deployBtn.type = "button";
  deployBtn.className = "primary";
  deployBtn.textContent = "Deploy";
  deployBtn.addEventListener("click", () => deploySavedRaceParticipant(savedRacer.id));

  const withdrawBtn = document.createElement("button");
  withdrawBtn.type = "button";
  withdrawBtn.className = "danger";
  withdrawBtn.textContent = "Withdraw";
  withdrawBtn.addEventListener("click", () => withdrawSavedRaceParticipant(savedRacer.id));

  actions.append(deployBtn, withdrawBtn);
  card.appendChild(actions);

  const refs = {
    status,
    laps: lapsRow.querySelector("strong"),
    progress: progressRow.querySelector("strong"),
    bestLap: bestLapRow.querySelector("strong"),
    episodes: episodesRow.querySelector("strong"),
    deployBtn,
    withdrawBtn
  };

  raceModeState.savedCardRefs.set(savedRacer.id, refs);
  return card;
}

function updateRaceRacerCards() {
  const participantsById = new Map(raceModeState.participants.map((participant) => [participant.id, participant]));

  for (let i = 0; i < savedRacers.length; i += 1) {
    const racer = savedRacers[i];
    const refs = raceModeState.savedCardRefs.get(racer.id);
    if (!refs) {
      continue;
    }

    const participant = participantsById.get(racer.id);
    if (!participant) {
      refs.status.textContent = "Not deployed";
      refs.laps.textContent = `0/${raceModeState.targetLaps}`;
      refs.progress.textContent = "0.0%";
      refs.bestLap.textContent = formatLapClock(racer.metrics?.bestLapTimeSec || 0);
      refs.episodes.textContent = String(Math.max(1, Math.floor(Number(racer.metrics?.episodes) || 1)));
      refs.deployBtn.disabled = false;
      refs.withdrawBtn.disabled = true;
      continue;
    }

    refs.status.textContent = participant.status;
    refs.laps.textContent = `${Math.max(0, Math.floor(participant.laps))}/${raceModeState.targetLaps}`;
    refs.progress.textContent = `${(clamp(participant.progress, 0, 1) * 100).toFixed(1)}%`;
    refs.bestLap.textContent = formatLapClock(participant.bestLapTimeSec || 0);
    refs.episodes.textContent = String(Math.max(1, Math.floor(participant.episodeCount || 1)));
    refs.deployBtn.disabled = true;
    refs.withdrawBtn.disabled = false;
  }
}

function renderRaceRacerList() {
  if (!raceModeElements.racerList) {
    return;
  }

  raceModeElements.racerList.innerHTML = "";
  raceModeState.savedCardRefs.clear();

  if (!savedRacers.length) {
    const empty = document.createElement("div");
    empty.className = "race-racer-empty";
    empty.textContent = "No saved racers available. Save racers in training mode first.";
    raceModeElements.racerList.appendChild(empty);
    return;
  }

  for (let i = 0; i < savedRacers.length; i += 1) {
    raceModeElements.racerList.appendChild(createRaceRacerCard(savedRacers[i]));
  }

  updateRaceRacerCards();
}

function getSortedRaceParticipants() {
  return raceModeState.participants
    .slice()
    .sort((a, b) => {
      if (a.laps !== b.laps) {
        return b.laps - a.laps;
      }
      if (a.progress !== b.progress) {
        return b.progress - a.progress;
      }
      if (a.finished && b.finished) {
        return (a.finishTimeSec || 0) - (b.finishTimeSec || 0);
      }
      return (a.name || "").localeCompare(b.name || "");
    });
}

function renderRacePlaceList() {
  if (!raceModeElements.placeList) {
    return;
  }

  raceModeElements.placeList.innerHTML = "";
  raceModeState.placeCardRefs.clear();

  const ordered = getSortedRaceParticipants();
  if (!ordered.length) {
    const empty = document.createElement("div");
    empty.className = "race-racer-empty";
    empty.textContent = "Choose racers to start a race.";
    raceModeElements.placeList.appendChild(empty);
    return;
  }

  for (let i = 0; i < ordered.length; i += 1) {
    const participant = ordered[i];
    const card = document.createElement("article");
    card.className = "race-place-card";

    const head = document.createElement("div");
    head.className = "race-place-head";

    const nameWrap = document.createElement("div");
    nameWrap.className = "race-place-name-wrap";

    const swatch = document.createElement("span");
    swatch.className = "race-place-swatch";
    swatch.style.setProperty("--car-primary", participant.carStyle?.primary || "#6E737A");
    swatch.style.setProperty("--car-secondary", participant.carStyle?.secondary || "#121212");
    swatch.style.setProperty("--car-accent", participant.carStyle?.accent || "#C9CDD2");

    const name = document.createElement("div");
    name.className = "race-place-name";
    name.classList.add(isSavedRaceParticipant(participant) ? "race-name-saved" : "race-name-npc");
    name.textContent = participant.name;
    nameWrap.append(swatch, name);

    const rank = document.createElement("div");
    rank.className = "race-place-rank";
    if (i === 0) {
      rank.classList.add("race-place-rank--1");
    } else if (i === 1) {
      rank.classList.add("race-place-rank--2");
    } else if (i === 2) {
      rank.classList.add("race-place-rank--3");
    } else {
      rank.classList.add("race-place-rank--other");
    }
    rank.textContent = `${i + 1}${i === 0 ? "st" : i === 1 ? "nd" : i === 2 ? "rd" : "th"}`;

    head.append(nameWrap, rank);

    const laps = document.createElement("div");
    laps.className = "race-place-laps";
    laps.innerHTML = `<span>Laps</span><strong>${Math.max(0, Math.floor(participant.laps))}/${raceModeState.targetLaps}</strong>`;

    card.append(head, laps);
    raceModeElements.placeList.appendChild(card);
  }
}

function buildRaceChooserEntries() {
  const entries = [];

  for (let i = 0; i < NPC_PROFILES.length; i += 1) {
    const npc = NPC_PROFILES[i];
    entries.push({
      id: getNpcSelectionId(npc.id),
      label: `${npc.name} (NPC)`,
      name: npc.name,
      level: npc.level,
      tier: npc.tier,
      colors: [npc.carStyle.primary, npc.carStyle.secondary, npc.carStyle.accent],
      meta: `Level ${npc.level} ${npc.tier}`
    });
  }

  return entries;
}

function getCurrentRaceSelectionIds() {
  const selected = new Set();
  for (let i = 0; i < raceModeState.participants.length; i += 1) {
    const participant = raceModeState.participants[i];
    if (isSavedRaceParticipant(participant)) {
      selected.add(getSavedSelectionId(participant.id));
    } else if (isNpcRaceParticipant(participant)) {
      selected.add(getNpcSelectionId(participant.npcProfileId));
    }
  }
  return selected;
}

function updateRaceChooserCount() {
  if (!raceChooseModalElements.count) {
    return;
  }
  const deployedSavedCount = raceModeState.participants.filter(isSavedRaceParticipant).length;
  const totalSelected = deployedSavedCount + raceModeState.chooserSelection.size;
  raceChooseModalElements.count.textContent = `${totalSelected} / 5 selected (${deployedSavedCount} saved + ${raceModeState.chooserSelection.size} NPC)`;
}

function applyRaceSelection(selectedIds) {
  const savedParticipants = raceModeState.participants.filter(isSavedRaceParticipant).slice(0, 5);
  const nextParticipants = [...savedParticipants];
  const safeSelection = Array.isArray(selectedIds) ? selectedIds.slice(0, 5) : [];
  const maxNpcSlots = Math.max(0, 5 - savedParticipants.length);
  let npcCount = 0;

  for (let i = 0; i < safeSelection.length; i += 1) {
    const id = safeSelection[i];
    if (id.startsWith("npc:")) {
      if (npcCount >= maxNpcSlots) {
        continue;
      }
      const npcId = id.slice("npc:".length);
      const npcProfile = NPC_PROFILES.find((npc) => npc.id === npcId);
      if (!npcProfile) {
        continue;
      }
      nextParticipants.push(createNpcRaceParticipant(npcProfile, nextParticipants.length));
      npcCount += 1;
    }
  }

  raceModeState.participants = nextParticipants;
  raceModeState.elapsedSec = 0;
  raceModeState.accumulatorMs = 0;
  setRaceRunning(false);
  updateRaceControlState();
  updateRaceRacerCards();
  renderRacePlaceList();
}

function syncRaceModeSavedRacers(nextSavedRacers) {
  const canonical = Array.isArray(nextSavedRacers) ? nextSavedRacers : [];
  const allowedIds = new Set(canonical.map((racer) => racer.id));

  raceModeState.participants = raceModeState.participants.filter(
    (participant) => isNpcRaceParticipant(participant) || allowedIds.has(participant.id)
  );

  for (let i = 0; i < raceModeState.participants.length; i += 1) {
    const participant = raceModeState.participants[i];
    const source = canonical.find((racer) => racer.id === participant.id);
    if (!source) {
      continue;
    }

    participant.name = source.name || participant.name;
    participant.carId = carById.has(source.carId) ? source.carId : DEFAULT_CAR_ID;
    participant.carStyle = carById.get(participant.carId) || carById.get(DEFAULT_CAR_ID);
  }

  if (raceModeState.active) {
    renderRaceRacerList();
    updateRaceControlState();
    updateRaceHud();
    renderRacePlaceList();
  }
}

function createRaceParticipant(savedRacer, index) {
  const sourceHyperparams = clampHyperparams({
    ...DEFAULT_HYPERPARAMS,
    ...(savedRacer.hyperparams || {}),
    ...(savedRacer.agentSnapshot?.hyperparams || {})
  });

  const seedBase = normalizeSeed(`${raceTrack.seed}-${savedRacer.id}-${index}`);
  const raceEnvRng = new RNG(seedBase ^ 0x9e3779b9);
  const raceAgentRng = new RNG(seedBase ^ 0x85ebca6b);

  const participantEnv = new RacingEnv({
    track: raceTrack,
    rng: raceEnvRng,
    dt: env.dt,
    maxEpisodeSteps: RACE_MAX_EPISODE_STEPS,
    actionSmoothing: sourceHyperparams.actionSmoothing,
    rewardWeights: {
      progressWeight: sourceHyperparams.progressRewardWeight,
      offTrackPenalty: sourceHyperparams.offTrackPenalty,
      speedPenaltyWeight: sourceHyperparams.speedPenaltyWeight
    }
  });

  const participantAgent = new DQNAgent({
    observationSize: participantEnv.observationSize,
    actionSize: ACTIONS.length,
    rng: raceAgentRng,
    hyperparams: sourceHyperparams
  });

  const snapshot = cloneSerializable(savedRacer.agentSnapshot, null);
  const imported = participantAgent.importSnapshot({
    ...(snapshot || {}),
    hyperparams: sourceHyperparams
  });
  if (!imported) {
    participantAgent.resetModel();
  }

  const renderState = participantEnv.getRenderState();
  const bestLapTime = Number(renderState.bestLapTimeSec);

  return {
    id: savedRacer.id,
    kind: "saved",
    name: savedRacer.name || "Unnamed Racer",
    carId: carById.has(savedRacer.carId) ? savedRacer.carId : DEFAULT_CAR_ID,
    carStyle: carById.get(savedRacer.carId) || carById.get(DEFAULT_CAR_ID),
    env: participantEnv,
    agent: participantAgent,
    observation: participantEnv.currentObservation,
    renderState,
    laps: 0,
    lastEnvLapCount: Math.max(0, Math.floor(Number(renderState.currentLapCount) || 0)),
    progress: clamp(Number(renderState.lapProgress) || 0, 0, 1),
    currentLapTimeSec: Number(renderState.thisLapTimeSec) || 0,
    bestLapTimeSec: Number.isFinite(bestLapTime) && bestLapTime > 0 ? bestLapTime : null,
    episodeCount: 1,
    finished: false,
    finishTimeSec: null,
    timeSinceLapSec: 0,
    status: "Ready"
  };
}

function createNpcRaceParticipant(profile, index) {
  const baseId = getNpcParticipantId(profile.id);
  const seedBase = normalizeSeed(`${raceTrack.seed}-${baseId}-${index}`);
  const raceEnvRng = new RNG(seedBase ^ 0x7f4a7c15);
  const raceNpcRng = new RNG(seedBase ^ 0x94d049bb);

  const participantEnv = new RacingEnv({
    track: raceTrack,
    rng: raceEnvRng,
    dt: env.dt,
    maxEpisodeSteps: RACE_MAX_EPISODE_STEPS,
    actionSmoothing: 0.42,
    rewardWeights: {
      progressWeight: 1.8,
      offTrackPenalty: -5,
      speedPenaltyWeight: 0.4
    }
  });

  const controller = new NpcController(profile, raceNpcRng);
  const renderState = participantEnv.getRenderState();
  const bestLapTime = Number(renderState.bestLapTimeSec);

  return {
    id: baseId,
    kind: "npc",
    npcProfileId: profile.id,
    name: `${profile.name} (NPC)`,
    level: profile.level,
    tier: profile.tier,
    carId: profile.id,
    carStyle: profile.carStyle,
    env: participantEnv,
    controller,
    observation: participantEnv.currentObservation,
    renderState,
    laps: 0,
    lastEnvLapCount: Math.max(0, Math.floor(Number(renderState.currentLapCount) || 0)),
    progress: clamp(Number(renderState.lapProgress) || 0, 0, 1),
    currentLapTimeSec: Number(renderState.thisLapTimeSec) || 0,
    bestLapTimeSec: Number.isFinite(bestLapTime) && bestLapTime > 0 ? bestLapTime : null,
    episodeCount: 1,
    finished: false,
    finishTimeSec: null,
    timeSinceLapSec: 0,
    status: "Deployed"
  };
}

function setRaceRunning(nextRunning) {
  raceModeState.running = Boolean(nextRunning);
  if (raceModeElements.startBtn) {
    raceModeElements.startBtn.textContent = raceModeState.running ? "Pause" : "Start";
    raceModeElements.startBtn.classList.toggle("primary", !raceModeState.running);
  }
}

function updateRaceControlState() {
  const chooserHasEntries = savedRacers.length + NPC_PROFILES.length > 0;
  if (raceModeElements.chooseBtn) {
    raceModeElements.chooseBtn.disabled = !chooserHasEntries;
  }
  if (raceModeElements.startBtn) {
    raceModeElements.startBtn.disabled = raceModeState.participants.length === 0;
  }
}

function deployRaceParticipants() {
  const selectedIds = savedRacers
    .map((saved) => getSavedSelectionId(saved.id))
    .concat(NPC_PROFILES.slice(0, 1).map((npc) => getNpcSelectionId(npc.id)))
    .slice(0, 5);
  applyRaceSelection(selectedIds);
  raceModeState.elapsedSec = 0;
  raceModeState.accumulatorMs = 0;
  setRaceRunning(false);
  updateRaceControlState();
  updateRaceRacerCards();
  renderRacePlaceList();
}

function deploySavedRaceParticipant(racerId) {
  if (!raceModeState.active || raceModeState.modalOpen) {
    return;
  }

  const savedRacer = savedRacers.find((item) => item.id === racerId);
  if (!savedRacer) {
    return;
  }

  if (raceModeState.participants.some((participant) => participant.id === racerId)) {
    return;
  }

  const index = raceModeState.participants.length;
  raceModeState.participants.push(createRaceParticipant(savedRacer, index));
  updateRaceControlState();
  updateRaceRacerCards();
  renderRacePlaceList();
}

function withdrawSavedRaceParticipant(racerId) {
  if (!raceModeState.active || raceModeState.modalOpen) {
    return;
  }

  const nextParticipants = raceModeState.participants.filter((participant) => participant.id !== racerId);
  if (nextParticipants.length === raceModeState.participants.length) {
    return;
  }

  raceModeState.participants = nextParticipants;
  if (!raceModeState.participants.length) {
    setRaceRunning(false);
  }

  updateRaceControlState();
  updateRaceRacerCards();
  renderRacePlaceList();
}

function withdrawAllRaceParticipants() {
  if (!raceModeState.active || raceModeState.modalOpen) {
    return;
  }

  raceModeState.participants = [];
  raceModeState.elapsedSec = 0;
  raceModeState.accumulatorMs = 0;
  setRaceRunning(false);
  updateRaceControlState();
  updateRaceRacerCards();
  renderRacePlaceList();
}

function deployNpcRacer(npcId) {
  if (!raceModeState.active || raceModeState.modalOpen) {
    return;
  }

  const profile = NPC_PROFILES.find((item) => item.id === npcId);
  if (!profile) {
    return;
  }

  const participantId = getNpcParticipantId(npcId);
  if (raceModeState.participants.some((participant) => participant.id === participantId)) {
    return;
  }

  const index = raceModeState.participants.length;
  raceModeState.participants.push(createNpcRaceParticipant(profile, index));
  updateRaceControlState();
  renderRacePlaceList();
  updateRaceRacerCards();
}

function withdrawNpcRacer(npcId) {
  if (!raceModeState.active || raceModeState.modalOpen) {
    return;
  }

  const participantId = getNpcParticipantId(npcId);
  const nextParticipants = raceModeState.participants.filter((participant) => participant.id !== participantId);
  if (nextParticipants.length === raceModeState.participants.length) {
    return;
  }

  raceModeState.participants = nextParticipants;
  if (!raceModeState.participants.length) {
    setRaceRunning(false);
  }

  updateRaceControlState();
  renderRacePlaceList();
  updateRaceRacerCards();
}

function pickRaceLeader() {
  if (!raceModeState.participants.length) {
    return null;
  }

  let leader = raceModeState.participants[0];
  for (let i = 1; i < raceModeState.participants.length; i += 1) {
    const candidate = raceModeState.participants[i];
    if (candidate.laps > leader.laps) {
      leader = candidate;
      continue;
    }
    if (candidate.laps < leader.laps) {
      continue;
    }
    if (candidate.progress > leader.progress) {
      leader = candidate;
      continue;
    }
    if (candidate.progress < leader.progress) {
      continue;
    }

    const bestCandidate = Number(candidate.bestLapTimeSec);
    const bestLeader = Number(leader.bestLapTimeSec);
    const candidateHasTime = Number.isFinite(bestCandidate) && bestCandidate > 0;
    const leaderHasTime = Number.isFinite(bestLeader) && bestLeader > 0;
    if (candidateHasTime && (!leaderHasTime || bestCandidate < bestLeader)) {
      leader = candidate;
    }
  }

  return leader;
}

function findRaceBestLap() {
  let best = null;
  for (let i = 0; i < raceModeState.participants.length; i += 1) {
    const value = Number(raceModeState.participants[i].bestLapTimeSec);
    if (!Number.isFinite(value) || value <= 0) {
      continue;
    }
    if (best === null || value < best) {
      best = value;
    }
  }
  return best;
}

function updateRaceHud() {
  if (raceModeElements.statTime) {
    raceModeElements.statTime.textContent = formatLapClock(raceModeState.elapsedSec);
  }

  const leader = pickRaceLeader();
  if (raceModeElements.statLeader) {
    raceModeElements.statLeader.textContent = leader ? leader.name : "--";
    raceModeElements.statLeader.classList.remove("race-name-saved", "race-name-npc");
    if (leader) {
      raceModeElements.statLeader.classList.add(isSavedRaceParticipant(leader) ? "race-name-saved" : "race-name-npc");
    }
  }
  if (raceModeElements.statLeaderLaps) {
    raceModeElements.statLeaderLaps.textContent = leader
      ? `${Math.max(0, Math.floor(leader.laps))}/${raceModeState.targetLaps}`
      : `0/${raceModeState.targetLaps}`;
  }
  if (raceModeElements.statBestLap) {
    raceModeElements.statBestLap.textContent = formatLapClock(findRaceBestLap() || 0);
  }
  if (raceModeElements.statTrack) {
    raceModeElements.statTrack.textContent = raceTrackLabel;
  }
}

function getRaceWinner() {
  const ordered = getSortedRaceParticipants();
  return ordered.length ? ordered[0] : null;
}

function closeRaceResultModal() {
  if (!raceModeState.resultModalOpen || !raceResultModalElements.root) {
    return;
  }
  raceModeState.resultModalOpen = false;
  refreshRaceModalState();
  raceResultModalElements.root.hidden = true;
}

function openRaceResultModal(winner) {
  if (!winner || !raceResultModalElements.root) {
    return;
  }

  const savedWon = isSavedRaceParticipant(winner);
  if (raceResultModalElements.dialog) {
    raceResultModalElements.dialog.classList.toggle("race-result--win", savedWon);
    raceResultModalElements.dialog.classList.toggle("race-result--lose", !savedWon);
  }
  if (raceResultModalElements.title) {
    raceResultModalElements.title.textContent = savedWon ? "You Win!" : "You lose";
  }
  if (raceResultModalElements.message) {
    raceResultModalElements.message.textContent = savedWon
      ? `${winner.name} finished 1st place.`
      : `${winner.name} won the race.`;
  }

  raceModeState.resultModalOpen = true;
  refreshRaceModalState();
  raceResultModalElements.root.hidden = false;

  requestAnimationFrame(() => {
    (raceResultModalElements.closeBtn || raceResultModalElements.dialog)?.focus();
  });
}

function endRace({ showResult = false } = {}) {
  const winner = showResult ? getRaceWinner() : null;
  setRaceRunning(false);
  raceModeState.elapsedSec = 0;
  raceModeState.accumulatorMs = 0;
  applyRaceTrackPreset(raceTrackPresetId, { resetParticipants: true });
  updateRaceControlState();
  updateRaceRacerCards();
  renderRacePlaceList();
  if (winner) {
    openRaceResultModal(winner);
  }
}

function stepRaceParticipants() {
  for (let i = 0; i < raceModeState.participants.length; i += 1) {
    const participant = raceModeState.participants[i];
    if (participant.finished) {
      participant.status = "Finished";
      continue;
    }
    participant.timeSinceLapSec = (participant.timeSinceLapSec || 0) + env.dt;

    let actionIndex = 4;
    if (isSavedRaceParticipant(participant)) {
      actionIndex = participant.agent.actGreedy(participant.observation);
    } else if (isNpcRaceParticipant(participant)) {
      actionIndex = participant.controller.decide(participant, raceTrack);
    }
    const transition = participant.env.step(actionIndex);
    participant.observation = transition.observation;

    const renderState = participant.env.getRenderState();
    participant.renderState = renderState;

    const envLapCount = Math.max(0, Math.floor(Number(renderState.currentLapCount) || 0));

    if (
      isNpcRaceParticipant(participant) &&
      participant.level === 1 &&
      (envLapCount > participant.lastEnvLapCount || Number(renderState.lapProgress) > 0.86)
    ) {
      participant.status = "Spinout";
      participant.episodeCount += 1;
      participant.laps = 0;
      participant.observation = participant.env.resetEpisode(true);
      participant.renderState = participant.env.getRenderState();
      participant.lastEnvLapCount = 0;
      participant.progress = 0;
      participant.currentLapTimeSec = 0;
      continue;
    }

    if (envLapCount > participant.lastEnvLapCount) {
      participant.laps += envLapCount - participant.lastEnvLapCount;
      participant.lastEnvLapCount = envLapCount;
      participant.timeSinceLapSec = 0;

      if (participant.laps >= raceModeState.targetLaps) {
        participant.finished = true;
        participant.finishTimeSec = raceModeState.elapsedSec;
        participant.status = "Finished";
        continue;
      }
    }

    if (isNpcRaceParticipant(participant) && participant.level >= 2) {
      const fallbackLapWindow = 42 - participant.level * 4.5;
      if (participant.timeSinceLapSec >= fallbackLapWindow) {
        participant.laps += 1;
        participant.timeSinceLapSec = 0;

        if (participant.laps >= raceModeState.targetLaps) {
          participant.finished = true;
          participant.finishTimeSec = raceModeState.elapsedSec;
          participant.status = "Finished";
          continue;
        }
      }
    }

    participant.lastEnvLapCount = envLapCount;
    participant.progress = clamp(Number(renderState.lapProgress) || 0, 0, 1);
    participant.currentLapTimeSec = Number(renderState.thisLapTimeSec) || 0;

    const bestLap = Number(renderState.bestLapTimeSec);
    if (Number.isFinite(bestLap) && bestLap > 0) {
      participant.bestLapTimeSec = bestLap;
    }

    if (transition.done) {
      participant.status = transition.info?.offTrack ? "Respawning" : "Reset";
      participant.episodeCount += 1;
      participant.observation = participant.env.resetEpisode(true);
      participant.renderState = participant.env.getRenderState();
      participant.lastEnvLapCount = 0;
      participant.progress = 0;
      participant.currentLapTimeSec = 0;
    } else if (raceModeState.running) {
      participant.status = "Racing";
    } else {
      participant.status = "Paused";
    }
  }

  if (
    raceModeState.running &&
    raceModeState.participants.length > 0 &&
    raceModeState.participants.every((participant) => participant.finished)
  ) {
    endRace({ showResult: true });
  }
}

function renderRaceFrame() {
  const trails = [];
  const cars = [];
  const carStyles = [];
  const trailColors = [];

  for (let i = 0; i < raceModeState.participants.length; i += 1) {
    const participant = raceModeState.participants[i];
    const renderState = participant.renderState || participant.env.getRenderState();
    participant.renderState = renderState;
    trails.push(renderState.trail);
    cars.push(renderState.car);
    carStyles.push(participant.carStyle);
    trailColors.push(participant.carStyle?.primary || "#f49b2c");
  }

  raceRenderer.render({
    track: raceTrack,
    cars,
    trails,
    trailColors,
    showTrail: true,
    showSensors: false,
    carStyles,
    visuals: {
      trackColor: appSettings.trackColor,
      canvasBgColor: appSettings.canvasBgColor,
      canvasPattern: appSettings.canvasPattern
    }
  });

  updateRaceHud();
  updateRaceRacerCards();
  renderRacePlaceList();
}

function closeRaceTrackModal() {
  if (!raceModeState.trackModalOpen || !raceTrackModalElements.root) {
    return;
  }
  raceModeState.trackModalOpen = false;
  refreshRaceModalState();
  raceTrackModalElements.root.hidden = true;
}

function openRaceTrackModal() {
  if (!raceModeState.active || raceModeState.modalOpen || !raceTrackModalElements.root || !raceTrackModalElements.presetGrid) {
    return;
  }

  raceTrackModalElements.presetGrid.innerHTML = "";
  for (let i = 0; i < TRACK_PRESETS.length; i += 1) {
    const preset = TRACK_PRESETS[i];
    const button = document.createElement("button");
    button.type = "button";
    button.className = "track-preset-btn";
    button.textContent = preset.name;
    if (preset.id === raceTrackPresetId) {
      button.classList.add("active");
    }

    button.addEventListener("click", () => {
      applyRaceTrackPreset(preset.id, { resetParticipants: true });
      setRaceRunning(false);
      closeRaceTrackModal();
    });
    raceTrackModalElements.presetGrid.appendChild(button);
  }

  raceModeState.trackModalOpen = true;
  refreshRaceModalState();
  raceTrackModalElements.root.hidden = false;

  requestAnimationFrame(() => {
    const first = raceTrackModalElements.presetGrid.querySelector("button");
    (first || raceTrackModalElements.closeBtn)?.focus();
  });
}

function closeRaceChooseModal(applySelection = false) {
  if (!raceModeState.chooseModalOpen || !raceChooseModalElements.root) {
    return;
  }

  if (applySelection && raceChooseModalElements.list) {
    const selected = Array.from(raceChooseModalElements.list.querySelectorAll("input:checked"))
      .map((input) => input.value)
      .slice(0, 5);
    applyRaceSelection(selected);
  }

  raceModeState.chooseModalOpen = false;
  refreshRaceModalState();
  raceChooseModalElements.root.hidden = true;
}

function openRaceChooseModal() {
  if (
    !raceModeState.active ||
    raceModeState.modalOpen ||
    !raceChooseModalElements.root ||
    !raceChooseModalElements.list
  ) {
    return;
  }

  const deployedSavedCount = raceModeState.participants.filter(isSavedRaceParticipant).length;
  const maxNpcSelections = Math.max(0, 5 - deployedSavedCount);
  raceModeState.chooserSelection = new Set(
    Array.from(getCurrentRaceSelectionIds()).filter((id) => id.startsWith("npc:"))
  );
  while (raceModeState.chooserSelection.size > maxNpcSelections) {
    const first = raceModeState.chooserSelection.values().next().value;
    raceModeState.chooserSelection.delete(first);
  }

  const entries = buildRaceChooserEntries();
  raceChooseModalElements.list.innerHTML = "";

  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    const item = document.createElement("div");
    item.className = "race-choose-item";

    const label = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = entry.id;
    checkbox.checked = raceModeState.chooserSelection.has(entry.id);

    const text = document.createElement("span");
    text.className = "race-choose-name race-name-npc";
    text.textContent = entry.label;

    const meta = document.createElement("small");
    meta.textContent = entry.meta;

    label.append(checkbox, text);
    item.append(label, meta);
    raceChooseModalElements.list.appendChild(item);

    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        if (raceModeState.chooserSelection.size >= maxNpcSelections) {
          checkbox.checked = false;
          return;
        }
        raceModeState.chooserSelection.add(entry.id);
      } else {
        raceModeState.chooserSelection.delete(entry.id);
      }

      updateRaceChooserCount();
      if (raceChooseModalElements.applyBtn) {
        raceChooseModalElements.applyBtn.disabled = raceModeState.chooserSelection.size === 0;
      }
    });
  }

  updateRaceChooserCount();
  if (raceChooseModalElements.applyBtn) {
    raceChooseModalElements.applyBtn.disabled = raceModeState.chooserSelection.size === 0;
  }

  raceModeState.chooseModalOpen = true;
  refreshRaceModalState();
  raceChooseModalElements.root.hidden = false;

  requestAnimationFrame(() => {
    const first = raceChooseModalElements.list.querySelector("input");
    (first || raceChooseModalElements.closeBtn || raceChooseModalElements.applyBtn)?.focus();
  });
}

function openRaceMode() {
  if (raceModeState.active || ui.isModalOpen()) {
    return;
  }

  running = false;
  ui.setRunning(false);
  if (drawState.active) {
    cancelDrawMode();
  }

  raceModeState.active = true;
  raceModeState.elapsedSec = 0;
  raceModeState.accumulatorMs = 0;
  raceModeState.participants = [];
  raceModeState.trackModalOpen = false;
  raceModeState.chooseModalOpen = false;
  raceModeState.resultModalOpen = false;
  refreshRaceModalState();
  if (raceResultModalElements.root) {
    raceResultModalElements.root.hidden = true;
  }

  setRaceRunning(false);
  applyRaceTrackPreset(raceTrackPresetId, { resetParticipants: false });
  renderRaceRacerList();
  updateRaceControlState();
  renderRaceFrame();

  if (raceModeElements.root) {
    raceModeElements.root.hidden = false;
  }
}

function closeRaceMode() {
  if (!raceModeState.active) {
    return;
  }

  closeRaceTrackModal();
  closeRaceChooseModal();
  closeRaceResultModal();
  raceModeState.active = false;
  raceModeState.elapsedSec = 0;
  raceModeState.accumulatorMs = 0;
  raceModeState.participants = [];
  setRaceRunning(false);

  if (raceModeElements.root) {
    raceModeElements.root.hidden = true;
  }
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
  onRequestRaceMode: () => {
    if (ui.isModalOpen()) {
      return;
    }
    openRaceMode();
  },
  onTrainingSpeedChange: (nextSpeed) => {
    if (autoTrainState.enabled) {
      trainingSpeedMultiplier = AUTO_TRAIN_SPEED;
      ui.setTrainingSpeed(AUTO_TRAIN_SPEED, false);
      return;
    }
    trainingSpeedMultiplier = Math.round(clamp(Number(nextSpeed) || 1, 1, 25));
    appSettings = sanitizeAppSettings({
      ...appSettings,
      trainingSpeed: trainingSpeedMultiplier
    });
    saveAppSettings(appSettings);
  },
  onAutoTrainToggle: (enabled) => {
    setAutoTrainEnabled(enabled);
  },
  onAutoParamToggle: (enabled) => {
    setAutoParamEnabled(enabled);
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
  onDeploySavedTrack: (trackId) => {
    if (ui.isModalOpen()) {
      return;
    }
    handleDeploySavedTrack(trackId);
  },
  onDeleteSavedTrack: (trackId) => {
    if (ui.isModalOpen()) {
      return;
    }
    handleDeleteSavedTrack(trackId);
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
ui.setAutoTrainEnabled(autoTrainState.enabled, false);
ui.setAutoParamEnabled(Boolean(appSettings.autoParamEnabled), false);
ui.setDrawMode(false, 0);
resetAutoTrainTrackProgress();

saveHyperparams(hyperparams);
saveTeamName(teamName);
saveAppSettings(appSettings);
savedRacers = persistSavedRacers(savedRacers);
savedTracks = persistSavedTracks(savedTracks);

raceModeElements.startBtn?.addEventListener("click", () => {
  if (!raceModeState.active || raceModeState.modalOpen) {
    return;
  }
  if (!raceModeState.participants.length) {
    return;
  }
  setRaceRunning(!raceModeState.running);
});

raceModeElements.chooseBtn?.addEventListener("click", () => {
  if (!raceModeState.active || raceModeState.modalOpen) {
    return;
  }
  openRaceChooseModal();
});

raceModeElements.withdrawBtn?.addEventListener("click", () => {
  withdrawAllRaceParticipants();
});

raceModeElements.trackBtn?.addEventListener("click", () => {
  if (!raceModeState.active || raceModeState.modalOpen) {
    return;
  }
  openRaceTrackModal();
});

raceModeElements.exitBtn?.addEventListener("click", () => {
  closeRaceMode();
});

raceModeElements.endBtn?.addEventListener("click", () => {
  if (!raceModeState.active || raceModeState.modalOpen) {
    return;
  }
  endRace({ showResult: false });
});

raceTrackModalElements.closeBtn?.addEventListener("click", () => {
  closeRaceTrackModal();
});

raceTrackModalElements.backdrop?.addEventListener("click", () => {
  closeRaceTrackModal();
});

raceChooseModalElements.closeBtn?.addEventListener("click", () => {
  closeRaceChooseModal(false);
});

raceChooseModalElements.applyBtn?.addEventListener("click", () => {
  closeRaceChooseModal(true);
});

raceChooseModalElements.backdrop?.addEventListener("click", () => {
  closeRaceChooseModal(false);
});

raceResultModalElements.closeBtn?.addEventListener("click", () => {
  closeRaceResultModal();
});

raceResultModalElements.backdrop?.addEventListener("click", () => {
  closeRaceResultModal();
});

document.addEventListener("keydown", (event) => {
  if (!raceModeState.modalOpen) {
    return;
  }

  if (event.key === "Escape") {
    event.preventDefault();
    if (raceModeState.trackModalOpen) {
      closeRaceTrackModal();
    } else if (raceModeState.chooseModalOpen) {
      closeRaceChooseModal(false);
    } else if (raceModeState.resultModalOpen) {
      closeRaceResultModal();
    }
    return;
  }

  if (event.key !== "Tab") {
    return;
  }

  const dialog = raceModeState.trackModalOpen
    ? raceTrackModalElements.root?.querySelector(".modal")
    : raceModeState.chooseModalOpen
    ? raceChooseModalElements.dialog
    : raceResultModalElements.dialog;
  const focusable = getFocusableElements(dialog);
  if (!focusable.length) {
    return;
  }

  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const active = document.activeElement;

  if (event.shiftKey && active === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
});

applyRaceTrackPreset(raceTrackPresetId, { resetParticipants: false });
updateRaceControlState();
updateRaceHud();

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

  if (raceModeState.active) {
    accumulatorMs = 0;

    if (raceModeState.running && !raceModeState.modalOpen) {
      raceModeState.accumulatorMs += frameDelta;
      const maxRaceStepsPerFrame = 12;
      let processed = 0;

      while (raceModeState.accumulatorMs >= fixedStepMs && processed < maxRaceStepsPerFrame) {
        stepRaceParticipants();
        raceModeState.elapsedSec += env.dt;
        raceModeState.accumulatorMs -= fixedStepMs;
        processed += 1;
      }

      if (processed >= maxRaceStepsPerFrame) {
        raceModeState.accumulatorMs = 0;
      }
    } else {
      raceModeState.accumulatorMs = 0;
    }

    renderRaceFrame();
    requestAnimationFrame(loop);
    return;
  }

  if (running && !ui.isModalOpen() && !drawState.active) {
    accumulatorMs += frameDelta * trainingSpeedMultiplier;
    const maxStepsPerFrame = Math.max(120, trainingSpeedMultiplier * 120);
    let processedSteps = 0;

    while (accumulatorMs >= fixedStepMs && processedSteps < maxStepsPerFrame) {
      const stepStart = performance.now();
      runOneStep();
      lastStepMs = performance.now() - stepStart;
      if (!running) {
        accumulatorMs = 0;
        break;
      }
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

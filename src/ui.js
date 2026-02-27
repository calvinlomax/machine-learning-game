function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function toLogSliderValue(value, min, max) {
  const logMin = Math.log10(min);
  const logMax = Math.log10(max);
  const normalized = (Math.log10(value) - logMin) / (logMax - logMin);
  return clamp(normalized * 1000, 0, 1000);
}

function fromLogSliderValue(sliderValue, min, max) {
  const t = clamp(sliderValue / 1000, 0, 1);
  const logMin = Math.log10(min);
  const logMax = Math.log10(max);
  return 10 ** (logMin + t * (logMax - logMin));
}

function formatNumber(value, decimals = 3) {
  return Number(value).toFixed(decimals);
}

function formatLapTime(secondsValue) {
  const totalSeconds = Math.max(0, Number.isFinite(secondsValue) ? secondsValue : 0);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const centiseconds = Math.floor((totalSeconds - Math.floor(totalSeconds)) * 100);

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}:${String(
    centiseconds
  ).padStart(2, "0")}`;
}

function formatReturn(value) {
  if (!Number.isFinite(value)) {
    return "--";
  }
  return formatNumber(value, 2);
}

function sanitizeTeamName(value) {
  const text = String(value ?? "").trim();
  return text || "ML1 Academy";
}

function sanitizeColor(value, fallback) {
  const text = String(value ?? "").trim();
  if (/^#[0-9a-fA-F]{6}$/.test(text)) {
    return text;
  }
  return fallback;
}

const PARAM_DEFS = [
  {
    id: "learningRate",
    label: "Learning rate",
    min: 1e-5,
    max: 1e-2,
    defaultValue: 3e-4,
    slider: { min: 0, max: 1000, step: 1 },
    toSliderValue: (value) => toLogSliderValue(value, 1e-5, 1e-2),
    fromSliderValue: (value) => fromLogSliderValue(value, 1e-5, 1e-2),
    format: (value) => value.toExponential(2)
  },
  {
    id: "gamma",
    label: "Discount factor (gamma)",
    min: 0.8,
    max: 0.999,
    step: 0.001,
    defaultValue: 0.99,
    format: (value) => formatNumber(value, 3)
  },
  {
    id: "epsilonStart",
    label: "Epsilon start",
    min: 0.1,
    max: 1,
    step: 0.01,
    defaultValue: 1,
    format: (value) => formatNumber(value, 2)
  },
  {
    id: "epsilonMin",
    label: "Epsilon min",
    min: 0.01,
    max: 0.2,
    step: 0.01,
    defaultValue: 0.05,
    format: (value) => formatNumber(value, 2)
  },
  {
    id: "epsilonDecay",
    label: "Epsilon decay",
    min: 0.9,
    max: 0.9999,
    step: 0.0001,
    defaultValue: 0.995,
    format: (value) => formatNumber(value, 4)
  },
  {
    id: "batchSize",
    label: "Batch size",
    min: 16,
    max: 256,
    step: 1,
    integer: true,
    defaultValue: 64,
    format: (value) => String(Math.round(value))
  },
  {
    id: "replayBufferSize",
    label: "Replay buffer size",
    min: 1000,
    max: 50000,
    step: 100,
    integer: true,
    defaultValue: 12000,
    format: (value) => String(Math.round(value))
  },
  {
    id: "targetUpdatePeriod",
    label: "Target network update period",
    min: 50,
    max: 5000,
    step: 10,
    integer: true,
    defaultValue: 500,
    format: (value) => String(Math.round(value))
  },
  {
    id: "trainingStepsPerEnvStep",
    label: "Training steps per env step",
    min: 1,
    max: 10,
    step: 1,
    integer: true,
    defaultValue: 2,
    format: (value) => String(Math.round(value))
  },
  {
    id: "maxEpisodeSteps",
    label: "Max episode steps",
    min: 200,
    max: 5000,
    step: 10,
    integer: true,
    defaultValue: 1200,
    format: (value) => String(Math.round(value))
  },
  {
    id: "actionSmoothing",
    label: "Action smoothing (steering inertia)",
    min: 0,
    max: 0.9,
    step: 0.01,
    defaultValue: 0.45,
    format: (value) => formatNumber(value, 2)
  },
  {
    id: "progressRewardWeight",
    label: "Progress reward weight",
    min: 0,
    max: 5,
    step: 0.01,
    defaultValue: 1.8,
    format: (value) => formatNumber(value, 2)
  },
  {
    id: "offTrackPenalty",
    label: "Off-track penalty",
    min: -10,
    max: 0,
    step: 0.1,
    defaultValue: -5,
    format: (value) => formatNumber(value, 1)
  },
  {
    id: "speedPenaltyWeight",
    label: "Speed penalty weight",
    min: 0,
    max: 2,
    step: 0.01,
    defaultValue: 0.5,
    format: (value) => formatNumber(value, 2)
  }
];

export const DEFAULT_HYPERPARAMS = Object.freeze(
  PARAM_DEFS.reduce((acc, def) => {
    acc[def.id] = def.defaultValue;
    return acc;
  }, {})
);

function sanitizeValue(def, inputValue) {
  const fallback = def.defaultValue;
  const numeric = Number(inputValue);
  const base = Number.isFinite(numeric) ? numeric : fallback;
  const clamped = clamp(base, def.min, def.max);
  return def.integer ? Math.round(clamped) : clamped;
}

export function clampHyperparams(values) {
  const next = {};
  for (let i = 0; i < PARAM_DEFS.length; i += 1) {
    const def = PARAM_DEFS[i];
    next[def.id] = sanitizeValue(def, values?.[def.id]);
  }

  if (next.epsilonMin > next.epsilonStart) {
    next.epsilonMin = next.epsilonStart;
  }

  return next;
}

function getFocusableElements(root) {
  const selector = "button, input, [href], select, textarea, [tabindex]:not([tabindex='-1'])";
  return Array.from(root.querySelectorAll(selector)).filter((el) => !el.hasAttribute("disabled"));
}

export function createUI({ initialHyperparams, initialSeed, initialTeamName, initialSettings }) {
  const elements = {
    startPauseBtn: document.getElementById("start-pause-btn"),
    stepBtn: document.getElementById("step-btn"),
    episodeResetBtn: document.getElementById("episode-reset-btn"),
    newTrackBtn: document.getElementById("new-track-btn"),
    newRacerBtn: document.getElementById("new-racer-btn"),
    changeCarBtn: document.getElementById("change-car-btn"),
    saveRacerBtn: document.getElementById("save-racer-btn"),
    settingsBtn: document.getElementById("settings-btn"),
    shareBtn: document.getElementById("share-btn"),
    trainingSpeedSlider: document.getElementById("train-speed-slider"),
    trainingSpeedValue: document.getElementById("train-speed-value"),
    seedInput: document.getElementById("seed-input"),
    resetDefaultsBtn: document.getElementById("reset-defaults-btn"),
    toggleSensors: document.getElementById("toggle-sensors"),
    toggleTrail: document.getElementById("toggle-trail"),
    sliderContainer: document.getElementById("training-sliders"),
    savedRacerList: document.getElementById("saved-racer-list"),
    savedTrackList: document.getElementById("saved-track-list"),
    teamNameDisplay: document.getElementById("team-name-display"),
    teamNameInput: document.getElementById("team-name-input"),
    drawTrackPanel: document.getElementById("draw-track-panel"),
    drawTrackStatus: document.getElementById("draw-track-status"),
    drawTrackFinishBtn: document.getElementById("draw-track-finish-btn"),
    drawTrackCancelBtn: document.getElementById("draw-track-cancel-btn")
  };

  const stats = {
    lapCountCurrent: document.getElementById("stat-lap-count-current"),
    lapCountBest: document.getElementById("stat-lap-count-best"),
    lapWorst: document.getElementById("stat-lap-worst"),
    lapBest: document.getElementById("stat-lap-best"),
    episode: document.getElementById("stat-episode"),
    step: document.getElementById("stat-step"),
    totalTrain: document.getElementById("stat-total-train"),
    progress: document.getElementById("stat-progress"),
    reward: document.getElementById("stat-reward"),
    episodeReturn: document.getElementById("stat-ep-return"),
    bestReturn: document.getElementById("stat-best-return"),
    epsilon: document.getElementById("stat-epsilon"),
    learningRate: document.getElementById("stat-lr"),
    gamma: document.getElementById("stat-gamma"),
    fps: document.getElementById("stat-fps"),
    stepMs: document.getElementById("stat-step-ms")
  };

  const modal = {
    root: document.getElementById("confirm-modal-root"),
    dialog: document.querySelector("#confirm-modal-root .modal"),
    title: document.getElementById("modal-title"),
    message: document.getElementById("modal-message"),
    cancelBtn: document.getElementById("modal-cancel-btn"),
    confirmBtn: document.getElementById("modal-confirm-btn"),
    backdrop: document.querySelector("#confirm-modal-root .modal-backdrop")
  };

  const carModal = {
    root: document.getElementById("car-modal-root"),
    dialog: document.querySelector("#car-modal-root .car-modal"),
    optionGrid: document.getElementById("car-option-grid"),
    closeBtn: document.getElementById("car-modal-close-btn"),
    backdrop: document.querySelector("#car-modal-root .modal-backdrop")
  };

  const trackModal = {
    root: document.getElementById("track-modal-root"),
    dialog: document.querySelector("#track-modal-root .track-modal"),
    presetGrid: document.getElementById("track-preset-grid"),
    drawBtn: document.getElementById("draw-track-btn"),
    saveBtn: document.getElementById("save-track-btn"),
    seedInput: document.getElementById("seed-input"),
    applyBtn: document.getElementById("apply-seed-btn"),
    randomBtn: document.getElementById("track-random-btn"),
    closeBtn: document.getElementById("track-modal-close-btn"),
    backdrop: document.querySelector("#track-modal-root .modal-backdrop")
  };

  const racerModal = {
    root: document.getElementById("racer-modal-root"),
    dialog: document.querySelector("#racer-modal-root .modal"),
    title: document.getElementById("racer-modal-title"),
    message: document.getElementById("racer-modal-message"),
    nameInput: document.getElementById("racer-name-input"),
    carField: document.getElementById("racer-car-field"),
    carSelect: document.getElementById("racer-car-select"),
    cancelBtn: document.getElementById("racer-modal-cancel-btn"),
    saveBtn: document.getElementById("racer-modal-save-btn"),
    backdrop: document.querySelector("#racer-modal-root .modal-backdrop")
  };

  const settingsModal = {
    root: document.getElementById("settings-modal-root"),
    dialog: document.querySelector("#settings-modal-root .settings-modal"),
    widthInput: document.getElementById("settings-world-width"),
    heightInput: document.getElementById("settings-world-height"),
    trackWidthInput: document.getElementById("settings-track-width"),
    trackWidthOutput: document.getElementById("settings-track-width-value"),
    trackColorInput: document.getElementById("settings-track-color"),
    canvasBgInput: document.getElementById("settings-canvas-bg"),
    canvasPatternSelect: document.getElementById("settings-canvas-pattern"),
    uiThemeSelect: document.getElementById("settings-ui-theme"),
    helpBtn: document.getElementById("settings-help-btn"),
    helpPop: document.getElementById("settings-help-pop"),
    cancelBtn: document.getElementById("settings-cancel-btn"),
    applyBtn: document.getElementById("settings-apply-btn"),
    backdrop: document.querySelector("#settings-modal-root .modal-backdrop")
  };

  const handlers = {
    onStartPause: () => {},
    onStep: () => {},
    onEpisodeReset: () => {},
    onRequestNewTrack: () => {},
    onRequestNewRacer: () => {},
    onRequestCarPicker: () => {},
    onRequestSaveRacer: () => {},
    onRequestSettings: () => {},
    onRequestShare: () => {},
    onTrainingSpeedChange: () => {},
    onFinishDrawTrack: () => {},
    onCancelDrawTrack: () => {},
    onDeploySavedRacer: () => {},
    onDeleteSavedRacer: () => {},
    onEditSavedRacer: () => {},
    onDeploySavedTrack: () => {},
    onDeleteSavedTrack: () => {},
    onTeamNameChange: () => {},
    onHyperparamsChange: () => {}
  };

  let hyperparams = clampHyperparams(initialHyperparams);
  let teamName = sanitizeTeamName(initialTeamName);
  let editingTeamName = false;
  let drawModeActive = false;
  let trainingSpeed = clamp(Math.round(Number(initialSettings?.trainingSpeed) || 1), 1, 25);
  let settings = {
    worldWidth: Number(initialSettings?.worldWidth) || 900,
    worldHeight: Number(initialSettings?.worldHeight) || 600,
    trackWidth: Number(initialSettings?.trackWidth) || 112,
    trackColor: sanitizeColor(initialSettings?.trackColor, "#576f57"),
    canvasBgColor: sanitizeColor(initialSettings?.canvasBgColor, "#1b2b2f"),
    canvasPattern: initialSettings?.canvasPattern || "diagonal",
    uiTheme: initialSettings?.uiTheme === "dark" ? "dark" : "light"
  };
  const sliderControls = new Map();

  function notifyHyperparamChange() {
    handlers.onHyperparamsChange({ ...hyperparams });
  }

  function refreshSlider(def) {
    const control = sliderControls.get(def.id);
    if (!control) {
      return;
    }

    const value = sanitizeValue(def, hyperparams[def.id]);
    hyperparams[def.id] = value;

    const sliderValue = def.toSliderValue ? def.toSliderValue(value) : value;
    control.input.value = String(sliderValue);
    control.output.textContent = def.format ? def.format(value) : String(value);
  }

  function refreshAllSliders() {
    for (let i = 0; i < PARAM_DEFS.length; i += 1) {
      refreshSlider(PARAM_DEFS[i]);
    }
  }

  function buildSliderPanel() {
    elements.sliderContainer.innerHTML = "";

    for (let i = 0; i < PARAM_DEFS.length; i += 1) {
      const def = PARAM_DEFS[i];
      const row = document.createElement("div");
      row.className = "slider-row";

      const label = document.createElement("label");
      label.setAttribute("for", `slider-${def.id}`);
      label.textContent = def.label;

      const output = document.createElement("output");
      output.setAttribute("for", `slider-${def.id}`);

      const input = document.createElement("input");
      input.type = "range";
      input.id = `slider-${def.id}`;
      input.min = String(def.slider?.min ?? def.min);
      input.max = String(def.slider?.max ?? def.max);
      input.step = String(def.slider?.step ?? def.step ?? 0.01);

      row.append(label, output, input);
      elements.sliderContainer.appendChild(row);

      sliderControls.set(def.id, { input, output });

      input.addEventListener("input", () => {
        const sliderValue = Number(input.value);
        const rawValue = def.fromSliderValue ? def.fromSliderValue(sliderValue) : sliderValue;
        hyperparams[def.id] = sanitizeValue(def, rawValue);

        if (def.id === "epsilonStart" && hyperparams.epsilonMin > hyperparams.epsilonStart) {
          hyperparams.epsilonMin = hyperparams.epsilonStart;
          refreshSlider(PARAM_DEFS.find((item) => item.id === "epsilonMin"));
        }

        if (def.id === "epsilonMin" && hyperparams.epsilonMin > hyperparams.epsilonStart) {
          hyperparams.epsilonMin = hyperparams.epsilonStart;
        }

        refreshSlider(def);
        notifyHyperparamChange();
      });
    }

    refreshAllSliders();
  }

  function setHyperparams(nextValues, notify = false) {
    hyperparams = clampHyperparams(nextValues);
    refreshAllSliders();

    if (notify) {
      notifyHyperparamChange();
    }
  }

  function getHyperparams() {
    return { ...hyperparams };
  }

  function setTeamName(nextName, notify = false) {
    teamName = sanitizeTeamName(nextName);
    if (elements.teamNameDisplay) {
      elements.teamNameDisplay.textContent = teamName;
    }
    if (elements.teamNameInput) {
      elements.teamNameInput.value = teamName;
    }

    if (notify) {
      handlers.onTeamNameChange(teamName);
    }
  }

  function beginTeamNameEdit() {
    if (editingTeamName || modalOpen || !elements.teamNameDisplay || !elements.teamNameInput) {
      return;
    }

    editingTeamName = true;
    elements.teamNameDisplay.hidden = true;
    elements.teamNameInput.hidden = false;
    elements.teamNameInput.value = teamName;
    requestAnimationFrame(() => {
      elements.teamNameInput.focus();
      elements.teamNameInput.select();
    });
  }

  function endTeamNameEdit(commit) {
    if (!editingTeamName || !elements.teamNameDisplay || !elements.teamNameInput) {
      return;
    }

    if (commit) {
      setTeamName(elements.teamNameInput.value, true);
    } else {
      elements.teamNameInput.value = teamName;
    }

    editingTeamName = false;
    elements.teamNameInput.hidden = true;
    elements.teamNameDisplay.hidden = false;
    elements.teamNameDisplay.focus();
  }

  function applyTheme(theme) {
    const nextTheme = theme === "dark" ? "dark" : "light";
    settings.uiTheme = nextTheme;
    document.documentElement.dataset.theme = nextTheme;
    if (settingsModal.uiThemeSelect) {
      settingsModal.uiThemeSelect.value = nextTheme;
    }
  }

  function setDrawMode(active, pointCount = 0) {
    drawModeActive = Boolean(active);
    if (!elements.drawTrackPanel || !elements.drawTrackStatus) {
      return;
    }

    elements.drawTrackPanel.hidden = !drawModeActive;
    if (drawModeActive) {
      elements.drawTrackStatus.textContent = `Draw mode: ${Math.max(0, Math.floor(pointCount))} points. Drag to sketch, then finish.`;
    }
  }

  function setTrainingSpeed(value, notify = false) {
    trainingSpeed = clamp(Math.round(Number(value) || 1), 1, 25);

    if (elements.trainingSpeedSlider) {
      elements.trainingSpeedSlider.value = String(trainingSpeed);
    }
    if (elements.trainingSpeedValue) {
      elements.trainingSpeedValue.textContent = `${trainingSpeed}x`;
    }

    if (notify) {
      handlers.onTrainingSpeedChange(trainingSpeed);
    }
  }

  function getTrainingSpeed() {
    return trainingSpeed;
  }

  function setRunning(isRunning) {
    if (!elements.startPauseBtn) {
      return;
    }
    elements.startPauseBtn.textContent = isRunning ? "Pause" : "Start";
    elements.startPauseBtn.classList.toggle("primary", !isRunning);
  }

  function updateStats(nextStats) {
    stats.lapCountCurrent.textContent = String(Math.max(0, Math.floor(nextStats.currentLapCount ?? 0)));
    stats.lapCountBest.textContent = String(Math.max(0, Math.floor(nextStats.bestLapCount ?? 0)));
    stats.lapWorst.textContent = formatLapTime(nextStats.thisLapTimeSec ?? 0);
    stats.lapBest.textContent = formatLapTime(nextStats.bestLapTimeSec ?? 0);

    stats.episode.textContent = String(nextStats.episode ?? 1);
    stats.step.textContent = String(nextStats.step ?? 0);
    stats.totalTrain.textContent = String(nextStats.totalTrainingSteps ?? 0);

    const progressPercent = ((nextStats.progress ?? 0) * 100).toFixed(1);
    stats.progress.textContent = `${progressPercent}%`;

    stats.reward.textContent = formatNumber(nextStats.reward ?? 0, 3);
    stats.episodeReturn.textContent = formatNumber(nextStats.episodeReturn ?? 0, 3);

    stats.bestReturn.textContent = Number.isFinite(nextStats.bestReturn)
      ? formatNumber(nextStats.bestReturn, 3)
      : "--";

    stats.epsilon.textContent = formatNumber(nextStats.epsilon ?? 0, 3);
    stats.learningRate.textContent = Number(nextStats.learningRate ?? 0).toExponential(2);
    stats.gamma.textContent = formatNumber(nextStats.gamma ?? 0, 3);
    stats.fps.textContent = formatNumber(nextStats.fps ?? 0, 1);
    stats.stepMs.textContent = formatNumber(nextStats.stepMs ?? 0, 2);
  }

  function createSavedRacerCard(savedRacer, carById) {
    const card = document.createElement("article");
    card.className = "saved-racer-card";
    card.dataset.racerId = savedRacer.id;

    const header = document.createElement("div");
    header.className = "saved-racer-head";

    const name = document.createElement("div");
    name.className = "saved-racer-name";
    name.textContent = savedRacer.name || "Unnamed Racer";

    const carPreview = document.createElement("span");
    carPreview.className = "saved-racer-car";
    const carStyle = carById.get(savedRacer.carId);
    if (carStyle) {
      carPreview.style.setProperty("--car-primary", carStyle.primary);
      carPreview.style.setProperty("--car-secondary", carStyle.secondary);
      carPreview.style.setProperty("--car-accent", carStyle.accent);
    }

    header.append(name, carPreview);
    card.appendChild(header);

    const metrics = document.createElement("div");
    metrics.className = "saved-racer-metrics";
    const metricRows = [
      ["Episodes", String(Math.max(1, Math.floor(savedRacer.metrics?.episodes ?? 1)))],
      ["Best laps", String(Math.max(0, Math.floor(savedRacer.metrics?.bestLapCount ?? 0)))],
      ["Best return", formatReturn(savedRacer.metrics?.bestReturn)],
      ["Train steps", String(Math.max(0, Math.floor(savedRacer.metrics?.trainingSteps ?? 0)))]
    ];

    for (let i = 0; i < metricRows.length; i += 1) {
      const [labelText, valueText] = metricRows[i];
      const row = document.createElement("div");
      row.className = "saved-racer-metric";

      const label = document.createElement("span");
      label.textContent = labelText;

      const value = document.createElement("strong");
      value.textContent = valueText;
      row.append(label, value);
      metrics.appendChild(row);
    }

    card.appendChild(metrics);

    const actions = document.createElement("div");
    actions.className = "saved-racer-actions";

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "danger delete-racer-btn";
    deleteBtn.textContent = "Delete racer";
    deleteBtn.addEventListener("click", () => handlers.onDeleteSavedRacer(savedRacer.id));

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "edit-racer-btn";
    editBtn.textContent = "Edit Racer";
    editBtn.addEventListener("click", () => handlers.onEditSavedRacer(savedRacer.id));

    const deployBtn = document.createElement("button");
    deployBtn.type = "button";
    deployBtn.className = "primary deploy-racer-btn";
    deployBtn.textContent = "Deploy Racer";
    deployBtn.addEventListener("click", () => handlers.onDeploySavedRacer(savedRacer.id));

    actions.append(deleteBtn, editBtn, deployBtn);
    card.appendChild(actions);

    return card;
  }

  function setSavedRacers(savedRacers, cars) {
    const list = Array.isArray(savedRacers) ? savedRacers.slice(0, 4) : [];
    elements.savedRacerList.innerHTML = "";

    if (!list.length) {
      const empty = document.createElement("div");
      empty.className = "saved-racer-empty";
      empty.textContent = "No saved racers yet. Save up to four racers from the current run.";
      elements.savedRacerList.appendChild(empty);
      return;
    }

    const carById = new Map((Array.isArray(cars) ? cars : []).map((car) => [car.id, car]));
    for (let i = 0; i < list.length; i += 1) {
      elements.savedRacerList.appendChild(createSavedRacerCard(list[i], carById));
    }
  }

  function createSavedTrackCard(savedTrack) {
    const card = document.createElement("article");
    card.className = "saved-track-card";
    card.dataset.trackId = savedTrack.id;

    const name = document.createElement("div");
    name.className = "saved-track-name";
    name.textContent = savedTrack.name || `Track ${savedTrack.seed}`;

    const seed = document.createElement("div");
    seed.className = "saved-track-seed";
    seed.textContent = `Seed: ${savedTrack.seed}`;

    const actions = document.createElement("div");
    actions.className = "saved-track-actions";

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "danger";
    deleteBtn.textContent = "Delete";
    deleteBtn.addEventListener("click", () => handlers.onDeleteSavedTrack(savedTrack.id));

    const deployBtn = document.createElement("button");
    deployBtn.type = "button";
    deployBtn.className = "primary";
    deployBtn.textContent = "Deploy";
    deployBtn.addEventListener("click", () => handlers.onDeploySavedTrack(savedTrack.id));

    actions.append(deleteBtn, deployBtn);
    card.append(name, seed, actions);

    return card;
  }

  function setSavedTracks(savedTracks) {
    const list = Array.isArray(savedTracks) ? savedTracks : [];
    if (!elements.savedTrackList) {
      return;
    }

    elements.savedTrackList.innerHTML = "";
    if (!list.length) {
      const empty = document.createElement("div");
      empty.className = "saved-track-empty";
      empty.textContent = "No saved tracks yet.";
      elements.savedTrackList.appendChild(empty);
      return;
    }

    for (let i = 0; i < list.length; i += 1) {
      elements.savedTrackList.appendChild(createSavedTrackCard(list[i]));
    }
  }

  let modalOpen = false;
  let activeModal = null;
  let modalResolver = null;
  let previousFocused = null;

  function hasModalElements(modalConfig, keys) {
    for (let i = 0; i < keys.length; i += 1) {
      if (!modalConfig[keys[i]]) {
        return false;
      }
    }
    return true;
  }

  function clearDanglingModalState() {
    if (!modalOpen) {
      return;
    }

    const confirmVisible = modal.root && !modal.root.hidden;
    const trackVisible = trackModal.root && !trackModal.root.hidden;
    const carVisible = carModal.root && !carModal.root.hidden;
    const racerVisible = racerModal.root && !racerModal.root.hidden;
    const settingsVisible = settingsModal.root && !settingsModal.root.hidden;

    if (!confirmVisible && !trackVisible && !carVisible && !racerVisible && !settingsVisible) {
      modalOpen = false;
      activeModal = null;
      modalResolver = null;
    }
  }

  function activeDialog() {
    if (activeModal === "confirm") {
      return modal.dialog;
    }
    if (activeModal === "track") {
      return trackModal.dialog;
    }
    if (activeModal === "car") {
      return carModal.dialog;
    }
    if (activeModal === "racer") {
      return racerModal.dialog;
    }
    if (activeModal === "settings") {
      return settingsModal.dialog;
    }
    return null;
  }

  function closeModal(result) {
    if (!modalOpen) {
      return;
    }

    if (activeModal === "confirm") {
      modal.root.hidden = true;
    } else if (activeModal === "track") {
      trackModal.root.hidden = true;
    } else if (activeModal === "car") {
      carModal.root.hidden = true;
    } else if (activeModal === "racer") {
      racerModal.root.hidden = true;
    } else if (activeModal === "settings") {
      settingsModal.root.hidden = true;
      if (settingsModal.helpPop) {
        settingsModal.helpPop.hidden = true;
      }
    }

    modalOpen = false;
    activeModal = null;

    const resolver = modalResolver;
    modalResolver = null;

    if (previousFocused && typeof previousFocused.focus === "function") {
      previousFocused.focus();
    }

    if (resolver) {
      resolver(result);
    }
  }

  function handleModalKeyboard(event) {
    if (!modalOpen) {
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      closeModal(false);
      return;
    }

    if (event.key === "Tab") {
      const dialog = activeDialog();
      if (!dialog) {
        return;
      }

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
    }
  }

  document.addEventListener("keydown", handleModalKeyboard);

  function confirmAction({ title, message, confirmText, confirmClass = "danger" }) {
    clearDanglingModalState();

    if (!hasModalElements(modal, ["root", "dialog", "title", "message", "cancelBtn", "confirmBtn"])) {
      return Promise.resolve(window.confirm(`${title}\n\n${message}`));
    }

    if (modalOpen) {
      return Promise.resolve(false);
    }

    modalOpen = true;
    activeModal = "confirm";
    previousFocused = document.activeElement;

    modal.title.textContent = title;
    modal.message.textContent = message;
    modal.confirmBtn.textContent = confirmText;
    modal.confirmBtn.classList.toggle("danger", confirmClass === "danger");
    modal.confirmBtn.classList.toggle("primary", confirmClass === "primary");

    modal.root.hidden = false;

    return new Promise((resolve) => {
      modalResolver = resolve;
      requestAnimationFrame(() => {
        modal.cancelBtn.focus();
      });
    });
  }

  modal.cancelBtn?.addEventListener("click", () => closeModal(false));
  modal.confirmBtn?.addEventListener("click", () => closeModal(true));
  modal.backdrop?.addEventListener("click", () => closeModal(false));

  function buildTrackPresetButton(preset, selectedSeedValue) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "track-preset-btn";
    button.textContent = preset.name;
    button.dataset.seed = String(preset.seed);
    button.dataset.presetName = String(preset.name);

    if (String(preset.seed) === String(selectedSeedValue)) {
      button.classList.add("active");
    }
    return button;
  }

  function openTrackPicker(presets, currentSeedValue) {
    clearDanglingModalState();

    if (
      !hasModalElements(trackModal, [
        "root",
        "dialog",
        "presetGrid",
        "drawBtn",
        "seedInput",
        "applyBtn",
        "randomBtn"
      ])
    ) {
      const fallbackInput = window.prompt(
        "Enter a track seed. Leave blank for random. Type DRAW to draw a track.",
        String(currentSeedValue ?? "")
      );
      if (fallbackInput === null) {
        return Promise.resolve(null);
      }
      const trimmed = fallbackInput.trim();
      if (!trimmed) {
        return Promise.resolve({ action: "random" });
      }
      if (trimmed.toUpperCase() === "DRAW") {
        return Promise.resolve({ action: "drawShape" });
      }
      return Promise.resolve({
        action: "applySeed",
        seed: trimmed,
        presetName: null
      });
    }

    if (modalOpen) {
      if (activeModal === "track") {
        return Promise.resolve(null);
      }
      closeModal(false);
    }

    const safePresets = Array.isArray(presets) ? presets : [];
    trackModal.seedInput.value = String(currentSeedValue ?? "");
    trackModal.presetGrid.innerHTML = "";

    for (let i = 0; i < safePresets.length; i += 1) {
      const preset = safePresets[i];
      const button = buildTrackPresetButton(preset, trackModal.seedInput.value);
      button.addEventListener("click", () => {
        trackModal.seedInput.value = String(preset.seed);
        const presetButtons = trackModal.presetGrid.querySelectorAll(".track-preset-btn");
        for (let idx = 0; idx < presetButtons.length; idx += 1) {
          presetButtons[idx].classList.toggle("active", presetButtons[idx] === button);
        }
      });
      trackModal.presetGrid.appendChild(button);
    }

    modalOpen = true;
    activeModal = "track";
    previousFocused = document.activeElement;
    trackModal.root.hidden = false;

    return new Promise((resolve) => {
      modalResolver = resolve;
      requestAnimationFrame(() => {
        const firstPreset = trackModal.presetGrid.querySelector(".track-preset-btn");
        (firstPreset || trackModal.seedInput || trackModal.closeBtn).focus();
      });
    });
  }

  trackModal.applyBtn?.addEventListener("click", () => {
    const presetButton = trackModal.presetGrid?.querySelector(".track-preset-btn.active");
    closeModal({
      action: "applySeed",
      seed: trackModal.seedInput?.value || "",
      presetName: presetButton?.dataset?.presetName || null
    });
  });
  trackModal.randomBtn?.addEventListener("click", () => {
    closeModal({ action: "random" });
  });
  trackModal.drawBtn?.addEventListener("click", () => {
    closeModal({ action: "drawShape" });
  });
  trackModal.saveBtn?.addEventListener("click", () => {
    const presetButton = trackModal.presetGrid?.querySelector(".track-preset-btn.active");
    closeModal({
      action: "saveTrack",
      seed: trackModal.seedInput?.value || "",
      presetName: presetButton?.dataset?.presetName || null
    });
  });
  trackModal.closeBtn?.addEventListener("click", () => closeModal(null));
  trackModal.backdrop?.addEventListener("click", () => closeModal(null));
  trackModal.seedInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      closeModal({
        action: "applySeed",
        seed: trackModal.seedInput?.value || "",
        presetName: null
      });
    }
  });
  trackModal.seedInput?.addEventListener("input", () => {
    const presetButtons = trackModal.presetGrid?.querySelectorAll(".track-preset-btn");
    if (!presetButtons) {
      return;
    }

    for (let i = 0; i < presetButtons.length; i += 1) {
      const button = presetButtons[i];
      button.classList.toggle("active", button.dataset.seed === trackModal.seedInput.value);
    }
  });

  function buildCarOptionButton(car, currentCarId) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "car-option-btn";
    if (car.id === currentCarId) {
      button.classList.add("active");
    }
    button.dataset.carId = car.id;

    const preview = document.createElement("span");
    preview.className = "car-preview";
    preview.style.setProperty("--car-primary", car.primary);
    preview.style.setProperty("--car-secondary", car.secondary);
    preview.style.setProperty("--car-accent", car.accent);

    const label = document.createElement("span");
    label.className = "car-option-label";
    label.textContent = car.alias;

    button.append(preview, label);
    return button;
  }

  function openCarPicker(cars, currentCarId) {
    clearDanglingModalState();

    if (!hasModalElements(carModal, ["root", "dialog", "optionGrid", "closeBtn"])) {
      const choices = Array.isArray(cars) ? cars : [];
      if (!choices.length) {
        return Promise.resolve(null);
      }

      const currentIndex = Math.max(
        0,
        choices.findIndex((car) => car.id === currentCarId)
      );
      const promptText = choices.map((car, index) => `${index + 1}. ${car.alias}`).join("\n");
      const answer = window.prompt(`Pick car number:\n${promptText}`, String(currentIndex + 1));
      if (answer === null) {
        return Promise.resolve(null);
      }

      const index = Math.floor(Number(answer)) - 1;
      if (!Number.isFinite(index) || index < 0 || index >= choices.length) {
        return Promise.resolve(null);
      }
      return Promise.resolve(choices[index].id);
    }

    if (modalOpen) {
      if (activeModal === "car") {
        return Promise.resolve(null);
      }
      closeModal(false);
    }

    carModal.optionGrid.innerHTML = "";
    const choices = Array.isArray(cars) ? cars : [];
    for (let i = 0; i < choices.length; i += 1) {
      const button = buildCarOptionButton(choices[i], currentCarId);
      button.addEventListener("click", () => closeModal(button.dataset.carId));
      carModal.optionGrid.appendChild(button);
    }

    modalOpen = true;
    activeModal = "car";
    previousFocused = document.activeElement;
    carModal.root.hidden = false;

    return new Promise((resolve) => {
      modalResolver = resolve;
      requestAnimationFrame(() => {
        const firstChoice = carModal.optionGrid.querySelector("button");
        (firstChoice || carModal.closeBtn).focus();
      });
    });
  }

  carModal.closeBtn?.addEventListener("click", () => closeModal(null));
  carModal.backdrop?.addEventListener("click", () => closeModal(null));

  function openRacerModal({
    title,
    message,
    submitText,
    nameValue = "",
    showCarSelect = false,
    cars = [],
    selectedCarId = ""
  }) {
    clearDanglingModalState();

    if (
      !hasModalElements(racerModal, [
        "root",
        "dialog",
        "title",
        "message",
        "nameInput",
        "carField",
        "carSelect",
        "cancelBtn",
        "saveBtn"
      ])
    ) {
      const fallbackName = window.prompt(message || title || "Racer name");
      if (fallbackName === null) {
        return Promise.resolve(null);
      }
      return Promise.resolve({
        name: String(fallbackName).trim(),
        carId: selectedCarId || null
      });
    }

    if (modalOpen) {
      if (activeModal === "racer") {
        return Promise.resolve(null);
      }
      closeModal(false);
    }

    racerModal.title.textContent = title;
    racerModal.message.textContent = message;
    racerModal.saveBtn.textContent = submitText;
    racerModal.nameInput.value = nameValue || "";

    if (showCarSelect) {
      racerModal.carField.hidden = false;
      racerModal.carSelect.innerHTML = "";
      for (let i = 0; i < cars.length; i += 1) {
        const option = document.createElement("option");
        option.value = cars[i].id;
        option.textContent = cars[i].alias;
        racerModal.carSelect.appendChild(option);
      }

      if (selectedCarId) {
        racerModal.carSelect.value = selectedCarId;
      }
      if (!racerModal.carSelect.value && racerModal.carSelect.options.length) {
        racerModal.carSelect.value = racerModal.carSelect.options[0].value;
      }
    } else {
      racerModal.carField.hidden = true;
      racerModal.carSelect.innerHTML = "";
    }

    modalOpen = true;
    activeModal = "racer";
    previousFocused = document.activeElement;
    racerModal.root.hidden = false;

    return new Promise((resolve) => {
      modalResolver = resolve;
      requestAnimationFrame(() => {
        racerModal.nameInput.focus();
        racerModal.nameInput.select();
      });
    });
  }

  function submitRacerModal() {
    closeModal({
      name: racerModal.nameInput.value.trim(),
      carId: racerModal.carField.hidden ? null : racerModal.carSelect.value
    });
  }

  racerModal.cancelBtn?.addEventListener("click", () => closeModal(null));
  racerModal.saveBtn?.addEventListener("click", submitRacerModal);
  racerModal.backdrop?.addEventListener("click", () => closeModal(null));
  racerModal.dialog?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      submitRacerModal();
    }
  });

  function confirmNewRacer() {
    return confirmAction({
      title: "New racer",
      message: "Create a new racer? This will reset model weights and training history.",
      confirmText: "Create",
      confirmClass: "danger"
    });
  }

  function confirmDeleteRacer(name) {
    return confirmAction({
      title: "Delete racer",
      message: `Delete ${name || "this racer"}? This cannot be undone.`,
      confirmText: "Delete",
      confirmClass: "danger"
    });
  }

  function confirmDeleteTrack(name) {
    return confirmAction({
      title: "Delete track",
      message: `Delete ${name || "this track"}? This cannot be undone.`,
      confirmText: "Delete",
      confirmClass: "danger"
    });
  }

  function promptSaveRacerName(cars, currentCarId) {
    return openRacerModal({
      title: "Save racer",
      message: "Name this racer and choose its car color. Leave name blank to auto-generate one.",
      submitText: "Save",
      nameValue: "",
      showCarSelect: true,
      cars: Array.isArray(cars) ? cars : [],
      selectedCarId: currentCarId || ""
    });
  }

  function promptEditRacer(savedRacer, cars) {
    return openRacerModal({
      title: "Edit racer",
      message: "Update the saved racer name and/or car color.",
      submitText: "Save changes",
      nameValue: savedRacer?.name || "",
      showCarSelect: true,
      cars: Array.isArray(cars) ? cars : [],
      selectedCarId: savedRacer?.carId || ""
    });
  }

  function promptTrackName(defaultName = "") {
    return openRacerModal({
      title: "Save track",
      message: "Name this track seed.",
      submitText: "Save track",
      nameValue: defaultName,
      showCarSelect: false
    }).then((result) => {
      if (!result) {
        return null;
      }
      return result.name || "";
    });
  }

  function sanitizeSettingsInput(input) {
    const allowedPatterns = new Set(["diagonal", "grid", "dots", "solid"]);
    return {
      worldWidth: Math.round(clamp(Number(input?.worldWidth) || settings.worldWidth || 900, 480, 1600)),
      worldHeight: Math.round(clamp(Number(input?.worldHeight) || settings.worldHeight || 600, 320, 1200)),
      trackWidth: Math.round(clamp(Number(input?.trackWidth) || settings.trackWidth || 112, 80, 150)),
      trackColor: sanitizeColor(input?.trackColor, settings.trackColor || "#576f57"),
      canvasBgColor: sanitizeColor(input?.canvasBgColor, settings.canvasBgColor || "#1b2b2f"),
      canvasPattern: allowedPatterns.has(input?.canvasPattern) ? input.canvasPattern : "diagonal",
      uiTheme: input?.uiTheme === "dark" ? "dark" : "light"
    };
  }

  function fillSettingsForm(nextSettings) {
    settings = sanitizeSettingsInput(nextSettings || settings);

    settingsModal.widthInput.value = String(settings.worldWidth);
    settingsModal.heightInput.value = String(settings.worldHeight);
    settingsModal.trackWidthInput.value = String(settings.trackWidth);
    settingsModal.trackWidthOutput.textContent = String(settings.trackWidth);
    settingsModal.trackColorInput.value = settings.trackColor;
    settingsModal.canvasBgInput.value = settings.canvasBgColor;
    settingsModal.canvasPatternSelect.value = settings.canvasPattern;
    settingsModal.uiThemeSelect.value = settings.uiTheme;
    applyTheme(settings.uiTheme);
  }

  function collectSettingsForm() {
    return sanitizeSettingsInput({
      worldWidth: settingsModal.widthInput.value,
      worldHeight: settingsModal.heightInput.value,
      trackWidth: settingsModal.trackWidthInput.value,
      trackColor: settingsModal.trackColorInput.value,
      canvasBgColor: settingsModal.canvasBgInput.value,
      canvasPattern: settingsModal.canvasPatternSelect.value,
      uiTheme: settingsModal.uiThemeSelect.value
    });
  }

  function openSettingsModal(currentSettings) {
    clearDanglingModalState();

    if (
      !hasModalElements(settingsModal, [
        "root",
        "dialog",
        "widthInput",
        "heightInput",
        "trackWidthInput",
        "trackColorInput",
        "canvasBgInput",
        "canvasPatternSelect",
        "uiThemeSelect",
        "cancelBtn",
        "applyBtn"
      ])
    ) {
      window.alert("Settings UI is unavailable in this build. Reload and try again.");
      return Promise.resolve(null);
    }

    if (modalOpen) {
      if (activeModal === "settings") {
        return Promise.resolve(null);
      }
      closeModal(false);
    }

    fillSettingsForm(currentSettings || settings);
    if (settingsModal.helpPop) {
      settingsModal.helpPop.hidden = true;
    }

    modalOpen = true;
    activeModal = "settings";
    previousFocused = document.activeElement;
    settingsModal.root.hidden = false;

    return new Promise((resolve) => {
      modalResolver = resolve;
      requestAnimationFrame(() => {
        settingsModal.widthInput.focus();
        settingsModal.widthInput.select();
      });
    });
  }

  function submitSettingsModal() {
    closeModal(collectSettingsForm());
  }

  settingsModal.trackWidthInput?.addEventListener("input", () => {
    settingsModal.trackWidthOutput.textContent = String(Math.round(Number(settingsModal.trackWidthInput.value) || 0));
  });
  settingsModal.helpBtn?.addEventListener("click", () => {
    if (!settingsModal.helpPop) {
      return;
    }
    settingsModal.helpPop.hidden = !settingsModal.helpPop.hidden;
  });
  settingsModal.cancelBtn?.addEventListener("click", () => closeModal(null));
  settingsModal.applyBtn?.addEventListener("click", submitSettingsModal);
  settingsModal.backdrop?.addEventListener("click", () => closeModal(null));
  settingsModal.dialog?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      const targetTag = event.target?.tagName || "";
      if (targetTag === "SELECT" || targetTag === "TEXTAREA") {
        return;
      }
      event.preventDefault();
      submitSettingsModal();
    }
  });

  applyTheme(settings.uiTheme);

  if (elements.seedInput) {
    elements.seedInput.value = String(initialSeed);
  }

  elements.startPauseBtn?.addEventListener("click", () => handlers.onStartPause());
  elements.stepBtn?.addEventListener("click", () => handlers.onStep());
  elements.episodeResetBtn?.addEventListener("click", () => handlers.onEpisodeReset());
  elements.newTrackBtn?.addEventListener("click", () => handlers.onRequestNewTrack());
  elements.newRacerBtn?.addEventListener("click", () => handlers.onRequestNewRacer());
  elements.changeCarBtn?.addEventListener("click", () => handlers.onRequestCarPicker());
  elements.saveRacerBtn?.addEventListener("click", () => handlers.onRequestSaveRacer());
  elements.settingsBtn?.addEventListener("click", () => handlers.onRequestSettings());
  elements.shareBtn?.addEventListener("click", () => handlers.onRequestShare());
  elements.trainingSpeedSlider?.addEventListener("input", () => {
    setTrainingSpeed(elements.trainingSpeedSlider.value, true);
  });
  elements.drawTrackFinishBtn?.addEventListener("click", () => handlers.onFinishDrawTrack());
  elements.drawTrackCancelBtn?.addEventListener("click", () => handlers.onCancelDrawTrack());

  elements.resetDefaultsBtn?.addEventListener("click", () => {
    setHyperparams(DEFAULT_HYPERPARAMS, true);
  });

  elements.teamNameDisplay?.addEventListener("click", beginTeamNameEdit);
  elements.teamNameDisplay?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      beginTeamNameEdit();
    }
  });

  elements.teamNameInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      endTeamNameEdit(true);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      endTeamNameEdit(false);
    }
  });

  elements.teamNameInput?.addEventListener("blur", () => {
    if (editingTeamName) {
      endTeamNameEdit(true);
    }
  });

  buildSliderPanel();
  setTrainingSpeed(trainingSpeed, false);
  setSavedRacers([], []);
  setSavedTracks([]);
  setTeamName(teamName, false);

  return {
    setHandlers(nextHandlers) {
      Object.assign(handlers, nextHandlers);
    },
    getHyperparams,
    setHyperparams,
    setTeamName,
    getSettings() {
      return { ...settings };
    },
    setSettings(nextSettings) {
      const next = sanitizeSettingsInput(nextSettings || settings);
      fillSettingsForm(next);
    },
    getSeedInput() {
      return elements.seedInput ? elements.seedInput.value : "";
    },
    setSeedInput(value) {
      if (elements.seedInput) {
        elements.seedInput.value = String(value);
      }
    },
    getRenderOptions() {
      return {
        showSensors: elements.toggleSensors.checked,
        showTrail: elements.toggleTrail.checked
      };
    },
    setRunning,
    updateStats,
    setSavedRacers,
    setSavedTracks,
    getTrainingSpeed,
    setTrainingSpeed,
    confirmNewRacer,
    confirmDeleteRacer,
    confirmDeleteTrack,
    promptSaveRacerName,
    promptEditRacer,
    promptTrackName,
    openTrackPicker,
    openSettingsModal,
    openCarPicker,
    setDrawMode,
    applyTheme,
    isModalOpen() {
      clearDanglingModalState();
      return modalOpen;
    }
  };
}

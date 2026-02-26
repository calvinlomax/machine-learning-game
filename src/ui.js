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

export function createUI({ initialHyperparams, initialSeed }) {
  const elements = {
    startPauseBtn: document.getElementById("start-pause-btn"),
    stepBtn: document.getElementById("step-btn"),
    episodeResetBtn: document.getElementById("episode-reset-btn"),
    newTrackBtn: document.getElementById("new-track-btn"),
    newRacerBtn: document.getElementById("new-racer-btn"),
    changeCarBtn: document.getElementById("change-car-btn"),
    applySeedBtn: document.getElementById("apply-seed-btn"),
    seedInput: document.getElementById("seed-input"),
    resetDefaultsBtn: document.getElementById("reset-defaults-btn"),
    toggleSensors: document.getElementById("toggle-sensors"),
    toggleTrail: document.getElementById("toggle-trail"),
    sliderContainer: document.getElementById("training-sliders")
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

  const handlers = {
    onStartPause: () => {},
    onStep: () => {},
    onEpisodeReset: () => {},
    onRequestNewTrack: () => {},
    onRequestNewRacer: () => {},
    onRequestCarPicker: () => {},
    onApplySeed: () => {},
    onHyperparamsChange: () => {}
  };

  let hyperparams = clampHyperparams(initialHyperparams);
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

  function setRunning(isRunning) {
    elements.startPauseBtn.textContent = isRunning ? "Pause" : "Start";
    elements.startPauseBtn.classList.toggle("primary", !isRunning);
  }

  function updateStats(nextStats) {
    stats.lapCountCurrent.textContent = String(Math.max(0, Math.floor(nextStats.currentLapCount ?? 0)));
    stats.lapCountBest.textContent = String(Math.max(0, Math.floor(nextStats.bestLapCount ?? 0)));
    stats.lapWorst.textContent = formatLapTime(nextStats.worstLapTimeSec ?? 0);
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

  let modalOpen = false;
  let activeModal = null;
  let modalResolver = null;
  let previousFocused = null;

  function activeDialog() {
    if (activeModal === "confirm") {
      return modal.dialog;
    }
    if (activeModal === "car") {
      return carModal.dialog;
    }
    return null;
  }

  function closeModal(result) {
    if (!modalOpen) {
      return;
    }

    if (activeModal === "confirm") {
      modal.root.hidden = true;
    } else if (activeModal === "car") {
      carModal.root.hidden = true;
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

  modal.cancelBtn.addEventListener("click", () => closeModal(false));
  modal.confirmBtn.addEventListener("click", () => closeModal(true));
  modal.backdrop.addEventListener("click", () => closeModal(false));

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

  carModal.closeBtn.addEventListener("click", () => closeModal(null));
  carModal.backdrop.addEventListener("click", () => closeModal(null));

  function confirmNewTrack() {
    return confirmAction({
      title: "New track",
      message: "Generate a new track? This will reset the current episode.",
      confirmText: "Generate",
      confirmClass: "primary"
    });
  }

  function confirmNewRacer() {
    return confirmAction({
      title: "New racer",
      message: "Create a new racer? This will reset model weights and training history.",
      confirmText: "Create",
      confirmClass: "danger"
    });
  }

  elements.seedInput.value = String(initialSeed);

  elements.startPauseBtn.addEventListener("click", () => handlers.onStartPause());
  elements.stepBtn.addEventListener("click", () => handlers.onStep());
  elements.episodeResetBtn.addEventListener("click", () => handlers.onEpisodeReset());
  elements.newTrackBtn.addEventListener("click", () => handlers.onRequestNewTrack());
  elements.newRacerBtn.addEventListener("click", () => handlers.onRequestNewRacer());
  elements.changeCarBtn.addEventListener("click", () => handlers.onRequestCarPicker());
  elements.applySeedBtn.addEventListener("click", () => handlers.onApplySeed(elements.seedInput.value));

  elements.resetDefaultsBtn.addEventListener("click", () => {
    setHyperparams(DEFAULT_HYPERPARAMS, true);
  });

  buildSliderPanel();

  return {
    setHandlers(nextHandlers) {
      Object.assign(handlers, nextHandlers);
    },
    getHyperparams,
    setHyperparams,
    getSeedInput() {
      return elements.seedInput.value;
    },
    setSeedInput(value) {
      elements.seedInput.value = String(value);
    },
    getRenderOptions() {
      return {
        showSensors: elements.toggleSensors.checked,
        showTrail: elements.toggleTrail.checked
      };
    },
    setRunning,
    updateStats,
    confirmNewTrack,
    confirmNewRacer,
    openCarPicker,
    isModalOpen() {
      return modalOpen;
    }
  };
}

function normalizeBasePath(basePath) {
  const raw = String(basePath || "/").trim() || "/";
  const prefixed = raw.startsWith("/") ? raw : `/${raw}`;
  return prefixed.endsWith("/") ? prefixed : `${prefixed}/`;
}

function resolveBaseUrl(configuredBase) {
  const normalized = normalizeBasePath(configuredBase);
  if (normalized !== "/") {
    return normalized;
  }

  const host = String(window.location.hostname || "").toLowerCase();
  if (!host.endsWith("github.io")) {
    return "/";
  }

  const segments = String(window.location.pathname || "/")
    .split("/")
    .filter(Boolean);
  if (!segments.length) {
    return "/";
  }
  return `/${segments[0]}/`;
}

const BASE_URL = resolveBaseUrl(import.meta.env?.BASE_URL ?? "/");
const SIMULATOR_URL = "https://calvinlomax.github.io/machine-learning-game/";

function applyStoredTheme() {
  try {
    const raw = window.localStorage.getItem("ml-racer-app-settings-v1");
    const parsed = raw ? JSON.parse(raw) : null;
    const theme = parsed && parsed.uiTheme === "light" ? "light" : "dark";
    document.documentElement.dataset.theme = theme;
  } catch {
    document.documentElement.dataset.theme = "dark";
  }
}

applyStoredTheme();

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function formatNumber(value, digits = 2) {
  return Number(value).toFixed(digits);
}

const backBtn = document.getElementById("learn-back-btn");
if (backBtn instanceof HTMLAnchorElement) {
  backBtn.href = SIMULATOR_URL;
}

function setupSensorConcept() {
  const canvas = document.getElementById("sensor-canvas");
  const progressInput = document.getElementById("sensor-progress");
  const headingInput = document.getElementById("sensor-heading");
  const raysInput = document.getElementById("sensor-rays");
  const progressOut = document.getElementById("sensor-progress-out");
  const headingOut = document.getElementById("sensor-heading-out");
  const raysOut = document.getElementById("sensor-rays-out");
  const readout = document.getElementById("sensor-readout");

  if (!(canvas instanceof HTMLCanvasElement)) {
    return;
  }

  const ctx = canvas.getContext("2d");
  if (!ctx || !(progressInput instanceof HTMLInputElement) || !(headingInput instanceof HTMLInputElement)) {
    return;
  }

  const sensorState = {
    progress: Number(progressInput.value),
    headingOffsetDeg: Number(headingInput.value),
    rays: Number(raysInput?.value || 7)
  };

  function ellipseMetric(x, y, cx, cy, a, b) {
    const dx = (x - cx) / a;
    const dy = (y - cy) / b;
    return dx * dx + dy * dy;
  }

  function isOnRoad(x, y, track) {
    const inOuter = ellipseMetric(x, y, track.cx, track.cy, track.outerA, track.outerB) <= 1;
    const outInner = ellipseMetric(x, y, track.cx, track.cy, track.innerA, track.innerB) >= 1;
    return inOuter && outInner;
  }

  function getTrackGeometry() {
    const w = canvas.width;
    const h = canvas.height;
    return {
      cx: w * 0.5,
      cy: h * 0.5,
      outerA: w * 0.44,
      outerB: h * 0.38,
      innerA: w * 0.28,
      innerB: h * 0.2
    };
  }

  function getCarPose(track) {
    const t = sensorState.progress;
    const theta = t * Math.PI * 2 - Math.PI / 2;
    const centerA = (track.outerA + track.innerA) * 0.5;
    const centerB = (track.outerB + track.innerB) * 0.5;

    const x = track.cx + Math.cos(theta) * centerA;
    const y = track.cy + Math.sin(theta) * centerB;

    const dx = -Math.sin(theta) * centerA;
    const dy = Math.cos(theta) * centerB;
    const tangent = Math.atan2(dy, dx);
    const heading = tangent + (sensorState.headingOffsetDeg * Math.PI) / 180;

    return { x, y, heading };
  }

  function castRays(track, car) {
    const maxRange = 200;
    const spread = (95 * Math.PI) / 180;
    const rayCount = Math.max(3, Math.floor(sensorState.rays));
    const rays = [];

    for (let i = 0; i < rayCount; i += 1) {
      const t = rayCount === 1 ? 0.5 : i / (rayCount - 1);
      const angle = car.heading + (t - 0.5) * spread;
      let hitDist = maxRange;
      let hitX = car.x + Math.cos(angle) * maxRange;
      let hitY = car.y + Math.sin(angle) * maxRange;

      for (let dist = 0; dist <= maxRange; dist += 2) {
        const x = car.x + Math.cos(angle) * dist;
        const y = car.y + Math.sin(angle) * dist;
        const outOfCanvas = x < 0 || x > canvas.width || y < 0 || y > canvas.height;
        if (outOfCanvas || !isOnRoad(x, y, track)) {
          hitDist = dist;
          hitX = x;
          hitY = y;
          break;
        }
      }

      rays.push({
        angle,
        distance: clamp(hitDist, 0, maxRange),
        normalized: clamp(hitDist / maxRange, 0, 1),
        hitX,
        hitY
      });
    }

    return rays;
  }

  function renderSensorReadout(rays) {
    if (!(readout instanceof HTMLElement)) {
      return;
    }
    readout.innerHTML = "";

    for (let i = 0; i < rays.length; i += 1) {
      const row = document.createElement("div");
      row.className = "sensor-row";

      const label = document.createElement("span");
      label.textContent = `Ray ${i + 1}`;

      const bar = document.createElement("div");
      bar.className = "sensor-bar";
      bar.style.setProperty("--fill-gap", String(1 - rays[i].normalized));

      const value = document.createElement("span");
      value.textContent = `${Math.round(rays[i].distance)} px`;

      row.append(label, bar, value);
      readout.appendChild(row);
    }
  }

  function drawCar(ctx2d, x, y, heading) {
    ctx2d.save();
    ctx2d.translate(x, y);
    ctx2d.rotate(heading);

    ctx2d.fillStyle = "#1e1e1e";
    ctx2d.strokeStyle = "#d7dde4";
    ctx2d.lineWidth = 1.2;

    ctx2d.beginPath();
    ctx2d.moveTo(16, 0);
    ctx2d.lineTo(8, -6);
    ctx2d.lineTo(-10, -6);
    ctx2d.lineTo(-16, -3);
    ctx2d.lineTo(-16, 3);
    ctx2d.lineTo(-10, 6);
    ctx2d.lineTo(8, 6);
    ctx2d.closePath();
    ctx2d.fill();
    ctx2d.stroke();

    ctx2d.restore();
  }

  function render() {
    const track = getTrackGeometry();
    const car = getCarPose(track);
    const rays = castRays(track, car);

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = "#2f4854";
    ctx.beginPath();
    ctx.ellipse(track.cx, track.cy, track.outerA, track.outerB, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#142329";
    ctx.beginPath();
    ctx.ellipse(track.cx, track.cy, track.innerA, track.innerB, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "rgba(226, 236, 239, 0.76)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(track.cx, track.cy, track.outerA, track.outerB, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(track.cx, track.cy, track.innerA, track.innerB, 0, 0, Math.PI * 2);
    ctx.stroke();

    ctx.setLineDash([8, 6]);
    ctx.strokeStyle = "rgba(200, 218, 222, 0.42)";
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.ellipse(
      track.cx,
      track.cy,
      (track.outerA + track.innerA) * 0.5,
      (track.outerB + track.innerB) * 0.5,
      0,
      0,
      Math.PI * 2
    );
    ctx.stroke();
    ctx.setLineDash([]);

    const startAngle = 0;
    const sxOuter = track.cx + Math.cos(startAngle) * track.outerA;
    const syOuter = track.cy + Math.sin(startAngle) * track.outerB;
    const sxInner = track.cx + Math.cos(startAngle) * track.innerA;
    const syInner = track.cy + Math.sin(startAngle) * track.innerB;

    ctx.strokeStyle = "#f0f4f7";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(sxInner, syInner);
    ctx.lineTo(sxOuter, syOuter);
    ctx.stroke();

    for (let i = 0; i < rays.length; i += 1) {
      const ray = rays[i];
      const hue = 24 + ray.normalized * 120;
      ctx.strokeStyle = `hsl(${hue}deg 88% 60%)`;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(car.x, car.y);
      ctx.lineTo(ray.hitX, ray.hitY);
      ctx.stroke();
    }

    drawCar(ctx, car.x, car.y, car.heading);
    renderSensorReadout(rays);
  }

  function onInput() {
    sensorState.progress = clamp(Number(progressInput.value), 0, 1);
    sensorState.headingOffsetDeg = clamp(Number(headingInput.value), -60, 60);
    sensorState.rays = clamp(Number(raysInput?.value || 7), 3, 11);

    if (progressOut instanceof HTMLOutputElement) {
      progressOut.textContent = `${Math.round(sensorState.progress * 100)}%`;
    }
    if (headingOut instanceof HTMLOutputElement) {
      const sign = sensorState.headingOffsetDeg > 0 ? "+" : "";
      headingOut.innerHTML = `${sign}${Math.round(sensorState.headingOffsetDeg)}&deg;`;
    }
    if (raysOut instanceof HTMLOutputElement) {
      raysOut.textContent = String(sensorState.rays);
    }
    render();
  }

  progressInput.addEventListener("input", onInput);
  headingInput.addEventListener("input", onInput);
  raysInput?.addEventListener("input", onInput);
  onInput();
}

function setupEpsilonConcept() {
  const canvas = document.getElementById("epsilon-canvas");
  const epsilonInput = document.getElementById("epsilon-slider");
  const trialsInput = document.getElementById("epsilon-trials");
  const rerollBtn = document.getElementById("epsilon-reroll-btn");
  const epsilonOut = document.getElementById("epsilon-out");
  const trialsOut = document.getElementById("epsilon-trials-out");
  const exploreCountEl = document.getElementById("epsilon-explore-count");
  const exploitCountEl = document.getElementById("epsilon-exploit-count");
  const scoreEl = document.getElementById("epsilon-score");

  if (
    !(canvas instanceof HTMLCanvasElement) ||
    !(epsilonInput instanceof HTMLInputElement) ||
    !(trialsInput instanceof HTMLInputElement)
  ) {
    return;
  }

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }

  let simulation = { explore: 0, exploit: 0, score: 0, trials: 200 };

  function drawDonut(explore, exploit) {
    const total = Math.max(1, explore + exploit);
    const centerX = canvas.width * 0.3;
    const centerY = canvas.height * 0.5;
    const radius = 82;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = "rgba(14, 24, 30, 0.86)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const exploreAngle = (explore / total) * Math.PI * 2;

    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.arc(centerX, centerY, radius, -Math.PI / 2, -Math.PI / 2 + exploreAngle);
    ctx.closePath();
    ctx.fillStyle = "#f58f3d";
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.arc(centerX, centerY, radius, -Math.PI / 2 + exploreAngle, (Math.PI * 3) / 2);
    ctx.closePath();
    ctx.fillStyle = "#22a37a";
    ctx.fill();

    ctx.fillStyle = "rgba(14, 24, 30, 0.98)";
    ctx.beginPath();
    ctx.arc(centerX, centerY, 45, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#eef4f7";
    ctx.font = "600 13px 'Avenir Next', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Decision Mix", centerX, centerY + 5);

    const barX = canvas.width * 0.58;
    const barWidth = canvas.width * 0.34;
    const barHeight = 20;
    const exploreRatio = explore / total;
    const exploitRatio = exploit / total;

    ctx.fillStyle = "#f58f3d";
    ctx.fillRect(barX, 76, barWidth * exploreRatio, barHeight);
    ctx.fillStyle = "#22a37a";
    ctx.fillRect(barX, 124, barWidth * exploitRatio, barHeight);
    ctx.strokeStyle = "rgba(238, 244, 247, 0.5)";
    ctx.lineWidth = 1;
    ctx.strokeRect(barX, 76, barWidth, barHeight);
    ctx.strokeRect(barX, 124, barWidth, barHeight);

    ctx.fillStyle = "#eef4f7";
    ctx.textAlign = "left";
    ctx.font = "600 12px 'Avenir Next', sans-serif";
    ctx.fillText(`Explore: ${Math.round(exploreRatio * 100)}%`, barX, 68);
    ctx.fillText(`Exploit: ${Math.round(exploitRatio * 100)}%`, barX, 116);
  }

  function runSimulation() {
    const epsilon = clamp(Number(epsilonInput.value), 0, 1);
    const trials = clamp(Math.floor(Number(trialsInput.value) || 200), 50, 500);
    let explore = 0;
    let exploit = 0;
    let score = 0;

    for (let i = 0; i < trials; i += 1) {
      if (Math.random() < epsilon) {
        explore += 1;
        if (Math.random() < 0.34) {
          score += 1;
        }
      } else {
        exploit += 1;
        if (Math.random() < 0.78) {
          score += 1;
        }
      }
    }

    simulation = { explore, exploit, score, trials };
    if (epsilonOut instanceof HTMLOutputElement) {
      epsilonOut.textContent = formatNumber(epsilon, 2);
    }
    if (trialsOut instanceof HTMLOutputElement) {
      trialsOut.textContent = String(trials);
    }
    if (exploreCountEl) {
      exploreCountEl.textContent = String(explore);
    }
    if (exploitCountEl) {
      exploitCountEl.textContent = String(exploit);
    }
    if (scoreEl) {
      scoreEl.textContent = `${Math.round((score / trials) * 100)}%`;
    }
    drawDonut(simulation.explore, simulation.exploit);
  }

  epsilonInput.addEventListener("input", runSimulation);
  trialsInput.addEventListener("input", runSimulation);
  rerollBtn?.addEventListener("click", runSimulation);
  runSimulation();
}

function setupQConcept() {
  const canvas = document.getElementById("q-canvas");
  const oldInput = document.getElementById("q-old");
  const rewardInput = document.getElementById("q-reward");
  const nextInput = document.getElementById("q-next");
  const alphaInput = document.getElementById("q-alpha");
  const gammaInput = document.getElementById("q-gamma");
  const formulaEl = document.getElementById("q-formula");

  const oldOut = document.getElementById("q-old-out");
  const rewardOut = document.getElementById("q-reward-out");
  const nextOut = document.getElementById("q-next-out");
  const alphaOut = document.getElementById("q-alpha-out");
  const gammaOut = document.getElementById("q-gamma-out");

  if (
    !(canvas instanceof HTMLCanvasElement) ||
    !(oldInput instanceof HTMLInputElement) ||
    !(rewardInput instanceof HTMLInputElement) ||
    !(nextInput instanceof HTMLInputElement) ||
    !(alphaInput instanceof HTMLInputElement) ||
    !(gammaInput instanceof HTMLInputElement)
  ) {
    return;
  }

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }

  function drawBar(x, value, color, label) {
    const baseY = canvas.height * 0.78;
    const scale = 45;
    const h = value * scale;
    const w = 72;

    ctx.fillStyle = color;
    if (h >= 0) {
      ctx.fillRect(x - w * 0.5, baseY - h, w, h);
    } else {
      ctx.fillRect(x - w * 0.5, baseY, w, -h);
    }

    ctx.fillStyle = "#ecf2f5";
    ctx.font = "600 12px 'Avenir Next', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(label, x, canvas.height - 14);
    ctx.fillText(formatNumber(value, 2), x, baseY - h - 8);
  }

  function render() {
    const oldQ = Number(oldInput.value);
    const reward = Number(rewardInput.value);
    const bestNext = Number(nextInput.value);
    const alpha = Number(alphaInput.value);
    const gamma = Number(gammaInput.value);

    const target = reward + gamma * bestNext;
    const newQ = oldQ + alpha * (target - oldQ);

    if (oldOut instanceof HTMLOutputElement) {
      oldOut.textContent = formatNumber(oldQ, 2);
    }
    if (rewardOut instanceof HTMLOutputElement) {
      rewardOut.textContent = formatNumber(reward, 2);
    }
    if (nextOut instanceof HTMLOutputElement) {
      nextOut.textContent = formatNumber(bestNext, 2);
    }
    if (alphaOut instanceof HTMLOutputElement) {
      alphaOut.textContent = formatNumber(alpha, 2);
    }
    if (gammaOut instanceof HTMLOutputElement) {
      gammaOut.textContent = formatNumber(gamma, 3);
    }

    if (formulaEl) {
      formulaEl.textContent =
        `Q_new = Q_old + α × (reward + γ × maxNextQ - Q_old)\n` +
        `Q_new = ${formatNumber(oldQ, 3)} + ${formatNumber(alpha, 3)} × (` +
        `${formatNumber(reward, 3)} + ${formatNumber(gamma, 3)} × ${formatNumber(bestNext, 3)} - ${formatNumber(
          oldQ,
          3
        )})\n` +
        `Q_new = ${formatNumber(newQ, 4)}`;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "rgba(14, 24, 30, 0.86)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const baseY = canvas.height * 0.78;
    ctx.strokeStyle = "rgba(236, 242, 245, 0.45)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(24, baseY);
    ctx.lineTo(canvas.width - 24, baseY);
    ctx.stroke();

    drawBar(canvas.width * 0.22, oldQ, "#4fb3ff", "Q old");
    drawBar(canvas.width * 0.5, target, "#f8c149", "Target");
    drawBar(canvas.width * 0.78, newQ, "#32c48d", "Q new");
  }

  oldInput.addEventListener("input", render);
  rewardInput.addEventListener("input", render);
  nextInput.addEventListener("input", render);
  alphaInput.addEventListener("input", render);
  gammaInput.addEventListener("input", render);
  render();
}

function setupReplayBufferConcept() {
  const canvas = document.getElementById("buffer-canvas");
  const batchInput = document.getElementById("buffer-batch");
  const batchOut = document.getElementById("buffer-batch-out");
  const addBtn = document.getElementById("buffer-add-btn");
  const sampleBtn = document.getElementById("buffer-sample-btn");
  const autoBtn = document.getElementById("buffer-auto-btn");
  const countEl = document.getElementById("buffer-count");
  const sampledEl = document.getElementById("buffer-sampled");
  const avgRewardEl = document.getElementById("buffer-avg-reward");

  if (!(canvas instanceof HTMLCanvasElement) || !(batchInput instanceof HTMLInputElement)) {
    return;
  }

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }

  const CAPACITY = 24;
  const buffer = [];
  let sampledIndices = [];

  function randomTransition() {
    return {
      reward: Number((Math.random() * 2 - 1).toFixed(2)),
      speed: Number((Math.random() * 1.2).toFixed(2))
    };
  }

  function addTransition() {
    buffer.push(randomTransition());
    if (buffer.length > CAPACITY) {
      buffer.shift();
    }
  }

  function sampleBatch() {
    const batchSize = clamp(Math.floor(Number(batchInput.value) || 6), 2, 10);
    const count = Math.min(batchSize, buffer.length);
    const chosen = new Set();

    while (chosen.size < count) {
      chosen.add(Math.floor(Math.random() * buffer.length));
    }
    sampledIndices = Array.from(chosen);
  }

  function rewardColor(reward) {
    const t = clamp((reward + 1) * 0.5, 0, 1);
    const r = Math.round(214 * (1 - t) + 51 * t);
    const g = Math.round(57 * (1 - t) + 196 * t);
    const b = Math.round(64 * (1 - t) + 129 * t);
    return `rgb(${r}, ${g}, ${b})`;
  }

  function render() {
    const batchSize = clamp(Math.floor(Number(batchInput.value) || 6), 2, 10);
    if (batchOut instanceof HTMLOutputElement) {
      batchOut.textContent = String(batchSize);
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "rgba(14, 24, 30, 0.86)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const cols = 8;
    const rows = 3;
    const gap = 8;
    const pad = 14;
    const cellW = (canvas.width - pad * 2 - gap * (cols - 1)) / cols;
    const cellH = (canvas.height - pad * 2 - gap * (rows - 1)) / rows;

    for (let i = 0; i < CAPACITY; i += 1) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = pad + col * (cellW + gap);
      const y = pad + row * (cellH + gap);
      const item = buffer[i];

      if (item) {
        ctx.fillStyle = rewardColor(item.reward);
        ctx.fillRect(x, y, cellW, cellH);
        ctx.fillStyle = "rgba(14, 24, 30, 0.88)";
        ctx.font = "600 11px 'Avenir Next', sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(`r=${item.reward.toFixed(2)}`, x + cellW * 0.5, y + cellH * 0.55);
      } else {
        ctx.fillStyle = "rgba(190, 206, 213, 0.12)";
        ctx.fillRect(x, y, cellW, cellH);
      }

      const isSampled = sampledIndices.includes(i);
      ctx.strokeStyle = isSampled ? "#ffe067" : "rgba(224, 236, 241, 0.42)";
      ctx.lineWidth = isSampled ? 3 : 1;
      ctx.strokeRect(x, y, cellW, cellH);
    }

    if (countEl) {
      countEl.textContent = `${buffer.length} / ${CAPACITY}`;
    }
    if (sampledEl) {
      sampledEl.textContent = String(sampledIndices.length);
    }
    if (avgRewardEl) {
      const avg =
        buffer.length > 0 ? buffer.reduce((sum, item) => sum + Number(item.reward || 0), 0) / buffer.length : 0;
      avgRewardEl.textContent = formatNumber(avg, 2);
    }
  }

  for (let i = 0; i < 12; i += 1) {
    addTransition();
  }
  sampleBatch();
  render();

  batchInput.addEventListener("input", () => {
    sampleBatch();
    render();
  });
  addBtn?.addEventListener("click", () => {
    addTransition();
    sampledIndices = [];
    render();
  });
  sampleBtn?.addEventListener("click", () => {
    sampleBatch();
    render();
  });
  autoBtn?.addEventListener("click", () => {
    while (buffer.length < CAPACITY) {
      addTransition();
    }
    sampleBatch();
    render();
  });
}

setupSensorConcept();
setupEpsilonConcept();
setupQConcept();
setupReplayBufferConcept();

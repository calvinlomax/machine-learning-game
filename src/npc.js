function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function wrapAngle(angle) {
  let wrapped = angle;
  while (wrapped > Math.PI) {
    wrapped -= Math.PI * 2;
  }
  while (wrapped < -Math.PI) {
    wrapped += Math.PI * 2;
  }
  return wrapped;
}

function toTrackDistance(track, progress, metersAhead = 0) {
  const total = Math.max(1, Number(track?.totalLength) || 1);
  const base = clamp(Number(progress) || 0, 0, 1) * total;
  let value = base + metersAhead;
  while (value < 0) {
    value += total;
  }
  while (value >= total) {
    value -= total;
  }
  return value;
}

function findSegmentIndexForDistance(track, distanceAlong) {
  const cumulative = track?.cumulativeLengths;
  if (!Array.isArray(cumulative) || cumulative.length < 2) {
    return 0;
  }

  for (let i = 0; i < cumulative.length - 1; i += 1) {
    if (distanceAlong >= cumulative[i] && distanceAlong <= cumulative[i + 1]) {
      return i;
    }
  }

  return cumulative.length - 2;
}

function samplePointAtDistance(track, distanceAlong) {
  const segments = track?.segments || [];
  if (!segments.length) {
    return { x: 0, y: 0 };
  }

  const segmentIndex = findSegmentIndexForDistance(track, distanceAlong);
  const segment = segments[segmentIndex];
  const startLength = track.cumulativeLengths[segmentIndex] || 0;
  const localT = clamp((distanceAlong - startLength) / (segment.length || 1), 0, 1);

  return {
    x: segment.a.x + segment.dx * localT,
    y: segment.a.y + segment.dy * localT
  };
}

function sampleTangentAtDistance(track, distanceAlong) {
  const segments = track?.segments || [];
  if (!segments.length) {
    return 0;
  }

  const segmentIndex = findSegmentIndexForDistance(track, distanceAlong);
  const segment = segments[segmentIndex];
  return Math.atan2(segment.dy, segment.dx);
}

function estimateCurvature(track, progress, lookAheadMeters) {
  const lookAhead = Math.max(10, Number(lookAheadMeters) || 10);
  const start = toTrackDistance(track, progress, lookAhead * 0.3);
  const end = toTrackDistance(track, progress, lookAhead * 1.1);
  const angleA = sampleTangentAtDistance(track, start);
  const angleB = sampleTangentAtDistance(track, end);
  const delta = Math.abs(wrapAngle(angleB - angleA));
  return clamp(delta / Math.PI, 0, 1);
}

function actionIndexFromDiscrete(steer, throttle) {
  const steerOffset = steer < 0 ? 0 : steer > 0 ? 2 : 1;
  const throttleBase = throttle > 0 ? 0 : throttle < 0 ? 6 : 3;
  return throttleBase + steerOffset;
}

function buildSkill(level) {
  const normalized = clamp((Number(level) - 1) / 4, 0, 1);

  return {
    lookAheadMeters: 44 + normalized * 100,
    headingGain: 2.1 + normalized * 1.6,
    lateralGain: 1.0 + normalized * 1.1,
    steeringDeadband: 0.2 - normalized * 0.08,
    steeringNoise: 0.5 - normalized * 0.44,
    throttleNoise: 0.6 - normalized * 0.5,
    throttleDeadband: 0.16 - normalized * 0.07,
    baseSpeed: 210 + normalized * 230,
    minSpeed: 75 + normalized * 115,
    maxSpeed: 265 + normalized * 230,
    cornerPenalty: 175 - normalized * 75,
    speedResponse: 90 - normalized * 40,
    mistakeRate: 0.14 - normalized * 0.12,
    holdStepsMax: Math.round(4 - normalized * 3)
  };
}

export const NPC_PROFILES = Object.freeze([
  {
    id: "npc-cadet",
    name: "Rook Velo",
    level: 1,
    tier: "Cadet",
    carStyle: { primary: "#3c6ea8", secondary: "#0f1e2e", accent: "#b8d8ff" }
  },
  {
    id: "npc-club",
    name: "Pico Drift",
    level: 2,
    tier: "Club",
    carStyle: { primary: "#6d7f1b", secondary: "#1f2a0a", accent: "#e8f18e" }
  },
  {
    id: "npc-pro",
    name: "Nova Kline",
    level: 3,
    tier: "Pro",
    carStyle: { primary: "#c14a29", secondary: "#35120a", accent: "#ffd4b5" }
  },
  {
    id: "npc-elite",
    name: "Astra Quell",
    level: 4,
    tier: "Elite",
    carStyle: { primary: "#7d3cb8", secondary: "#250d38", accent: "#dcc0ff" }
  },
  {
    id: "npc-legend",
    name: "Vortex Prime",
    level: 5,
    tier: "Legend",
    carStyle: { primary: "#00a99b", secondary: "#062a28", accent: "#b9fff9" }
  }
]);

export class NpcController {
  constructor(profile, rng) {
    this.profile = profile;
    this.rng = rng;
    this.skill = buildSkill(profile?.level || 1);
    this.lastAction = 4;
    this.holdSteps = 0;
  }

  randomSigned() {
    return this.rng.next() * 2 - 1;
  }

  decide(participant, track) {
    if (!participant || !participant.env || !track) {
      return 4;
    }

    if (this.holdSteps > 0) {
      this.holdSteps -= 1;
      return this.lastAction;
    }

    const env = participant.env;
    const renderState = participant.renderState || env.getRenderState();
    const car = renderState.car || env.car;
    const projection = env.prevProjection || {
      progress: 0,
      signedDistance: 0,
      tangentAngle: car.heading
    };

    const lookAhead = this.skill.lookAheadMeters + car.speed * 0.08;
    const targetDistance = toTrackDistance(track, projection.progress, lookAhead);
    const targetPoint = samplePointAtDistance(track, targetDistance);
    const targetHeading = Math.atan2(targetPoint.y - car.y, targetPoint.x - car.x);

    const lateralNorm = clamp(projection.signedDistance / (track.width * 0.5 || 1), -1, 1);
    const headingError = wrapAngle(targetHeading - car.heading);
    const steerSignal =
      headingError * this.skill.headingGain -
      lateralNorm * this.skill.lateralGain +
      this.randomSigned() * this.skill.steeringNoise;

    let steer = 0;
    if (steerSignal > this.skill.steeringDeadband) {
      steer = 1;
    } else if (steerSignal < -this.skill.steeringDeadband) {
      steer = -1;
    }

    const curvature = estimateCurvature(track, projection.progress, lookAhead);
    let targetSpeed = this.skill.baseSpeed - curvature * this.skill.cornerPenalty;
    if (Math.abs(lateralNorm) > 0.82) {
      targetSpeed *= 0.72;
    }
    targetSpeed = clamp(targetSpeed, this.skill.minSpeed, this.skill.maxSpeed);

    const throttleSignal =
      (targetSpeed - car.speed) / Math.max(20, this.skill.speedResponse) +
      this.randomSigned() * this.skill.throttleNoise;

    let throttle = 0;
    if (throttleSignal > this.skill.throttleDeadband) {
      throttle = 1;
    } else if (throttleSignal < -this.skill.throttleDeadband) {
      throttle = -1;
    }

    if (this.rng.next() < this.skill.mistakeRate) {
      if (this.rng.next() < 0.6) {
        steer = 0;
      }
      if (this.rng.next() < 0.5) {
        throttle = 0;
      }
    }

    const sharpRecovery = Math.abs(headingError) > 0.95 || Math.abs(lateralNorm) > 0.9;
    this.holdSteps = sharpRecovery ? 0 : this.rng.int(0, this.skill.holdStepsMax);
    this.lastAction = actionIndexFromDiscrete(steer, throttle);
    return this.lastAction;
  }
}

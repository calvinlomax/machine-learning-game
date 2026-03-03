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
  const safeLevel = Math.max(1, Math.min(5, Math.floor(Number(level) || 1)));
  if (safeLevel <= 1) {
    return {
      lookAheadMeters: 36,
      headingGain: 1.8,
      lateralGain: 1.0,
      steeringDeadband: 0.24,
      steeringNoise: 0.72,
      throttleNoise: 0.64,
      throttleDeadband: 0.2,
      baseSpeed: 250,
      minSpeed: 90,
      maxSpeed: 290,
      cornerPenalty: 220,
      speedResponse: 85,
      mistakeRate: 0.22,
      holdStepsMax: 5
    };
  }

  const normalized = clamp((safeLevel - 2) / 3, 0, 1);

  return {
    lookAheadMeters: 72 + normalized * 92,
    headingGain: 3.0 + normalized * 1.4,
    lateralGain: 2.1 + normalized * 0.9,
    steeringDeadband: 0.085 - normalized * 0.025,
    steeringNoise: 0.075 - normalized * 0.045,
    throttleNoise: 0.06 - normalized * 0.035,
    throttleDeadband: 0.08 - normalized * 0.03,
    baseSpeed: 180 + normalized * 130,
    minSpeed: 95 + normalized * 45,
    maxSpeed: 245 + normalized * 145,
    cornerPenalty: 195 - normalized * 55,
    speedResponse: 66 - normalized * 16,
    mistakeRate: 0.015 - normalized * 0.012,
    holdStepsMax: 1
  };
}

export const NPC_PROFILES = Object.freeze([
  {
    id: "npc-cadet",
    name: "Rook Velo",
    level: 1,
    tier: "Cadet",
    carStyle: { primary: "#8A4B2E", secondary: "#25130D", accent: "#F2C69A" }
  },
  {
    id: "npc-club",
    name: "Pico Drift",
    level: 2,
    tier: "Club",
    carStyle: { primary: "#2A8B78", secondary: "#0B2D27", accent: "#9DE7D9" }
  },
  {
    id: "npc-pro",
    name: "Nova Kline",
    level: 3,
    tier: "Pro",
    carStyle: { primary: "#B34C87", secondary: "#2F1226", accent: "#F5BEE0" }
  },
  {
    id: "npc-elite",
    name: "Astra Quell",
    level: 4,
    tier: "Elite",
    carStyle: { primary: "#6C8E2A", secondary: "#1E2A0D", accent: "#DFF0A8" }
  },
  {
    id: "npc-legend",
    name: "Vortex Prime",
    level: 5,
    tier: "Legend",
    carStyle: { primary: "#C17C1A", secondary: "#2D1A07", accent: "#F6DCA6" }
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

    const level = Math.max(1, Math.floor(Number(this.profile?.level) || 1));

    if (this.holdSteps > 0 && level <= 1) {
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

    const rawLookAhead = this.skill.lookAheadMeters + car.speed * 0.05;
    const lookAhead = clamp(rawLookAhead, 32, 220);
    const curvature = estimateCurvature(track, projection.progress, lookAhead);
    const targetDistance = toTrackDistance(track, projection.progress, lookAhead);
    const targetPoint = samplePointAtDistance(track, targetDistance);
    const targetHeading = Math.atan2(targetPoint.y - car.y, targetPoint.x - car.x);

    const obs = participant.observation || env.currentObservation || [];
    const frontDistNorm = Number(obs[9]);

    const lateralNorm = clamp(projection.signedDistance / (track.width * 0.5 || 1), -1, 1);
    const headingError = wrapAngle(targetHeading - car.heading);
    const tangentError = wrapAngle(projection.tangentAngle - car.heading);
    const steerSignal =
      headingError * this.skill.headingGain * 0.68 +
      tangentError * this.skill.headingGain * 0.42 -
      lateralNorm * this.skill.lateralGain +
      this.randomSigned() * this.skill.steeringNoise;

    let steer = 0;
    if (steerSignal > this.skill.steeringDeadband) {
      steer = 1;
    } else if (steerSignal < -this.skill.steeringDeadband) {
      steer = -1;
    }

    let targetSpeed = this.skill.baseSpeed - curvature * this.skill.cornerPenalty - Math.abs(lateralNorm) * 68;
    if (Math.abs(headingError) > 0.72) {
      targetSpeed *= 0.66;
    }
    if (Math.abs(headingError) > 1.08) {
      targetSpeed *= 0.48;
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

    const frontBlocked = Number.isFinite(frontDistNorm) && frontDistNorm < 0.24;
    const frontCritical = Number.isFinite(frontDistNorm) && frontDistNorm < 0.12;
    if (frontBlocked || Math.abs(lateralNorm) > 0.93) {
      throttle = -1;
    }
    if (frontCritical || Math.abs(headingError) > 1.2) {
      throttle = -1;
      steer = lateralNorm >= 0 ? -1 : 1;
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
    this.holdSteps = level <= 1 && !sharpRecovery ? this.rng.int(0, this.skill.holdStepsMax) : 0;
    this.lastAction = actionIndexFromDiscrete(steer, throttle);
    return this.lastAction;
  }
}

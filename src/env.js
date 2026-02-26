import { ACTIONS, CAR_CONFIG, createCarState, stepCar } from "./physics.js";
import { projectToCenterline, wrappedProgressDelta } from "./trackgen.js";

const DEFAULT_SENSOR_ANGLES = [-0.95, -0.6, -0.3, 0, 0.3, 0.6, 0.95];
const DEFAULT_MAX_SENSOR_DISTANCE = 360;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeAngle(angle) {
  let wrapped = angle;
  while (wrapped > Math.PI) {
    wrapped -= Math.PI * 2;
  }
  while (wrapped < -Math.PI) {
    wrapped += Math.PI * 2;
  }
  return wrapped;
}

function cross(ax, ay, bx, by) {
  return ax * by - ay * bx;
}

function raySegmentDistance(ox, oy, dirX, dirY, x1, y1, x2, y2) {
  const segX = x2 - x1;
  const segY = y2 - y1;
  const denom = cross(dirX, dirY, segX, segY);

  if (Math.abs(denom) < 1e-9) {
    return null;
  }

  const qx = x1 - ox;
  const qy = y1 - oy;
  const t = cross(qx, qy, segX, segY) / denom;
  const u = cross(qx, qy, dirX, dirY) / denom;

  if (t >= 0 && u >= 0 && u <= 1) {
    return t;
  }

  return null;
}

export class RacingEnv {
  constructor({
    track,
    rng,
    dt = 1 / 30,
    maxEpisodeSteps = 1200,
    actionSmoothing = 0.4,
    rewardWeights,
    sensorAngles = DEFAULT_SENSOR_ANGLES,
    maxSensorDistance = DEFAULT_MAX_SENSOR_DISTANCE
  }) {
    this.track = track;
    this.rng = rng;
    this.dt = dt;
    this.maxEpisodeSteps = maxEpisodeSteps;
    this.actionSmoothing = clamp(actionSmoothing, 0, 0.9);

    this.rewardWeights = {
      progressWeight: rewardWeights?.progressWeight ?? 1.8,
      offTrackPenalty: rewardWeights?.offTrackPenalty ?? -5,
      speedPenaltyWeight: rewardWeights?.speedPenaltyWeight ?? 0.5
    };

    this.sensorAngles = sensorAngles;
    this.maxSensorDistance = maxSensorDistance;

    this.car = createCarState(0, 0, 0, 0);
    this.trajectory = [];
    this.lastSensorHits = [];

    this.stepCount = 0;
    this.lastReward = 0;
    this.lastProgressDelta = 0;
    this.episodeReturn = 0;
    this.done = false;
    this.prevProjection = null;
    this.currentObservation = new Float32Array(0);

    this.clearLapHistory({ resetBestLapCount: true });
    this.resetEpisode(true);
  }

  setTrack(track) {
    this.track = track;
    this.clearLapHistory();
    return this.resetEpisode(true);
  }

  clearLapHistory(options = {}) {
    const resetBestLapCount = Boolean(options.resetBestLapCount);
    this.bestLapTimeSec = null;
    this.worstLapTimeSec = null;
    this.lastLapTimeSec = null;
    this.currentLapCount = 0;
    if (resetBestLapCount) {
      this.bestLapCount = 0;
    }
  }

  setLapHistory(records = {}) {
    const bestLapTimeSec = Number(records.bestLapTimeSec);
    const worstLapTimeSec = Number(records.worstLapTimeSec);
    const bestLapCount = Number(records.bestLapCount);

    this.bestLapTimeSec = Number.isFinite(bestLapTimeSec) && bestLapTimeSec > 0 ? bestLapTimeSec : null;
    this.worstLapTimeSec =
      Number.isFinite(worstLapTimeSec) && worstLapTimeSec > 0 ? worstLapTimeSec : null;
    this.bestLapCount = Number.isFinite(bestLapCount) ? Math.max(0, Math.floor(bestLapCount)) : 0;
  }

  updateConfig({ maxEpisodeSteps, actionSmoothing, rewardWeights }) {
    if (typeof maxEpisodeSteps === "number") {
      this.maxEpisodeSteps = Math.max(50, Math.floor(maxEpisodeSteps));
    }

    if (typeof actionSmoothing === "number") {
      this.actionSmoothing = clamp(actionSmoothing, 0, 0.9);
    }

    if (rewardWeights) {
      if (typeof rewardWeights.progressWeight === "number") {
        this.rewardWeights.progressWeight = rewardWeights.progressWeight;
      }
      if (typeof rewardWeights.offTrackPenalty === "number") {
        this.rewardWeights.offTrackPenalty = rewardWeights.offTrackPenalty;
      }
      if (typeof rewardWeights.speedPenaltyWeight === "number") {
        this.rewardWeights.speedPenaltyWeight = rewardWeights.speedPenaltyWeight;
      }
    }
  }

  randomRange(min, max) {
    if (this.rng && typeof this.rng.range === "function") {
      return this.rng.range(min, max);
    }
    return min + (max - min) * Math.random();
  }

  getSpawnPose() {
    const idx = this.track.startIndex;
    const p1 = this.track.centerline[idx];
    const p2 = this.track.centerline[(idx + 1) % this.track.centerline.length];
    const heading = Math.atan2(p2.y - p1.y, p2.x - p1.x);

    return {
      x: p1.x,
      y: p1.y,
      heading,
      speed: 48
    };
  }

  resetEpisode(withNoise = true) {
    const spawn = this.getSpawnPose();
    const headingJitter = withNoise ? this.randomRange(-0.08, 0.08) : 0;
    const speedJitter = withNoise ? this.randomRange(-10, 10) : 0;

    this.car = createCarState(
      spawn.x,
      spawn.y,
      spawn.heading + headingJitter,
      Math.max(0, spawn.speed + speedJitter)
    );

    this.stepCount = 0;
    this.lastReward = 0;
    this.lastProgressDelta = 0;
    this.episodeReturn = 0;
    this.done = false;
    this.lapProgress = 0;
    this.lapElapsedSec = 0;
    this.currentLapCount = 0;

    this.trajectory = [{ x: this.car.x, y: this.car.y }];

    this.prevProjection = projectToCenterline(this.track, this.car);
    this.currentObservation = this.computeObservation(this.prevProjection);
    this.observationSize = this.currentObservation.length;

    return this.currentObservation;
  }

  castRay(angle) {
    const originX = this.car.x;
    const originY = this.car.y;
    const dirX = Math.cos(angle);
    const dirY = Math.sin(angle);

    let minDistance = this.maxSensorDistance;
    let hitX = originX + dirX * minDistance;
    let hitY = originY + dirY * minDistance;

    for (let i = 0; i < this.track.boundarySegments.length; i += 1) {
      const segment = this.track.boundarySegments[i];
      const distance = raySegmentDistance(
        originX,
        originY,
        dirX,
        dirY,
        segment.a.x,
        segment.a.y,
        segment.b.x,
        segment.b.y
      );

      if (distance !== null && distance < minDistance) {
        minDistance = distance;
        hitX = originX + dirX * minDistance;
        hitY = originY + dirY * minDistance;
      }
    }

    return {
      distance: minDistance,
      hit: { x: hitX, y: hitY }
    };
  }

  computeObservation(projection) {
    const sensorValues = new Float32Array(this.sensorAngles.length);
    const sensorHits = [];

    for (let i = 0; i < this.sensorAngles.length; i += 1) {
      const angle = this.car.heading + this.sensorAngles[i];
      const ray = this.castRay(angle);
      const normalizedDistance = clamp(ray.distance / this.maxSensorDistance, 0, 1);
      sensorValues[i] = normalizedDistance;
      sensorHits.push({
        x: ray.hit.x,
        y: ray.hit.y,
        distance: ray.distance,
        normalizedDistance,
        angle
      });
    }

    this.lastSensorHits = sensorHits;

    const speedNorm = clamp(this.car.speed / CAR_CONFIG.maxSpeed, 0, 1);
    const headingError = normalizeAngle(this.car.heading - projection.tangentAngle);
    const lateral = clamp(projection.signedDistance / (this.track.width * 0.5), -1, 1);

    const observation = new Float32Array(6 + sensorValues.length);
    observation[0] = speedNorm;
    observation[1] = Math.cos(headingError);
    observation[2] = Math.sin(headingError);
    observation[3] = lateral;
    observation[4] = this.car.steer;
    observation[5] = this.lastProgressDelta * 25;

    for (let i = 0; i < sensorValues.length; i += 1) {
      observation[6 + i] = sensorValues[i];
    }

    return observation;
  }

  step(actionIndex) {
    if (this.done) {
      return {
        observation: this.currentObservation,
        reward: 0,
        done: true,
        info: {
          offTrack: false,
          maxStepsReached: false,
          progress: this.prevProjection?.progress || 0,
          step: this.stepCount,
          episodeReturn: this.episodeReturn
        }
      };
    }

    const safeIndex = Number.isFinite(actionIndex) ? Math.floor(actionIndex) : 4;
    const normalizedIndex = ((safeIndex % ACTIONS.length) + ACTIONS.length) % ACTIONS.length;
    const action = ACTIONS[normalizedIndex];

    stepCar(this.car, action, this.dt, this.actionSmoothing, CAR_CONFIG);

    this.stepCount += 1;
    this.trajectory.push({ x: this.car.x, y: this.car.y });
    if (this.trajectory.length > 900) {
      this.trajectory.shift();
    }

    const projection = projectToCenterline(this.track, this.car);
    let progressDelta = wrappedProgressDelta(this.prevProjection.progress, projection.progress);
    progressDelta = clamp(progressDelta, -0.04, 0.04);
    this.lastProgressDelta = progressDelta;
    this.lapElapsedSec += this.dt;

    let nextLapProgress = Math.max(0, this.lapProgress + progressDelta);
    while (nextLapProgress >= 1) {
      nextLapProgress -= 1;
      this.lastLapTimeSec = this.lapElapsedSec;
      if (this.bestLapTimeSec === null || this.lapElapsedSec < this.bestLapTimeSec) {
        this.bestLapTimeSec = this.lapElapsedSec;
      }
      if (this.worstLapTimeSec === null || this.lapElapsedSec > this.worstLapTimeSec) {
        this.worstLapTimeSec = this.lapElapsedSec;
      }
      this.currentLapCount += 1;
      if (this.currentLapCount > this.bestLapCount) {
        this.bestLapCount = this.currentLapCount;
      }
      this.lapElapsedSec = 0;
    }
    this.lapProgress = nextLapProgress;

    const speedNorm = clamp(this.car.speed / CAR_CONFIG.maxSpeed, 0, 1);
    const progressReward = this.rewardWeights.progressWeight * progressDelta * 120;
    const speedPenalty = this.rewardWeights.speedPenaltyWeight * (1 - speedNorm) * 0.04;
    const steeringPenalty = Math.abs(this.car.steer) * 0.0025;

    let reward = progressReward - speedPenalty - steeringPenalty;

    const offTrack = projection.distance > this.track.width * 0.5;
    if (offTrack) {
      reward += this.rewardWeights.offTrackPenalty;
    }

    const maxStepsReached = this.stepCount >= this.maxEpisodeSteps;
    const done = offTrack || maxStepsReached;

    this.done = done;
    this.lastReward = reward;
    this.episodeReturn += reward;
    this.prevProjection = projection;

    this.currentObservation = this.computeObservation(projection);

    return {
      observation: this.currentObservation,
      reward,
      done,
      info: {
        offTrack,
        maxStepsReached,
        progress: projection.progress,
        step: this.stepCount,
        episodeReturn: this.episodeReturn
      }
    };
  }

  getRenderState() {
    return {
      track: this.track,
      car: this.car,
      trail: this.trajectory,
      sensorHits: this.lastSensorHits,
      progress: this.prevProjection?.progress || 0,
      lapProgress: this.lapProgress || 0,
      thisLapTimeSec: this.lapElapsedSec || 0,
      bestLapTimeSec: this.bestLapTimeSec,
      worstLapTimeSec: this.worstLapTimeSec,
      currentLapCount: this.currentLapCount || 0,
      bestLapCount: this.bestLapCount || 0
    };
  }
}

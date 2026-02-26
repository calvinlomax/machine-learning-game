export const ACTIONS = [
  { steer: -1, throttle: 1, label: "left + accel" },
  { steer: 0, throttle: 1, label: "straight + accel" },
  { steer: 1, throttle: 1, label: "right + accel" },
  { steer: -1, throttle: 0, label: "left + coast" },
  { steer: 0, throttle: 0, label: "straight + coast" },
  { steer: 1, throttle: 0, label: "right + coast" },
  { steer: -1, throttle: -1, label: "left + brake" },
  { steer: 0, throttle: -1, label: "straight + brake" },
  { steer: 1, throttle: -1, label: "right + brake" }
];

export const CAR_CONFIG = {
  maxSpeed: 340,
  accel: 300,
  brake: 360,
  drag: 1.1,
  turnRate: 3.1
};

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

export function createCarState(x, y, heading, speed = 0) {
  return {
    x,
    y,
    heading,
    speed,
    steer: 0,
    angularVelocity: 0
  };
}

export function stepCar(state, action, dt, actionSmoothing, config = CAR_CONFIG) {
  const smoothing = clamp(actionSmoothing, 0, 0.9);
  const chosenAction = action || ACTIONS[4];

  state.steer = state.steer * smoothing + chosenAction.steer * (1 - smoothing);

  let acceleration = 0;
  if (chosenAction.throttle > 0) {
    acceleration = config.accel * chosenAction.throttle;
  } else if (chosenAction.throttle < 0) {
    acceleration = config.brake * chosenAction.throttle;
  }

  state.speed += acceleration * dt;
  state.speed *= Math.max(0, 1 - config.drag * dt);
  state.speed = clamp(state.speed, 0, config.maxSpeed);

  const speedFactor = 0.22 + 0.78 * (state.speed / config.maxSpeed);
  state.angularVelocity = state.steer * config.turnRate * speedFactor;
  state.heading = wrapAngle(state.heading + state.angularVelocity * dt);

  state.x += Math.cos(state.heading) * state.speed * dt;
  state.y += Math.sin(state.heading) * state.speed * dt;

  return state;
}

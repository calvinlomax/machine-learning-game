import { ReplayBuffer } from "./replay.js";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function argMax(values) {
  let bestIndex = 0;
  let bestValue = values[0] ?? 0;

  for (let i = 1; i < values.length; i += 1) {
    if (values[i] > bestValue) {
      bestValue = values[i];
      bestIndex = i;
    }
  }

  return bestIndex;
}

function createMatrix(rows, cols, rng, scale) {
  const matrix = new Array(rows);
  for (let r = 0; r < rows; r += 1) {
    const row = new Float32Array(cols);
    for (let c = 0; c < cols; c += 1) {
      row[c] = rng.range(-scale, scale);
    }
    matrix[r] = row;
  }
  return matrix;
}

class TinyQNetwork {
  constructor(inputSize, hiddenSize, outputSize, rng) {
    this.inputSize = inputSize;
    this.hiddenSize = hiddenSize;
    this.outputSize = outputSize;

    const scale1 = Math.sqrt(2 / (inputSize + hiddenSize));
    const scale2 = Math.sqrt(2 / (hiddenSize + outputSize));

    this.w1 = createMatrix(hiddenSize, inputSize, rng, scale1);
    this.b1 = new Float32Array(hiddenSize);

    this.w2 = createMatrix(outputSize, hiddenSize, rng, scale2);
    this.b2 = new Float32Array(outputSize);
  }

  copyFrom(other) {
    for (let h = 0; h < this.hiddenSize; h += 1) {
      this.w1[h].set(other.w1[h]);
      this.b1[h] = other.b1[h];
    }

    for (let o = 0; o < this.outputSize; o += 1) {
      this.w2[o].set(other.w2[o]);
      this.b2[o] = other.b2[o];
    }
  }

  forward(observation) {
    const preHidden = new Float32Array(this.hiddenSize);
    const hidden = new Float32Array(this.hiddenSize);

    for (let h = 0; h < this.hiddenSize; h += 1) {
      let sum = this.b1[h];
      const row = this.w1[h];
      for (let i = 0; i < this.inputSize; i += 1) {
        sum += row[i] * observation[i];
      }
      preHidden[h] = sum;
      hidden[h] = sum > 0 ? sum : 0;
    }

    const qValues = new Float32Array(this.outputSize);
    for (let o = 0; o < this.outputSize; o += 1) {
      let sum = this.b2[o];
      const row = this.w2[o];
      for (let h = 0; h < this.hiddenSize; h += 1) {
        sum += row[h] * hidden[h];
      }
      qValues[o] = sum;
    }

    return {
      preHidden,
      hidden,
      qValues
    };
  }

  predict(observation) {
    return this.forward(observation).qValues;
  }

  trainBatch(batch, targetNetwork, gamma, learningRate) {
    if (!batch.length) {
      return null;
    }

    const gradW1 = new Array(this.hiddenSize);
    const gradB1 = new Float32Array(this.hiddenSize);
    for (let h = 0; h < this.hiddenSize; h += 1) {
      gradW1[h] = new Float32Array(this.inputSize);
    }

    const gradW2 = new Array(this.outputSize);
    const gradB2 = new Float32Array(this.outputSize);
    for (let o = 0; o < this.outputSize; o += 1) {
      gradW2[o] = new Float32Array(this.hiddenSize);
    }

    let loss = 0;

    for (let b = 0; b < batch.length; b += 1) {
      const sample = batch[b];
      const forwardPass = this.forward(sample.state);
      const currentQ = forwardPass.qValues[sample.action];
      const nextQ = targetNetwork.predict(sample.nextState);

      let maxNextQ = nextQ[0] ?? 0;
      for (let i = 1; i < nextQ.length; i += 1) {
        if (nextQ[i] > maxNextQ) {
          maxNextQ = nextQ[i];
        }
      }

      const target = sample.done ? sample.reward : sample.reward + gamma * maxNextQ;
      const error = currentQ - target;
      loss += 0.5 * error * error;

      gradB2[sample.action] += error;
      const actionW2Grad = gradW2[sample.action];
      for (let h = 0; h < this.hiddenSize; h += 1) {
        actionW2Grad[h] += error * forwardPass.hidden[h];
      }

      for (let h = 0; h < this.hiddenSize; h += 1) {
        if (forwardPass.preHidden[h] <= 0) {
          continue;
        }

        const hiddenGrad = this.w2[sample.action][h] * error;
        gradB1[h] += hiddenGrad;

        const hiddenW1Grad = gradW1[h];
        for (let i = 0; i < this.inputSize; i += 1) {
          hiddenW1Grad[i] += hiddenGrad * sample.state[i];
        }
      }
    }

    const invBatch = 1 / batch.length;
    const clipMagnitude = 5;

    for (let h = 0; h < this.hiddenSize; h += 1) {
      const row = this.w1[h];
      const gradRow = gradW1[h];
      for (let i = 0; i < this.inputSize; i += 1) {
        const grad = clamp(gradRow[i] * invBatch, -clipMagnitude, clipMagnitude);
        row[i] -= learningRate * grad;
      }
      const biasGrad = clamp(gradB1[h] * invBatch, -clipMagnitude, clipMagnitude);
      this.b1[h] -= learningRate * biasGrad;
    }

    for (let o = 0; o < this.outputSize; o += 1) {
      const row = this.w2[o];
      const gradRow = gradW2[o];
      for (let h = 0; h < this.hiddenSize; h += 1) {
        const grad = clamp(gradRow[h] * invBatch, -clipMagnitude, clipMagnitude);
        row[h] -= learningRate * grad;
      }
      const biasGrad = clamp(gradB2[o] * invBatch, -clipMagnitude, clipMagnitude);
      this.b2[o] -= learningRate * biasGrad;
    }

    return loss * invBatch;
  }
}

function sanitizeHyperparams(input) {
  return {
    learningRate: clamp(input.learningRate, 1e-5, 1e-2),
    gamma: clamp(input.gamma, 0.8, 0.999),
    epsilonStart: clamp(input.epsilonStart, 0.1, 1),
    epsilonMin: clamp(input.epsilonMin, 0.01, 0.2),
    epsilonDecay: clamp(input.epsilonDecay, 0.9, 0.9999),
    batchSize: Math.floor(clamp(input.batchSize, 16, 256)),
    replayBufferSize: Math.floor(clamp(input.replayBufferSize, 1000, 50000)),
    targetUpdatePeriod: Math.floor(clamp(input.targetUpdatePeriod, 50, 5000)),
    trainingStepsPerEnvStep: Math.floor(clamp(input.trainingStepsPerEnvStep, 1, 10))
  };
}

export class DQNAgent {
  constructor({ observationSize, actionSize, rng, hyperparams }) {
    this.observationSize = observationSize;
    this.actionSize = actionSize;
    this.hiddenSize = 32;
    this.rng = rng;

    this.hyperparams = sanitizeHyperparams(hyperparams);

    this.onlineNetwork = new TinyQNetwork(
      this.observationSize,
      this.hiddenSize,
      this.actionSize,
      this.rng
    );

    this.targetNetwork = new TinyQNetwork(
      this.observationSize,
      this.hiddenSize,
      this.actionSize,
      this.rng
    );

    this.targetNetwork.copyFrom(this.onlineNetwork);

    this.replay = new ReplayBuffer(this.hyperparams.replayBufferSize);
    this.epsilon = this.hyperparams.epsilonStart;

    this.trainingStepCount = 0;
    this.lastLoss = null;
  }

  setHyperparams(nextHyperparams) {
    const merged = sanitizeHyperparams({ ...this.hyperparams, ...nextHyperparams });
    const previousReplaySize = this.hyperparams.replayBufferSize;

    this.hyperparams = merged;

    if (merged.replayBufferSize !== previousReplaySize) {
      this.replay.resize(merged.replayBufferSize);
    }

    this.epsilon = clamp(this.epsilon, this.hyperparams.epsilonMin, this.hyperparams.epsilonStart);
  }

  act(observation) {
    if (this.rng.next() < this.epsilon) {
      return Math.floor(this.rng.next() * this.actionSize);
    }

    const qValues = this.onlineNetwork.predict(observation);
    return argMax(qValues);
  }

  remember(transition) {
    this.replay.push({
      state: Float32Array.from(transition.state),
      action: transition.action,
      reward: transition.reward,
      nextState: Float32Array.from(transition.nextState),
      done: Boolean(transition.done)
    });
  }

  train(stepsOverride) {
    const requestedSteps = Number.isFinite(stepsOverride)
      ? Math.floor(stepsOverride)
      : this.hyperparams.trainingStepsPerEnvStep;

    const steps = Math.max(1, requestedSteps);
    let updates = 0;
    let latestLoss = null;

    for (let i = 0; i < steps; i += 1) {
      if (this.replay.size === 0) {
        break;
      }

      const batchSize = Math.max(1, Math.min(this.hyperparams.batchSize, this.replay.size));
      const batch = this.replay.sample(batchSize, this.rng);
      if (!batch.length) {
        break;
      }

      latestLoss = this.onlineNetwork.trainBatch(
        batch,
        this.targetNetwork,
        this.hyperparams.gamma,
        this.hyperparams.learningRate
      );

      this.trainingStepCount += 1;
      updates += 1;

      if (this.trainingStepCount % this.hyperparams.targetUpdatePeriod === 0) {
        this.targetNetwork.copyFrom(this.onlineNetwork);
      }
    }

    if (updates > 0) {
      this.lastLoss = latestLoss;
    }

    return {
      updates,
      loss: latestLoss,
      replaySize: this.replay.size,
      skipped: updates === 0
    };
  }

  onEpisodeEnd() {
    this.epsilon = Math.max(this.hyperparams.epsilonMin, this.epsilon * this.hyperparams.epsilonDecay);
  }

  resetModel() {
    this.onlineNetwork = new TinyQNetwork(
      this.observationSize,
      this.hiddenSize,
      this.actionSize,
      this.rng
    );

    this.targetNetwork = new TinyQNetwork(
      this.observationSize,
      this.hiddenSize,
      this.actionSize,
      this.rng
    );

    this.targetNetwork.copyFrom(this.onlineNetwork);
    this.replay = new ReplayBuffer(this.hyperparams.replayBufferSize);

    this.epsilon = this.hyperparams.epsilonStart;
    this.trainingStepCount = 0;
    this.lastLoss = null;
  }
}

function drawPolyline(ctx, points, closePath = false) {
  if (!points || points.length === 0) {
    return;
  }

  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i += 1) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  if (closePath) {
    ctx.closePath();
  }
}

export function createRenderer(canvas, { worldWidth = 900, worldHeight = 600 } = {}) {
  const ctx = canvas.getContext("2d", { alpha: false });
  let dpr = Math.max(1, window.devicePixelRatio || 1);

  function resizeForDpr() {
    const nextDpr = Math.max(1, window.devicePixelRatio || 1);
    if (nextDpr !== dpr || canvas.width !== Math.floor(worldWidth * dpr) || canvas.height !== Math.floor(worldHeight * dpr)) {
      dpr = nextDpr;
      canvas.width = Math.floor(worldWidth * dpr);
      canvas.height = Math.floor(worldHeight * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function drawBackground() {
    const gradient = ctx.createLinearGradient(0, 0, worldWidth, worldHeight);
    gradient.addColorStop(0, "#1b2b2f");
    gradient.addColorStop(1, "#253d42");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, worldWidth, worldHeight);

    ctx.fillStyle = "rgba(255, 255, 255, 0.03)";
    for (let x = -worldHeight; x < worldWidth + worldHeight; x += 42) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + worldHeight, worldHeight);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.04)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  function drawTrack(track) {
    if (!track) {
      return;
    }

    const roadColor = "#576f57";
    const boundaryColor = "#f4ead2";

    ctx.fillStyle = roadColor;
    ctx.beginPath();
    ctx.moveTo(track.leftBoundary[0].x, track.leftBoundary[0].y);
    for (let i = 1; i < track.leftBoundary.length; i += 1) {
      ctx.lineTo(track.leftBoundary[i].x, track.leftBoundary[i].y);
    }
    for (let i = track.rightBoundary.length - 1; i >= 0; i -= 1) {
      ctx.lineTo(track.rightBoundary[i].x, track.rightBoundary[i].y);
    }
    ctx.closePath();
    ctx.fill();

    ctx.lineWidth = 3;
    ctx.strokeStyle = "#1d2620";
    drawPolyline(ctx, track.leftBoundary, true);
    ctx.stroke();
    drawPolyline(ctx, track.rightBoundary, true);
    ctx.stroke();

    ctx.lineWidth = 2;
    ctx.strokeStyle = boundaryColor;
    drawPolyline(ctx, track.leftBoundary, true);
    ctx.stroke();
    drawPolyline(ctx, track.rightBoundary, true);
    ctx.stroke();

    ctx.save();
    ctx.setLineDash([8, 7]);
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = "rgba(250, 248, 237, 0.45)";
    drawPolyline(ctx, track.centerline, true);
    ctx.stroke();
    ctx.restore();

    ctx.save();
    const { a, b } = track.startLine;
    ctx.lineWidth = 5;
    ctx.strokeStyle = "#f8f4ea";
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();

    ctx.setLineDash([6, 6]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#1a1a1a";
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.restore();
  }

  function drawTrail(trail) {
    if (!trail || trail.length < 2) {
      return;
    }

    ctx.lineWidth = 1.8;
    ctx.strokeStyle = "rgba(255, 196, 77, 0.55)";
    drawPolyline(ctx, trail, false);
    ctx.stroke();
  }

  function drawSensors(car, sensorHits) {
    if (!car || !sensorHits || !sensorHits.length) {
      return;
    }

    ctx.lineWidth = 1.2;
    ctx.strokeStyle = "rgba(122, 219, 255, 0.8)";

    for (let i = 0; i < sensorHits.length; i += 1) {
      const hit = sensorHits[i];
      ctx.beginPath();
      ctx.moveTo(car.x, car.y);
      ctx.lineTo(hit.x, hit.y);
      ctx.stroke();

      ctx.fillStyle = "rgba(182, 241, 255, 0.95)";
      ctx.beginPath();
      ctx.arc(hit.x, hit.y, 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawCar(car) {
    if (!car) {
      return;
    }

    ctx.save();
    ctx.translate(car.x, car.y);
    ctx.rotate(car.heading);

    ctx.fillStyle = "#f49b2c";
    ctx.strokeStyle = "#311809";
    ctx.lineWidth = 1.5;

    ctx.beginPath();
    ctx.moveTo(14, 0);
    ctx.lineTo(-12, -8);
    ctx.lineTo(-7, 0);
    ctx.lineTo(-12, 8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#f7e4bf";
    ctx.beginPath();
    ctx.moveTo(6, 0);
    ctx.lineTo(-5, -4.2);
    ctx.lineTo(-5, 4.2);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  function render({ track, car, trail, sensorHits, showSensors, showTrail }) {
    resizeForDpr();
    drawBackground();
    drawTrack(track);
    if (showTrail) {
      drawTrail(trail);
    }
    if (showSensors) {
      drawSensors(car, sensorHits);
    }
    drawCar(car);
  }

  resizeForDpr();

  return {
    render,
    resizeForDpr
  };
}

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

const DEFAULT_CAR_STYLE = {
  primary: "#f49b2c",
  secondary: "#311809",
  accent: "#f7e4bf"
};

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

  function drawCar(car, carStyle = DEFAULT_CAR_STYLE) {
    if (!car) {
      return;
    }

    const primary = carStyle?.primary || DEFAULT_CAR_STYLE.primary;
    const secondary = carStyle?.secondary || DEFAULT_CAR_STYLE.secondary;
    const accent = carStyle?.accent || DEFAULT_CAR_STYLE.accent;

    ctx.save();
    ctx.translate(car.x, car.y);
    ctx.rotate(car.heading);

    ctx.fillStyle = "#111111";
    ctx.beginPath();
    ctx.arc(7, -7.4, 2.25, 0, Math.PI * 2);
    ctx.arc(7, 7.4, 2.25, 0, Math.PI * 2);
    ctx.arc(-14, -8.7, 2.35, 0, Math.PI * 2);
    ctx.arc(-14, 8.7, 2.35, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = primary;
    ctx.strokeStyle = "#121212";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(17, 0);
    ctx.lineTo(10.5, -4.2);
    ctx.lineTo(2.6, -5.5);
    ctx.lineTo(-8.5, -6.5);
    ctx.lineTo(-14.4, -8.4);
    ctx.lineTo(-21, -8.4);
    ctx.lineTo(-21, 8.4);
    ctx.lineTo(-14.4, 8.4);
    ctx.lineTo(-8.5, 6.5);
    ctx.lineTo(2.6, 5.5);
    ctx.lineTo(10.5, 4.2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = secondary;
    ctx.beginPath();
    ctx.moveTo(8.3, 0);
    ctx.lineTo(4.2, -2.4);
    ctx.lineTo(-10.6, -2.8);
    ctx.lineTo(-13.8, -5.7);
    ctx.lineTo(-13.8, 5.7);
    ctx.lineTo(-10.6, 2.8);
    ctx.lineTo(4.2, 2.4);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.moveTo(17, 0);
    ctx.lineTo(8.7, -1.9);
    ctx.lineTo(8.7, 1.9);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = secondary;
    ctx.fillRect(14.2, -7.1, 6.4, 2.5);
    ctx.fillRect(14.2, 4.6, 6.4, 2.5);
    ctx.fillRect(12.8, -4.6, 1.4, 9.2);

    ctx.fillStyle = accent;
    ctx.fillRect(-23.9, -8.9, 2.2, 17.8);
    ctx.fillRect(-26.3, -9.9, 2.6, 19.8);

    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(-11, -4.2);
    ctx.lineTo(8.2, -1.55);
    ctx.moveTo(-11, 4.2);
    ctx.lineTo(8.2, 1.55);
    ctx.stroke();

    ctx.fillStyle = "#171717";
    ctx.beginPath();
    ctx.moveTo(2.3, 0);
    ctx.lineTo(-0.9, -1.1);
    ctx.lineTo(-4.6, 0);
    ctx.lineTo(-0.9, 1.1);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  function render({ track, car, trail, sensorHits, showSensors, showTrail, carStyle }) {
    resizeForDpr();
    drawBackground();
    drawTrack(track);
    if (showTrail) {
      drawTrail(trail);
    }
    if (showSensors) {
      drawSensors(car, sensorHits);
    }
    drawCar(car, carStyle);
  }

  resizeForDpr();

  return {
    render,
    resizeForDpr
  };
}

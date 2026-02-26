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
    if (!car) return;

    const primary = carStyle?.primary || DEFAULT_CAR_STYLE.primary;
    const secondary = carStyle?.secondary || DEFAULT_CAR_STYLE.secondary;
    const accent = carStyle?.accent || DEFAULT_CAR_STYLE.accent;

    ctx.save();
    ctx.translate(car.x, car.y);
    ctx.rotate(car.heading);

    // -------- Wheels (bigger rear, slightly larger track) --------
    ctx.fillStyle = "#101010";
    ctx.beginPath();
    // front wheels
    ctx.arc(9.5, -8.2, 2.15, 0, Math.PI * 2);
    ctx.arc(9.5, 8.2, 2.15, 0, Math.PI * 2);
    // rear wheels
    ctx.arc(-15.8, -9.6, 2.55, 0, Math.PI * 2);
    ctx.arc(-15.8, 9.6, 2.55, 0, Math.PI * 2);
    ctx.fill();

    // -------- Main body (F1-ish outline: nose, sidepods, taper to rear) --------
    ctx.fillStyle = primary;
    ctx.strokeStyle = "#121212";
    ctx.lineWidth = 1.2;

    ctx.beginPath();
    // nose tip
    ctx.moveTo(18.5, 0);
    // front wing area
    ctx.lineTo(13.0, -5.0);
    // nose narrowing
    ctx.lineTo(8.2, -3.6);
    // chassis to sidepod
    ctx.lineTo(2.8, -5.9);
    // sidepod bulge
    ctx.lineTo(-8.8, -7.4);
    // rear body
    ctx.lineTo(-16.8, -9.0);
    // rear wing mount area
    ctx.lineTo(-23.8, -9.0);
    ctx.lineTo(-23.8, 9.0);
    ctx.lineTo(-16.8, 9.0);
    ctx.lineTo(-8.8, 7.4);
    ctx.lineTo(2.8, 5.9);
    ctx.lineTo(8.2, 3.6);
    ctx.lineTo(13.0, 5.0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // -------- Cockpit + engine cover (secondary) --------
    ctx.fillStyle = secondary;
    ctx.beginPath();
    ctx.moveTo(6.8, 0);
    ctx.lineTo(3.2, -2.3);
    ctx.lineTo(-7.8, -2.9);
    ctx.lineTo(-12.8, -6.0);
    ctx.lineTo(-15.5, -6.0);
    ctx.lineTo(-15.5, 6.0);
    ctx.lineTo(-12.8, 6.0);
    ctx.lineTo(-7.8, 2.9);
    ctx.lineTo(3.2, 2.3);
    ctx.closePath();
    ctx.fill();

    // cockpit opening (dark)
    ctx.fillStyle = "#151515";
    ctx.beginPath();
    ctx.moveTo(-1.2, 0);
    ctx.lineTo(-3.4, -1.4);
    ctx.lineTo(-6.1, 0);
    ctx.lineTo(-3.4, 1.4);
    ctx.closePath();
    ctx.fill();

    // -------- Nose tip accent --------
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.moveTo(18.5, 0);
    ctx.lineTo(10.4, -1.9);
    ctx.lineTo(10.4, 1.9);
    ctx.closePath();
    ctx.fill();

    // -------- Front wing (secondary) --------
    ctx.fillStyle = secondary;
    // upper/lower main planes
    ctx.fillRect(13.9, -8.1, 7.4, 2.6);
    ctx.fillRect(13.9, 5.5, 7.4, 2.6);
    // center pillar
    ctx.fillRect(12.4, -5.5, 1.5, 11.0);

    // -------- Rear wing (accent) --------
    ctx.fillStyle = accent;
    // endplates + element
    ctx.fillRect(-24.9, -9.8, 2.4, 19.6);
    ctx.fillRect(-27.7, -10.8, 3.0, 21.6);
    // top flap
    ctx.fillRect(-28.2, -10.8, 6.0, 1.5);
    ctx.fillRect(-28.2, 9.3, 6.0, 1.5);

    // -------- Sidepod stripes (accent strokes) --------
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.05;
    ctx.beginPath();
    ctx.moveTo(-10.8, -4.7);
    ctx.lineTo(8.8, -1.6);
    ctx.moveTo(-10.8, 4.7);
    ctx.lineTo(8.8, 1.6);
    ctx.stroke();

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

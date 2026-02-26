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

    // Scale to match your existing coordinate system.
    // If the car looks too big/small, change s.
    const s = 1.0;
    ctx.scale(s, s);

    // ---------- Wheels (open wheel look) ----------
    const wheelFill = "#0f0f10";
    ctx.fillStyle = wheelFill;

    // rear wheels (bigger)
    ctx.beginPath();
    ctx.roundRect(-17.5, -11.0, 6.8, 6.8, 1.6);
    ctx.roundRect(-17.5, 4.2, 6.8, 6.8, 1.6);
    ctx.fill();

    // front wheels (smaller)
    ctx.beginPath();
    ctx.roundRect(8.6, -10.0, 6.2, 6.2, 1.6);
    ctx.roundRect(8.6, 3.8, 6.2, 6.2, 1.6);
    ctx.fill();

    // ---------- Main silhouette (simplified F1 top view) ----------
    // Nose -> sidepods -> engine cover -> rear section
    ctx.fillStyle = primary;
    ctx.strokeStyle = "#141414";
    ctx.lineWidth = 1.2;

    ctx.beginPath();
    // nose tip
    ctx.moveTo(22.0, 0);

    // upper nose edge to front axle area
    ctx.quadraticCurveTo(16.8, -2.0, 12.5, -2.6);

    // widen to sidepods
    ctx.quadraticCurveTo(5.0, -3.8, 1.0, -6.8);
    ctx.quadraticCurveTo(-4.0, -10.4, -10.5, -10.2);

    // rear body widening near suspension
    ctx.quadraticCurveTo(-15.2, -10.0, -19.8, -8.6);

    // rear-most body (before wing)
    ctx.quadraticCurveTo(-24.2, -7.2, -24.2, -3.0);
    ctx.lineTo(-24.2, 3.0);
    ctx.quadraticCurveTo(-24.2, 7.2, -19.8, 8.6);

    // mirror back along lower edge
    ctx.quadraticCurveTo(-15.2, 10.0, -10.5, 10.2);
    ctx.quadraticCurveTo(-4.0, 10.4, 1.0, 6.8);
    ctx.quadraticCurveTo(5.0, 3.8, 12.5, 2.6);
    ctx.quadraticCurveTo(16.8, 2.0, 22.0, 0);

    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // ---------- Front wing (simple) ----------
    ctx.fillStyle = secondary;
    // main plane
    ctx.beginPath();
    ctx.roundRect(16.0, -10.8, 9.2, 3.0, 1.2);
    ctx.roundRect(16.0, 7.8, 9.2, 3.0, 1.2);
    ctx.fill();
    // center pillar
    ctx.beginPath();
    ctx.roundRect(14.6, -3.6, 1.8, 7.2, 0.9);
    ctx.fill();

    // ---------- Rear wing (simple) ----------
    ctx.fillStyle = accent;
    // endplates
    ctx.beginPath();
    ctx.roundRect(-30.0, -11.2, 3.2, 22.4, 1.2);
    ctx.roundRect(-26.3, -10.0, 2.4, 20.0, 1.1);
    ctx.fill();
    // top/bottom flaps
    ctx.beginPath();
    ctx.roundRect(-30.6, -11.2, 8.8, 1.8, 0.9);
    ctx.roundRect(-30.6, 9.4, 8.8, 1.8, 0.9);
    ctx.fill();

    // ---------- Cockpit + engine cover ----------
    ctx.fillStyle = secondary;
    ctx.beginPath();
    // cockpit spine
    ctx.moveTo(8.5, 0);
    ctx.quadraticCurveTo(4.0, -2.4, -3.0, -2.8);
    ctx.quadraticCurveTo(-9.8, -3.2, -13.6, -6.8);
    ctx.lineTo(-16.6, -6.8);
    ctx.quadraticCurveTo(-18.8, -6.8, -19.0, -4.5);
    ctx.lineTo(-19.0, 4.5);
    ctx.quadraticCurveTo(-18.8, 6.8, -16.6, 6.8);
    ctx.lineTo(-13.6, 6.8);
    ctx.quadraticCurveTo(-9.8, 3.2, -3.0, 2.8);
    ctx.quadraticCurveTo(4.0, 2.4, 8.5, 0);
    ctx.closePath();
    ctx.fill();

    // cockpit opening
    ctx.fillStyle = "#151515";
    ctx.beginPath();
    ctx.ellipse(-1.8, 0, 2.5, 1.6, 0, 0, Math.PI * 2);
    ctx.fill();

    // ---------- Accents (nose + sidepod lines) ----------
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.moveTo(22.0, 0);
    ctx.lineTo(13.2, -2.1);
    ctx.lineTo(13.2, 2.1);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.05;
    ctx.beginPath();
    ctx.moveTo(-10.0, -5.2);
    ctx.lineTo(10.2, -1.8);
    ctx.moveTo(-10.0, 5.2);
    ctx.lineTo(10.2, 1.8);
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

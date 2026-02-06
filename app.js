const form = document.getElementById("calc-form");
const resultEl = document.getElementById("result");
const warningsEl = document.getElementById("warnings");
const resetBtn = document.getElementById("reset");
const presetSelect = document.getElementById("preset");

const inputs = {
  energy: document.getElementById("energy"),
  time: document.getElementById("time"),
  target: document.getElementById("target"),
  maxGates: document.getElementById("maxGates"),
  t: document.getElementById("t"),
};

const presets = {
  "source-ore": { time: "8", energy: "50" },
  "valley-low": { time: "40", energy: "220" },
  "valley-mid": { time: "40", energy: "420" },
  "valley-high": { time: "40", energy: "1100" },
  "wuling-low": { time: "40", energy: "1600" },
};

function showWarning(message) {
  warningsEl.textContent = message;
}

function clearWarning() {
  warningsEl.textContent = "";
}

function parsePositiveBigInt(value, label) {
  const trimmed = value.trim();
  if (!/^[0-9]+$/.test(trimmed)) {
    throw new Error(`${label} 只能输入非负整数。`);
  }
  const n = BigInt(trimmed);
  if (n <= 0n) {
    throw new Error(`${label} 必须大于 0。`);
  }
  return n;
}

function parseNonNegativeInt(value, label) {
  const trimmed = value.trim();
  if (!/^[0-9]+$/.test(trimmed)) {
    throw new Error(`${label} 只能输入正整数。`);
  }
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`${label} 不能为负数。`);
  }
  return n;
}

function gcd(a, b) {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x;
}

function reduceRat(rat) {
  const g = gcd(rat.n, rat.d);
  if (g > 1n) {
    rat.n /= g;
    rat.d /= g;
  }
  return rat;
}

function parseRational(value) {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("电池输入速率不能为空。");
  }
  if (trimmed.includes("/")) {
    const [nStr, dStr] = trimmed.split("/").map((v) => v.trim());
    if (!/^[0-9]+$/.test(nStr) || !/^[0-9]+$/.test(dStr)) {
      throw new Error("电池输入速率分数格式应为 1/2。");
    }
    const n = BigInt(nStr);
    const d = BigInt(dStr);
    if (d === 0n || n <= 0n) {
      throw new Error("电池输入速率必须大于 0。");
    }
    return reduceRat({ n, d });
  }
  if (trimmed.includes(".")) {
    if (!/^[0-9]*\.[0-9]+$/.test(trimmed)) {
      throw new Error("电池输入速率小数格式应为 0.5。");
    }
    const [intPart, fracPart] = trimmed.split(".");
    const digits = fracPart.length;
    const denom = 10n ** BigInt(digits);
    const num = BigInt((intPart || "0") + fracPart);
    if (num <= 0n) {
      throw new Error("电池输入速率必须大于 0。");
    }
    return reduceRat({ n: num, d: denom });
  }
  if (!/^[0-9]+$/.test(trimmed)) {
    throw new Error("电池输入速率格式不正确。");
  }
  const n = BigInt(trimmed);
  if (n <= 0n) {
    throw new Error("电池输入速率必须大于 0。");
  }
  return { n, d: 1n };
}

function compareRat(a, b) {
  const left = a.n * b.d;
  const right = b.n * a.d;
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function ratToString(rat) {
  if (rat.d === 1n) return rat.n.toString();
  return `${rat.n.toString()}/${rat.d.toString()}`;
}

function ratToDecimal(rat, digits) {
  if (digits <= 0) return rat.n / rat.d;
  const sign = rat.n < 0n ? "-" : "";
  let n = rat.n < 0n ? -rat.n : rat.n;
  const d = rat.d;
  const intPart = n / d;
  let rem = n % d;
  let frac = "";
  for (let i = 0; i < digits; i++) {
    rem *= 10n;
    const digit = rem / d;
    frac += digit.toString();
    rem = rem % d;
  }
  return `${sign}${intPart.toString()}.${frac}`;
}

function fracLess(m1, d1, m2, d2) {
  if (m2 === null || d2 === null) return true;
  return m1 * d2 < m2 * d1;
}

function fracEqual(m1, d1, m2, d2) {
  if (m2 === null || d2 === null) return false;
  return m1 * d2 === m2 * d1;
}

function findBest(p, q, target, maxGates) {
  const one = 1n;
  let best = null;
  let D2 = 1n;
  const two = 2n;
  const three = 3n;
  const tq = target * q;

  for (let a = 0; a <= maxGates; a++) {
    let D = D2;
    for (let b = 0; b <= maxGates - a; b++) {
      const m = (tq * D) / p + 1n;
      if (m <= D) {
        if (
          !best ||
          fracLess(m, D, best.m, best.d) ||
          (fracEqual(m, D, best.m, best.d) && a + b < best.a + best.b)
        ) {
          best = { a, b, m, d: D };
        }
      }
      D = D * three;
    }
    D2 = D2 * two;
  }

  if (!best || best.m < one) return null;
  return best;
}

function buildDAG(best) {
  if (best.a === 0 && best.b === 0) {
    const leaf = { id: 1, den: 1n, to: "OUT", from: 0 };
    return { gates: [], leaves: [leaf] };
  }

  const kList = [];
  for (let i = 0; i < best.b; i++) kList.push(3);
  for (let i = 0; i < best.a; i++) kList.push(2);

  const gates = [];
  const leaves = [];
  let mRemain = best.m;
  let DRemain = best.d;
  let den = 1n;
  let leafID = 1;

  for (let i = 0; i < kList.length; i++) {
    const k = kList[i];
    den = den * BigInt(k);
    DRemain = DRemain / BigInt(k);

    let x = mRemain / DRemain;
    const maxX = BigInt(k - 1);
    if (x > maxX) x = maxX;

    if (x > 0n) {
      mRemain = mRemain - x * DRemain;
    }

    const gate = {
      id: i + 1,
      k,
      in: i > 0 ? `G${i}.out0` : "IN",
      outContinue: "",
      leafIDs: [],
      leafDen: den,
    };

    for (let j = 0; j < k - 1; j++) {
      const to = BigInt(j) < x ? "OUT" : "WAREHOUSE";
      const leaf = { id: leafID, den, to, from: gate.id };
      leaves.push(leaf);
      gate.leafIDs.push(leafID);
      leafID++;
    }

    if (i === kList.length - 1) {
      const to = mRemain === 1n ? "OUT" : "WAREHOUSE";
      const leaf = { id: leafID, den, to, from: gate.id };
      leaves.push(leaf);
      gate.outContinue = `L${leafID}`;
      leafID++;
      mRemain = 0n;
    } else {
      gate.outContinue = `G${i + 2}.out0`;
    }

    gates.push(gate);
  }

  return { gates, leaves };
}

function localizeNode(node) {
  if (node === "OUT") return "输出";
  if (node === "WAREHOUSE") return "仓库";
  if (node.startsWith("G")) {
    const gatePart = node.split(".")[0];
    const id = gatePart.replace(/[^0-9]/g, "");
    return `分流器${id}`;
  }
  return node;
}

function gateOutLabel(out, leafTo) {
  if (out.startsWith("G")) {
    const gatePart = out.split(".")[0];
    const id = gatePart.replace(/[^0-9]/g, "");
    return `分流器${id}`;
  }
  if (out.startsWith("L")) {
    const id = Number(out.replace(/[^0-9]/g, ""));
    const dest = leafTo.get(id);
    return localizeNode(dest || out);
  }
  return localizeNode(out);
}

function buildConnectionLines(gates, leaves) {
  if (gates.length === 0) {
    return ["(无)", "直接输出，无分流器。"];
  }
  const leafTo = new Map();
  for (const leaf of leaves) {
    leafTo.set(leaf.id, leaf.to);
  }

  const lines = [];
  for (const gate of gates) {
    const outs = [];
    outs.push(gateOutLabel(gate.outContinue, leafTo));
    for (const lid of gate.leafIDs) {
      outs.push(localizeNode(leafTo.get(lid)));
    }
    lines.push(`分流器${gate.id}: ${outs.join(" ")}`);
  }
  return lines;
}

function calculate() {
  clearWarning();
  const energy = parsePositiveBigInt(inputs.energy.value, "电池输出功率");
  const time = parsePositiveBigInt(inputs.time.value, "持续时间");
  const target = parsePositiveBigInt(inputs.target.value, "目标功率");
  const maxGates = parseNonNegativeInt(inputs.maxGates.value, "最大分流器数量");
  const tRat = parseRational(inputs.t.value || "0.5");

  if (maxGates > 100) {
    showWarning("提示：最大分流器数量过高可能导致浏览器计算时间变长。");
  }

  let p = energy * time * tRat.n;
  let q = tRat.d;
  const g = gcd(p, q);
  if (g > 1n) {
    p = p / g;
    q = q / g;
  }

  const pIn = { n: p, d: q };
  const targetRat = { n: target, d: 1n };
  if (compareRat(pIn, targetRat) <= 0) {
    throw new Error("无解：目标功率不小于输入功率。");
  }

  const best = findBest(p, q, target, maxGates);
  if (!best) {
    throw new Error("无解：在给定最大分流器数量内未找到可行方案。");
  }

  const output = reduceRat({ n: p * best.m, d: q * best.d });
  const dag = buildDAG(best);
  const connections = buildConnectionLines(dag.gates, dag.leaves);

  const lines = [];
  lines.push("结果");
  lines.push(`输入功率 P_in = ${ratToString(pIn)} (约 ${ratToDecimal(pIn, 6)})`);
  lines.push(`目标功率 = ${target.toString()}`);
  lines.push(
    `最优分数 = ${best.m.toString()}/${best.d.toString()} (分流器数量=${best.a + best.b}, 1/2=${best.a}, 1/3=${best.b})`
  );
  lines.push(`输出功率 = ${ratToString(output)} (约 ${ratToDecimal(output, 6)})`);
  lines.push("");
  lines.push("连接方式");
  lines.push(...connections);

  return lines.join("\n");
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  try {
    const output = calculate();
    resultEl.textContent = output;
  } catch (err) {
    resultEl.textContent = `错误：${err.message || err}`;
  }
});

resetBtn.addEventListener("click", () => {
  form.reset();
  clearWarning();
  resultEl.textContent = "请输入参数后点击开始计算。";
});

if (presetSelect) {
  presetSelect.addEventListener("change", () => {
    const preset = presets[presetSelect.value];
    if (!preset) return;
    inputs.time.value = preset.time;
    inputs.energy.value = preset.energy;
  });
}

function setupGridPattern() {
  const gridEl = document.getElementById("grid-pattern");
  if (!gridEl) return;

  let lastWidth = 0;
  let lastHeight = 0;

  function render() {
    const rawSize = getComputedStyle(document.documentElement)
      .getPropertyValue("--grid-size")
      .trim();
    const size = Number.parseInt(rawSize, 10) || 96;
    const width = Math.ceil(window.innerWidth / size) * size;
    const height = Math.ceil(window.innerHeight / size) * size;

    if (width === lastWidth && height === lastHeight) return;
    lastWidth = width;
    lastHeight = height;

    const cols = Math.ceil(width / size);
    const rows = Math.ceil(height / size);
    const rects = [];

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const cellX = x * size;
        const cellY = y * size;
        if (Math.random() < 0.7) {
          rects.push(
            `<rect x="${cellX}" y="${cellY}" width="${size}" height="${size}" fill="#ffffff"/>`
          );
        } else {
          rects.push(
            `<rect x="${cellX}" y="${cellY}" width="${size}" height="${size}" fill="url(#diag)" stroke="#1f2a32" stroke-opacity="0.18" stroke-width="1"/>`
          );
        }
      }
    }

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" shape-rendering="crispEdges">
  <defs>
    <pattern id="diag" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <line x1="0" y1="0" x2="0" y2="10" stroke="#1f2a32" stroke-opacity="0.08" stroke-width="1"/>
    </pattern>
  </defs>
  ${rects.join("")}
</svg>`;

    const encoded = encodeURIComponent(svg).replace(/%0A/g, "");
    gridEl.style.backgroundImage = `url("data:image/svg+xml,${encoded}")`;
    gridEl.style.backgroundSize = `${width}px ${height}px`;
  }

  window.addEventListener("resize", () => {
    requestAnimationFrame(render);
  });

  render();
}

setupGridPattern();

function setupParticles() {
  const canvas = document.getElementById("particles");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const mouse = { x: 0, y: 0, active: false };
  let width = 0;
  let height = 0;
  let particles = [];

  function createParticles() {
    const area = width * height;
    const count = Math.min(90, Math.max(40, Math.floor(area / 25000)));
    particles = Array.from({ length: count }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * 0.375,
      vy: (Math.random() - 0.5) * 0.375,
      r: 2.4 + Math.random() * 2.2,
    }));
  }

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    createParticles();
  }

  function step() {
    ctx.clearRect(0, 0, width, height);

    for (const p of particles) {
      p.x += p.vx;
      p.y += p.vy;

      if (p.x <= 0 || p.x >= width) {
        p.vx *= -1;
        p.x = Math.min(Math.max(p.x, 0), width);
      }
      if (p.y <= 0 || p.y >= height) {
        p.vy *= -1;
        p.y = Math.min(Math.max(p.y, 0), height);
      }
    }

    const linkDist = 140;
    ctx.lineWidth = 1;
    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const a = particles[i];
        const b = particles[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dist = Math.hypot(dx, dy);
        if (dist < linkDist) {
          const alpha = (linkDist - dist) / linkDist;
          ctx.strokeStyle = `rgba(58, 74, 86, ${0.18 * alpha})`;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }
    }

    if (mouse.active) {
      const mouseDist = 160;
      for (const p of particles) {
        const dx = p.x - mouse.x;
        const dy = p.y - mouse.y;
        const dist = Math.hypot(dx, dy);
        if (dist < mouseDist) {
          const alpha = (mouseDist - dist) / mouseDist;
          ctx.strokeStyle = `rgba(58, 74, 86, ${0.28 * alpha})`;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(mouse.x, mouse.y);
          ctx.stroke();
        }
      }
    }

    ctx.fillStyle = "rgba(58, 74, 86, 0.7)";
    for (const p of particles) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }

    requestAnimationFrame(step);
  }

  window.addEventListener("resize", () => {
    requestAnimationFrame(resize);
  });
  window.addEventListener("mousemove", (event) => {
    mouse.x = event.clientX;
    mouse.y = event.clientY;
    mouse.active = true;
  });
  window.addEventListener("mouseleave", () => {
    mouse.active = false;
  });

  resize();
  requestAnimationFrame(step);
}

setupParticles();
